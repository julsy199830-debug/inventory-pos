/**
 * Stage 1 unit tests for the PIN hashing library (`src/lib/pin.ts`).
 *
 * The project's only test framework is Playwright, which is reserved for E2E
 * (testDir `./tests/e2e`, boots the dev server and seeds SQLite). These are
 * pure-Node assertions run with the same `tsx` runner the project already uses
 * for `prisma/seed.ts` and `scripts/promote-admin.ts`:
 *
 *   npx tsx tests/unit/pin-hash.test.ts
 *
 * Exits non-zero when any assertion fails. The PIN literals below are the
 * already-public seed/demo PINs and throwaway shapes; the runner prints only
 * PASS/FAIL lines — never a hash, a salt, or derived bytes.
 */

import assert from "node:assert/strict";
import { hashPin, verifyPin, isHashedPin, PIN_PATTERN } from "../../src/lib/pin";

/** A valid v1 stored hash looks exactly like this (values unspecified). */
const V1_FORMAT = /^scrypt\$v1\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

let passed = 0;
const failed: string[] = [];

async function test(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  // 1–3. Round-trip against a known PIN.
  const adminHash = await hashPin("1234");

  await test("1. hashPin returns a valid versioned scrypt hash", () => {
    assert.match(adminHash, V1_FORMAT, "stored value is not in v1 format");
    assert.equal(isHashedPin(adminHash), true);
  });

  await test("2. verifyPin accepts the correct PIN", async () => {
    assert.equal(await verifyPin("1234", adminHash), true);
  });

  await test("3. verifyPin rejects a wrong PIN", async () => {
    assert.equal(await verifyPin("9999", adminHash), false);
  });

  // 4–5. Leading zeros and the full 4–6 digit range must survive as strings.
  await test("4. leading-zero PIN '0000' hashes and verifies", async () => {
    const hash = await hashPin("0000");
    assert.equal(isHashedPin(hash), true);
    assert.equal(await verifyPin("0000", hash), true);
    assert.equal(await verifyPin("000", hash), false);
  });

  await test("5. six-digit PIN '000001' hashes and verifies", async () => {
    const hash = await hashPin("000001");
    assert.equal(isHashedPin(hash), true);
    assert.equal(await verifyPin("000001", hash), true);
    assert.equal(await verifyPin("00001", hash), false);
  });

  // 6–7. Random per-hash salt: same input, different stored values, both valid.
  const [first, second] = await Promise.all([hashPin("1234"), hashPin("1234")]);

  await test("6. hashing the same PIN twice yields different stored values", () => {
    assert.notEqual(first, second, "salt did not vary between hashes");
  });

  await test("7. both same-PIN hashes verify successfully", async () => {
    assert.equal(await verifyPin("1234", first), true);
    assert.equal(await verifyPin("1234", second), true);
  });

  // 8. Malformed stored values fail closed: false, never an exception.
  const HEX32 = "a".repeat(32);
  const HEX128 = "b".repeat(128);
  const malformed: Array<[string, string]> = [
    ["empty string", ""],
    ["random text", "random text"],
    ["plaintext-looking value", "1234"],
    ["incomplete format", "scrypt$v1$"],
    ["missing salt and hash", "scrypt$v1$16384$8$1"],
    ["invalid numeric parameters", `scrypt$v1$abc$8$1$${HEX32}$${HEX128}`],
    ["N out of range", `scrypt$v1$9999999$8$1$${HEX32}$${HEX128}`],
    ["N not a power of two", `scrypt$v1$16383$8$1$${HEX32}$${HEX128}`],
    ["r out of range", `scrypt$v1$16384$999$1$${HEX32}$${HEX128}`],
    ["p out of range", `scrypt$v1$16384$8$99$${HEX32}$${HEX128}`],
    ["invalid hex salt", `scrypt$v1$16384$8$1$${"z".repeat(32)}$${HEX128}`],
    ["invalid hex hash", `scrypt$v1$16384$8$1$${HEX32}$${"z".repeat(128)}`],
    ["truncated hash", `scrypt$v1$16384$8$1$${HEX32}$${HEX128.slice(0, 100)}`],
    ["unknown version", `scrypt$v2$16384$8$1$${HEX32}$${HEX128}`],
    ["wrong algorithm", `bcrypt$v1$16384$8$1$${HEX32}$${HEX128}`],
  ];

  await test("8. malformed stored values return false without throwing", async () => {
    for (const [label, stored] of malformed) {
      assert.equal(isHashedPin(stored), false, `isHashedPin: ${label}`);
      const verified = await verifyPin("1234", stored); // must not throw
      assert.equal(verified, false, `verifyPin: ${label}`);
    }
  });

  // 9. The shape rule is still the shared PIN_PATTERN, unchanged and strict.
  await test("9. PIN validation stays strict (4–6 digits only)", () => {
    for (const bad of ["123", "1234567", "12a4", "12 4", "1.23", "12-4", ""]) {
      assert.equal(PIN_PATTERN.test(bad), false, `should reject: "${bad}"`);
    }
    for (const good of ["0000", "0123", "1234", "9999", "000001", "999999"]) {
      assert.equal(PIN_PATTERN.test(good), true, `should accept: "${good}"`);
    }
  });

  await test("9b. hashPin refuses to hash a non-PIN (async rejection)", async () => {
    await assert.rejects(hashPin("123"), /4–6 digits/);
    await assert.rejects(hashPin("1234567"), /4–6 digits/);
    await assert.rejects(hashPin("abcd"), /4–6 digits/);
  });

  // 10. Genuinely asynchronous: returns a Promise and runs concurrent work.
  await test("10. hashPin is asynchronous and safely concurrent", async () => {
    const pending = hashPin("1234");
    assert.ok(pending instanceof Promise, "hashPin did not return a Promise");
    const hashes = await Promise.all([
      pending,
      hashPin("1234"),
      hashPin("0000"),
      hashPin("000001"),
    ]);
    for (const hash of hashes) {
      assert.match(hash, V1_FORMAT, "concurrent hash broke the format");
    }
    assert.notEqual(hashes[0], hashes[1]);
    assert.equal(await verifyPin("1234", hashes[0]), true);
    assert.equal(await verifyPin("0000", hashes[2]), true);
    assert.equal(await verifyPin("000001", hashes[3]), true);
  });

  const total = passed + failed.length;
  console.log(
    `\nPIN hashing unit tests: ${passed}/${total} passed, ${failed.length} failed.`,
  );
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(" | ")}`);
    process.exit(1);
  }
}

void main();
