import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Known absolute project root: `next.config.ts`'s own directory. Turbopack
// walks up from the entry looking for a lockfile to decide the workspace root,
// and here there's a *second* `package-lock.json` (plus a `node_modules/`) one
// directory up at `C:\Users\OCA\` — a stray leftover from an earlier `npm
// install openai` run in the wrong directory. Turbopack picked that parent as
// the root, which has only `openai` installed — no `better-sqlite3`, no `prisma`.
// Resolving the action module graph (which imports `@/lib/db` → the native
// `better-sqlite3` adapter) then failed inside the Turbopack worker, so every
// Server Action POST returned "Connection closed." before the action body ever
// ran (the Add Employee save silently dropped, with no row written and no
// server-side exception in the action's own try/catch). Pinning `turbopack.root`
// to this directory makes module resolution stay in the project, where the
// real dependencies live. The standalone fix is to delete the stray
// `C:\Users\OCA\package.json` / `package-lock.json`; this config pin survives
// that and any future stray lockfile too.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  /**
   * Allow Server Actions from cross-origin requests (LAN access).
   * Without this, Server Actions fail when accessing from other devices on the network.
   * Includes localhost, LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x), and wildcard for flexibility.
   */
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        '127.0.0.1:3000',
        // LAN ranges - use specific IP in production, wildcard for dev flexibility
        '192.168.*.*',
        '10.*.*.*',
        '172.16.*.*',
        '172.17.*.*',
        '172.18.*.*',
        '172.19.*.*',
        '172.20.*.*',
        '172.21.*.*',
        '172.22.*.*',
        '172.23.*.*',
        '172.24.*.*',
        '172.25.*.*',
        '172.26.*.*',
        '172.27.*.*',
        '172.28.*.*',
        '172.29.*.*',
        '172.30.*.*',
        '172.31.*.*',
      ],
    },
  },
  /**
   * Native/Node-only packages that must not be bundled into the Next.js
   * server build. Prisma 7 needs a driver adapter at runtime —
   * `@prisma/adapter-better-sqlite3` wraps the native `better-sqlite3` binary.
   *
   * `better-sqlite3`, `prisma`, and `@prisma/client` are already on Next's
   * built-in opt-out list, so we only need to declare the adapter explicitly.
   * Without this, the webpack/turbopack bundler chokes on the native module.
   */
  serverExternalPackages: ["@prisma/adapter-better-sqlite3"],
};

export default nextConfig;

