-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- Seed one Category row per distinct `Product.category` text value so existing
-- products keep their classification when we replace the text column with a
-- `categoryId` FK below. `lowStockThreshold` defaults to 10 (the app-wide
-- default) for every backfilled category; tune per-category on the management
-- page afterwards. We insert only distinct, non-null category names — a stray
-- null or empty category becomes uncategorized (handled by the nullable FK).
INSERT INTO "Category" ("id", "name", "lowStockThreshold", "createdAt", "updatedAt")
SELECT
  -- Lower(hex(randomblob(16))) gives a 32-char hex string; prefixed so the id
  -- shape still reads like the UUIDs the runtime default would produce.
  'seedcat_' || lower(hex(randomblob(12))) AS "id",
  "category"                              AS "name",
  10                                      AS "lowStockThreshold",
  CURRENT_TIMESTAMP                        AS "createdAt",
  CURRENT_TIMESTAMP                        AS "updatedAt"
FROM "Product"
WHERE "category" IS NOT NULL AND trim("category") <> ''
GROUP BY "category";

-- RedefineTables
-- SQLite has no `ALTER TABLE ADD CONSTRAINT` and a nullable FK + index are
-- simplest to stage via the copy-rename dance the rest of this migrations
-- folder uses (see `add_employee_shift_sales`). We drop the free-text `category`
-- column on the way through — its meaning now lives on `Category` joined via
-- `categoryId`.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "stock" INTEGER NOT NULL,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "supplierId" TEXT,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Copy existing rows across, resolving categoryId from the category text via a
-- correlated subquery against the freshly seeded Category table. Rows whose
-- old `category` had no matching Category (or were null/empty) land with a
-- NULL categoryId — uncategorized, by design (the FK is nullable + SetNull).
INSERT INTO "new_Product" ("id", "name", "sku", "price", "cost", "stock", "categoryId", "createdAt", "updatedAt", "supplierId")
SELECT
  "id",
  "name",
  "sku",
  "price",
  "cost",
  "stock",
  (SELECT "id" FROM "Category" WHERE "Category"."name" IS "Product"."category") AS "categoryId",
  "createdAt",
  "updatedAt",
  "supplierId"
FROM "Product";

DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
