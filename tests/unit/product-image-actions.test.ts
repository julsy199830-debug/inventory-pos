/**
 * Phase 1c integration tests for the product-image Server Actions
 * (`uploadProductImage` / `removeProductImage` in
 * `src/app/(dashboard)/inventory/actions.ts`).
 *
 * Run: npx tsx tests/unit/product-image-actions.test.ts
 *
 * ISOLATION: like the other Server Action suites, this never touches the
 * repository's `dev.db`. It points `DATABASE_URL` at a throwaway file under
 * `test-results/`, applies the real migrations, seeds its own users/products,
 * and deletes the directory afterwards.
 *
 * FILESYSTEM: uploads write to `public/uploads/products/`, which is the REAL
 * directory. To keep the repo clean the suite snapshots that directory's file
 * list before each scenario and removes anything the test created, and the
 * whole directory is deleted at the end. Only files this suite creates are ever
 * touched.
 *
 * WHAT IS BEING PINNED DOWN — the three properties that make an upload safe and
 * trustworthy:
 *   1. a real image is stored, referenced by a managed URL, and actually lands
 *      on disk with bytes matching what was sent;
 *   2. a non-image (HTML/SVG/PDF) is refused no matter what it is named or
 *      declared — this is the stored-XSS boundary;
 *   3. replace and remove clean up the superseded file, while an externally
 *      hosted image is never deleted, because we do not own it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
const origResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename = function (
  request: string,
  ...rest: unknown[]
) {
  return MOCKS[request] ?? origResolve.call(this, request, ...rest);
};

const DB_DIR = path.resolve("test-results", "product-image-db");
const DB_REL_URL = "file:./test-results/product-image-db/product-image.db";
const UPLOAD_DIR = path.resolve("public", "uploads", "products");

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((e: unknown) => {
      failed += 1;
      console.error(`FAIL - ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}
/** A genuinely-signed PNG payload, large enough to clear the validator's floor. */
function pngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...new Array(300).fill(0x41),
  ]);
}
function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, ...new Array(300).fill(0x42)]);
}
function textBytes(text: string): Uint8Array {
  return new Uint8Array([...ascii(text), ...new Array(300).fill(0x20)]);
}
/**
 * Wrap bytes in the `File` the action expects.
 *
 * The single cast is needed because the lib's `BlobPart` wants an
 * `ArrayBufferView<ArrayBuffer>` while `Uint8Array` is typed over
 * `ArrayBufferLike`. The bytes here are always plain, non-shared buffers
 * created by `new Uint8Array(...)`, so the narrower type holds at runtime.
 */
function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

/** Build the FormData the action expects: `id` + an `image` File. */
function uploadForm(productId: string, file: File): FormData {
  const f = new FormData();
  f.append("id", productId);
  f.append("image", file);
  return f;
}
function idForm(productId: string): FormData {
  const f = new FormData();
  f.append("id", productId);
  return f;
}

/** Files currently in the upload dir, so a test can assert on-disk effects. */
function uploadDirFiles(): string[] {
  if (!existsSync(UPLOAD_DIR)) return [];
  return readdirSync(UPLOAD_DIR).sort();
}

function asUser(userId: string): void {
  globalThis.__PO_TEST_COOKIES__ = { "pos-cashier": userId };
}
function signedOut(): void {
  globalThis.__PO_TEST_COOKIES__ = {};
}


async function main(): Promise<void> {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  process.env.DATABASE_URL = DB_REL_URL;

  const mig = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATABASE_URL: DB_REL_URL },
  });
  if (mig.status !== 0) {
    console.error(mig.stdout, mig.stderr);
    throw new Error(`prisma migrate deploy failed on the throwaway test DB (${mig.status})`);
  }

  const { prisma } = await import("@/lib/db");
  const { hashPin } = await import("@/lib/pin");
  const { uploadProductImage, removeProductImage } = await import(
    "@/app/(dashboard)/inventory/actions"
  );

  const ADMIN = "u-pi-admin";
  const MANAGER = "u-pi-manager";
  const CASHIER = "u-pi-cashier";
  for (const [id, name, role, pin] of [
    [ADMIN, "Photo Admin", "ADMIN", "1234"],
    [MANAGER, "Photo Manager", "MANAGER", "2345"],
    [CASHIER, "Photo Cashier", "CASHIER", "3456"],
  ] as const) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}@product-image.test`,
        passwordHash: "test-only-not-used",
        pinHash: await hashPin(pin),
        role,
        active: true,
      },
    });
  }

  let seq = 0;
  async function makeProduct(stock = 10): Promise<string> {
    seq += 1;
    const p = await prisma.product.create({
      data: {
        name: `Photo Widget ${seq}`,
        sku: `PI-${String(seq).padStart(4, "0")}`,
        price: 10,
        cost: 4,
        stock,
      },
    });
    return p.id;
  }
  const imageOf = (id: string): Promise<string | null> =>
    prisma.product.findUniqueOrThrow({ where: { id } }).then((p) => p.imageUrl);
  const pngFile = (name = "photo.png", type = "image/png"): File =>
    makeFile(pngBytes(), name, type);
  const fileFrom = makeFile;

  asUser(ADMIN);

  // ══ 1. UPLOAD: a real image is stored, referenced and written to disk ═════
  await check("1. uploading a PNG stores the bytes and points imageUrl at them", async () => {
    const id = await makeProduct();
    const before = uploadDirFiles().length;
    const res = await uploadProductImage(uploadForm(id, pngFile()));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const url = res.data.imageUrl;
    assert.ok(url, "returns the resulting imageUrl");
    assert.match(url, /^\/uploads\/products\/[A-Za-z0-9-]+\.png$/, "managed path, generated name");
    assert.equal(await imageOf(id), url, "the row points at the new file");
    const fileName = url.replace("/uploads/products/", "");
    assert.ok(existsSync(path.join(UPLOAD_DIR, fileName)), "file exists on disk");
    const written = new Uint8Array(readFileSync(path.join(UPLOAD_DIR, fileName)));
    assert.deepEqual([...written], [...pngBytes()], "stored bytes match what was sent");
    assert.equal(uploadDirFiles().length, before + 1, "exactly one new file");
  });

  await check("2. the stored extension follows the detected bytes, not the filename", async () => {
    const id = await makeProduct();
    // A JPEG payload wearing a .png name must be stored as .jpg.
    const jpeg = jpegBytes();
    const res = await uploadProductImage(
      uploadForm(id, fileFrom(jpeg, "lying.png", "image/png")),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.match(res.data.imageUrl ?? "", /\.jpg$/, "stored as .jpg on its real signature");
  });

  // ══ 2. REFUSAL: the stored-XSS boundary ══════════════════════════════════
  await check("3. an HTML document is refused even when named .png and typed image/png", async () => {
    const id = await makeProduct();
    const before = uploadDirFiles().length;
    const evil = fileFrom(
      textBytes("<html><script>alert(document.cookie)</script>"),
      "totally-a-photo.png",
      "image/png",
    );
    const res = await uploadProductImage(uploadForm(id, evil));
    assert.equal(res.ok, false, "script-bearing document must not be stored");
    assert.ok(!res.ok && /not a supported image/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await imageOf(id), null, "imageUrl untouched");
    assert.equal(uploadDirFiles().length, before, "nothing written to disk");
  });

  await check("4. an SVG is refused (script-capable, served same-origin)", async () => {
    const id = await makeProduct();
    const svg = fileFrom(
      textBytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      "logo.svg",
      "image/svg+xml",
    );
    const res = await uploadProductImage(uploadForm(id, svg));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /not a supported image/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await imageOf(id), null);
  });

  await check("5. empty, undersized and missing files are refused", async () => {
    const id = await makeProduct();
    const empty = await uploadProductImage(
      uploadForm(id, fileFrom(new Uint8Array(0), "e.png", "image/png")),
    );
    assert.equal(empty.ok, false);
    assert.ok(!empty.ok && /empty/.test(empty.error), !empty.ok ? empty.error : "");

    const tiny = await uploadProductImage(
      uploadForm(id, fileFrom(new Uint8Array(8), "t.png", "image/png")),
    );
    assert.equal(tiny.ok, false);
    assert.ok(!tiny.ok && /too small/.test(tiny.error), !tiny.ok ? tiny.error : "");

    // No file part at all (a hand-rolled POST).
    const none = new FormData();
    none.append("id", id);
    const res = await uploadProductImage(none);
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /Choose an image/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await imageOf(id), null);
  });

  await check("6. an over-sized file is refused before anything is written", async () => {
    const id = await makeProduct();
    const before = uploadDirFiles().length;
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(pngBytes().slice(0, 8), 0);
    const res = await uploadProductImage(uploadForm(id, fileFrom(big, "big.png", "image/png")));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /or smaller/.test(res.error), !res.ok ? res.error : "");
    assert.equal(uploadDirFiles().length, before, "no partial file left behind");
  });

  await check("7. an unknown or missing product id is refused", async () => {
    const ghost = await uploadProductImage(uploadForm("no-such-product", pngFile()));
    assert.equal(ghost.ok, false);
    assert.ok(!ghost.ok && /no longer exists/.test(ghost.error), !ghost.ok ? ghost.error : "");
    const noId = await uploadProductImage(uploadForm("", pngFile()));
    assert.equal(noId.ok, false);
    assert.ok(!noId.ok && /Missing product id/.test(noId.error), !noId.ok ? noId.error : "");
  });

  // ══ 3. REPLACE / REMOVE: file lifecycle ══════════════════════════════════
  await check("8. replacing a photo swaps the reference and deletes the old file", async () => {
    const id = await makeProduct();
    const first = await uploadProductImage(uploadForm(id, pngFile("a.png")));
    assert.ok(first.ok, !first.ok ? first.error : "");
    const firstName = (first.data.imageUrl ?? "").replace("/uploads/products/", "");
    assert.ok(existsSync(path.join(UPLOAD_DIR, firstName)));

    const second = await uploadProductImage(uploadForm(id, pngFile("b.png")));
    assert.ok(second.ok, !second.ok ? second.error : "");
    const secondName = (second.data.imageUrl ?? "").replace("/uploads/products/", "");
    assert.notEqual(secondName, firstName, "a new file, not an overwrite in place");
    assert.equal(await imageOf(id), second.data.imageUrl);
    assert.ok(existsSync(path.join(UPLOAD_DIR, secondName)), "new file present");
    assert.equal(
      existsSync(path.join(UPLOAD_DIR, firstName)),
      false,
      "the superseded file is cleaned up, not left to accumulate",
    );
  });

  await check("9. removing a photo clears the reference and deletes the file", async () => {
    const id = await makeProduct();
    const up = await uploadProductImage(uploadForm(id, pngFile()));
    assert.ok(up.ok, !up.ok ? up.error : "");
    const name = (up.data.imageUrl ?? "").replace("/uploads/products/", "");

    const res = await removeProductImage(idForm(id));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.imageUrl, null);
    assert.equal(await imageOf(id), null, "row cleared — the UI falls back to initials");
    assert.equal(existsSync(path.join(UPLOAD_DIR, name)), false, "file deleted");
  });

  await check("10. removing is idempotent and safe on a product that never had a photo", async () => {
    const id = await makeProduct();
    const res = await removeProductImage(idForm(id));
    assert.ok(res.ok, "already in the desired state is success, not an error");
    assert.equal(res.data.imageUrl, null);
    assert.equal(await imageOf(id), null);
  });

  await check("11. removing an EXTERNAL image forgets the URL but never unlinks a file we don't own", async () => {
    const id = await makeProduct();
    await prisma.product.update({
      where: { id },
      data: { imageUrl: "https://cdn.example.com/nas/tee.png" },
    });
    const sentinel = path.join(UPLOAD_DIR, "must-not-be-touched.png");
    writeFileSync(sentinel, pngBytes());

    const res = await removeProductImage(idForm(id));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(await imageOf(id), null, "reference dropped");
    assert.ok(existsSync(sentinel), "a file outside our namespace is left alone");
    rmSync(sentinel, { force: true });
  });

  await check("12. a traversal-shaped imageUrl cannot delete files outside the upload dir", async () => {
    const id = await makeProduct();
    const victim = path.resolve("db-probe-should-not-exist.txt");
    writeFileSync(victim, "secret");
    await prisma.product.update({
      where: { id },
      data: { imageUrl: "/uploads/products/../../db-probe-should-not-exist.txt" },
    });

    const res = await removeProductImage(idForm(id));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(await imageOf(id), null, "reference still cleared");
    assert.ok(existsSync(victim), "the traversal target survives — nothing joined outside the dir");
    rmSync(victim, { force: true });
  });

  // ══ 4. PERMISSIONS ════════════════════════════════════════════════════════
  await check("13. CASHIER cannot upload or remove", async () => {
    const id = await makeProduct();
    asUser(CASHIER);
    const up = await uploadProductImage(uploadForm(id, pngFile()));
    assert.equal(up.ok, false);
    assert.ok(!up.ok && /permission/.test(up.error), !up.ok ? up.error : "");
    const before = uploadDirFiles().length;
    const rm = await removeProductImage(idForm(id));
    assert.equal(rm.ok, false);
    assert.equal(uploadDirFiles().length, before, "no write from an unauthorized upload");
  });

  await check("14. a signed-out caller cannot upload or remove", async () => {
    const id = await makeProduct();
    signedOut();
    const up = await uploadProductImage(uploadForm(id, pngFile()));
    assert.equal(up.ok, false);
    assert.ok(!up.ok && /signed in/.test(up.error), !up.ok ? up.error : "");
    const rm = await removeProductImage(idForm(id));
    assert.equal(rm.ok, false);
    assert.ok(!rm.ok && /signed in/.test(rm.error), !rm.ok ? rm.error : "");
  });

  await check("15. MANAGER may upload and remove", async () => {
    const id = await makeProduct();
    asUser(MANAGER);
    const up = await uploadProductImage(uploadForm(id, pngFile()));
    assert.ok(up.ok, !up.ok ? up.error : "");
    assert.ok(await imageOf(id));
    const rm = await removeProductImage(idForm(id));
    assert.ok(rm.ok, !rm.ok ? rm.error : "");
    assert.equal(await imageOf(id), null);
  });

  // ══ 5. FALLBACK: no photo must not affect selling ════════════════════════
  await check("16. a product with no image remains fully sellable (null imageUrl)", async () => {
    const id = await makeProduct();
    assert.equal(await imageOf(id), null, "products simply start with no photo");
    // The register must not care that there is no image, so a missing photo can
    // never be a reason a sale fails.
    const { createSale } = await import("@/app/actions/sales");
    asUser(CASHIER);
    const sale = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: id, quantity: 1 }],
      tendered: 100,
      change: 90,
    });
    assert.ok(sale.ok, !sale.ok ? sale.error : "");
  });

  console.log(`\nproduct image action tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;

  await prisma.$disconnect();
  try {
    rmSync(DB_DIR, { recursive: true, force: true });
  } catch {
    console.log("note: temp test DB left in place (Windows file lock)");
  }
  // Remove only the uploads this suite created.
  try {
    rmSync(UPLOAD_DIR, { recursive: true, force: true });
  } catch {
    console.log("note: temp upload dir left in place (safe to delete manually)");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});



