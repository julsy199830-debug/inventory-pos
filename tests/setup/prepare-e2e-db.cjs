const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'dev.db');
const targetDir = path.join(root, 'test-db');
const target = path.join(targetDir, 'e2e.db');
const temporaryTarget = `${target}.tmp`;
const stale = path.join(root, 'prisma', 'dev.db');

if (path.resolve(source) === path.resolve(target)) throw new Error('E2E source and target must differ');
if (path.resolve(stale) === path.resolve(target)) throw new Error('Refusing to use prisma/dev.db');
if (!fs.existsSync(source)) throw new Error(`Real database not found: ${source}`);

async function main() {
  // Remove only the disposable directory. The source is never opened writable.
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  // SQLite's online backup API includes committed WAL contents, unlike copying
  // only the main .db file while the development server may be running.
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    await sourceDb.backup(temporaryTarget);
  } finally {
    sourceDb.close();
  }

  if (!fs.existsSync(temporaryTarget) || fs.statSync(temporaryTarget).size === 0) {
    throw new Error(`E2E database backup was not created: ${temporaryTarget}`);
  }

  fs.renameSync(temporaryTarget, target);
  console.log(`E2E database prepared from a read-only backup: ${target}`);
}

main().catch((error) => {
  fs.rmSync(temporaryTarget, { force: true });
  console.error(error);
  process.exitCode = 1;
});
