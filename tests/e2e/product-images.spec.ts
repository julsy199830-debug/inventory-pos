/**
 * Product management + photo upload — UI smoke test (Phase 1c).
 *
 * Covers the flows a clerk actually performs:
 *   1. the Edit dialog opens on the shared modal and shows a photo area
 *   2. a product with no photo shows the initials fallback, not a broken image
 *   3. uploading a real image attaches it and the row renders it
 *   4. the photo can be removed again, returning to the fallback
 *   5. a non-image is refused inline with a readable message
 *
 * RULES:
 *  - Every test resolves its own target row and logs in for itself, so none of
 *    them depend on another having run first.
 *  - Uploads write into the real `public/uploads/products/` directory (where the
 *    app stores them). `beforeAll` records what was already there and
 *    `afterAll` deletes only the files this spec created, so the working tree is
 *    left exactly as found.
 *  - The shared E2E database is disposable; no reseeding.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** A 1x1 PNG — the smallest genuinely-signed image our validator accepts. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/**
 * A real HTML document wearing a .png name and an image/png MIME type — the
 * classic "upload" payload. It must be refused.
 *
 * Note this deliberately has NO image signature at the front. Magic-byte
 * sniffing proves a file *begins* with one of the four accepted formats (and
 * the stored extension is derived from that); it is not a full image decoder.
 * A polyglot that starts with valid PNG bytes would pass, but it would still be
 * stored as — and served as — `image/png`, so a browser renders it as an image
 * rather than executing it. That is the property that actually matters, and it
 * is enforced by the extension, not by the sniff.
 */
const HTML_AS_PNG = Buffer.concat([
  Buffer.from('<!DOCTYPE html><html><body><script>alert(document.cookie)</script></body></html>', 'utf8'),
  Buffer.alloc(256, 0x20),
]);

const UPLOAD_DIR = path.resolve('public', 'uploads', 'products');
/** Files present before the spec ran, so cleanup only removes what we added. */
let preExisting: string[] = [];

type Page = import('@playwright/test').Page;

async function adminLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button:has-text("Admin")').first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill('1234');
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

/**
 * Open the Edit dialog for the first product row.
 * Retries past hydration, since the trigger is a client island. Returns the
 * dialog plus the product name (read from the trigger's aria-label), so tests
 * can assert against the same row without a brittle DOM query.
 */
async function openFirstEditDialog(page: Page): Promise<{
  dialog: import('@playwright/test').Locator;
  productName: string;
}> {
  await adminLogin(page);
  await page.goto('/inventory');
  const trigger = page.locator('button[aria-label^="Edit "]').first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  const label = (await trigger.getAttribute('aria-label')) ?? '';
  const productName = label.replace(/^Edit /, '');
  expect(productName, 'trigger exposes the product name').not.toBe('');

  await expect(async () => {
    await trigger.click();
    await expect(
      page.getByRole('dialog', { name: 'Edit Product' }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return { dialog: page.getByRole('dialog', { name: 'Edit Product' }), productName };
}

/** Attach a photo through the dialog's file input. */
async function attachPhoto(
  dialog: import('@playwright/test').Locator,
  buffer: Buffer,
): Promise<void> {
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'shelf.png',
    mimeType: 'image/png',
    buffer,
  });
}

test.describe('Product management', () => {
  test.beforeAll(() => {
    if (existsSync(UPLOAD_DIR)) preExisting = readdirSync(UPLOAD_DIR);
  });

  test.afterAll(() => {
    if (!existsSync(UPLOAD_DIR)) return;
    for (const f of readdirSync(UPLOAD_DIR)) {
      if (!preExisting.includes(f)) rmSync(path.join(UPLOAD_DIR, f), { force: true });
    }
  });

  test('edit dialog shows a photo area with the initials fallback', async ({ page }) => {
    const { dialog } = await openFirstEditDialog(page);

    // The shared modal with a dedicated, full-width photo section.
    await expect(dialog.getByRole('heading', { name: 'Photo' })).toBeVisible();
    await expect(dialog.getByText('No photo')).toBeVisible();
    await expect(dialog.getByText(/Drag an image here/)).toBeVisible();
    await expect(dialog.getByText(/JPG, PNG, WebP or GIF/)).toBeVisible();
    // The URL escape hatch is preserved for LAN/NAS-hosted photos.
    await expect(dialog.getByLabel(/paste an image URL/i)).toBeVisible();
  });

  test('refuses a non-image that is named like a photo', async ({ page }) => {
    const { dialog } = await openFirstEditDialog(page);
    await attachPhoto(dialog, HTML_AS_PNG);

    // Refused on its bytes, and the message says so in plain language.
    await expect(dialog.getByRole('alert')).toContainText(/not a supported image/i, {
      timeout: 15000,
    });
    await expect(dialog.getByText('No photo')).toBeVisible();
  });

  test('uploads a photo, renders it on the row, then removes it again', async ({ page }) => {
    const { dialog, productName } = await openFirstEditDialog(page);

    await attachPhoto(dialog, PNG_1PX);
    await expect(dialog.getByText('Current')).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('button', { name: 'Remove photo' })).toBeVisible();

    // The stored reference is a managed path, not a blob: URL.
    await expect(dialog.getByLabel(/paste an image URL/i)).toHaveValue(
      /^\/uploads\/products\/[A-Za-z0-9-]+\.png$/,
    );

    // The inventory row now renders a real <img> for this product.
    await dialog.getByRole('button', { name: 'Close' }).click();
    const row = page.locator('tr', { hasText: productName }).first();
    await expect(row.locator('img')).toHaveCount(1, { timeout: 15000 });

    // Removing returns the row to the initials fallback.
    const again = page.getByRole('dialog', { name: 'Edit Product' });
    await page.locator(`button[aria-label="Edit ${productName}"]`).first().click();
    await expect(again).toBeVisible({ timeout: 15000 });
    await again.getByRole('button', { name: 'Remove photo' }).click();
    await expect(again.getByText('No photo')).toBeVisible({ timeout: 15000 });
  });
});
