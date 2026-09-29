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
// Phase 1d money/loyalty rules. `round2` is deliberately NOT imported: this
// module already defines its own local `round2` from before the shared lib
// existed, and re-pointing every existing money line in this file at a new
// import would be a change to untouched earning/tax logic for no benefit.
import {
  earnedPointsFor,
  LOYALTY_POINT_VALUE,
  pointsReversedForRefund,
  redemptionValueFor,
  refundValueFor,
  saleItemUnitValues,
  totalAfterRedemption,
} from "@/lib/loyalty";

/** Round to 2 decimals - money math always lands on centavo precision. */
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** The only payment methods supported by the POS and persisted sale ledger. */
const PAYMENT_METHODS = ["CASH", "CARD", "STORE_CREDIT"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

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
  /**
   * Loyalty points to SPEND (Phase 1d). Whole, non-negative, and never more than
   * the customer's balance. Only meaningful with a `customerId`. The peso value
   * is derived here from the taxable base, so the client contributes intent and
   * the server decides what it is worth.
   */
  redeemPoints?: number | null;
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
  if (!isPaymentMethod(paymentMethod)) {
    return { ok: false, error: "Payment method must be CASH, CARD, or STORE_CREDIT." };
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
  // Points are whole and never negative. Validated here (not coerced) so a
  // fractional or negative request is a clear refusal rather than a silent
  // round. `NaN`/undefined means "no redemption".
  const requestedPoints = input.redeemPoints == null ? 0 : Number(input.redeemPoints);
  if (!Number.isFinite(requestedPoints) || !Number.isInteger(requestedPoints) || requestedPoints < 0) {
    return { ok: false, error: "Points to redeem must be a whole number of 0 or more." };
  }
  // Points are a customer benefit; there is no account to spend them from on a
  // guest checkout, so refuse rather than silently ignoring the request.
  if (requestedPoints > 0 && !customerId) {
    return { ok: false, error: "Select a customer before redeeming loyalty points." };
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

      // ── Loyalty redemption (Phase 1d) ──────────────────────────────────
      // The customer's balance is read INSIDE the transaction and re-checked
      // here, so two registers racing on the same customer can't both spend the
      // same points. The peso value is capped at the taxable base, which is what
      // stops points from driving the total below zero.
      let redeemedPoints = 0;
      let redemptionAmount = 0;
      if (requestedPoints > 0) {
        const account = await tx.customer.findUnique({
          where: { id: customerId! },
          select: { id: true, loyaltyPoints: true },
        });
        if (!account) throw new Error("CUSTOMER_NOT_FOUND");
        if (account.loyaltyPoints < requestedPoints) {
          throw new Error("INSUFFICIENT_POINTS");
        }
        if (redemptionValueFor(requestedPoints, taxable) < requestedPoints * LOYALTY_POINT_VALUE) {
          // The points are worth more than the cart — refuse rather than clamp,
          // so a cashier is never told a redemption succeeded for less value
          // than the customer gave up.
          throw new Error("REDEMPTION_EXCEEDS_TOTAL");
        }
        redeemedPoints = requestedPoints;
        redemptionAmount = redemptionValueFor(redeemedPoints, taxable);
      }

      const totalAmount = totalAfterRedemption(taxable, tax, redemptionAmount);
      // Points are not earned on the part of the cart that points already paid
      // for — otherwise buy-and-redeem in a loop would farm points. With no
      // redemption this is exactly the pre-Phase-1d `floor(taxable / 10)`.
      const earnedPoints = earnedPointsFor(taxable, redemptionAmount);

      // Payment validation is server-authoritative. The total above is the exact
      // value persisted below; a client-supplied change value is never trusted.
      // CASH requires a finite, non-negative amount at least equal to that total;
      // all other methods ignore any tender/change payload and persist nulls.
      let tendered: number | null = null;
      let change: number | null = null;
      if (paymentMethod === "CASH") {
        if (typeof input.tendered !== "number" || !Number.isFinite(input.tendered) || input.tendered < 0) {
          throw new Error("INVALID_CASH_TENDERED");
        }
        tendered = round2(input.tendered);
        if (tendered < totalAmount) {
          throw new Error("INSUFFICIENT_CASH");
        }
        change = round2(tendered - totalAmount);
      }

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
          redeemedPoints,
          redemptionAmount,
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

      // Loyalty point movement — spend first, then earn, as one net update. The
      // balance was re-read above inside this transaction, so the deduction is
      // based on a value that cannot have moved underneath us.
      if (customerId && (earnedPoints > 0 || redeemedPoints > 0)) {
        await tx.customer.update({
          where: { id: customerId },
          data: { loyaltyPoints: { increment: earnedPoints - redeemedPoints } },
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
      if (err.message === "INVALID_CASH_TENDERED") {
        return { ok: false, error: "Cash tendered must be a valid amount of 0 or more." };
      }
      if (err.message === "INSUFFICIENT_CASH") {
        return { ok: false, error: "Cash tendered must cover the total due." };
      }
      if (err.message === "CUSTOMER_NOT_FOUND") {
        return { ok: false, error: "The selected customer no longer exists." };
      }
      if (err.message === "INSUFFICIENT_POINTS") {
        return { ok: false, error: "This customer does not have that many points to redeem." };
      }
      if (err.message === "REDEMPTION_EXCEEDS_TOTAL") {
        return { ok: false, error: "Those points are worth more than this cart. Redeem fewer points." };
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
      // A sale that has already been partly refunded cannot be voided: the void
      // restores stock for the FULL quantity, which would put back units the
      // refund already returned. The two paths are mutually exclusive by design.
      if (sale.refundedAmount > 0) throw new Error("SALE_HAS_REFUNDS");
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
        // Net point reversal (Phase 1d): hand back points the customer SPENT at
        // checkout, claw back points the sale EARNED. With no redemption this is
        // exactly the old `decrement: earnedPoints`, so existing void behaviour
        // is unchanged.
        const pointDelta = sale.redeemedPoints - sale.earnedPoints;
        if (pointDelta !== 0) {
          if (cust.loyaltyPoints + pointDelta < 0) throw new Error("LOYALTY_BALANCE_CONFLICT");
          await tx.customer.update({ where: { id: sale.customerId }, data: { loyaltyPoints: { increment: pointDelta } } });
        }
      } else if (sale.customerId && (sale.earnedPoints > 0 || sale.redeemedPoints > 0)) {
        const cust = await tx.customer.findUnique({ where: { id: sale.customerId }, select: { loyaltyPoints: true } });
        if (!cust) throw new Error("CUSTOMER_NOT_FOUND");
        const pointDelta = sale.redeemedPoints - sale.earnedPoints;
        if (cust.loyaltyPoints + pointDelta < 0) throw new Error("LOYALTY_BALANCE_CONFLICT");
        await tx.customer.update({ where: { id: sale.customerId }, data: { loyaltyPoints: { increment: pointDelta } } });
      }
      return updated;
    });
    return { ok: true, data: { id: result.id, status: result.status } };
  } catch (err) {
    if (err instanceof Error) switch (err.message) {
      case "SALE_NOT_FOUND": return { ok: false, error: "Sale not found." };
      case "SALE_ALREADY_VOIDED": return { ok: false, error: "This sale has already been voided." };
      case "SALE_NOT_COMPLETED": return { ok: false, error: "Only completed sales can be voided." };
      case "SALE_HAS_REFUNDS": return { ok: false, error: "This sale has refunds against it and can no longer be voided." };
      case "PRODUCT_NOT_FOUND": return { ok: false, error: "One of the products in the sale no longer exists." };
      case "CUSTOMER_BALANCE_CONFLICT": return { ok: false, error: "Cannot void automatically. Customer balance would go negative. Manual review required." };
      case "LOYALTY_BALANCE_CONFLICT": return { ok: false, error: "Cannot void automatically. Loyalty points would go negative. Manual review required." };
      case "CUSTOMER_NOT_FOUND": return { ok: false, error: "The customer linked to this sale no longer exists." };
    }
    return { ok: false, error: "Could not void the sale. Please try again." };
  }
}

/** ── Partial refunds (Phase 1d) ─────────────────────────────────────────── */

/** One requested refund line: which sale item, and how many units to take. */
export type RefundLineInput = {
  /** The `SaleItem.id` to take units back from. */
  saleItemId: string;
  /** Units to refund. */
  quantity: number;
};

export type RefundSaleInput = {
  saleId: string;
  lines: RefundLineInput[];
  /** Required — an unexplained money-out is exactly what an audit is for. */
  reason: string;
};

export type RefundSaleResult = MutationResult<{
  id: string;
  /** Peso amount returned by this refund. */
  amount: number;
  /** Running refunded total on the sale after this refund. */
  refundedTotal: number;
  /** Derived display status: "Refunded" | "Partially Refunded" | "Completed". */
  status: string;
}>;

/**
 * Refund part (or all) of a completed sale.
 *
 * Distinct from {@link voidSale} in every way that matters, and the two never
 * meet: a void reverses an entire sale and is left exactly as it was; a refund
 * takes back specific units, may be repeated until the sale is exhausted, and
 * is refused on a sale that has already been voided.
 *
 * Guarantees, all enforced inside one transaction:
 *  - a line can never be refunded beyond what was bought — `refundedQuantity` is
 *    re-read here and checked against `quantity - refunded`;
 *  - the peso amount is proportional to what was actually paid, so refunding one
 *    of three units of a discount/tax-bearing sale returns a third of the money
 *    paid, not a third of the shelf price;
 *  - the running total can never exceed `totalAmount`, so repeated refunds
 *    cannot drain more than the customer paid;
 *  - stock is returned with a RESTOCK movement per line, so inventory and the
 *    stock ledger stay in step with the refund;
 *  - each event is recorded in `SaleRefund` (who / when / how much / why).
 *
 * ADMIN/MANAGER only, like void — this is money out of the till.
 */
export async function refundSale(input: RefundSaleInput): Promise<RefundSaleResult> {
  const saleId = (input?.saleId ?? "").trim();
  const reason = (input?.reason ?? "").trim();
  const lines = Array.isArray(input?.lines) ? input.lines : [];

  let cashier: CashierSession;
  try {
    cashier = await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) return { ok: false, error: "Sign in to process a refund." };
    throw err;
  }
  const denied = await roleGuardError(["ADMIN", "MANAGER"]);
  if (denied) return { ok: false, error: denied };
  if (!saleId) return { ok: false, error: "Sale ID is required." };
  if (!reason) return { ok: false, error: "A refund reason is required." };
  if (lines.length === 0) return { ok: false, error: "Choose at least one item to refund." };

  // Collapse duplicate lines for the same item first: two entries of 1 and 1
  // against a 2-unit line is ONE refund of 2, not two independent claims on it.
  const requested = new Map<string, number>();
  for (const line of lines) {
    const id = (line?.saleItemId ?? "").trim();
    const qty = Number(line?.quantity);
    if (!id) return { ok: false, error: "A refund line is missing its sale item." };
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "Refund quantities must be whole numbers of 1 or more." };
    }
    requested.set(id, (requested.get(id) ?? 0) + qty);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
      if (!sale) throw new Error("SALE_NOT_FOUND");
      if (sale.status === "Voided") throw new Error("SALE_VOIDED");
      if (sale.status !== "Completed") throw new Error("SALE_NOT_COMPLETED");

      const itemById = new Map(sale.items.map((item) => [item.id, item]));
      for (const id of requested.keys()) {
        if (!itemById.has(id)) throw new Error("ITEM_NOT_IN_SALE");
      }

      // Anti-over-refund: every requested quantity must fit in what is still
      // refundable on that line, checked against the live `refundedQuantity`.
      for (const [id, qty] of requested) {
        const item = itemById.get(id)!;
        if (item.quantity - item.refundedQuantity <= 0) throw new Error("ITEM_ALREADY_REFUNDED");
        if (qty > item.quantity - item.refundedQuantity) throw new Error("REFUND_EXCEEDS_PURCHASED");
      }

      // Value the refund against what was ACTUALLY PAID, splitting the sale
      // total across its items in proportion to their catalog value at the time.
      const unitValues = saleItemUnitValues(
        sale.items.map((item) => ({ quantity: item.quantity, priceAtSale: item.priceAtSale })),
        sale.totalAmount,
      );
      const valueById = new Map(sale.items.map((item, index) => [item.id, unitValues[index]]));

      const refundableTotal = round2(sale.totalAmount - sale.refundedAmount);
      const amount = refundValueFor(
        [...requested.entries()].map(([id, qty]) => ({
          quantity: qty,
          unitValue: round2((valueById.get(id) ?? 0) / itemById.get(id)!.quantity),
        })),
        refundableTotal,
      );
      if (amount <= 0) throw new Error("REFUND_AMOUNT_ZERO");

      // Return the goods and audit each restock, so inventory and the stock
      // ledger move together exactly as they did at the original sale.
      for (const [id, qty] of requested) {
        const item = itemById.get(id)!;
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true },
        });
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            quantityChange: qty,
            type: "RESTOCK",
            reason: `Refund for Sale ${saleId.slice(0, 8)} - ${reason}`,
          },
        });
        await tx.saleItem.update({
          where: { id },
          data: { refundedQuantity: { increment: qty } },
        });
      }

      // Claw back the loyalty points this refund's value earned, proportional to
      // the value returned and clamped to what the customer still holds — a
      // refund must never be blocked because points were already spent.
      if (sale.customerId && sale.earnedPoints > 0) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
          select: { id: true, loyaltyPoints: true },
        });
        if (customer) {
          const reverse = pointsReversedForRefund(
            sale.earnedPoints,
            amount,
            sale.totalAmount,
            customer.loyaltyPoints,
          );
          if (reverse > 0) {
            await tx.customer.update({
              where: { id: customer.id },
              data: { loyaltyPoints: { decrement: reverse } },
            });
          }
        }
      }

      // A STORE_CREDIT sale went on the customer's account, so handing goods
      // back reduces what they owe — mirroring the void's balance reversal.
      if (sale.paymentMethod === "STORE_CREDIT" && sale.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
          select: { id: true, currentBalance: true },
        });
        if (customer && customer.currentBalance > 0) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { currentBalance: { decrement: Math.min(amount, customer.currentBalance) } },
          });
        }
      }

      await tx.saleRefund.create({ data: { saleId, amount, reason, cashierId: cashier.id } });

      const refundedTotal = round2(sale.refundedAmount + amount);
      await tx.sale.update({ where: { id: saleId }, data: { refundedAmount: refundedTotal } });

      // Status is DERIVED, never stored: the per-line refunded quantities are the
      // source of truth, so a status flag can't drift out of step with them.
      const fullyRefunded = sale.items.every(
        (item) => item.refundedQuantity + (requested.get(item.id) ?? 0) >= item.quantity,
      );

      return {
        id: saleId,
        amount,
        refundedTotal,
        status: fullyRefunded ? "Refunded" : "Partially Refunded",
      };
    });

    revalidatePath("/pos");
    revalidatePath("/");
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Error) switch (err.message) {
      case "SALE_NOT_FOUND": return { ok: false, error: "Sale not found." };
      case "SALE_VOIDED": return { ok: false, error: "This sale was voided and cannot be refunded." };
      case "SALE_NOT_COMPLETED": return { ok: false, error: "Only completed sales can be refunded." };
      case "ITEM_NOT_IN_SALE": return { ok: false, error: "One of the selected items is not part of this sale." };
      case "ITEM_ALREADY_REFUNDED": return { ok: false, error: "One of the selected items has already been fully refunded." };
      case "REFUND_EXCEEDS_PURCHASED": return { ok: false, error: "You cannot refund more units than were purchased." };
      case "REFUND_AMOUNT_ZERO": return { ok: false, error: "This sale has already been fully refunded." };
      case "PRODUCT_NOT_FOUND": return { ok: false, error: "One of the products in the sale no longer exists." };
    }
    return { ok: false, error: "Could not process the refund. Please try again." };
  }
}
