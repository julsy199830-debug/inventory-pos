/**
 * Unit tests for the product-image URL rules (Phase 1a).
 *
 * `Product.imageUrl` is rendered into an `<img src>` on the register grid and
 * the inventory table, so the validator is a security boundary as much as a
 * UX one: it must accept what a self-hosted LAN store actually uses (absolute
 * http(s) URLs and root-relative paths) and reject everything else, so a stored
 * `javascript:` payload can never become a script sink.
 */
import assert from "node:assert/strict";
import {
  hasProductImage,
  INVALID_IMAGE_URL,
  parseImageUrl,
} from "@/lib/types";

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

// ── Accepted: the shapes a real store uses ─────────────────────────────────
check("accepts an https URL", () => {
  assert.equal(parseImageUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
});
check("accepts an http URL", () => {
  assert.equal(parseImageUrl("http://192.168.1.50:3000/img/a.png"), "http://192.168.1.50:3000/img/a.png");
});
check("accepts a root-relative path served by this app", () => {
  assert.equal(parseImageUrl("/images/tee.png"), "/images/tee.png");
});
check("trims surrounding whitespace", () => {
  assert.equal(parseImageUrl("  https://x.test/a.jpg  "), "https://x.test/a.jpg");
});

// ── Empty means "no photo", which is legal ────────────────────────────────
check("empty string becomes null (placeholder, not an error)", () => {
  assert.equal(parseImageUrl(""), null);
});
check("whitespace-only becomes null", () => {
  assert.equal(parseImageUrl("   "), null);
});
check("undefined becomes null", () => {
  assert.equal(parseImageUrl(undefined), null);
});
check("null becomes null", () => {
  assert.equal(parseImageUrl(null), null);
});

// ── Rejected: script sinks and nonsense ───────────────────────────────────
check("rejects a javascript: URL", () => {
  assert.equal(parseImageUrl("javascript:alert(1)"), INVALID_IMAGE_URL);
});
check("rejects a data: URI", () => {
  assert.equal(parseImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), INVALID_IMAGE_URL);
});
check("rejects a file: URL", () => {
  assert.equal(parseImageUrl("file:///etc/passwd"), INVALID_IMAGE_URL);
});
check("rejects a protocol-relative //host path (open-redirect-ish shape)", () => {
  assert.equal(parseImageUrl("//evil.test/a.jpg"), INVALID_IMAGE_URL);
});
check("rejects a bare word", () => {
  assert.equal(parseImageUrl("not-a-url"), INVALID_IMAGE_URL);
});
check("rejects an over-long value", () => {
  assert.equal(parseImageUrl("https://x.test/" + "a".repeat(2100)), INVALID_IMAGE_URL);
});

// ── hasProductImage narrows away the sentinel ─────────────────────────────
check("hasProductImage true for a real url", () => {
  assert.equal(hasProductImage("https://x.test/a.jpg"), true);
});
check("hasProductImage false for null / empty / sentinel", () => {
  assert.equal(hasProductImage(null), false);
  assert.equal(hasProductImage(""), false);
  assert.equal(hasProductImage("   "), false);
  // The sentinel is a symbol, not a string, so it is never "an image".
  assert.equal(hasProductImage(INVALID_IMAGE_URL as unknown as string), false);
});

console.log(`product image URL tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
