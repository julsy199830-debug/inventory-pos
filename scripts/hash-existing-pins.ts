/**
 * One-shot legacy PIN migration (Priority 2 — Stage 5).
 *
 * Finds every `User` whose `pinHash` is still NULL, validates its legacy
 * plaintext `pin`, hashes it with the Stage 1 versioned scrypt format,
 * self-verifies the hash against the very PIN it was derived from, and writes
 * ONLY `pinHash`. Nothing else on the row (id/name/email/role/active/
 * passwordHash/legacy `pin`) is touched, and no other table is read or
 * written.
 *
 * Safety properties:
 *   - Idempotent: rows that already have a `pinHash` are skipped, and the
 *     write itself is conditional (`WHERE pinHash IS NULL` via
 *     `updateMany`), so re-running — or racing another invocation — can
 *     never double-write or clobber a different row's hash.
 *   - Malformed/missing legacy PINs are NOT guessed or repaired: the account
 *     is reported for manual intervention and left untouched (never deleted).
 *   - A backup of the database is written to `backups/` (project convention)
 *     before any modification — using better-sqlite3's consistent online
 *     backup API, exactly like the scheduled backup in `src/lib/db.ts`.
 *     Skippable with `--no-backup` (e.g. when targeting a throwaway copy).
 *   - No secret ever reaches stdout: PINs, hashes, and salts are never
 *     printed. Only aggregate counts, plus the name/email of accounts that
 *     need manual intervention (identity, not credentials).
 *
 * Usage:
 *   npm run hash:pins                       # migrate the default dev.db
 *   npx tsx scripts/hash-existing-pins.ts --db file:/path/to/copy.db --no-backup
 *   npx tsx scripts/hash-existing-pins.ts --verify-only
 *
 * The `--db` flag accepts a `file:` URL or a bare path (resolved against the
 * project root), so the script can be exercised against a throwaway copy of
 * the database before it ever touches the real one.
 *
 * STATUS (post plaintext-retirement): a HISTORICAL/ADMIN tool only — it is
 * not part of normal application behavior (all current write paths hash at
 * creation). It stays useful for (a) verifying historical backups and
 * (b) migrating an old pre-retirement database before pointing the current
 * app at it. It therefore talks RAW SQL through better-sqlite3 — never the
 * generated Prisma client — and detects per target whether the legacy `pin`
 * column exists: on a retired-schema database it is simply a no-op with a
 * read-only `--verify-only` mode; on a pre-retirement database it migrates.
 * A database that predates the `pinHash` column itself is refused with a
 * clear message (apply the app's migrations first).
 *
 * The core logic ({@link migrateLegacyPins}, {@link verifyAllHashes}) is
 * exported and depends only on injected store functions, so
 * `tests/unit/migrate-pins.test.ts` can exercise it against in-memory fakes
 * without any database at all.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PIN_PATTERN, hashPin, isHashedPin, verifyPin } from "@/lib/pin";

// ── Injectable store types (the only database knowledge the core needs) ─────

/** A legacy row: `pinHash` is still NULL and the plaintext PIN is present. */
export type LegacyUserRecord = {
  id: string;
  name: string;
  email: string;
  pin: string;
};

/** Every user row, reduced to what hash verification may look at. */
export type UserHashRecord = {
  id: string;
  /** Legacy plaintext PIN — present only in pre-retirement databases. */
  pin: string | null;
  pinHash: string | null;
};

/** An account that could not be auto-migrated (identity only — no secrets). */
export type FailureRecord = {
  id: string;
  name: string;
  email: string;
  reason: string;
};

export type MigrationOutcome = {
  /** Total distinct users seen (legacy + already hashed at scan time). */
  scanned: number;
  /** Rows that already had a `pinHash` when scanned (skipped). */
  alreadyHashed: number;
  /** Rows this run actually migrated. */
  migrated: number;
  /** Rows needing manual intervention (invalid legacy PIN, etc.). */
  failed: number;
  /** Per-account details for every failure (name/email only, no secrets). */
  failures: FailureRecord[];
};

export type VerificationOutcome = {
  totalUsers: number;
  /** Rows with no hash — must be 0 after a complete migration. */
  nullPinHash: number;
  /** Rows with a `pinHash` that isn't parseable v1 scrypt. */
  malformedHashes: number;
  /** Rows whose stored hash verifies against the legacy plaintext PIN. */
  verifiedAgainstLegacyPin: number;
  /**
   * Rows whose legacy `pin` is no longer a PIN (inert filler written by the
   * Stage 5 create/update/seed paths) — expected and harmless: the hash is
   * the credential, the filler can't be checked against anything.
   */
  legacyPinInert: number;
  /** Rows whose legacy PIN SHOULD verify but doesn't — a real problem. */
  legacyMismatches: number;
};

// ── Core logic (no Prisma, no filesystem — fully unit-testable) ─────────────

/**
 * Migrate every legacy user handed in by `findLegacyUsers`.
 *
 * Per row: validate the legacy PIN shape → hash it → verify the hash against
 * the original PIN → conditionally write ONLY `pinHash` (the
 * `pinHash IS NULL` condition keeps concurrent runs safe: the loser of a race
 * updates 0 rows instead of overwriting the winner's differently-salted
 * hash). A row whose write lost the race is counted as already hashed — its
 * credential is a hash either way.
 *
 * `hash` is injectable so tests can prove the self-verification guard: a hash
 * function that returns garbage must produce a failure with nothing written.
 */
export async function migrateLegacyPins(
  findLegacyUsers: () => Promise<LegacyUserRecord[]>,
  countHashedUsers: () => Promise<number>,
  writePinHash: (id: string, pinHash: string) => Promise<number>,
  hash: (pin: string) => Promise<string> = hashPin,
): Promise<MigrationOutcome> {
  const legacy = await findLegacyUsers();
  const alreadyHashed = await countHashedUsers();
  const scanned = legacy.length + alreadyHashed;

  const failures: FailureRecord[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const u of legacy) {
    if (!PIN_PATTERN.test(u.pin ?? "")) {
      failures.push({
        id: u.id,
        name: u.name,
        email: u.email,
        reason:
          "legacy PIN is missing or malformed (manual intervention required; account left untouched)",
      });
      continue;
    }
    const stored = await hash(u.pin);
    // Self-check BEFORE storing: a hash that does not verify against the very
    // PIN it was derived from must never be persisted — writing it could
    // lock the employee out of their account.
    if (!(await verifyPin(u.pin, stored))) {
      failures.push({
        id: u.id,
        name: u.name,
        email: u.email,
        reason: "generated hash failed self-verification (nothing written)",
      });
      continue;
    }
    const count = await writePinHash(u.id, stored);
    if (count === 1) migrated++;
    else skipped++; // lost a race: the row was hashed by someone else mid-run
  }

  return {
    scanned,
    alreadyHashed: alreadyHashed + skipped,
    migrated,
    failed: failures.length,
    failures,
  };
}

/**
 * Read-only verification pass over every user (see {@link VerificationOutcome}).
 * Never throws on bad data — bad rows are classified and counted.
 */
export async function verifyAllHashes(
  readUsers: () => Promise<UserHashRecord[]>,
): Promise<VerificationOutcome> {
  const users = await readUsers();
  const out: VerificationOutcome = {
    totalUsers: users.length,
    nullPinHash: 0,
    malformedHashes: 0,
    verifiedAgainstLegacyPin: 0,
    legacyPinInert: 0,
    legacyMismatches: 0,
  };
  for (const u of users) {
    if (u.pinHash === null) {
      out.nullPinHash++;
      continue;
    }
    if (!isHashedPin(u.pinHash)) {
      out.malformedHashes++;
      continue;
    }
    const legacyPin = u.pin ?? "";
    if (PIN_PATTERN.test(legacyPin)) {
      if (await verifyPin(legacyPin, u.pinHash)) out.verifiedAgainstLegacyPin++;
      else out.legacyMismatches++;
    } else {
      out.legacyPinInert++;
    }
  }
  return out;
}

// ── CLI wiring (database + backup + reporting) ──────────────────────────────

type CliArgs = { db?: string; verifyOnly: boolean; noBackup: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { verifyOnly: false, noBackup: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") {
      args.db = argv[++i];
    } else if (argv[i] === "--verify-only") {
      args.verifyOnly = true;
    } else if (argv[i] === "--no-backup") {
      args.noBackup = true;
    }
  }
  return args;
}

/** Resolve a `--db` flag / env fallback to an absolute `file:` URL. */
export function resolveDbUrl(flagValue?: string): string {
  const raw = flagValue ?? process.env.DATABASE_URL ?? "file:./dev.db";
  const cleaned = raw.replace(/^file:/, "");
  const abs = path.isAbsolute(cleaned)
    ? cleaned
    : path.resolve(process.cwd(), cleaned);
  return `file:${abs}`;
}

/**
 * Consistent snapshot of the target database into `backups/`, using the same
 * online-backup API as the scheduled backup in `src/lib/db.ts` (safe even in
 * WAL mode). A distinct `pin-migration-` prefix keeps this rollback point out
 * of the app's rolling 14-snapshot prune.
 */
async function backupDatabase(dbPath: string): Promise<string> {
  const dir = path.resolve(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const dest = path.join(dir, `pin-migration-${stamp}.db`);
  const source = new Database(dbPath, { readonly: true });
  try {
    await source.backup(dest);
  } finally {
    source.close();
  }
  return dest;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDbUrl(args.db);
  const dbPath = url.slice("file:".length);

  console.log(`[hash:pins] database target: ${dbPath}`);
  if (!existsSync(dbPath)) {
    console.error(`[hash:pins] database file not found: ${dbPath}`);
    process.exitCode = 1;
    return;
  }

  // Raw SQL (better-sqlite3), NOT the generated Prisma client: this tool must
  // also work against HISTORICAL databases whose schema predates the current
  // one. Column presence is detected per target so the same script handles a
  // pre-retirement backup (has `pin`) and a current database (does not).
  // better-sqlite3 ships no complete connection typings in this install, so
  // mirror the tiny statement surface this script needs instead of importing
  // a second typings package.
  type SqliteConn = {
    prepare: (sql: string) => {
      all: () => unknown[];
      get: () => unknown;
      run: (...args: unknown[]) => { changes: number };
    };
    close: () => void;
  };
  const conn = new Database(dbPath) as unknown as SqliteConn;
  const columns = conn
    .prepare("PRAGMA table_info(User)")
    .all()
    .map((c) => (c as { name: string }).name);
  if (!columns.includes("pinHash")) {
    console.error(
      "[hash:pins] target database has no `pinHash` column — apply the app's migrations first, then rerun.",
    );
    conn.close();
    process.exitCode = 1;
    return;
  }
  const hasPin = columns.includes("pin");

  if (args.verifyOnly) {
    const v = await verifyAllHashes(async () =>
      conn
        .prepare(`SELECT id, ${hasPin ? "pin" : "NULL AS pin"}, pinHash FROM "User"`)
        .all() as UserHashRecord[],
    );
    console.log(
      `[hash:pins] verify: users=${v.totalUsers}, pinHash NULL=${v.nullPinHash}, ` +
        `malformed hashes=${v.malformedHashes}, verified-vs-legacy=${v.verifiedAgainstLegacyPin}, ` +
        `legacy pin inert/absent=${v.legacyPinInert}, legacy mismatches=${v.legacyMismatches}`,
    );
    if (v.nullPinHash > 0 || v.malformedHashes > 0 || v.legacyMismatches > 0) {
      console.error("[hash:pins] verification FAILED (see counts above).");
      process.exitCode = 1;
    } else {
      console.log("[hash:pins] verification OK.");
    }
    conn.close();
    return;
  }

  try {
    if (!args.noBackup) {
      const backupPath = await backupDatabase(dbPath);
      console.log(`[hash:pins] backup written: ${backupPath}`);
    }
    if (!hasPin) {
      // Normal no-op on a retired-schema database — nothing to migrate.
      console.log("[hash:pins] no legacy `pin` column on this database — nothing to migrate.");
      return;
    }

    const outcome = await migrateLegacyPins(
      async () =>
        conn
          .prepare('SELECT id, name, email, pin FROM "User" WHERE pinHash IS NULL')
          .all() as LegacyUserRecord[],
      async () =>
        (
          conn
            .prepare('SELECT COUNT(*) AS n FROM "User" WHERE pinHash IS NOT NULL')
            .get() as { n: number }
        ).n,
      async (id, pinHash) =>
        conn
          .prepare('UPDATE "User" SET pinHash = ? WHERE id = ? AND pinHash IS NULL')
          .run(pinHash, id).changes,
    );

    // Aggregates only — never a PIN, hash, or salt.
    console.log(`[hash:pins] Users scanned: ${outcome.scanned}`);
    console.log(`[hash:pins] Already hashed: ${outcome.alreadyHashed}`);
    console.log(`[hash:pins] Migrated: ${outcome.migrated}`);
    console.log(`[hash:pins] Failed: ${outcome.failed}`);
    for (const f of outcome.failures) {
      console.log(
        `[hash:pins]   needs manual intervention: ${f.name} <${f.email}> — ${f.reason}`,
      );
    }
    if (outcome.failed > 0) process.exitCode = 1;
  } finally {
    conn.close();
  }
}

// Run the CLI only when invoked directly — importing this module from the
// unit tests must not open a database connection or mutate anything.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  void main();
}