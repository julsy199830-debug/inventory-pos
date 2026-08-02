"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { MutationResult } from "@/lib/types";

/**
 * One line item in an outgoing sale. The client supplies `productId` and
 * `quantity`; `priceAtSale` is the unit price to snapshot for the ledger. We do
 * NOT trust these blindly server-side — see `createSale`.
 */
export type SaleItemInput = {
  productId: string;
  quantity: number;
  priceAtSale: number;
};

/**
 * Payload for `createSale`. Everything here comes from an untrusted client, so
 * the action re-validates each field rather than assuming the UI ran checks.
 */
export type CreateSaleInput = {
  /** Optional customer for loyalty accrual; null/omitted = guest checkout. */
  customerId?: string | null;
  subtotal: number;
  tax: number;
  totalAmount: number;
  paymentMethod: string;
  items: SaleItemInput[];
};

export type CreateSaleResult = MutationResult<{ id: string }>;

/**
 * Create a Sale header + its SaleItem rows, decrement product stock, and bump
 * the customer's loyalty points — all inside a single `prisma.$transaction` so
 * the ledger can never be left half-written. If any step throws (out-of-stock,
 * deleted product, bad customer id), the whole transaction rolls back and we
 * surface a generic, leak-free error.
 *
 * Loyalty accrues at 1 point per whole $10 spent (subtotal only — tax doesn't
 * count, matching "per $10 spent"). Points are added to whatever the customer
 * already has; the schema itself enforces a 0 floor for new rows, and an update
 * here only ever increases the balance, so it never goes negative.
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

  // ── Server-authoritative validation ────────────────────────────────────
  // The client may have been bypassed entirely — a Server Action is just a
  // POST endpoint to anyone who can craft one.
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
  if (items.length === 0) {
    return { ok: false, error: "Cannot check out an empty cart." };
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    const price = Number(item.priceAtSale);
    if (
      typeof item.productId !== "string" ||
      item.productId.trim() === ""
    ) {
      return { ok: false, error: "A cart item is missing its product." };
    }
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "Quantities must be whole numbers of 1 or more." };
    }
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: "A cart item has an invalid price." };
    }
  }

  // Loyalty points to accrue if a customer was attached. ℹ points per whole
  // $10 of subtotal — `Math.floor(subtotal / 10)`.
  const earnedPoints = Math.floor(subtotal / 10);

  try {
    const sale = await prisma.$transaction(async (tx) => {
      // Create the header first so we get an id to hang line items off. If a
      // customerId was supplied but doesn't exist anymore (deleted between the
      // page render and checkout), the FK insert would fail — caught below as a
      // generic error after the rollback. We don't pre-check existence; the
      // transaction's integrity constraint is the source of truth.
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

      // Decrement stock for each purchased product. We `select stock` first so
      // we can detect an underflow and abort the whole sale before it commits —
      // a partial-sale-then-roll-back is preferable to selling stock we don't
      // have. A missing product (deleted mid-checkout) also lands here as a
      // null check.
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
      }

      // Loyalty accrual — only when a customer was linked and earned anything.
      // Switched to `increment` so concurrent sales for the same customer
      // don't clobber each other (a read-then-set would lose updates).
      if (customerId && earnedPoints > 0) {
        await tx.customer.update({
          where: { id: customerId },
          data: { loyaltyPoints: { increment: earnedPoints } },
        });
      }

      return created;
    });

    // The POS view and the dashboard stats both depend on product stock /
    // sale totals, so refresh both routes after a successful checkout.
    revalidatePath("/pos");
    revalidatePath("/");

    return { ok: true as const, data: { id: sale.id } };
  } catch (err) {
    // Inline-known failures translate to user-facing copy; anything else is a
    // generic leak-free message so internals never reach the client.
    if (err instanceof Error) {
      if (err.message === "OUT_OF_STOCK") {
        return { ok: false, error: "Some items are out of stock. Please restock or remove them and try again." };
      }
      if (err.message === "PRODUCT_NOT_FOUND") {
        return { ok: false, error: "One of the items in your cart no longer exists." };
      }
    }
    return { ok: false, error: "Could not complete the sale. Please try again." };
  }
}
