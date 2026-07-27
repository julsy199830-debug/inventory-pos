---
name: prisma-client-not-regenerated-by-migrate
description: prisma migrate dev does not regenerate the Prisma 7 client in this repo; run prisma generate after schema changes
metadata:
  type: project
---

In `inventory-pos` (Prisma 7.8 + `@prisma/adapter-better-sqlite3`, `prisma.config.ts` + driver-adapter client at `src/lib/db.ts`, generated client output `src/generated/prisma`), `npx prisma migrate dev --name <x>` applies the migration to `dev.db` (at repo root — `file:./dev.db` in `.env` resolves CWD-relative) but does **not** reliably regenerate the client. After any `schema.prisma` change, also run `npx prisma generate` explicitly, then verify the new model file exists under `src/generated/prisma/models/` before assuming it's ready.

**Why:** Observed 2026-07-15 — after `migrate dev` for the `add_suppliers` migration, `src/generated/prisma/models/` lacked `Supplier.ts` and model files kept a prior-day timestamp; only `prisma generate` produced it.

**How to apply:** Workflow after schema edits: edit `prisma/schema.prisma` → `npx prisma migrate dev --name <x>` → `npx prisma generate` → confirm the new `models/<Name>.ts` landed → restart `next dev`. Related: [[inventory-pos-prisma-setup]].
