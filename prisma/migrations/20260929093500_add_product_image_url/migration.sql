-- Phase 1a: product photos.
--
-- 1. Optional product photo. Nullable TEXT with no default, so every existing
--    Product row reads back as NULL and the UI renders its generated
--    placeholder instead of a broken image. Additive only - no table rebuild,
--    no row rewrite, no data loss.
ALTER TABLE "Product" ADD COLUMN "imageUrl" TEXT;

-- 2. Reconcile pre-existing drift. The `add_suppliers` and `add_category_model`
--    migrations already created these two indexes, but the database never
--    received them because the matching `@@index` declarations were lost from
--    schema.prisma. Creating an index is non-destructive, so this brings the
--    database back in line with the migration history and unblocks
--    `prisma migrate dev` (which was demanding a destructive reset).
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_supplierId_idx" ON "Product"("supplierId");