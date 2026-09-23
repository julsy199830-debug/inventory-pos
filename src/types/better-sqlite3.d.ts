// Ambient type declarations for `better-sqlite3` v12 — the package ships no
// TypeScript types (no `types` field, no bundled `.d.ts`), so `db.ts`'s direct
// use (WAL pragma + online backup) needs a minimal local surface. This also
// keeps `@prisma/adapter-better-sqlite3`'s `import type { Options } from
// 'better-sqlite3'` resolvable.
declare module "better-sqlite3" {
  export interface Options {
    /** Open the database read-only. */
    readonly?: boolean;
    /** Throw instead of creating the file when it doesn't exist. */
    fileMustExist?: boolean;
    /** SQLITE_BUSY wait timeout in ms. */
    timeout?: number;
    /** Debug logger invoked for each executed statement. */
    verbose?: ((message?: unknown, additionalArguments?: unknown[]) => void) | null;
    /** Explicit path to the native binding. */
    nativeBinding?: string;
  }

  export interface BackupProgressInfo {
    totalPages: number;
    remainingPages: number;
  }

  export interface BackupOptions {
    /** Which attached database to back up (defaults to "main"). */
    attached?: string;
    /** Progress callback — return false to abort the backup. */
    progress?: (info: BackupProgressInfo) => void | boolean;
  }

  export interface BackupResult {
    source: number;
    total: number;
  }

  class Database {
    constructor(filename: string, options?: Options);
    /** Run a PRAGMA statement; returns the pragma's result rows. */
    pragma(source: string, options?: unknown): unknown;
    close(): void;
    /** SQLite online backup API — async in v12, writing to `filename`. */
    backup(filename: string, options?: BackupOptions): Promise<BackupResult>;
  }

  export default Database;
}