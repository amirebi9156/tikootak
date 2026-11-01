// تست ماتریس حریم خصوصی Q1: عمومی/خصوصی × مالک/فالوور/غیرفالوور/بلاک‌شده
// + درخواست/پذیرش/رد/لغو/حذف فالوور + لینک امضاشدهٔ قدیمی + استوری.
// اجرا: node --test tests/gateway/privacy.test.mjs
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
import { mountFeed } from '../../gateway/src/feed.js';
import { mountStories } from '../../gateway/src/stories.js';
import { createNotifier } from '../../gateway/src/notifications.js';

const OWNER = '@owner:test';
const FOLLOWER = '@follower:test';
const STRANGER = '@stranger:test';
const BLOCKED = '@blocked:test';
const USERS = [OWNER, FOLLOWER, STRANGER, BLOCKED];
const TOKENS = {
  'tok-owner': OWNER,
  'tok-follower': FOLLOWER,
  'tok-stranger': STRANGER,
  'tok-blocked': BLOCKED,
};
const NAMES = {
  [OWNER]: 'Owner', [FOLLOWER]: 'Follower', [STRANGER]: 'Stranger', [BLOCKED]: 'Blocked',
};
const realFetch = globalThis.fetch;
let mockServer = null;

test('Q1 privacy matrix', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikootak-q1-'));
  const db = new Database(path.join(dir, 'gateway.db'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'feed'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'avatars'), { recursive: true });
  db.pragma('journal_mode = WAL');
  await runMigrations(db, { dbPath: path.join(dir, 'gateway.db') });

  const now = Math.floor(Date.now() / 1000);
  for (const uid of USERS) {
    db.prepare('INSERT INTO registrations (user_id,invite_code,created_at) VALUES (?,?,?)').run(uid, 'TEST', now);
    db.prepare('INSERT INTO profiles (user_id,bio,is_private) VALUES (?,?,0)').run(uid, `bio ${uid}`);
    db.prepare('INSERT OR REPLACE INTO name_index (user_id,name_lc) VALUES (?,?)').run(uid, NAMES[uid].toLowerCase());
  }
  fs.writeFileSync(path.join(dataDir, 'feed', 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(dataDir, 'stories', 's1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  db.prepare('INSERT INTO posts (id,user_id,caption,mime,file,size,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('p1', OWNER, 'hello', 'image/jpeg', 'p1.jpg', 4, now);
  db.prepare('INSERT INTO stories (id,user_id,mime,file,caption,size,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('s1', OWNER, 'image/jpeg', 's1.jpg', 'story', 4, now, now + 86400);

  const notifier = createNotifier(db);
  const privacy = createPrivacy({ db });
  const displayName = async (uid) => NAMES[uid] || uid;
  const whoami = async (token) => (TOKENS[token] ? { user_id: TOKENS[token] } : null);
  async function auth(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const me = m ? await whoami(m[1]) : null;
    if (!me) return res.status(401).json({ error: 'unauthorized' });
    req.userId = me.user_id;
    next();
  }

  const app = express();
  app.use(express.json());
  const feed = mountFeed(app, {
    db, privacy, whoami, synapseUrl: 'http://mock-synapse', secret: 'test-secret',
    dataDir, notifications: notifier,
  });
  mountProfiles(app, {
    db, privacy, ...feed, secret: 'test-secret', dataDir, notifications: notifier,
  });
  mountStories(app, {
    db, privacy, ...feed, secret: 'test-secret', dataDir, notifications: notifier,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  mockServer = `http://127.0.0.1:${server.address().port}`;

  // Synapse profile lookup inside mountFeed only needs a displayname.
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('http://mock-synapse/')) {
      const uid = decodeURIComponent(String(url).split('/profile/')[1] || '');
      return new Response(JSON.stringify({ displayname: NAMES[uid] || uid }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(url, opts);
  };

  async function api(method, p, token, body) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await realFetch(`${mockServer}${p}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const raw = (p) => realFetch(`${mockServer}${p}`).then((r) => r.status);

  try {
    // --- عمومی: همه می‌بینند ---
    let r = await api('GET', '/api/privacy', 'tok-owner');
    assert.equal(r.status, 200);
    assert.equal(r.body.is_private, false);

    r = await api('GET', '/api/feed/posts/p1', 'tok-stranger');
    assert.equal(r.status, 200, 'public post visible');
    const oldMediaUrl = r.body.url;
    assert.ok(oldMediaUrl, 'signed media url');
    assert.equal(await raw(oldMediaUrl), 200, 'public signed media readable');

    r = await api('GET', '/api/profiles/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.can_view, true);
    assert.equal(r.body.is_private, false);
    assert.equal(r.body.follow_status, 'none');

    // استوری حتی برای حساب عمومی فقط به فالوورهای accepted نشان داده می‌شود.
    r = await api('GET', '/api/stories', 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.groups.length, 0, 'public story is not shown to non-follower');

    // فالوور accepted روی حساب عمومی: بدون تأیید، و در فید following دیده می‌شود.
    r = await api('POST', '/api/follow/' + encodeURIComponent(OWNER), 'tok-follower');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'accepted');
    r = await api('GET', '/api/feed/posts?following=1', 'tok-follower');
    assert.ok(r.body.posts.some((x) => x.id === 'p1'), 'accepted following feed includes owner');
    r = await api('GET', '/api/stories', 'tok-follower');
    assert.equal(r.body.groups.length, 1, 'accepted follower sees public story');

    // --- خصوصی شدن: غیرفالوور ۴۰۴، پروفایل محدود ---
    r = await api('PATCH', '/api/profile', 'tok-owner', { is_private: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.is_private, true);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-owner')).status, 200, 'owner always sees own post');
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-follower')).status, 200, 'accepted follower sees private post');
    assert.equal((await api('GET', '/api/profiles/' + encodeURIComponent(OWNER), 'tok-owner')).body.can_view, true, 'owner profile full');
    assert.equal((await api('GET', `/api/profiles/${encodeURIComponent(OWNER)}/follows`, 'tok-owner')).status, 200, 'owner sees follow lists');

    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 404, 'private post hidden');
    assert.equal((await api('POST', '/api/feed/posts/p1/like', 'tok-stranger')).status, 404, 'private post like hidden');
    assert.equal((await api('GET', '/api/feed/posts/p1/comments', 'tok-stranger')).status, 404, 'private post comments hidden');
    assert.equal((await api('POST', '/api/feed/posts/p1/comments', 'tok-stranger', { text: 'hi' })).status, 404, 'private post comment hidden');
    assert.equal((await api('GET', '/api/feed/posts?user=' + encodeURIComponent(OWNER), 'tok-stranger')).status, 404, 'private profile feed hidden');
    assert.equal(await raw(oldMediaUrl), 404, 'old signed media url revoked by privacy');

    r = await api('GET', '/api/profiles/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.can_view, false);
    assert.equal(r.body.private, true);
    assert.equal(r.body.bio, `bio ${OWNER}`, 'bio remains visible on limited profile');
    assert.equal(r.body.posts, 1, 'count remains visible');
    assert.equal((await api('GET', `/api/profiles/${encodeURIComponent(OWNER)}/follows`, 'tok-stranger')).status, 404, 'private follow lists hidden');

    // --- درخواست فالو: pending تا پذیرش ---
    r = await api('POST', '/api/follow/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.following, false);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 404, 'pending cannot view');

    r = await api('GET', '/api/follow/requests', 'tok-owner');
    assert.equal(r.status, 200);
    assert.ok(r.body.requests.some((x) => x.user_id === STRANGER), 'owner sees follow request');
    assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND actor=? AND kind='follow_request'").get(OWNER, STRANGER), 'follow_request notification');

    r = await api('POST', `/api/follow/requests/${encodeURIComponent(STRANGER)}/accept`, 'tok-owner');
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, true);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 200, 'accepted follower can view');
    assert.equal((await api('GET', '/api/profiles/' + encodeURIComponent(OWNER), 'tok-stranger')).body.can_view, true);
    assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND actor=? AND kind='follow_accept'").get(STRANGER, OWNER), 'follow_accept notification');

    r = await api('GET', '/api/stories', 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.groups.length, 1, 'accepted follower sees story');
    const storyUrl = r.body.groups[0].stories[0].url;
    assert.equal(await raw(storyUrl), 200, 'accepted follower can read signed story media');

    // --- حذف فالوور توسط مالک ---
    r = await api('DELETE', `/api/followers/${encodeURIComponent(STRANGER)}`, 'tok-owner');
    assert.equal(r.status, 200);
    assert.equal(r.body.removed, true);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 404, 'removed follower loses access');
    assert.equal(await raw(storyUrl), 404, 'old signed story url revoked after unfollow');

    // --- عمومی شدن: pending خودکار accepted می‌شود ---
    r = await api('POST', '/api/follow/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.body.status, 'pending');
    r = await api('PATCH', '/api/profile', 'tok-owner', { is_private: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.auto_accepted, 1, 'going public auto-accepts pending');
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 200);
    assert.equal(db.prepare('SELECT status FROM follows WHERE follower=? AND followee=?').get(STRANGER, OWNER).status, 'accepted');

    // --- بلاک برتر است ---
    db.prepare('INSERT INTO blocks (blocker,blocked,created_at) VALUES (?,?,?)').run(OWNER, STRANGER, now);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 404, 'blocked viewer cannot view');
    assert.equal((await api('GET', '/api/profiles/' + encodeURIComponent(OWNER), 'tok-stranger')).status, 404, 'blocked profile hidden');
    assert.equal((await api('GET', '/api/stories', 'tok-stranger')).body.groups.length, 0, 'blocked viewer has no story group');

    // --- لغو درخواست pending ---
    db.prepare('DELETE FROM follows WHERE follower=? AND followee=?').run(STRANGER, OWNER);
    db.prepare('DELETE FROM blocks WHERE blocker=? AND blocked=?').run(OWNER, STRANGER);
    r = await api('PATCH', '/api/profile', 'tok-owner', { is_private: true });
    assert.equal(r.status, 200);
    r = await api('POST', '/api/follow/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.body.status, 'pending');
    r = await api('DELETE', '/api/follow/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.body.status, 'none');
    assert.equal((await api('GET', '/api/follow/requests', 'tok-owner')).body.requests.length, 0, 'cancel removes request');

    // --- رد درخواست ---
    r = await api('POST', '/api/follow/' + encodeURIComponent(OWNER), 'tok-stranger');
    assert.equal(r.body.status, 'pending');
    r = await api('POST', `/api/follow/requests/${encodeURIComponent(STRANGER)}/decline`, 'tok-owner');
    assert.equal(r.body.declined, true);
    assert.equal((await api('GET', '/api/feed/posts/p1', 'tok-stranger')).status, 404, 'declined remains hidden');

    // --- صفحه باید بعد از فیلتر SQL پر بماند، نه اینکه پست‌های خصوصی LIMIT را بخورند ---
    const ins = db.prepare('INSERT INTO posts (id,user_id,caption,mime,file,size,created_at) VALUES (?,?,?,?,?,?,?)');
    for (let i = 0; i < 30; i++) ins.run(`priv-${i}`, OWNER, `private ${i}`, 'image/jpeg', 'none.jpg', 1, now + 100 + i);
    for (let i = 0; i < 10; i++) ins.run(`pub-${i}`, FOLLOWER, `public ${i}`, 'image/jpeg', 'none.jpg', 1, now - 100 - i);
    r = await api('GET', '/api/feed/posts?limit=8', 'tok-stranger');
    assert.equal(r.status, 200);
    assert.equal(r.body.posts.length, 8, 'private rows do not consume the page');
    assert.ok(r.body.posts.every((x) => x.user_id === FOLLOWER), 'only public author rows returned');
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
