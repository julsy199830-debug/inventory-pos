import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface SqliteConn { prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }; close(): void }
const DB_PATH = process.env.DATABASE_URL ? path.resolve(process.cwd(), process.env.DATABASE_URL.replace(/^file:/, '')) : path.resolve(__dirname, '..', '..', 'dev.db');
function db(): SqliteConn { return new Database(DB_PATH) as unknown as SqliteConn; }

let poId = '';
let poNumber = '';
let productId = '';
let originalStock = 0;

test.beforeAll(() => {
  const conn = db();
  try {
    const admin = conn.prepare("SELECT id FROM \"User\" WHERE role = 'ADMIN' AND active = 1 ORDER BY createdAt LIMIT 1").get() as { id: string };
    const supplier = conn.prepare('SELECT id FROM "Supplier" ORDER BY name LIMIT 1').get() as { id: string };
    const product = conn.prepare('SELECT id, stock FROM "Product" ORDER BY name LIMIT 1').get() as { id: string; stock: number };
    poId = randomUUID(); poNumber = `E2E-RCPT-${Date.now()}`; productId = product.id; originalStock = product.stock;
    conn.prepare('INSERT INTO "PurchaseOrder" (id, poNumber, supplierId, status, orderDate, createdById, createdAt, updatedAt) VALUES (?, ?, ?, \'ORDERED\', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(poId, poNumber, supplier.id, admin.id);
    conn.prepare('INSERT INTO "PurchaseOrderItem" (id, purchaseOrderId, productId, orderedQty, unitCost, receivedQty, createdAt, updatedAt) VALUES (?, ?, ?, 5, 1.25, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(randomUUID(), poId, productId);
  } finally { conn.close(); }
});

test.afterAll(() => {
  const conn = db();
  try {
    conn.prepare('DELETE FROM "PurchaseReceiptItem" WHERE purchaseReceiptId IN (SELECT id FROM "PurchaseReceipt" WHERE purchaseOrderId = ?)').run(poId);
    conn.prepare('DELETE FROM "PurchaseReceipt" WHERE purchaseOrderId = ?').run(poId);
    conn.prepare('DELETE FROM "StockMovement" WHERE reason LIKE ?').run(`%${poNumber}%`);
    conn.prepare('DELETE FROM "PurchaseOrderItem" WHERE purchaseOrderId = ?').run(poId);
    conn.prepare('DELETE FROM "PurchaseOrder" WHERE id = ?').run(poId);
    conn.prepare('UPDATE "Product" SET stock = ? WHERE id = ?').run(originalStock, productId);
  } finally { conn.close(); }
});

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await expect(async () => {
    await page.locator('button:has-text("Admin")').first().click();
    await expect(page.locator('input[type="password"]')).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.locator('input[type="password"]').fill('1234');
  await page.locator('button:has-text("Open register")').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
}

test.describe('Purchase receiving UI', () => {
  test('receives a delivery, rejects over-receiving, and shows history', async ({ page }) => {
    await login(page);
    await page.goto(`/purchasing/${poId}`);
    await expect(page.locator('h1')).toHaveText(poNumber);
    await expect(page.getByRole('button', { name: 'Receive stock' })).toBeVisible();
    await expect(async () => {
      await page.getByRole('button', { name: 'Receive stock' }).click();
      await expect(page.getByRole('spinbutton')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    const input = page.getByRole('spinbutton');
    await input.fill('6');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Confirm receipt' }).click({ force: true });
    await expect(page.locator('form [role="alert"]')).toContainText('Cannot receive 6', { timeout: 15000 });
    await input.fill('2');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(page.getByText('Partially received').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Receiving history')).toBeVisible();
    await expect(page.getByText(/^RCPT-\d{6}-\d{6}$/)).toBeVisible();
  });
});
