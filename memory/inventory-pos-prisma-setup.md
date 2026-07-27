---
name: inventory-pos-prisma-setup
description: how Prisma 7 + better-sqlite3 is wired in inventory-pos (config, db, generated client, dev.db location)
metadata:
  type: project
---

`inventory-pos` Prisma 7.8 setup:

- Schema: `prisma/schema.prisma`. Datasource provider `sqlite`. Generator client output `../src/generated/prisma`.
- `prisma.config.ts` (`import "dotenv/config"`, `defineConfig` from `prisma/config`): wires `schema`, migrations `path: prisma/migrations`, `seed: tsx prisma/seed.ts`, and `datasource.url: process.env["DATABASE_URL"]`.
- `.env`: `DATABASE_URL="file:./dev.db"`. Resolved CWD-relative → the live DB is `dev.db` at the **repo root**, not `prisma/dev.db`.
- Runtime client: `src/lib/db.ts` — `PrismaClient` from `@/generated/prisma/client`, instantiated with `@prisma/adapter-better-sqlite3` (`PrismaBetterSqlite3`). Singleton via `globalThis` to survive Next HMR. No built-in query engine in Prisma 7 → driver adapter is mandatory.

Migration CLI: `npx prisma migrate dev --name <x> --schema prisma/schema.prisma`. See [[prisma-client-not-regenerated-by-migrate]] — must follow with `npx prisma generate`.
