/**
 * Product image rules shared by the upload Server Actions and the client-side
 * image picker.
 *
 * This module is deliberately free of any `node:` imports so the browser can
 * import the same constants and sniffing logic the server uses. The picker uses
 * it to fail fast with a readable message; the action re-runs the identical
 * checks authoritatively, because a Server Action is a public POST endpoint and
 * client-side validation is a convenience, never a security boundary.
 *
 * ── Why magic-byte sniffing instead of trusting the upload ────────────────────
 * These files are written into `public/` and served from the SAME ORIGIN as the
 * POS application. A browser handed `text/html` (or an SVG carrying script) with
 * an `image/png` Content-Type is executing attacker script with the register's
 * session cookie. `File.type` comes from the OS and is attacker-controlled, so
 * it proves nothing. We read the leading bytes and only accept the four formats
 * whose signatures are unambiguous, deriving the stored extension from what we
 * actually found — never from the filename the user chose.
 *
 * SVG is deliberately unsupported for this reason: it is a script-capable
 * document format, not a raster image, and serving it same-origin is a stored
 * XSS vector. A raster fallback renders perfectly well for a product photo.
 */

/** Hard ceiling on an uploaded product photo. 2 MB is ample for a shelf photo
 *  and keeps the register's page weight sane on a LAN. */
export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

/** The smallest image we bother storing — below this it's a stray icon or a
 *  truncated upload, not a product photo. */
export const MIN_PRODUCT_IMAGE_BYTES = 64;

/** Public URL prefix where managed product photos are served from. Files land in
 *  `public/uploads/products/`, which Next serves statically (verified: runtime
 *  additions are served by `next start`), so there is no upload service, no CDN
 *  and no database blob. */
export const PRODUCT_IMAGE_PUBLIC_PREFIX = "/uploads/products/";

/** File extensions we will write, keyed by the MIME type we detected. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Human-facing MIME list for the picker's `accept` attribute and hint text. */
export const PRODUCT_IMAGE_MIME_TYPES = Object.keys(EXTENSION_BY_MIME);
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_MIME_TYPES.join(",");

/** Formats a product photo may use, as a short human string. */
export const PRODUCT_IMAGE_FORMAT_HINT = "JPG, PNG, WebP or GIF";

/**
 * Identify an image by its leading bytes.
 *
 * Returns the detected MIME type, or `null` when the bytes are not one of the
 * four accepted raster formats. Only the first twelve bytes are inspected, so
 * this is cheap enough to run on the client for instant feedback.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" / "GIF89a"
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.subarray(0, 6));
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }

  // WebP: "RIFF" .... "WEBP" (4 size bytes in between)
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/** The file extension to store a detected MIME type under, or `null` if the
 *  type is not one we accept. */
export function imageExtensionFor(mime: string | null): string | null {
  if (!mime) return null;
  return EXTENSION_BY_MIME[mime] ?? null;
}

/**
 * The stored file name for a detected MIME type.
 *
 * A random name, never the user's filename: the original name is attacker-
 * controlled and would otherwise let `../../` or a shell-hostile string reach
 * the filesystem, and two products called `photo.jpg` would collide. The
 * extension comes from the bytes we verified, so the stored file's type always
 * matches its contents.
 */
export function buildStoredImageName(extension: string, token: string): string {
  return `${token}.${extension}`;
}

/** Strip anything that isn't a safe token character, so a caller-supplied token
 *  can never inject a path separator or a dotfile. */
export function safeImageToken(token: string): string {
  return token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** The stored file name a managed `imageUrl` points at, or `null` when the URL
 *  is not one of ours (an externally hosted LAN/NAS image, say).
 *
 * Returning the bare file name — never a path — is what lets the remove action
 * unlink a file without ever joining user input onto a directory. */
export function managedImageFileName(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  // Only a root-relative path under our prefix counts. An absolute http(s) URL
  // is somebody else's file and must never be deleted.
  if (!imageUrl.startsWith(PRODUCT_IMAGE_PUBLIC_PREFIX)) return null;
  const name = imageUrl.slice(PRODUCT_IMAGE_PUBLIC_PREFIX.length);
  // Reject nested paths, traversal and empty names outright.
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(name) ? name : null;
}

/** `true` when the stored image lives in our uploads directory and can be
 *  replaced or deleted by this app. */
export function isManagedProductImage(imageUrl: string | null | undefined): boolean {
  return managedImageFileName(imageUrl) !== null;
}

/** Format a byte count for a human-readable limit/error message. */
export function formatImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * A rejection reason for an image, or `null` when the bytes are acceptable.
 *
 * Returned as a message rather than a boolean because the operator needs to know
 * *why* a perfectly reasonable-looking file was refused. Used identically by the
 * picker (instant feedback) and the action (authoritative).
 *
 * Only the bytes are consulted. The browser/OS-supplied MIME type is
 * deliberately ignored: it adds no safety (the signature is the security
 * boundary) and it creates false negatives — Windows routinely reports a valid
 * PNG as `application/octet-stream` when the file has no extension
 * association, and refusing those would break ordinary uploads.
 */
export function validateImageBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "That file is empty.";
  if (bytes.length < MIN_PRODUCT_IMAGE_BYTES) {
    return "That file is too small to be a product photo.";
  }
  if (bytes.length > MAX_PRODUCT_IMAGE_BYTES) {
    return `Images must be ${formatImageBytes(MAX_PRODUCT_IMAGE_BYTES)} or smaller.`;
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return `That file is not a supported image. Use ${PRODUCT_IMAGE_FORMAT_HINT}.`;
  }
  return null;
}
