import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
