import express from 'express';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import path from 'node:path';
import fs from 'node:fs';
import { mountFeed } from './feed.js';
import { mountMusic } from './music.js';
import { mountUploads } from './uploads.js';
import { mountAdmin } from './admin.js';
import { mountProfiles } from './profiles.js';
import { mountStories } from './stories.js';
import { createNotifier, mountNotifications } from './notifications.js';
import { createInterests } from './interests.js';
import { createPrivacy } from './privacy.js';
import { mountBlocks } from './blocks.js';
import { mountRanking } from './ranking.js';
import { mountReports } from './reports.js';
import { mountAdminPlus } from './adminx.js';
import { mountSuggest } from './suggest.js';
import { createChannelPrivacy } from './channel-privacy.js';
import { makeSettings } from './settings.js';
import { makeSynapseAdmin } from './synapse-admin.js';
import { mountUserInvites } from './userinvites.js';
import { createTranscoder } from './transcode.js';
import { passwordProblem, createLoginGuard } from './policy.js';
import { createAudit, ipAllowed, keyStrength } from './audit.js';
import { runMigrations, getSchemaStatus } from './migrate.js';

const {
  PORT = '3000',
  DB_PATH = './gateway.db',
  SYNAPSE_URL,
  SYNAPSE_SHARED_SECRET,
  MATRIX_SERVER_NAME,
  LIVEKIT_KEY,
  LIVEKIT_SECRET,
  LIVEKIT_PUBLIC_URL,
  GATEWAY_ADMIN_KEY,
  RATE_REGISTER_PER_HOUR = '10',
  RATE_LOGIN_PER_15MIN = '30',
} = process.env;

for (const [k, v] of Object.entries({
  SYNAPSE_URL, SYNAPSE_SHARED_SECRET, MATRIX_SERVER_NAME,
  LIVEKIT_KEY, LIVEKIT_SECRET, LIVEKIT_PUBLIC_URL, GATEWAY_ADMIN_KEY,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

// ---------- دیتابیس ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
const dataDir = path.dirname(path.resolve(DB_PATH));
fs.mkdirSync(dataDir, { recursive: true });
try {
  await runMigrations(db, { dbPath: DB_PATH });
} catch (e) {
  console.error(`✘ migration دیتابیس شکست خورد: ${e.message}`);
  if (e.code === 'DB_SCHEMA_TOO_NEW') {
    console.error('نسخهٔ دیتابیس از نسخهٔ کد جدیدتر است؛ دانگرید امن نیست. کد جدیدتر نصب کن یا از بکاپ استفاده کن.');
  }
  db.close();
  process.exit(1);
}
const settings = makeSettings(db);

// اعلان‌ها: جدول قبل از mount ماژول‌های دیگر ساخته می‌شود تا بتوانند اعلان ثبت کنند
const notifier = createNotifier(db);
const interests = createInterests(db);
const privacy = createPrivacy({ db });

const now = () => Math.floor(Date.now() / 1000);

// ---------- رمز امضای لینک‌های مدیا: جدا از کلید ادمین و ماندگار در data ----------
const MEDIA_SECRET = (() => {
  if (process.env.MEDIA_SECRET) return process.env.MEDIA_SECRET;
  const f = path.join(dataDir, 'media.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch { /* می‌سازیم */ }
  const k = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, k, { mode: 0o600 });
  return k;
})();

// ---------- سقف حجم هر کاربر (پست + آهنگ + استوری) ----------
const QUOTA = (Number(process.env.USER_QUOTA_MB) || 3000) * 1024 * 1024;
const usedBytes = (uid) => {
  const one = (t) => { try { return db.prepare(`SELECT COALESCE(SUM(size),0) s FROM ${t} WHERE user_id=?`).get(uid).s; } catch { return 0; } };
  return one('posts') + one('tracks') + one('stories');
};
const quotaOk = (uid, add) => usedBytes(uid) + add <= QUOTA;

// صف تبدیل ویدیو (یک worker؛ TRANSCODE=0 خاموش)
const transcoder = createTranscoder({
  db,
  dataDir,
  enabled: process.env.TRANSCODE !== '0',
  log: console,
});

// رزرو یک استفاده از کد دعوت (اتمیک)
const reserveInvite = db.transaction((code) => {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!row || row.revoked) return false;
  if (row.expires_at && row.expires_at < now()) return false;
  if (row.uses >= row.max_uses) return false;
  db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(code);
  return true;
});
const releaseInvite = (code) =>
  db.prepare('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE code = ?').run(code);

// ---------- Synapse ----------
// همه‌ی تماس‌ها به Synapse مهلت دارند تا اگر آن کند شد، gateway هم گیر نکند
const fetchT = (url, opts = {}, ms = 10_000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });

// Q7: فیلتر اعضای کانال؛ پیش‌فرض روشن. با CHANNEL_PRIVACY=0 خاموش می‌شود.
const channelPrivacy = createChannelPrivacy({
  synapseUrl: SYNAPSE_URL,
  fetchT,
  whoami,
  secret: MEDIA_SECRET,
  serverName: MATRIX_SERVER_NAME,
  enabled: process.env.CHANNEL_PRIVACY !== '0',
  log: console,
});
async function synapseRegister(username, password, displayname) {
  const nonceRes = await fetchT(`${SYNAPSE_URL}/_synapse/admin/v1/register`);
  if (!nonceRes.ok) throw new Error('synapse nonce failed');
  const { nonce } = await nonceRes.json();

  const mac = crypto
    .createHmac('sha1', SYNAPSE_SHARED_SECRET)
    .update(Buffer.from(nonce, 'utf8'))
    .update(Buffer.from([0]))
    .update(Buffer.from(username, 'utf8'))
    .update(Buffer.from([0]))
    .update(Buffer.from(password, 'utf8'))
    .update(Buffer.from([0]))
    .update(Buffer.from('notadmin', 'utf8'))
    .digest('hex');

  const res = await fetchT(`${SYNAPSE_URL}/_synapse/admin/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nonce, username, password, displayname, admin: false, mac,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function synapseLogin(username, password) {
  const res = await fetchT(`${SYNAPSE_URL}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
      initial_device_display_name: 'TIKOOTAK',
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function whoami(accessToken) {
  const res = await fetchT(`${SYNAPSE_URL}/_matrix/client/v3/account/whoami`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function isRoomMember(accessToken, roomId) {
  const res = await fetchT(
    `${SYNAPSE_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  return res.ok;
}

// ---------- اپ ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// هدرهای پایهٔ امنیتی برای همهٔ پاسخ‌های API؛ پاسخ‌های احراز هویت هرگز کش نشوند
app.use('/api', (req, res, next) => {
  res.set({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  if (req.path.startsWith('/auth/') || req.path.startsWith('/admin/') || req.path.startsWith('/rtc/')) res.set('cache-control', 'no-store');
  next();
});
app.use(express.json({ limit: '10kb' }));

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: Number(RATE_REGISTER_PER_HOUR) || 10, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(RATE_LOGIN_PER_15MIN) || 30, standardHeaders: true, legacyHeaders: false });
const rtcLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

const adminLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const adminFails = rateLimit({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false });
const audit = createAudit(db);
const loginGuard = createLoginGuard();
const ADMIN_ALLOW = String(process.env.ADMIN_ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (keyStrength(GATEWAY_ADMIN_KEY) === 'weak') console.warn('!! GATEWAY_ADMIN_KEY کوتاه/ضعیف است (حداقل ۳۲ نویسه). ./scripts/admin.sh rotate-key');
if (!ADMIN_ALLOW.length) console.warn('!! ADMIN_ALLOW_IPS تنظیم نیست؛ مسیرهای ادمین از هر IP با کلید در دسترس‌اند.');
function requireAdmin(req, res, next) {
  // IP غیرمجاز: همان ۴۰۴ عادی (وجود مسیر ادمین فاش نشود)
  if (!ipAllowed(req.ip, ADMIN_ALLOW)) {
    audit.log(req.ip, req.method, req.originalUrl.split('?')[0], 404, 'ip_denied');
    return res.status(404).json({ error: 'not_found' });
  }
  res.on('finish', () => {
    if (req.method !== 'GET' || res.statusCode === 401 || res.statusCode === 429) {
      audit.log(req.ip, req.method, req.originalUrl.split('?')[0], res.statusCode);
    }
  });
  return adminLimiter(req, res, () => adminFails(req, res, () => checkAdmin(req, res, next)));
}
function checkAdmin(req, res, next) {
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const expected = Buffer.from(GATEWAY_ADMIN_KEY);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/api/public/config', (_req, res) => { const r = settings.registration(); res.json({ registration_open: r.open, message: r.message || '' }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, schema: getSchemaStatus(db), channel_privacy: channelPrivacy.status() }));

// ثبت‌نام با کد دعوت
app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const { invite, username, password, displayname } = req.body || {};
  const code = String(invite || '').trim().toUpperCase();
  const user = String(username || '').trim().toLowerCase();
  const pass = String(password || '');
  const name = String(displayname || user).trim().slice(0, 40);

  if (!/^[a-z0-9._-]{3,32}$/.test(user)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  if (pass.length < 10 || pass.length > 128) {
    return res.status(400).json({ error: 'invalid_password' });
  }
  if (passwordProblem(pass, user)) {
    return res.status(400).json({ error: 'weak_password' });
  }
  const rs = settings.registration();
  if (!rs.open) return res.status(403).json({ error: 'registration_closed', reason: rs.reason, message: rs.message || undefined });
  if (!reserveInvite(code)) {
    return res.status(403).json({ error: 'invalid_invite' });
  }

  try {
    const r = await synapseRegister(user, pass, name);
    if (!r.ok) {
      releaseInvite(code);
      if (r.body?.errcode === 'M_USER_IN_USE') {
        return res.status(409).json({ error: 'username_taken' });
      }
      return res.status(502).json({ error: 'register_failed' });
    }
    db.prepare('INSERT OR REPLACE INTO registrations (user_id, invite_code, created_at) VALUES (?, ?, ?)')
      .run(r.body.user_id, code, now());
    try { db.prepare('INSERT OR REPLACE INTO name_index (user_id,name_lc) VALUES (?,?)').run(r.body.user_id, name.toLowerCase().slice(0, 80)); } catch { /* بعداً پر می‌شود */ }
    return res.json({
      user_id: r.body.user_id,
      access_token: r.body.access_token,
      device_id: r.body.device_id,
    });
  } catch (e) {
    releaseInvite(code);
    console.error('register error', e.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
});

// لاگین
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const uname = String(username).trim().toLowerCase().slice(0, 64);
  const wait = loginGuard.locked(uname);
  if (wait) { audit.log(req.ip, 'POST', '/api/auth/login', 429, `locked ${uname}`); return res.status(429).set('retry-after', String(wait)).json({ error: 'account_locked', retry_after: wait }); }
  try {
    const r = await synapseLogin(uname, String(password));
    if (!r.ok) { if (r.status !== 429) loginGuard.fail(uname); return res.status(r.status === 429 ? 429 : 403).json({ error: 'login_failed' }); }
    loginGuard.ok(uname);
    return res.json({
      user_id: r.body.user_id,
      access_token: r.body.access_token,
      device_id: r.body.device_id,
    });
  } catch (e) {
    console.error('login error', e.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
});

// توکن تماس گروهی: فقط برای اعضای همون روم Matrix
app.post('/api/rtc/token', rtcLimiter, async (req, res) => {
  const token = bearer(req);
  const roomId = String(req.body?.room_id || '');
  if (!token || !roomId) return res.status(400).json({ error: 'missing_fields' });
  try {
    const me = await whoami(token);
    if (!me) return res.status(401).json({ error: 'unauthorized' });
    if (!(await isRoomMember(token, roomId))) return res.status(403).json({ error: 'not_a_member' });

    const at = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, {
      identity: me.user_id,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
    });
    return res.json({ url: LIVEKIT_PUBLIC_URL, token: await at.toJwt() });
  } catch (e) {
    console.error('rtc token error', e.message);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
});

// ---------- فید ----------
const feedHelpers = mountFeed(app, {
  db, privacy, whoami, synapseUrl: SYNAPSE_URL, secret: MEDIA_SECRET,
  dataDir, maxMb: Number(process.env.FEED_MAX_MB) || 150,
  notifications: notifier, quotaOk, interests,
  onVideoPost: (post) => transcoder.enqueue(post),
  onPostDelete: (id) => transcoder.cancel(id),
});

const uploadCtl = mountUploads(app, {
  auth: feedHelpers.auth, requireAdmin, settings, serverName: MATRIX_SERVER_NAME, synapseUrl: SYNAPSE_URL,
});
mountMusic(app, {
  db, ...feedHelpers, secret: MEDIA_SECRET, uploadAllowed: uploadCtl.allowedFor,
  dataDir, maxMb: Number(process.env.MUSIC_MAX_MB) || 60, quotaOk,
});

mountProfiles(app, {
  db, privacy, ...feedHelpers, secret: MEDIA_SECRET, dataDir,
  notifications: notifier, interests,
});

mountStories(app, {
  db, privacy, ...feedHelpers, secret: MEDIA_SECRET,
  dataDir, maxMb: Number(process.env.STORY_MAX_MB) || 50, quotaOk,
  onVideoStory: (story) => transcoder.enqueue({ ...story, kind: 'story' }),
  onStoryDelete: (id) => transcoder.cancel(id),
});

mountNotifications(app, { db, auth: feedHelpers.auth, displayName: feedHelpers.displayName });

mountBlocks(app, { db, auth: feedHelpers.auth, displayName: feedHelpers.displayName });
mountRanking(app, {
  db, privacy, auth: feedHelpers.auth, shape: feedHelpers.shape, interests,
  displayName: feedHelpers.displayName,
});
mountSuggest(app, {
  auth: feedHelpers.auth, synapseUrl: SYNAPSE_URL, fetchT, bearer,
});
app.use('/_matrix/client', channelPrivacy.middleware);

const synapseAdmin = makeSynapseAdmin({ url: SYNAPSE_URL, secret: SYNAPSE_SHARED_SECRET, settings, fetchT });
const adminOps = mountAdmin(app, {
  db, requireAdmin, dataDir,
  onPostDelete: (id) => transcoder.cancel(id),
  onStoryDelete: (id) => transcoder.cancel(id),
  transcodeStats: () => transcoder.stats(),
});
adminOps.transcodeStats = () => transcoder.stats();
mountAdminPlus(app, {
  db, requireAdmin, dataDir, ops: adminOps, shape: feedHelpers.shape, displayName: feedHelpers.displayName,
  settings, synapseAdmin, quotaBytes: QUOTA, dbPath: path.resolve(DB_PATH),
});
mountUserInvites(app, { db, auth: feedHelpers.auth, settings, displayName: feedHelpers.displayName });
mountReports(app, { db, auth: feedHelpers.auth, requireAdmin, shape: feedHelpers.shape, ops: adminOps });
transcoder.start();

// ---------- ادمین ----------
app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const maxUses = Math.min(Math.max(parseInt(req.body?.max_uses ?? 1, 10) || 1, 1), 1000);
  const days = parseInt(req.body?.expires_days ?? 0, 10) || 0;
  const note = String(req.body?.note || '').slice(0, 100);
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
  db.prepare('INSERT INTO invites (code, max_uses, expires_at, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(code, maxUses, days > 0 ? now() + days * 86400 : null, note, now());
  res.json({ code, max_uses: maxUses, expires_days: days || null });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  res.json({ events: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(n) });
});

app.get('/api/admin/invites', requireAdmin, (_req, res) => {
  res.json(db.prepare(`SELECT i.*, (SELECT group_concat(r.user_id, ',') FROM registrations r WHERE r.invite_code=i.code) AS used_by FROM invites i ORDER BY created_at DESC LIMIT 500`).all());
});

app.delete('/api/admin/invites/:code', requireAdmin, (req, res) => {
  const r = db.prepare('UPDATE invites SET revoked = 1 WHERE code = ?').run(req.params.code.toUpperCase());
  res.json({ revoked: r.changes > 0 });
});

// مسیر ناشناخته و خطای پیش‌بینی‌نشده همیشه JSON باشند
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  if ((err?.status || err?.statusCode) === 416) return res.status(416).end(); // Range نامعتبر (پخش ویدیو)
  console.error('unhandled', err?.message);
  if (!res.headersSent) res.status(500).json({ error: 'server_error' });
});

// فایل‌های یتیم (آپلود نیمه‌کاره قبل از ثبت در دیتابیس) را هنگام بالا آمدن پاک می‌کنیم
function sweepOrphans() {
  const sets = [['feed', 'posts', 'file'], ['music', 'tracks', 'file'], ['stories', 'stories', 'file'], ['covers', 'tracks', 'cover_file'], ['avatars', 'profiles', 'avatar_file']];
  for (const [d, table, col] of sets) {
    const full = path.join(dataDir, d);
    let files = [];
    try { files = fs.readdirSync(full); } catch { continue; }
    const known = new Set(db.prepare(`SELECT ${col} f FROM ${table} WHERE ${col} IS NOT NULL`).all().map((r) => r.f));
    for (const f of files) {
      if (known.has(f) || f === 'thumbs') continue;
      try { if (Date.now() - fs.statSync(path.join(full, f)).mtimeMs > 3600_000) fs.rmSync(path.join(full, f), { force: true }); } catch { /* بی‌خیال */ }
    }
  }
}
function sweepThumbs() {
  const full = path.join(dataDir, 'feed', 'thumbs');
  let files = [];
  try { files = fs.readdirSync(full); } catch { return; }
  const known = new Set(db.prepare('SELECT thumb_file f FROM posts WHERE thumb_file IS NOT NULL').all().map((r) => r.f));
  for (const f of files) {
    if (known.has(f)) continue;
    try { if (Date.now() - fs.statSync(path.join(full, f)).mtimeMs > 3600_000) fs.rmSync(path.join(full, f), { force: true }); } catch { /* بی‌خیال */ }
  }
}
try { sweepThumbs(); } catch (e) { console.error('sweepThumbs', e.message); }
try { sweepOrphans(); } catch (e) { console.error('sweep', e.message); }

// پر کردن فهرست نام‌ها برای جستجو (کاربران قبلی) آرام و پس‌زمینه
(async () => {
  const todo = db.prepare('SELECT user_id FROM registrations WHERE user_id NOT IN (SELECT user_id FROM name_index)').all();
  for (const r of todo) { await feedHelpers.displayName(r.user_id); await new Promise((ok) => setTimeout(ok, 80)); }
})().catch(() => {});

const server = app.listen(Number(PORT), () => console.log(`gateway listening on :${PORT}`));
server.headersTimeout = 30_000;
server.requestTimeout = 0; // آپلود فایل بزرگ روی اینترنت کند طولانی است؛ خود آپلود با شمارنده‌ی بایت کنترل می‌شود
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
