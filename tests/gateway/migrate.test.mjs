// تست migration نسخه‌دار gateway. اجرا: node --test tests/gateway/migrate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations, getSchemaStatus, latestVersion } from '../../gateway/src/migrate.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikootak-migrate-'));
  return { dir, file: path.join(dir, 'gateway.db') };
}
function cols(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}
function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

test('empty DB: migration 1 creates full schema and is idempotent', async () => {
  const { dir, file } = tmpDb();
  const db = new Database(file);
  try {
    const r = await runMigrations(db, { dbPath: file });
    assert.equal(r.from, 0);
    assert.equal(r.to, 3);
    assert.equal(r.applied.length, 3);
    assert.equal(latestVersion(), 3);
    for (const t of ['invites', 'registrations', 'posts', 'tracks', 'profiles', 'bans', 'stories', 'transcode_jobs', 'audit_log', 'settings']) {
      assert.ok(hasTable(db, t), `table ${t}`);
    }
    for (const c of ['thumb_file', 'thumb_mime']) assert.ok(cols(db, 'posts').has(c), c);
    for (const c of ['cover_file', 'cover_mime', 'hash']) assert.ok(cols(db, 'tracks').has(c), c);
    for (const c of ['story_audience', 'hide_follows', 'is_private', 'verified']) assert.ok(cols(db, 'profiles').has(c), c);
    assert.ok(cols(db, 'bans').has('deactivated'));
    assert.ok(cols(db, 'transcode_jobs').has('kind'));
    assert.ok(cols(db, 'invites').has('owner'));
    assert.ok(cols(db, 'follows').has('status'));
    assert.equal(db.prepare("SELECT dflt_value d FROM pragma_table_info('follows') WHERE name='status'").get().d, "'accepted'");
    assert.deepEqual(getSchemaStatus(db), { version: 3, applied: 3, latest: 3 });

    const again = await runMigrations(db, { dbPath: file });
    assert.equal(again.applied.length, 0);
    assert.equal(again.from, 3);
    assert.equal(again.to, 3);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('legacy UI31 DB: adds missing columns without losing rows and backs up first', async () => {
  const { dir, file } = tmpDb();
  const db = new Database(file);
  try {
    db.exec(`
      CREATE TABLE invites (code TEXT PRIMARY KEY, max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, note TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE registrations (user_id TEXT PRIMARY KEY, invite_code TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE tracks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE profiles (user_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', avatar_file TEXT, avatar_mime TEXT, updated_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE bans (user_id TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
      CREATE TABLE follows (follower TEXT NOT NULL, followee TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (follower, followee));
      CREATE TABLE transcode_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued', tries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, error TEXT);
    `);
    db.prepare('INSERT INTO invites (code,created_at) VALUES (?,?)').run('OLD-CODE', 1);
    db.prepare('INSERT INTO registrations VALUES (?,?,?)').run('@old:localhost', 'OLD-CODE', 1);
    db.prepare('INSERT INTO posts (id,user_id,mime,file,size,created_at) VALUES (?,?,?,?,?,?)').run('p1', '@old:localhost', 'image/png', 'p.png', 10, 1);
    db.prepare('INSERT INTO tracks (id,user_id,title,mime,file,size,created_at) VALUES (?,?,?,?,?,?,?)').run('t1', '@old:localhost', 't', 'audio/mpeg', 't.mp3', 10, 1);
    db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run('@old:localhost');
    db.prepare('INSERT INTO bans (user_id,created_at) VALUES (?,?)').run('@bad:localhost', 1);
    db.prepare('INSERT INTO follows (follower,followee,created_at) VALUES (?,?,?)').run('@old:localhost', '@friend:localhost', 1);
    db.prepare('INSERT INTO transcode_jobs (post_id,created_at) VALUES (?,?)').run('p1', 1);

    const r = await runMigrations(db, { dbPath: file });
    assert.equal(r.from, 0);
    assert.equal(r.to, 3);
    assert.ok(r.backup && fs.existsSync(r.backup), 'pre-migrate backup exists');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM posts').get().c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 1);
    assert.ok(cols(db, 'invites').has('owner'));
    assert.ok(cols(db, 'posts').has('thumb_file'));
    assert.ok(cols(db, 'posts').has('thumb_mime'));
    assert.ok(cols(db, 'tracks').has('cover_file'));
    assert.ok(cols(db, 'tracks').has('cover_mime'));
    assert.ok(cols(db, 'tracks').has('hash'));
    assert.ok(cols(db, 'profiles').has('story_audience'));
    assert.ok(cols(db, 'profiles').has('hide_follows'));
    assert.ok(cols(db, 'profiles').has('is_private'));
    assert.ok(cols(db, 'profiles').has('verified'));
    assert.ok(cols(db, 'follows').has('status'));
    assert.ok(cols(db, 'bans').has('deactivated'));
    assert.ok(cols(db, 'transcode_jobs').has('kind'));
    assert.equal(db.prepare('SELECT uses FROM invites WHERE code=?').get('OLD-CODE').uses, 0);
    assert.equal(db.prepare('SELECT status FROM follows WHERE follower=?').get('@old:localhost').status, 'accepted');
    assert.equal(db.prepare('SELECT is_private FROM profiles WHERE user_id=?').get('@old:localhost').is_private, 0);
    assert.equal(db.prepare('SELECT verified FROM profiles WHERE user_id=?').get('@old:localhost').verified, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('future DB: refuses downgrade with clear code', async () => {
  const { dir, file } = tmpDb();
  const db = new Database(file);
  try {
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(999, 'future', 1);
    await assert.rejects(() => runMigrations(db, { dbPath: file }), (e) => e.code === 'DB_SCHEMA_TOO_NEW' && /newer than code/.test(e.message));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
