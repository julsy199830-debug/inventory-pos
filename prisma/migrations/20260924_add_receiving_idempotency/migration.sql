-- Add a stable browser-generated key for receiving idempotency.
-- Existing receipts remain valid with NULL requestKey.
ALTER TABLE "PurchaseReceipt" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "PurchaseReceipt_requestKey_key" ON "PurchaseReceipt"("requestKey");
