/**
 * Loyalty + refund money rules (Phase 1d).
 *
 * Pure functions shared by the POS register, the Server Actions and the tests,
 * so the number the cashier sees is produced by the same code that decides what
 * is written to the ledger. Free of `node:` imports so client components can
 * import it directly.
 *
 * ── Earning (unchanged from before this phase) ──────────────────────────────
 * A sale earns 1 point per whole 10 of the *taxable* amount. This phase does
 * not alter that rate or its base, EXCEPT that a sale paid partly with points
 * does not earn points on the part covered by those points — otherwise a
 * customer could buy and redeem in a loop to farm points.
 *
 * ── Redemption ─────────────────────────────────────────────────────────────
 * 1 point is worth 1 centavo. The value is capped at the cart's taxable amount:
 * points can never make a total negative or pay for more than the goods are
 * worth. A redemption always costs whole points.
 */

/** Cash value of a single loyalty point, in pesos. 1 point = ₱0.01. */
export const LOYALTY_POINT_VALUE = 0.01;

/** Pesos of taxable spend that earn one point. Mirrors the pre-Phase-1d rule. */
export const LOYALTY_EARN_PER = 10;

/** Round to 2 decimals — money math always lands on centavo precision. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Points a sale earns, given its taxable base and the value already covered by
 * redeemed points.
 *
 * With no redemption this is exactly the historical `floor(taxable / 10)`, so
 * existing earning behaviour is preserved.
 */
export function earnedPointsFor(taxable: number, redemptionValue: number): number {
  const paidInCash = Math.max(0, round2(taxable - redemptionValue));
  return Math.floor(paidInCash / LOYALTY_EARN_PER);
}

/**
 * Cash value of `points`, capped at `cap`.
 *
 * Always returns a whole-centavo amount. `points` is trusted to already be a
 * non-negative integer by the caller; this function is the money side only.
 */
export function redemptionValueFor(points: number, cap: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return round2(Math.min(round2(points * LOYALTY_POINT_VALUE), Math.max(0, round2(cap))));
}

/**
 * The most points that can be spent on a cart worth `taxable`.
 *
 * The register caps its input at this so a cashier can never be told "too many"
 * for a value the UI itself offered.
 */
export function maxRedeemablePoints(availablePoints: number, taxable: number): number {
  if (!Number.isFinite(availablePoints) || availablePoints <= 0) return 0;
  const affordable = Math.floor(Math.max(0, taxable) / LOYALTY_POINT_VALUE);
  return Math.max(0, Math.min(Math.floor(availablePoints), affordable));
}

/**
 * Full sale total once a redemption is applied.
 *
 * Tax is charged on the goods value (unchanged); points then reduce what the
 * customer actually pays, floored at zero.
 */
export function totalAfterRedemption(
  taxable: number,
  tax: number,
  redemptionValue: number,
): number {
  return round2(Math.max(0, round2(taxable + tax) - redemptionValue));
}


/**
 * ── Partial refunds ─────────────────────────────────────────────────────────
 *
 * A refund returns goods, not a re-run of checkout, so it is valued as a
 * *proportion of what was actually paid* rather than by re-deriving catalog
 * prices (which may have changed since the sale). Each refunded unit is worth
 * its share of the sale total, so a 1-of-3 refund of a tax-and-discount-bearing
 * sale refunds a third of what the customer really paid, not a third of the
 * shelf price.
 */

/** One requested refund line: how many units of a sale item to take back. */
export type RefundLine = {
  /** The `SaleItem.id` being refunded. */
  saleItemId: string;
  /** Units to refund, 1..(original − already refunded). */
  quantity: number;
};

/**
 * Value of a set of refund lines against a sale.
 *
 * `unitValue` is the per-unit peso value of that sale item, already derived by
 * the caller. The result is proportional to the sale's total and can never
 * exceed what is left to refund — the caller passes that as `cap`, which is
 * what makes over-refunding impossible even after several partial refunds and
 * accumulated centavo rounding.
 */
export function refundValueFor(
  lines: Array<{ quantity: number; unitValue: number }>,
  cap: number,
): number {
  const raw = lines.reduce((sum, line) => sum + line.quantity * line.unitValue * 100, 0);
  return round2(Math.min(round2(raw / 100), Math.max(0, round2(cap))));
}

/**
 * Per-unit peso value of one `SaleItem` within its sale.
 *
 * The sale's total is spread across its items in proportion to their catalog
 * value at the time (`quantity × priceAtSale`). The last item therefore absorbs
 * any rounding remainder, so the parts always sum back to the sale total rather
 * than leaving a few centavos unaccounted for.
 */
export function saleItemUnitValues(
  items: Array<{ quantity: number; priceAtSale: number }>,
  saleTotal: number,
): number[] {
  const gross = items.map((item) => item.quantity * item.priceAtSale);
  const grossTotal = gross.reduce((sum, value) => sum + value, 0);
  if (grossTotal <= 0) return items.map(() => 0);

  const values: number[] = [];
  let allocated = 0;
  items.forEach((_, index) => {
    // The final item takes whatever is left, absorbing float drift.
    const isLast = index === items.length - 1;
    const value = isLast
      ? round2(Math.max(0, saleTotal - allocated))
      : round2((gross[index] / grossTotal) * saleTotal);
    values.push(value);
    allocated = round2(allocated + value);
  });
  return values;
}

/**
 * Points to claw back when refunding part of a sale.
 *
 * Earned points are reversed in proportion to the value refunded, and clamped
 * to what the customer actually holds: a refund must never be *blocked* because
 * the customer has already spent the points it would claw back. Returns 0 for a
 * guest sale (no customer) or a sale that earned nothing.
 */
export function pointsReversedForRefund(
  earnedPoints: number,
  refundValue: number,
  saleTotal: number,
  customerPoints: number,
): number {
  if (earnedPoints <= 0 || customerPoints <= 0) return 0;
  if (saleTotal <= 0) return 0;
  const proportional = Math.floor((earnedPoints * refundValue) / saleTotal);
  return Math.max(0, Math.min(proportional, customerPoints));
}
