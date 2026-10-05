/**
 * Phase 6 — customer account ledger arithmetic.
 *
 * `src/lib/ledger.ts` is pure, so the money rules can be pinned without a
 * database. The properties that matter to a store keeping customer credit:
 *
 *   1. the balance is rebuilt from movements, never read from a stored float,
 *   2. a voided credit sale contributes NOTHING (not a charge, not a payment),
 *   3. reductions never drive the balance below zero — the same "never negative"
 *      rule the payment and refund actions already apply,
 *   4. a date-filtered window reports the balance the customer actually had at
 *      the window start, not a balance rebuilt from the window in isolation,
 *   5. every entry carries its own running balance, so a statement can be
 *      checked row by row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLedger, type LedgerEvent } from "@/lib/ledger";

const day = (n: number) => new Date(2026, 0, n, 12, 0, 0);

function ev(
  id: string,
  kind: LedgerEvent["kind"],
  amount: number,
  date: Date,
): LedgerEvent {
  return { id, kind, amount, date, label: id };
}

test("an empty account has a zero balance", () => {
  const r = buildLedger([]);
  assert.equal(r.balance, 0);
  assert.equal(r.entries.length, 0);
  assert.equal(r.openingBalance, 0);
});

test("a charge raises the balance and a payment lowers it", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 500, day(1)),
    ev("pay1", "PAYMENT", -200, day(2)),
  ]);
  assert.equal(r.balance, 300);
  assert.equal(r.openingBalance, 0);
  assert.equal(r.totalCharges, 500);
  assert.equal(r.totalPayments, 200);
});

test("each entry carries the running balance after it", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 500, day(1)),
    ev("pay1", "PAYMENT", -200, day(2)),
    ev("sale2", "CHARGE", 100, day(3)),
  ]);
  assert.deepEqual(
    r.entries.map((e) => e.balance),
    [500, 300, 400],
  );
});

test("a VOID contributes exactly zero and never moves the balance", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 500, day(1)),
    ev("sale2", "VOID", 500, day(2)),
  ]);
  assert.equal(r.balance, 500, "the voided sale must add nothing");
  const voidRow = r.entries.find((e) => e.kind === "VOID")!;
  assert.equal(voidRow.amount, 0);
  assert.equal(voidRow.balance, 500);
});

test("entries are ordered oldest first regardless of input order", () => {
  const r = buildLedger([
    ev("c", "CHARGE", 30, day(3)),
    ev("a", "CHARGE", 10, day(1)),
    ev("b", "PAYMENT", -5, day(2)),
  ]);
  assert.deepEqual(
    r.entries.map((e) => e.id),
    ["a", "b", "c"],
  );
  assert.equal(r.balance, 35);
});

test("a refund on an account sale reduces what is owed", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 400, day(1)),
    ev("ref1", "REFUND", -150, day(2)),
  ]);
  assert.equal(r.balance, 250);
});

test("a reduction is clamped so the balance never goes negative", () => {
  // Mirrors recordCustomerPayment, which settles `min(amount, balance)`.
  const r = buildLedger([
    ev("sale1", "CHARGE", 100, day(1)),
    ev("pay1", "PAYMENT", -250, day(2)),
  ]);
  assert.equal(r.balance, 0);
  assert.equal(r.entries[1].amount, -100, "only the 100 owed was applied");
});

test("a negative adjustment is clamped like any other reduction", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 60, day(1)),
    ev("adj1", "ADJUSTMENT", -500, day(2)),
  ]);
  assert.equal(r.balance, 0);
  assert.equal(r.entries[1].amount, -60);
});

test("a positive adjustment raises the balance (a correction upward)", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 100, day(1)),
    ev("adj1", "ADJUSTMENT", 25, day(2)),
  ]);
// ── Date windows ──────────────────────────────────────────────────────────────

test("a date window filters the rows but not the closing balance", () => {
  const events = [
    ev("sale1", "CHARGE", 500, day(1)),
    ev("pay1", "PAYMENT", -200, day(10)),
  ];
  const all = buildLedger(events);
  const windowed = buildLedger(events, { from: day(5), to: day(20) });

  assert.equal(all.entries.length, 2);
  assert.equal(windowed.entries.length, 1);
  // The customer still owes 300 — a filtered report must not forget the past.
  assert.equal(windowed.balance, 300);
  assert.equal(all.balance, windowed.balance);
});

test("the opening balance is what was owed before the first visible row", () => {
  const events = [
    ev("sale1", "CHARGE", 500, day(1)),
    ev("pay1", "PAYMENT", -200, day(10)),
    ev("sale2", "CHARGE", 50, day(15)),
  ];
  const w = buildLedger(events, { from: day(12), to: day(20) });
  assert.equal(w.entries.length, 1);
  assert.equal(w.openingBalance, 300, "500 charged - 200 paid");
  assert.equal(w.balance, 350);
  assert.equal(w.openingBalance + w.entries[0].amount, w.balance);
});

test("an empty window still reports the true closing balance", () => {
  const events = [ev("sale1", "CHARGE", 500, day(1))];
  const w = buildLedger(events, { from: day(10), to: day(20) });
  assert.equal(w.entries.length, 0);
  assert.equal(w.balance, 500, "money is still owed even if nothing is listed");
  assert.equal(w.openingBalance, 500);
});

test("the window bounds are inclusive", () => {
  const events = [
    ev("a", "CHARGE", 10, day(5)),
    ev("b", "CHARGE", 20, day(6)),
    ev("c", "CHARGE", 30, day(7)),
  ];
  const w = buildLedger(events, { from: day(5), to: day(7) });
  assert.equal(w.entries.length, 3);
});

test("totals describe the whole history, not just the window", () => {
  const events = [
    ev("a", "CHARGE", 100, day(1)),
    ev("b", "CHARGE", 200, day(10)),
  ];
  const w = buildLedger(events, { from: day(5), to: day(20) });
  assert.equal(w.entries.length, 1);
  assert.equal(w.totalCharges, 300, "summary totals cover all recorded charges");
});

// ── Reproducibility ───────────────────────────────────────────────────────────

test("entries sharing a timestamp keep a stable order across runs", () => {
  const at = day(5);
  const events = [
    ev("zzz", "CHARGE", 10, at),
    ev("aaa", "CHARGE", 20, at),
    ev("mmm", "CHARGE", 30, at),
  ];
  const first = buildLedger(events).entries.map((e) => e.id);
  const second = buildLedger([...events].reverse()).entries.map((e) => e.id);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["aaa", "mmm", "zzz"]);
});

test("floating point money does not accumulate drift", () => {
  const events = Array.from({ length: 10 }, (_, i) =>
    ev(`p${i}`, "CHARGE", 0.1, day(1)),
  );
  assert.equal(buildLedger(events).balance, 1);
});
  assert.equal(r.balance, 125);
  assert.equal(r.entries[1].amount, 25);
});

test("a write-off settles the debt without creating a credit", () => {
  const r = buildLedger([
    ev("sale1", "CHARGE", 80, day(1)),
    ev("adj1", "ADJUSTMENT", -80, day(2)),
  ]);
  assert.equal(r.balance, 0);
  assert.equal(r.totalPayments, 80);
});