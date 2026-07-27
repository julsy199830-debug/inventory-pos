-- Add a unique constraint on Supplier.name so each supplier has a distinct
-- business name. Backfills safely because the existing dev.db holds three
-- suppliers with distinct names (verified before creating this migration).
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
