/**
 * Unit tests for the register's customer picker (Phase 4).
 *
 * `rankCustomerMatches` is what a cashier actually feels: hit the key, get the
 * right customer highlighted, press Enter. The ordering rules are pinned here
 * rather than only through the browser because a regression is quiet - the
 * picker still works, it just attaches the wrong account to the sale, and the
 * cashier has no way to notice.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RESULTS,
  rankCustomerMatches,
  relativeSince,
  shouldOfferCreate,
} from "../../src/app/pos/customer-search";
import type { PosCustomer } from "../../src/app/pos/PosCheckout";

/** Minimal fixture; only the fields the helpers read matter. */
function cust(over: Partial<PosCustomer> & { id: string; name: string }): PosCustomer {
  return {
    phone: null,
    loyaltyPoints: 0,
    creditLimit: 0,
    currentBalance: 0,
    salesCount: 0,
    lastSaleAt: null,
    ...over,
  };
}

const BOOK: PosCustomer[] = [
  cust({ id: "1", name: "Ana Reyes", phone: "09171234567" }),
  cust({ id: "2", name: "Ben Santos", phone: "09181234567" }),
  cust({ id: "3", name: "Carla Bautista" }),
  cust({ id: "4", name: "Ana Cruz" }),
  cust({ id: "5", name: "Diego Lim", phone: "09201234567" }),
];

const ids = (list: PosCustomer[]) => list.map((c) => c.id);

describe("rankCustomerMatches", () => {
  it("returns an empty result set rather than everything when nothing matches", () => {
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "zzzz")), []);
  });

  it("an empty query lists the book in its given order, capped", () => {
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "")), ["1", "2", "3", "4", "5"]);
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "   ")), ["1", "2", "3", "4", "5"]);
  });

  it("matches on a name substring, case-insensitively", () => {
    // "ana" hits both Anas; "REYES" hits only one.
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "ana")).sort(), ["1", "4"]);
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "REYES")), ["1"]);
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "bautista")), ["3"]);
  });

  it("matches on a phone substring, case- and format-insensitively", () => {
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "0918")), ["2"]);
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "09171234567")), ["1"]);
  });

  it("a phone typed with spaces still finds the customer", () => {
    // Spacing and punctuation are how a number is read off a loyalty card.
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "0917 123 4567")), ["1"]);
  });

  it("an exact phone match outranks a name-prefix match", () => {
    // "09171234567" is Ana Reyes' phone, and no name starts with it, so build
    // the sharper case explicitly.
    const book: PosCustomer[] = [
      cust({ id: "phone", name: "Zed Match", phone: "5551234" }),
      cust({ id: "prefix", name: "5551234 Alpha" }),
    ];
    assert.deepEqual(ids(rankCustomerMatches(book, "5551234")), ["phone", "prefix"]);
  });

  it("a name-prefix match outranks a mid-name substring match", () => {
    const book: PosCustomer[] = [
      // "mar" sits in the middle of this one, so it is a substring hit only.
      cust({ id: "mid", name: "Ana Marisol" }),
      // ...and leads this one, so it is a prefix hit.
      cust({ id: "prefix", name: "Marisol Vega" }),
    ];
    assert.deepEqual(ids(rankCustomerMatches(book, "mar")), ["prefix", "mid"]);
  });

  it("caps the list so a broad query cannot flood the popover", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      cust({ id: String(i), name: `Customer ${i}` }),
    );
    const result = rankCustomerMatches(many, "customer");
    assert.equal(result.length, MAX_RESULTS);
    assert.ok(result.length < many.length);
  });

  it("honours an explicit limit override", () => {
    assert.equal(rankCustomerMatches(BOOK, "a", 2).length, 2);
  });

  it("orders ties by name so the highlight does not jump between keystrokes", () => {
    // Two prefix matches with the same rank: name order decides, and it must be
    // the same answer on every call.
    const book: PosCustomer[] = [
      cust({ id: "b", name: "Anna Lee" }),
      cust({ id: "a", name: "Ana Lee" }),
    ];
    assert.deepEqual(ids(rankCustomerMatches(book, "an")), ["a", "b"]);
    assert.deepEqual(ids(rankCustomerMatches(book, "an")), ["a", "b"]);
  });

  it("a customer with no phone is still findable by name", () => {
    const book: PosCustomer[] = [cust({ id: "nophone", name: "Erin Wu" })];
    assert.deepEqual(ids(rankCustomerMatches(book, "erin")), ["nophone"]);
  });

  it("a bare digit query does not match every phone on substring alone", () => {
    // Guards the `digits.length > 0` guard: an all-punctuation query must not
    // degenerate into "contains empty string" and return the whole book.
    assert.deepEqual(ids(rankCustomerMatches(BOOK, "***")), []);
  });
});

describe("relativeSince", () => {
  const NOW = new Date("2026-03-15T12:00:00Z").getTime();
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

  it("returns null when there is no purchase", () => {
    assert.equal(relativeSince(null, NOW), null);
  });

  it("returns null for an unparseable value rather than a misleading zero", () => {
    assert.equal(relativeSince("not-a-date", NOW), null);
  });

  it("labels today and yesterday", () => {
    assert.equal(relativeSince(daysAgo(0), NOW), "today");
    assert.equal(relativeSince(daysAgo(1), NOW), "yesterday");
  });

  it("labels days, months and years at the right boundaries", () => {
    assert.equal(relativeSince(daysAgo(2), NOW), "2d ago");
    assert.equal(relativeSince(daysAgo(29), NOW), "29d ago");
    assert.equal(relativeSince(daysAgo(30), NOW), "1mo ago");
    assert.equal(relativeSince(daysAgo(330), NOW), "11mo ago");
    assert.equal(relativeSince(daysAgo(365), NOW), "1y ago");
  });

  it("reads a clock-skewed future date as today, never a negative age", () => {
    const future = new Date(NOW + 5 * 86_400_000).toISOString();
    assert.equal(relativeSince(future, NOW), "today");
  });
});

describe("shouldOfferCreate", () => {
  it("never offers when the caller cannot create", () => {
    // A CASHIER must never see it: `createCustomer` is gated to ADMIN/MANAGER.
    assert.equal(shouldOfferCreate(BOOK, "New Person", false), false);
  });

  it("offers for a new name once two characters are typed", () => {
    assert.equal(shouldOfferCreate(BOOK, "Zo", true), true);
  });

  it("refuses a single character, which matches too much to be a real intent", () => {
    assert.equal(shouldOfferCreate(BOOK, "Z", true), false);
  });

  it("refuses when the name already exists, ignoring case and surrounding space", () => {
    assert.equal(shouldOfferCreate(BOOK, "Ana Reyes", true), false);
    assert.equal(shouldOfferCreate(BOOK, "  ana reyes  ", true), false);
  });

  it("offers even when a partial match exists, since that is not the same person", () => {
    // "Ana Reyes Jr" is a different customer from "Ana Reyes"; the cashier
    // decides, not the match count.
    assert.equal(shouldOfferCreate(BOOK, "Ana Reyes Jr", true), true);
  });

  it("ignores an all-whitespace query", () => {
    assert.equal(shouldOfferCreate(BOOK, "   ", true), false);
  });
});