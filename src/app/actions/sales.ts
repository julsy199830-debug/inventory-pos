"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  NoCashierError,
  requireCashierSession,
  roleGuardError,
  type CashierSession,
} from "@/lib/session";
import type { MutationResult } from "@/lib/types";

/** Round to 2 decimals - money math always lands on centavo precision. */
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * One cart line sent to the server. Only the cart's *shape* is trusted — the
 * unit price is re-derived from the catalog (`Product.price`) and discounts are
 * re-applied server-side, so these values never touch the stored ledger
 * directly.
 */
export type SaleItemInput = {
  productId: string;
  quantity: number;
  discount?: { type: string; value: number } | null;
};

export type CreateSaleInput = {
  /** Optional customer for loyalty accrual; null/omitted = guest checkout. */
  customerId?: string | null;
  paymentMethod: string;
  /** Optional cart-wide discount request (percent or fixed) — re-applied server-side. */
  discount?: { type: string; value: number } | null;
  items: SaleItemInput[];
  /** Cash only: amount the customer handed over (persisted for drawer audit). */
  tendered?: number | null;
  /** Cash only: change due, as shown on the register. */
  change?: number | null;
};

export type CreateSaleResult = MutationResult<{ id: string }>;

/**
 * Create a Sale header + its SaleItem rows, decrement product stock, bump the
 * customer's loyalty points, and (for STORE_CREDIT) verify + raise the
 * customer's outstanding balance — all inside a single `prisma.$transaction`
 * so the ledger can never be left half-written. The signed-in cashier (from
 * `requireCashierSession`) is stamped onto the row as `cashierId` so the
 * Employees shift ledger can attribute this sale to the right employee.
 */
export async function createSale(
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  const customerId = input.customerId?.trim() || null;
  const paymentMethod = (input.paymentMethod ?? "").trim();
  const items = Array.isArray(input.items) ? input.items : [];

  // ── Session gate ──────────────────────────────────────────────────────
  // Resolve the signed-in cashier and keep their id — it's written onto the
  // Sale row as `cashierId` below, which is what the Employees shift ledger
  // ("sales this ledger") keys on to attribute this sale to its cashier.
  let cashier: CashierSession;
  try {
    cashier = await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to the register to complete this sale." };
    }
    throw err;
  }

  // ── Server-authoritative validation ────────────────────────────────────
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
  // A discount request must be a well-formed { type, value } with a
  // non-negative amount — the server re-applies it against catalog prices
  // (capped at the discounted base), so malformed shapes are rejected
  // outright rather than silently coerced.
  const isValidDiscount = (d: unknown): d is { type: string; value: number } =>
    typeof d === "object"
    && d !== null
    && ((d as { type?: unknown }).type === "PERCENT" || (d as { type?: unknown }).type === "FIXED")
    && Number.isFinite(Number((d as { value?: unknown }).value))
    && Number((d as { value?: unknown }).value) >= 0;
  for (const item of items) {
    const qty = Number(item.quantity);
    if (typeof item.productId !== "string" || item.productId.trim() === "") {
      return { ok: false, error: "A cart item is missing its product." };
    }
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "Quantities must be whole numbers of 1 or more." };
    }
    if (item.discount != null && !isValidDiscount(item.discount)) {
      return { ok: false, error: "A cart item has an invalid discount." };
    }
  }
  if (input.discount != null && !isValidDiscount(input.discount)) {
    return { ok: false, error: "The cart-wide discount is invalid." };
  }

  try {
    const sale = await prisma.$transaction(async (tx) => {
      // Server-authoritative money math. The client only contributes the
      // cart's *shape*; every peso figure is re-derived here from the
      // catalog, the store's tax rate and the requested discounts, so the
      // stored ledger can always reconcile:
      // subtotal - discountAmount = taxable; taxable + tax = totalAmount.
      const catalog = await tx.product.findMany({
        where: { id: { in: items.map((item) => item.productId) } },
        select: { id: true, price: true, stock: true },
      });
      const productById = new Map(catalog.map((product) => [product.id, product]));
      const settings = await tx.storeSetting.findFirst({ select: { taxRate: true } });
      const taxRate = Number(settings?.taxRate ?? 0) || 0;

      // Discount requests are re-applied against catalog math, each capped so
      // they can never over-discount their base (a percent can't exceed 100%,
      // a fixed amount can't exceed the base it applies to).
      const lineDiscount = (base: number, discount?: { type: string; value: number } | null) => {
        if (!discount) return 0;
        if (discount.type === "PERCENT") {
          return round2(base * (Math.min(Number(discount.value), 100) / 100));
        }
        if (discount.type === "FIXED") {
          return round2(Math.min(Number(discount.value), base));
        }
        return 0;
      };

      let subtotal = 0;
      let lineDiscountTotal = 0;
      const priced = new Map<string, number>();
      for (const item of items) {
        const product = productById.get(item.productId);
        if (!product) {
          throw new Error("PRODUCT_NOT_FOUND");
        }
        const qty = Number(item.quantity);
        if (product.stock < qty) {
          throw new Error("OUT_OF_STOCK");
        }
        const base = round2(product.price * qty);
        subtotal = round2(subtotal + base);
        lineDiscountTotal = round2(lineDiscountTotal + lineDiscount(base, item.discount));
        priced.set(item.productId, product.price);
      }

      // The cart-wide discount applies to what remains after line discounts,
      // and the combined discount can never push the taxable base below zero.
      const discountAmount = round2(
        lineDiscountTotal + lineDiscount(round2(subtotal - lineDiscountTotal), input.discount),
      );
      const taxable = Math.max(0, round2(subtotal - discountAmount));
      const tax = round2(taxable * (taxRate / 100));
      const totalAmount = round2(taxable + tax);
      // Loyalty points per whole 10 of the discounted subtotal.
      const earnedPoints = Math.floor(taxable / 10);

      // Cash-only drawer figures, persisted for the audit trail. The register
      // only sends these on CASH checkouts; every other method stores null.
      const tendered = paymentMethod === "CASH" && Number.isFinite(Number(input.tendered))
        ? round2(Number(input.tendered))
        : null;
      const change = paymentMethod === "CASH" && tendered != null && Number.isFinite(Number(input.change))
        ? round2(Number(input.change))
        : null;

      const created = await tx.sale.create({
        data: {
          customerId,
          cashierId: cashier.id,
          subtotal,
          discountAmount,
          tax,
          totalAmount,
          paymentMethod,
          earnedPoints,
          tendered,
          change,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
              priceAtSale: priced.get(item.productId)!,
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

/** Void a completed sale - restores inventory, reverses credit/loyalty, marks as Voided. Requires ADMIN/MANAGER. */
export async function voidSale(
  saleId: string,
  reason: string,
): Promise<MutationResult<{ id: string; status: string }>> {
  const tid = (saleId ?? "").trim();
  const rsn = (reason ?? "").trim();
  let cashier: CashierSession;
  try { cashier = await requireCashierSession(); } catch (err) {
    if (err instanceof NoCashierError) return { ok: false, error: "Sign in to void a sale." };
    throw err;
  }
  const denied = await roleGuardError(["ADMIN", "MANAGER"]);
  if (denied) return { ok: false, error: denied };
  if (!tid) return { ok: false, error: "Sale ID is required." };
  if (!rsn) return { ok: false, error: "Void reason is required." };
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: tid }, include: { items: { include: { product: true } }, customer: true } });
      if (!sale) throw new Error("SALE_NOT_FOUND");
      if (sale.status !== "Completed") { if (sale.status === "Voided") throw new Error("SALE_ALREADY_VOIDED"); throw new Error("SALE_NOT_COMPLETED"); }
      const updated = await tx.sale.update({ where: { id: tid }, data: { status: "Voided", voidReason: rsn, voidedAt: new Date(), voidedBy: cashier.id } });
      for (const item of sale.items) {
        const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
        if (!prod) throw new Error("PRODUCT_NOT_FOUND");
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        await tx.stockMovement.create({ data: { productId: item.productId, quantityChange: item.quantity, type: "VOID", reason: `Sale ${tid} voided - ${rsn}` } });
      }
      if (sale.paymentMethod === "STORE_CREDIT" && sale.customerId) {
        const cust = await tx.customer.findUnique({ where: { id: sale.customerId }, select: { currentBalance: true, loyaltyPoints: true } });
        if (!cust) throw new Error("CUSTOMER_NOT_FOUND");
        if (cust.currentBalance - sale.totalAmount < 0) throw new Error("CUSTOMER_BALANCE_CONFLICT");
        await tx.customer.update({ where: { id: sale.customerId }, data: { currentBalance: { decrement: sale.totalAmount } } });
        await tx.customerPayment.create({ data: { customerId: sale.customerId, cashierId: cashier.id, paymentMethod: sale.paymentMethod, amount: sale.totalAmount, notes: `Void reversal of Sale ${tid} - ${rsn}` } });
        if (sale.earnedPoints > 0) {
          if (cust.loyaltyPoints - sale.earnedPoints < 0) throw new Error("LOYALTY_BALANCE_CONFLICT");
          await tx.customer.update({ where: { id: sale.customerId }, data: { loyaltyPoints: { decrement: sale.earnedPoints } } });
        }
      } else if (sale.customerId && sale.earnedPoints > 0) {
        const cust = await tx.customer.findUnique({ where: { id: sale.customerId }, select: { loyaltyPoints: true } });
        if (!cust) throw new Error("CUSTOMER_NOT_FOUND");
        if (cust.loyaltyPoints - sale.earnedPoints < 0) throw new Error("LOYALTY_BALANCE_CONFLICT");
        await tx.customer.update({ where: { id: sale.customerId }, data: { loyaltyPoints: { decrement: sale.earnedPoints } } });
      }
      return updated;
    });
    return { ok: true, data: { id: result.id, status: result.status } };
  } catch (err) {
    if (err instanceof Error) switch (err.message) {
      case "SALE_NOT_FOUND": return { ok: false, error: "Sale not found." };
      case "SALE_ALREADY_VOIDED": return { ok: false, error: "This sale has already been voided." };
      case "SALE_NOT_COMPLETED": return { ok: false, error: "Only completed sales can be voided." };
      case "PRODUCT_NOT_FOUND": return { ok: false, error: "One of the products in the sale no longer exists." };
      case "CUSTOMER_BALANCE_CONFLICT": return { ok: false, error: "Cannot void automatically. Customer balance would go negative. Manual review required." };
      case "LOYALTY_BALANCE_CONFLICT": return { ok: false, error: "Cannot void automatically. Loyalty points would go negative. Manual review required." };
      case "CUSTOMER_NOT_FOUND": return { ok: false, error: "The customer linked to this sale no longer exists." };
    }
    return { ok: false, error: "Could not void the sale. Please try again." };
  }
}
