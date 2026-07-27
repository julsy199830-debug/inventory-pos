-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeName" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "currencySymbol" TEXT NOT NULL DEFAULT '$',
    "updatedAt" DATETIME NOT NULL
);
