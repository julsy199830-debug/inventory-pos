/**
 * Unit tests for the legacy-PIN migration core (`scripts/hash-existing-pins.ts`).
 *
 * Run with the project's plain script runner (same style as pin-hash.test.ts):
 *   npx tsx tests/unit/migrate-pins.test.ts
 *
 * The core functions take injected store closures, so every case here runs
 * against a tiny in-memory fake — no database, no filesystem, no network.
 * PIN literals appear only as fixture inputs; no PIN or hash is ever printed.
 */
import {
  migrateLegacyPins,
  verifyAllHashes,
  resolveDbUrl,
  type LegacyUserRecord,
  type UserHashRecord,
} from "../../scripts/hash-existing-pins";
import { hashPin, isHashedPin, verifyPin } from "../../src/lib/pin";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`ok - ${name}`);
    })
    .catch((e: unknown) => {
      failed++;
      console.error(`FAIL - ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

function eq(a: unknown, b: unknown, msg?: string): void {
  assert(a === b, `${msg ?? "values differ"}: ${String(a)} !== ${String(b)}`);
}

type Row = { id: string; name: string; email: string; pin: string; pinHash: string | null };

function fakeStore(rows: Row[]) {
  return {
    findLegacyUsers: async (): Promise<LegacyUserRecord[]> =>
      rows
        .filter((r) => r.pinHash === null)
        .map(({ id, name, email, pin }) => ({ id, name, email, pin })),
    countHashedUsers: async () => rows.filter((r) => r.pinHash !== null).length,
    writePinHash: async (id: string, pinHash: string) => {
      const rowFound = rows.find((r) => r.id === id);
      if (!rowFound) return 0;
      if (rowFound.pinHash !== null) return 0; // conditional write: only when NULL
      rowFound.pinHash = pinHash;
      return 1;
    },
    readUsers: async (): Promise<UserHashRecord[]> =>
      rows.map(({ id, pin, pinHash }) => ({ id, pin, pinHash })),
  };
}

let seq = 0;
function row(pin: string, pinHash: string | null, name = "Fixture"): Row {
  seq += 1;
  return { id: `u${seq}`, name, email: `${name.toLowerCase()}${seq}@t.test`, pin, pinHash };
}

async function main(): Promise<void> {
  // ── Test 1: valid legacy users are migrated; only pinHash is written ────
  await check("legacy user migrated; only pinHash written; hash self-verifies", async () => {
    const store = fakeStore([row("1234", null, "Admin")]);
    const out = await migrateLegacyPins(store.findLegacyUsers, store.countHashedUsers, store.writePinHash);
    eq(out.migrated, 1);
    eq(out.failed, 0);
    const [u] = await store.readUsers();
    assert(u.pinHash !== null && isHashedPin(u.pinHash), "stored value must be a valid v1 hash");
    assert(await verifyPin("1234", u.pinHash as string), "stored hash must verify against the legacy PIN");
    eq(u.pin, "1234", "legacy pin column must be untouched by the script");
  });

  // ── Test 2: already-hashed users are skipped but counted as scanned ─────
  await check("already-hashed users are skipped", async () => {
    const hashed = await hashPin("5555");
    const store = fakeStore([row("1234", null, "A"), row("5555", hashed, "B")]);
    const out = await migrateLegacyPins(store.findLegacyUsers, store.countHashedUsers, store.writePinHash);
    eq(out.scanned, 2);
    eq(out.alreadyHashed, 1);
    eq(out.migrated, 1);
  });

  // ── Test 3: malformed legacy PINs are rejected without any write ────────
  await check("malformed legacy PINs reported for manual intervention, untouched", async () => {
    const store = fakeStore([row("", null, "Empty"), row("abc", null, "Letters"), row("1234567", null, "Seven")]);
    const out = await migrateLegacyPins(store.findLegacyUsers, store.countHashedUsers, store.writePinHash);
    eq(out.failed, 3);
    eq(out.migrated, 0);
    eq(out.failures.length, 3);
    assert(out.failures.every((f) => f.reason.includes("manual intervention")), "reason must ask for intervention");
    assert((await store.readUsers()).every((u) => u.pinHash === null), "nothing may be written for failures");
  });

  // ── Test 4: rerunning is idempotent ─────────────────────────────────────
  await check("rerun is idempotent (second run migrates nothing)", async () => {
    const store = fakeStore([row("1234", null, "Admin"), row("0000", null, "Cashier")]);
    const first = await migrateLegacyPins(store.findLegacyUsers, store.countHashedUsers, store.writePinHash);
    eq(first.migrated, 2);
    const second = await migrateLegacyPins(store.findLegacyUsers, store.countHashedUsers, store.writePinHash);
    eq(second.migrated, 0, "second run must migrate nothing");
    eq(second.alreadyHashed, 2, "second run must see both rows as hashed");
    eq(second.failed, 0);
  });

  // ── Test 5: a hash that fails self-verification is never stored ─────────
  await check("self-verification guard: broken hash function writes nothing", async () => {
    const store = fakeStore([row("1234", null, "Admin")]);
    const out = await migrateLegacyPins(
      store.findLegacyUsers,
      store.countHashedUsers,
      store.writePinHash,
      async () => "not-a-valid-hash",
    );
    eq(out.failed, 1);
    eq(out.migrated, 0);
    eq((await store.readUsers())[0].pinHash, null, "nothing may be stored when self-verify fails");
  });

  // ── Test 6: a lost race (write returns 0) counts as already hashed ──────
  await check("lost race (conditional write returns 0) is safe", async () => {
    const store = fakeStore([row("1234", null, "Admin")]);
    const out = await migrateLegacyPins(
      store.findLegacyUsers,
      store.countHashedUsers,
      async () => 0, // simulate another writer winning the race
    );
    eq(out.migrated, 0);
    eq(out.alreadyHashed, 1);
    eq(out.failed, 0);
  });

  // ── Test 7: verifyAllHashes classifies every row type ───────────────────
  await check("verification pass classifies null/malformed/verified/inert/mismatch", async () => {
    const goodHash = await hashPin("1234");
    const otherHash = await hashPin("0000");
    const out = await verifyAllHashes(async () => [
      { id: "a", pin: "1234", pinHash: goodHash }, // verified
      { id: "b", pin: "inert-abc123", pinHash: otherHash }, // inert filler
      { id: "c", pin: "9999", pinHash: goodHash }, // mismatch
      { id: "d", pin: "1234", pinHash: "garbage" }, // malformed
      { id: "e", pin: "1234", pinHash: null }, // null
    ]);
    eq(out.totalUsers, 5);
    eq(out.verifiedAgainstLegacyPin, 1);
    eq(out.legacyPinInert, 1);
    eq(out.legacyMismatches, 1);
    eq(out.malformedHashes, 1);
    eq(out.nullPinHash, 1);
  });

  // ── Test 8: --db URL resolution handles both bare paths and file: URLs ──
  await check("resolveDbUrl normalizes bare paths and file: URLs", () => {
    assert(resolveDbUrl("file:C:/x/y.db").startsWith("file:"), "file: URL stays a file: URL");
    assert(resolveDbUrl("some/rel.db").startsWith("file:"), "bare path gets the file: scheme");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
