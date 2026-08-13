import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Resolve the SQLite database URL.
 *
 * `prisma.config.ts` reads `DATABASE_URL` from `.env` and feeds it to Prisma's
 * CLI (migrations, etc.). The runtime client can't see `.env` automatically, so
 * we read the same env var here and fall back to the local dev file. Keep this
 * in sync with the value in `.env`.
 */
const databaseUrl =
  process.env.DATABASE_URL ?? "file:./dev.db";

/**
 * Safe Prisma client singleton for Next.js.
 *
 * Prisma 7 has no built-in query engine — every client needs a driver adapter.
 * We use `@prisma/adapter-better-sqlite3`, which wraps the native
 * `better-sqlite3` module against our SQLite `dev.db`.
 *
 * During `next dev`, HMR tears down and re-imports modules on every change. A
 * fresh `new PrismaClient()` on each reload would open a new connection pool
 * and leak the old ones — SQLite only allows one writer, so this matters. We
 * stash the client on `globalThis` in development and reuse the same instance
 * across reloads. In production there is no HMR, so a normal client is fine.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
