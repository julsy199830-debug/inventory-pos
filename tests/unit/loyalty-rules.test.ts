/**
 * Unit tests for the Phase 1d loyalty + refund money rules.
 *
 * These functions decide what pesos actually move, so they are pinned directly
 * rather than only through the actions. The properties that matter most:
 *
 *  - EARNING IS UNCHANGED. With no redemption, `earnedPointsFor` must equal the
 *    historical `floor(taxable / 10)` for every value — a regression here would
 *    silently change loyalty accrual for every sale in the shop.
 *  - Points can never buy more than the cart is worth, and can never drive a
 *    total negative.
 *  - Refund values are proportional to what was PAID, the per-item split always
 *    sums back to the sale total (no centavos stranded), and the cap makes
 *    repeated over-refunds impossible.
 *
 * Run: npx tsx tests/unit/loyalty-rules.test.ts
 */
import assert from "node:assert/strict";
import {
  earnedPointsFor,
  LOYALTY_EARN_PER,
  LOYALTY_POINT_VALUE,
  maxRedeemablePoints,
  pointsReversedForRefund,
  redemptionValueFor,
  refundValueFor,
  round2,
  saleItemUnitValues,
  totalAfterRedemption,
} from "@/lib/loyalty";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ── Earning: must match the pre-Phase-1d rule exactly ──────────────────────
check("earning is unchanged: floor(taxable/10) when nothing is redeemed", () => {
  for (const taxable of [0, 1, 9, 10, 19, 20, 99, 100, 199, 250, 1234.56, 9999.99]) {
    assert.equal(
      earnedPointsFor(taxable, 0),
      Math.floor(taxable / LOYALTY_EARN_PER),
      `taxable=${taxable} must earn the historical amount`,
    );
  }
});
check("no points are earned on the part points already paid for", () => {
  // P100 taxable, P20 covered by points -> P80 cash -> 8 points, not 10.
  assert.equal(earnedPointsFor(100, 20), 8);
});
check("a fully point-paid cart earns nothing", () => {
  assert.equal(earnedPointsFor(100, 100), 0);
});
check("a redemption larger than the base still earns 0, never negative", () => {
  assert.equal(earnedPointsFor(50, 80), 0);
});

// ── Redemption value ───────────────────────────────────────────────────────
check("1 point is worth 1 centavo", () => {
  assert.equal(LOYALTY_POINT_VALUE, 0.01);
  assert.equal(redemptionValueFor(100, 1000), 1);
  assert.equal(redemptionValueFor(2500, 1000), 25);
});
check("redemption value is capped at the cart's taxable base", () => {
  assert.equal(redemptionValueFor(100000, 40), 40, "points cannot exceed the cart");
  assert.equal(redemptionValueFor(100000, 0), 0);
});
check("zero or negative points are worth nothing", () => {
  assert.equal(redemptionValueFor(0, 100), 0);
  assert.equal(redemptionValueFor(-50, 100), 0);
});
check("redemption value never returns more precision than centavos", () => {
  assert.equal(redemptionValueFor(1, 100), 0.01);
  assert.equal(redemptionValueFor(3, 100), 0.03);
});

// ── Max redeemable: what the register offers the cashier ───────────────────
check("max redeemable is the smaller of balance and what the cart can absorb", () => {
  assert.equal(maxRedeemablePoints(1000, 50), 1000, "balance is the limit when rich");
  assert.equal(maxRedeemablePoints(100000, 5), 500, "cart value is the limit when rich in points");
  assert.equal(maxRedeemablePoints(0, 100), 0);
  assert.equal(maxRedeemablePoints(100, 0), 0);
});
check("max redeemable never goes negative", () => {
  assert.equal(maxRedeemablePoints(-100, 100), 0);
  assert.equal(maxRedeemablePoints(100, -50), 0);
});

// ── Total after redemption ─────────────────────────────────────────────────
check("total is reduced by the redemption but never below zero", () => {
  assert.equal(totalAfterRedemption(100, 12, 10), 102);
  assert.equal(totalAfterRedemption(100, 12, 112), 0, "floors at zero, never negative");
});
check("no redemption reproduces the plain taxable + tax total", () => {
  assert.equal(totalAfterRedemption(199.99, 24, 0), round2(199.99 + 24));
});

// ── Refund valuation ───────────────────────────────────────────────────────
check("refund value is proportional to units at a known unit value", () => {
  assert.equal(refundValueFor([{ quantity: 1, unitValue: 50 }], 200), 50);
  assert.equal(refundValueFor([{ quantity: 2, unitValue: 25 }], 200), 50);
});
check("refund value is capped at what is left to refund", () => {
  assert.equal(refundValueFor([{ quantity: 5, unitValue: 100 }], 120), 120);
  assert.equal(refundValueFor([{ quantity: 5, unitValue: 100 }], 0), 0);
});
check("refund value accumulates across lines", () => {
  assert.equal(
    refundValueFor([{ quantity: 1, unitValue: 33.33 }, { quantity: 2, unitValue: 10 }], 500),
    round2(33.33 + 20),
  );
});


// ── Per-item split: the parts must sum back to the whole ───────────────────
check("per-item values sum back to the sale total (no centavos stranded)", () => {
  const items = [
    { quantity: 2, priceAtSale: 33.33 },
    { quantity: 1, priceAtSale: 10 },
    { quantity: 3, priceAtSale: 7.77 },
  ];
  const values = saleItemUnitValues(items, 111.11);
  assert.equal(values.length, 3);
  assert.equal(round2(values.reduce((s, v) => s + v, 0)), 111.11, "exact sum");
});
check("a single item owns the entire sale total", () => {
  assert.deepEqual(saleItemUnitValues([{ quantity: 2, priceAtSale: 50 }], 100), [100]);
});
check("equal-value items split evenly", () => {
  const values = saleItemUnitValues(
    [
      { quantity: 1, priceAtSale: 10 },
      { quantity: 1, priceAtSale: 10 },
    ],
    20,
  );
  assert.deepEqual(values, [10, 10]);
});
check("a zero-value sale yields zero values, never NaN", () => {
  const values = saleItemUnitValues([{ quantity: 1, priceAtSale: 0 }], 0);
  assert.deepEqual(values, [0]);
});
check("a fully-discounted-to-zero sale does not divide by zero", () => {
  const values = saleItemUnitValues(
    [
      { quantity: 1, priceAtSale: 0 },
      { quantity: 1, priceAtSale: 0 },
    ],
    0,
  );
  assert.deepEqual(values, [0, 0]);
});

// ── Points reversal on refund ──────────────────────────────────────────────
check("points are clawed back in proportion to the value refunded", () => {
  // 10 points on a P100 sale, half refunded -> 5 back.
  assert.equal(pointsReversedForRefund(10, 50, 100, 1000), 5);
});
check("points are never clawed back beyond what the customer holds", () => {
  // Earned 10 but the balance is 2 - take 2, never go negative.
  assert.equal(pointsReversedForRefund(10, 100, 100, 2), 2);
});
check("a guest sale (no points) reverses nothing", () => {
  assert.equal(pointsReversedForRefund(0, 50, 100, 1000), 0);
  assert.equal(pointsReversedForRefund(10, 50, 100, 0), 0);
});
check("a zero-value sale reverses nothing rather than dividing by zero", () => {
  assert.equal(pointsReversedForRefund(10, 50, 0, 1000), 0);
});
check("a tiny refund reverses 0 points rather than a fraction", () => {
  assert.equal(pointsReversedForRefund(10, 5, 100, 1000), 0, "floor, never fractional");
});

console.log(`loyalty + refund rule tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
