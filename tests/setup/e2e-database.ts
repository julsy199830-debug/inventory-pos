import path from 'node:path';

/**
 * Test-only SQLite path guard.
 *
 * Playwright must always run against the disposable E2E database. Keeping the
 * guard in one module prevents a direct-database E2E spec from silently falling
 * back to the developer database if its environment is incomplete.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REAL_DB = path.join(PROJECT_ROOT, 'dev.db');
const STALE_DB = path.join(PROJECT_ROOT, 'prisma', 'dev.db');
const E2E_DB = path.join(PROJECT_ROOT, 'test-db', 'e2e.db');

export const E2E_DATABASE_URL = 'file:./test-db/e2e.db';

function normalized(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

/** Fail closed unless DATABASE_URL points to Playwright's disposable database. */
export function assertE2EDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests.');
  }
  if (!value.startsWith('file:')) {
    throw new Error(`E2E DATABASE_URL must be a SQLite file URL: ${value}`);
  }

  const filePath = value.slice('file:'.length);
  const resolved = normalized(path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath));

  if (resolved === normalized(REAL_DB)) {
    throw new Error(`Refusing to run E2E tests against the real database: ${REAL_DB}`);
  }
  if (resolved === normalized(STALE_DB)) {
    throw new Error(`Refusing to use the stale database placeholder: ${STALE_DB}`);
  }
  if (resolved !== normalized(E2E_DB)) {
    throw new Error(`E2E DATABASE_URL must resolve to the disposable database: ${E2E_DB}`);
  }

  return resolved;
}

/** Resolve the disposable database for E2E specs that use direct SQLite setup. */
export function getE2EDatabasePath(): string {
  return assertE2EDatabaseUrl();
}
