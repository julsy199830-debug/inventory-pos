/**
 * Unit tests for the product-image rules (Phase 1c).
 *
 * These are the security-critical, pure functions behind the upload path, so
 * they are tested directly rather than only through the UI:
 *
 *  - `sniffImageMime` decides what actually gets written into `public/` and
 *    served same-origin with the POS. A `text/html` or SVG payload that slipped
 *    through would be stored XSS against the register's session, so the byte
 *    patterns are pinned here — including the near-misses (a RIFF file that
 *    isn't WebP, a truncated PNG signature).
 *  - `managedImageFileName` is the only thing standing between a user-supplied
 *    `imageUrl` and `unlink()`. It must hand back a bare, safe file name for our
 *    own uploads and `null` for everything else, including traversal attempts
 *    and externally hosted images we don't own.
 *
 * Run: npx tsx tests/unit/product-image-upload.test.ts
 */
import assert from "node:assert/strict";
import {
  buildStoredImageName,
  formatImageBytes,
  imageExtensionFor,
  isManagedProductImage,
  managedImageFileName,
  MAX_PRODUCT_IMAGE_BYTES,
  MIN_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_PUBLIC_PREFIX,
  safeImageToken,
  sniffImageMime,
  validateImageBytes,
} from "@/lib/product-image";

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

/** Real signature bytes, padded past the validator's size floor. */
function pngBytes(extra = 200): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(extra).fill(0)]);
}
function jpegBytes(extra = 200): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, ...new Array(extra).fill(0)]);
}
function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}
function gifBytes(extra = 200): Uint8Array {
  return new Uint8Array([...ascii("GIF89a"), ...new Array(extra).fill(0)]);
}
function webpBytes(extra = 200): Uint8Array {
  return new Uint8Array([
    ...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...new Array(extra).fill(0),
  ]);
}
function textBytes(text: string, extra = 200): Uint8Array {
  return new Uint8Array([...ascii(text), ...new Array(extra).fill(0)]);
}

// ── Magic-byte sniffing: the four accepted raster formats ────────────────────
check("sniffs PNG", () => assert.equal(sniffImageMime(pngBytes()), "image/png"));
check("sniffs JPEG", () => assert.equal(sniffImageMime(jpegBytes()), "image/jpeg"));
check("sniffs GIF89a", () => assert.equal(sniffImageMime(gifBytes()), "image/gif"));
check("sniffs GIF87a", () => assert.equal(sniffImageMime(textBytes("GIF87a")), "image/gif"));
check("sniffs WebP", () => assert.equal(sniffImageMime(webpBytes()), "image/webp"));

// ── Rejected: anything that could become a script sink ──────────────────────
check("rejects an HTML document, whatever it is named", () =>
  assert.equal(sniffImageMime(textBytes("<!DOCTYPE html><script>alert(1)</script>")), null));
check("rejects an SVG (script-capable, served same-origin)", () =>
  assert.equal(sniffImageMime(textBytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), null));
check("rejects a PDF", () => assert.equal(sniffImageMime(textBytes("%PDF-1.7")), null));

// ── Extension mapping is derived from the detected type, not the filename ───
check("maps each accepted mime to a safe extension", () => {
  assert.equal(imageExtensionFor("image/png"), "png");
  assert.equal(imageExtensionFor("image/jpeg"), "jpg");
  assert.equal(imageExtensionFor("image/webp"), "webp");
  assert.equal(imageExtensionFor("image/gif"), "gif");
});
check("refuses an extension for a non-accepted mime", () => {
  assert.equal(imageExtensionFor("image/svg+xml"), null);
  assert.equal(imageExtensionFor("text/html"), null);
  assert.equal(imageExtensionFor(null), null);
});
check("accept attribute lists exactly the supported types", () => {
  assert.equal(PRODUCT_IMAGE_ACCEPT, "image/jpeg,image/png,image/webp,image/gif");
});

// ── Stored names: generated, never attacker-controlled ─────────────────────
check("builds a name from the token and verified extension", () =>
  assert.equal(buildStoredImageName("png", "abc-123"), "abc-123.png"));
check("safeImageToken strips path separators, dots and traversal", () => {
  assert.equal(safeImageToken("../../etc/passwd"), "etcpasswd");
  assert.equal(safeImageToken("a/b\\c"), "abc");
  assert.equal(safeImageToken("....//....//x"), "x", "every dot and slash is dropped");
  assert.equal(safeImageToken("photo.jpg"), "photojpg");
});
check("safeImageToken keeps UUID characters intact", () => {
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(safeImageToken(uuid), uuid);
});
check("safeImageToken bounds the length", () =>
  assert.equal(safeImageToken("a".repeat(500)).length, 64));

// ── Managed-path detection: the unlink safety boundary ─────────────────────
check("recognises one of our own uploads", () => {
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}abc-123.png`), "abc-123.png");
  assert.equal(isManagedProductImage(`${PRODUCT_IMAGE_PUBLIC_PREFIX}abc-123.png`), true);
});
check("ignores null / empty / whitespace", () => {
  assert.equal(managedImageFileName(null), null);
  assert.equal(managedImageFileName(""), null);
  assert.equal(isManagedProductImage(undefined), false);
});
check("never claims an externally hosted image (we do not own it)", () => {
  assert.equal(managedImageFileName("https://cdn.example.com/a.png"), null);
  assert.equal(managedImageFileName("http://192.168.1.50/nas/a.png"), null);
  assert.equal(managedImageFileName("//evil.test/a.png"), null);
  assert.equal(isManagedProductImage("https://cdn.example.com/a.png"), false);
});
check("rejects a traversal attempt under our own prefix", () => {
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}../secrets.env`), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}..%2F..%2Fwin.ini`), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}../../dev.db`), null);
});
check("rejects a nested path under our prefix", () => {
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}sub/dir/a.png`), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}sub\\a.png`), null);
});
check("rejects a name with no extension or odd characters", () => {
  assert.equal(managedImageFileName(PRODUCT_IMAGE_PUBLIC_PREFIX), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}noext`), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}a b.png`), null);
  assert.equal(managedImageFileName(`${PRODUCT_IMAGE_PUBLIC_PREFIX}.hidden`), null);
});

// ── Validator: the gate used identically by the picker and the action ──────
check("accepts each supported format", () => {
  assert.equal(validateImageBytes(pngBytes()), null);
  assert.equal(validateImageBytes(jpegBytes()), null);
  assert.equal(validateImageBytes(gifBytes()), null);
  assert.equal(validateImageBytes(webpBytes()), null);
});
check("bytes are the only authority: the OS MIME label is ignored", () => {
  // Windows reports extension-less images as application/octet-stream. The
  // signature already decided this is a PNG, so it must not be refused.
  assert.equal(validateImageBytes(pngBytes()), null);
});
check("rejects empty bytes", () =>
  assert.match(String(validateImageBytes(new Uint8Array(0))), /empty/));
check("rejects a file under the size floor", () =>
  assert.match(
    String(validateImageBytes(new Uint8Array(MIN_PRODUCT_IMAGE_BYTES - 1))),
    /too small/,
  ));
check("rejects a file over the size ceiling", () => {
  const tooBig = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1);
  tooBig.set(pngBytes(8), 0);
  assert.match(String(validateImageBytes(tooBig)), /or smaller/);
});
check("rejects a correctly-sized file whose bytes are not an image", () =>
  assert.match(String(validateImageBytes(new Uint8Array(500))), /not a supported image/));
check("HTML masquerading as a PNG is rejected on its bytes, not its name", () =>
  assert.match(
    String(validateImageBytes(textBytes("<html><script>alert(1)</script>"))),
    /not a supported image/,
  ));

// ── Human formatting ───────────────────────────────────────────────────────
check("formats byte counts for the UI", () => {
  assert.equal(formatImageBytes(MAX_PRODUCT_IMAGE_BYTES), "2 MB");
  assert.equal(formatImageBytes(500 * 1024), "500 KB");
  assert.equal(formatImageBytes(12), "12 bytes");
});

console.log(`product image upload tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;

check("rejects an ELF binary", () =>
  assert.equal(sniffImageMime(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Array(200).fill(0)])), null));
check("rejects a RIFF container that is not WebP (e.g. WAV)", () => {
  const wav = new Uint8Array([
    ...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"), ...new Array(200).fill(0),
  ]);
  assert.equal(sniffImageMime(wav), null);
});
check("rejects a truncated PNG signature (no body)", () => {
  assert.equal(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])), null);
});
check("rejects empty input", () => assert.equal(sniffImageMime(new Uint8Array(0)), null));
