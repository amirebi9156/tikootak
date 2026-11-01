// Migration نسخه‌دار gateway. هر migration در یک تراکنش اجرا می‌شود.
// قبل از اولین migration معلق یک backup از DB گرفته می‌شود (۳ فایل آخر نگه داشته می‌شود).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, 'migrations');
const BACKUP_PREFIX = 'pre-migrate-';
const KEEP_BACKUPS = 3;

export async function loadMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+.*\.js$/.test(f)).sort();
  const out = [];
  const seen = new Set();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, f)).href);
    const m = mod.default;
    if (!m || !Number.isInteger(m.version) || typeof m.up !== 'function') {
      throw new Error(`migration نامعتبر: ${f}`);
    }
    if (seen.has(m.version)) throw new Error(`migration تکراری: ${m.version}`);
    seen.add(m.version);
    out.push(m);
  }
  return out.sort((a, b) => a.version - b.version);
}

// بالاترین نسخهٔ کد؛ برای محافظ دانگرید (بدون import، برای ادمین/doctor قابل استفاده است).
export function latestVersion() {
  try {
    const versions = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+.*\.js$/.test(f))
      .map((f) => Number(f.split('-')[0]))
      .filter(Number.isInteger);
    return versions.length ? Math.max(...versions) : 0;
  } catch { return 0; }
}

export function getSchemaStatus(db) {
  try {
    const r = db.prepare('SELECT MAX(version) AS version, COUNT(*) AS applied FROM schema_migrations').get();
    return { version: Number(r?.version) || 0, applied: Number(r?.applied) || 0, latest: latestVersion() };
  } catch {
    return { version: 0, applied: 0, latest: latestVersion() };
  }
}

function backupBeforeMigrate(db, dbPath, fromVersion) {
  if (!dbPath || dbPath === ':memory:') return Promise.resolve(null);
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${BACKUP_PREFIX}${fromVersion}-${stamp}.db`);
  // backup بهتر از کپی فایل در حالت WAL است.
  return db.backup(target).then(() => {
    try {
      const old = fs.readdirSync(dir)
        .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
        .map((f) => path.join(dir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      for (const f of old.slice(KEEP_BACKUPS)) fs.rmSync(f, { force: true });
    } catch { /* پاک‌سازی backup قدیمی نباید migration را بشکند */ }
    return target;
  });
}

export async function runMigrations(db, { dbPath = process.env.DB_PATH || './gateway.db', log = console } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const migrations = await loadMigrations();
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  const curRow = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  const current = Number(curRow?.v) || 0;

  if (current > latest) {
    const err = new Error(`DB schema version ${current} is newer than code version ${latest}; downgrade rejected`);
    err.code = 'DB_SCHEMA_TOO_NEW';
    err.dbVersion = current;
    err.codeVersion = latest;
    throw err;
  }

  const pending = migrations.filter((m) => m.version > current);
  if (!pending.length) return { from: current, to: current, applied: [] };

  const backup = await backupBeforeMigrate(db, dbPath, current);
  const applied = [];
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)')
        .run(m.version, m.name, Math.floor(Date.now() / 1000));
    });
    tx();
    applied.push({ version: m.version, name: m.name });
    log.info?.(`[migrate] applied ${m.version}-${m.name}`);
  }
  return { from: current, to: latest, applied, backup };
}
