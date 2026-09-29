-- Phase 1d: loyalty redemption + partial refunds.
--
-- 1. Loyalty redemption columns on Sale. `redeemedPoints` / `redemptionAmount`
--    record what the customer SPENT at checkout (0 for almost every sale, so the
--    default keeps every existing row exactly as it was). `refundedAmount` is the
--    running total refunded, capped at `totalAmount` by the refund action.
--    Prisma rebuilds `Sale` because these are NOT NULL columns with defaults.
--
-- 2. `SaleItem.refundedQuantity` is the anti-over-refund ledger: it is always
--    0..quantity, and a second refund of the same units has nothing left to take.
--
-- 3. `SaleRefund` is the per-event audit row (who / when / how much / why). A
--    sale can be refunded several times, so the event needs its own record �
--    the same "ledger of events hanging off a parent" shape as CustomerPayment.
--
-- Note on the two PurchaseReceipt / PurchaseReceiptItem index sets: the
-- migration history already creates them but the datamodel had lost the @@index
-- declarations, so Prisma wanted to DROP them (and a destructive reset). The
-- declarations are restored in schema.prisma instead, so this migration is
-- purely additive over the sales tables. No rows are dropped or rewritten
-- beyond the two table rebuilds above, both of which copy every column.

-- CreateTable
CREATE TABLE "SaleRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "cashierId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleRefund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleRefund_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "totalAmount" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT,
    "cashierId" TEXT,
    "voidReason" TEXT,
    "voidedAt" DATETIME,
    "voidedBy" TEXT,
    "earnedPoints" INTEGER NOT NULL DEFAULT 0,
    "tendered" REAL,
    "change" REAL,
    "redeemedPoints" INTEGER NOT NULL DEFAULT 0,
    "redemptionAmount" REAL NOT NULL DEFAULT 0,
    "refundedAmount" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Sale" ("cashierId", "change", "createdAt", "customerId", "discountAmount", "earnedPoints", "id", "paymentMethod", "status", "subtotal", "tax", "tendered", "totalAmount", "voidReason", "voidedAt", "voidedBy") SELECT "cashierId", "change", "createdAt", "customerId", "discountAmount", "earnedPoints", "id", "paymentMethod", "status", "subtotal", "tax", "tendered", "totalAmount", "voidReason", "voidedAt", "voidedBy" FROM "Sale";
DROP TABLE "Sale";
ALTER TABLE "new_Sale" RENAME TO "Sale";
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");
CREATE INDEX "Sale_cashierId_idx" ON "Sale"("cashierId");
CREATE TABLE "new_SaleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceAtSale" REAL NOT NULL,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SaleItem" ("id", "priceAtSale", "productId", "quantity", "saleId") SELECT "id", "priceAtSale", "productId", "quantity", "saleId" FROM "SaleItem";
DROP TABLE "SaleItem";
ALTER TABLE "new_SaleItem" RENAME TO "SaleItem";
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SaleRefund_saleId_idx" ON "SaleRefund"("saleId");

-- CreateIndex
CREATE INDEX "SaleRefund_createdAt_idx" ON "SaleRefund"("createdAt");
