// تست API پیشنهاد کاربر/اتاق Q2. اجرا: node --test tests/gateway/suggest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../gateway/src/migrate.js';
import { createPrivacy } from '../../gateway/src/privacy.js';
import { mountProfiles } from '../../gateway/src/profiles.js';
import { mountSuggest } from '../../gateway/src/suggest.js';

const ME = '@me:test';
const TOKEN = 'tok-me';
const NAMES = {
  '@ali:test': 'Ali',
  '@alireza:test': 'Alireza',
  '@sara:test': 'Ali Sara',
};

function roomChunk() {
  return {
    chunk: [
      { room_id: '!alpha:test', name: 'Alpha Room', canonical_alias: '#alpha:test', num_joined_members: 12, visibility: 'public' },
      { room_id: '!beta:test', name: 'Beta', canonical_alias: '#beta:test', num_joined_members: 20, visibility: 'public' },
      { room_id: '!private:test', name: 'Alpha private', canonical_alias: '#private:test', num_joined_members: 99, visibility: 'private' },
    ],
  };
}

test('Q2 people/rooms suggest: prefix first, cap, blocks and private rooms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikootak-q2-'));
  const db = new Database(path.join(dir, 'gateway.db'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  db.pragma('journal_mode = WAL');
  await runMigrations(db, { dbPath: path.join(dir, 'gateway.db') });

  for (const uid of [ME, '@ali:test', '@alireza:test', '@sara:test', '@nine:test', '@bad:test', '@blocked:test']) {
    db.prepare('INSERT INTO registrations (user_id,invite_code,created_at) VALUES (?,?,?)').run(uid, 'T', 1);
    db.prepare('INSERT INTO profiles (user_id,bio,verified) VALUES (?,?,?)').run(uid, '', uid === '@ali:test' ? 1 : 0);
  }
  for (const [uid, name] of Object.entries(NAMES)) db.prepare('INSERT INTO name_index (user_id,name_lc) VALUES (?,?)').run(uid, name.toLowerCase());
  db.prepare('INSERT INTO bans (user_id,created_at) VALUES (?,?)').run('@bad:test', 1);
  db.prepare('INSERT INTO blocks (blocker,blocked,created_at) VALUES (?,?,?)').run(ME, '@blocked:test', 1);

  const privacy = createPrivacy({ db });
  const auth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.status(401).json({ error: 'unauthorized' });
    req.userId = ME;
    next();
  };
  const displayName = async (uid) => NAMES[uid] || uid.replace(/^@/, '').split(':')[0];
  const app = express();
  app.use(express.json());
  mountProfiles(app, { db, privacy, auth, displayName, forgetName: () => {}, secret: 'test', dataDir });
  let seenUrl = '';
  mountSuggest(app, {
    auth,
    synapseUrl: 'http://synapse.test',
    bearer: (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    fetchT: async (url) => { seenUrl = url; return { ok: true, json: async () => roomChunk() }; },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, token = TOKEN) => {
    const r = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  try {
    let r = await get('/api/people/suggest?q=ali');
    assert.equal(r.status, 200);
    const ids = r.body.users.map((u) => u.user_id);
    assert.deepEqual(ids, ['@ali:test', '@alireza:test', '@sara:test']);
    assert.equal(r.body.users[0].verified, true);
    assert.ok(!ids.includes(ME), 'self excluded');
    assert.ok(!ids.includes('@bad:test'), 'banned excluded');
    assert.ok(!ids.includes('@blocked:test'), 'blocked excluded');

    r = await get('/api/people/suggest?q=');
    assert.deepEqual(r.body.users, []);
    r = await get('/api/people/suggest?q=ali', 'bad');
    assert.equal(r.status, 401);

    r = await get('/api/rooms/suggest?q=al');
    assert.equal(r.status, 200);
    assert.equal(r.body.rooms[0].room_id, '!alpha:test', 'prefix room first');
    assert.ok(!r.body.rooms.some((x) => x.room_id === '!private:test'), 'private room excluded');
    assert.ok(r.body.rooms.length <= 8);
    assert.match(seenUrl, /generic_search_term/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
