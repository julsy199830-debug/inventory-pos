import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma v7 ships `PrismaClient` from the generator output (see `prisma/schema.prisma`:
// `generator client { provider = "prisma-client"; output = "../src/generated/prisma" }`),
// NOT from the `@prisma/client` package entry — that module no longer re-exports it, and
// importing it from there was a TS2305 / runtime crash before this fix.
//
// v7 also mandates a driver adapter. We use the better-sqlite3 adapter the project depends on,
// pointing at the SQLite file in the repo root (matches `_smoke.js`). The `file:` prefix is
// required by better-sqlite3 regardless of cwd.
const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
