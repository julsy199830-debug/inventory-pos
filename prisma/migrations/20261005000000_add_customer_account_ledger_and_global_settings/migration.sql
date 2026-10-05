-- Phase 6: global store settings + the customer account ledger.
--
-- ADDITIVE ONLY. No table is dropped, rebuilt or rewritten, and no existing row
-- is altered. Every statement below is either CREATE TABLE / CREATE INDEX or
-- ALTER TABLE ... ADD COLUMN with a constant default, which SQLite applies in
-- place to existing rows without rewriting them.
--
-- Existing business rules are deliberately unchanged:
--   * `StoreSetting.taxRate = 0` still means "no tax". `taxEnabled` is an
--     ADDITIONAL switch, and the effective rate is `taxEnabled && taxRate > 0`,
--     so a store that already relies on taxRate=0 keeps behaving identically.
--   * `CustomerPayment.kind` defaults to 'PAYMENT', so every existing row and
--     the normal recordCustomerPayment path keep their current meaning.
--   * No historical sale amount is touched. This migration changes no data.

-- ── Drift repair ──────────────────────────────────────────────────────────────
-- These four indexes are created by the Phase 2 migrations and declared in
-- schema.prisma, but are absent from the live database. `prisma migrate dev`
-- refuses to run while that is true (it offers only a destructive reset), so we
-- repair it here with IF NOT EXISTS rather than losing the store's data.
CREATE INDEX IF NOT EXISTS "PurchaseReceipt_purchaseOrderId_idx" ON "PurchaseReceipt"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseReceipt_receivedById_idx" ON "PurchaseReceipt"("receivedById");
CREATE INDEX IF NOT EXISTS "PurchaseReceiptItem_purchaseReceiptId_idx" ON "PurchaseReceiptItem"("purchaseReceiptId");
CREATE INDEX IF NOT EXISTS "PurchaseReceiptItem_purchaseOrderItemId_idx" ON "PurchaseReceiptItem"("purchaseOrderItemId");

-- ── StoreSetting: one global configuration for the whole app ──────────────────
ALTER TABLE "StoreSetting" ADD COLUMN "taxEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreSetting" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-PH';
ALTER TABLE "StoreSetting" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'PHP';
ALTER TABLE "StoreSetting" ADD COLUMN "dateFormat" TEXT NOT NULL DEFAULT 'MMM D, YYYY';
ALTER TABLE "StoreSetting" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT 'h:mm a';
ALTER TABLE "StoreSetting" ADD COLUMN "email" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "receiptFooter" TEXT;

-- ── CustomerPayment.kind ──────────────────────────────────────────────────────
-- Lets the ledger tell a real settlement from the synthetic row `voidSale`
-- writes to reverse a credit sale. Without it a voided credit sale would post
-- both a reversed charge AND a payment, showing a phantom credit.
ALTER TABLE "CustomerPayment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PAYMENT';

-- ── AccountAdjustment ─────────────────────────────────────────────────────────
-- Manual movements of a customer account (correction, write-off). The balance is
-- derived from records in src/lib/ledger.ts, so an adjustment must be a row,
-- never a silent edit of the stored float.
CREATE TABLE "AccountAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AccountAdjustment_customerId_idx" ON "AccountAdjustment"("customerId");
CREATE INDEX "AccountAdjustment_createdAt_idx" ON "AccountAdjustment"("createdAt");

-- ── LoyaltyEvent ──────────────────────────────────────────────────────────────
-- The record `Customer.loyaltyPoints` is derived from, so a points balance can
-- be explained to the customer instead of only diffed.
CREATE TABLE "LoyaltyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "saleId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoyaltyEvent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LoyaltyEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "LoyaltyEvent_customerId_idx" ON "LoyaltyEvent"("customerId");
CREATE INDEX "LoyaltyEvent_saleId_idx" ON "LoyaltyEvent"("saleId");
CREATE INDEX "LoyaltyEvent_createdAt_idx" ON "LoyaltyEvent"("createdAt");