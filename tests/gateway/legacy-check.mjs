// بررسی migration روی یک DB موجود (مثلاً UI31). اجرا: DB=/tmp/legacy.db node tests/gateway/legacy-check.mjs
import Database from 'better-sqlite3';
import { runMigrations, getSchemaStatus } from '../../gateway/src/migrate.js';

const file = process.env.DB;
if (!file) { console.error('DB env لازم است'); process.exit(2); }
const d = new Database(file);
const count = (t) => { try { return d.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return null; } };
const before = { registrations: count('registrations'), posts: count('posts'), tracks: count('tracks') };
const r = await runMigrations(d, { dbPath: file });
const after = { registrations: count('registrations'), posts: count('posts'), tracks: count('tracks') };
console.log(JSON.stringify({ before, after, applied: r.applied, status: getSchemaStatus(d), backup: r.backup }, null, 2));
d.close();
