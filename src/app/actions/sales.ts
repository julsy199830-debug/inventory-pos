"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { NoCashierError, requireCashierSession } from "@/lib/session";
import type { MutationResult } from "@/lib/types";

export type SaleItemInput = {
  productId: string;
  quantity: number;
  priceAtSale: number;
};

export type CreateSaleInput = {
  customerId?: string | null;
  subtotal: number;
  tax: number;
  totalAmount: number;
  paymentMethod: string;
  items: SaleItemInput[];
};

export type CreateSaleResult = MutationResult<{ id: string }>;

/**
 * Create a Sale header + its SaleItem rows, decrement product stock, bump the
 * customer's loyalty points, and (for STORE_CREDIT) verify + raise the
 * customer's outstanding balance — all inside a single `prisma.$transaction`
 * so the ledger can never be left half-written.
 */
export async function createSale(
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  const customerId = input.customerId?.trim() || null;
  const subtotal = Number(input.subtotal);
  const tax = Number(input.tax);
  const totalAmount = Number(input.totalAmount);
  const paymentMethod = (input.paymentMethod ?? "").trim();
  const items = Array.isArray(input.items) ? input.items : [];

  // ── Session gate ──────────────────────────────────────────────────────
  try {
    await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to the register to complete this sale." };
    }
    throw err;
  }

  // ── Server-authoritative validation ────────────────────────────────────
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return { ok: false, error: "Subtotal is invalid." };
  }
  if (!Number.isFinite(tax) || tax < 0) {
    return { ok: false, error: "Tax is invalid." };
  }
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return { ok: false, error: "Total is invalid." };
  }
  if (!paymentMethod) {
    return { ok: false, error: "Payment method is required." };
  }
  // Store Credit ("On Account") can only be used with a customer attached —
  // there's no ledger to charge without an account.
  if (paymentMethod === "STORE_CREDIT" && !customerId) {
    return { ok: false, error: "Select a customer to charge this on account." };
  }
  if (items.length === 0) {
    return { ok: false, error: "Cannot check out an empty cart." };
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    const price = Number(item.priceAtSale);
    if (typeof item.productId !== "string" || item.productId.trim() === "") {
      return { ok: false, error: "A cart item is missing its product." };
    }
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "Quantities must be whole numbers of 1 or more." };
    }
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: "A cart item has an invalid price." };
    }
  }

  // Loyalty points per whole ₱10 of subtotal.
  const earnedPoints = Math.floor(subtotal / 10);

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          customerId,
          subtotal,
          tax,
          totalAmount,
          paymentMethod,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
              priceAtSale: Number(item.priceAtSale),
            })),
          },
        },
        select: { id: true },
      });

      // Decrement stock for each purchased product, auditing each movement.
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stock: true },
        });
        if (!product) {
          throw new Error("PRODUCT_NOT_FOUND");
        }
        const qty = Number(item.quantity);
        if (product.stock < qty) {
          throw new Error("OUT_OF_STOCK");
        }
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            quantityChange: -qty,
            type: "SALE",
          },
        });
      }

      // Store Credit ("On Account" / utang): verify the customer exists and is
      // within their credit limit, then raise their outstanding balance by this
      // sale's total inside the same tx — the ledger can't be half-updated.
      if (paymentMethod === "STORE_CREDIT") {
        if (!customerId) throw new Error("NO_CUSTOMER");
        const account = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, creditLimit: true, currentBalance: true },
        });
        if (!account) throw new Error("CUSTOMER_NOT_FOUND");
        if (account.currentBalance + totalAmount > account.creditLimit) {
          throw new Error("CREDIT_LIMIT_EXCEEDED");
        }
        await tx.customer.update({
          where: { id: account.id },
          data: { currentBalance: { increment: totalAmount } },
        });
      }

      // Loyalty accrual — only when a customer was linked and earned anything.
      if (customerId && earnedPoints > 0) {
        await tx.customer.update({
          where: { id: customerId },
          data: { loyaltyPoints: { increment: earnedPoints } },
        });
      }

      return created;
    });

    revalidatePath("/pos");
    revalidatePath("/");

    return { ok: true as const, data: { id: sale.id } };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "OUT_OF_STOCK") {
        return { ok: false, error: "Some items are out of stock. Please restock or remove them and try again." };
      }
      if (err.message === "PRODUCT_NOT_FOUND") {
        return { ok: false, error: "One of the items in your cart no longer exists." };
      }
      if (err.message === "CREDIT_LIMIT_EXCEEDED") {
        return { ok: false, error: "This customer has reached their credit limit for this transaction." };
      }
      if (err.message === "CUSTOMER_NOT_FOUND") {
        return { ok: false, error: "The selected customer no longer exists." };
      }
    }
    return { ok: false, error: "Could not complete the sale. Please try again." };
  }
}