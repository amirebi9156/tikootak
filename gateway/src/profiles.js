import { sniffBuf } from './sniff.js';
import { stripImageBuf } from './strip.js';
// پروفایل (عکس و بیو)، دنبال کردن، جستجوی کاربران. آیدی هر کاربر همان نام کاربری او (@ali) است.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import rateLimit from 'express-rate-limit';

const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function mountProfiles(app, { db, privacy, auth, displayName, forgetName, secret, dataDir, notifications = null, interests = null }) {
  const dir = path.join(dataDir, 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  const now = () => Math.floor(Date.now() / 1000);
  const key = crypto.createHash('sha256').update(`avatar:${secret}`).digest();
  const sign = (uid, v) => crypto.createHmac('sha256', key).update(`${uid}|${v}`).digest('base64url');
  const SIGLEN = sign('x', 0).length;

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', avatar_file TEXT, avatar_mime TEXT, updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  // حریم خصوصی: ستون‌های story_audience/hide_follows در migration 001 و is_private در migration 002 اضافه می‌شوند.
  const row = (uid) => db.prepare('SELECT * FROM profiles WHERE user_id=?').get(uid);
  const privacyOf = (uid) => {
    const p = row(uid);
    return {
      story_audience: p?.story_audience === 'followers' ? 'followers' : 'everyone',
      hide_follows: !!p?.hide_follows,
      is_private: !!p?.is_private,
      pending_requests: cnt("SELECT COUNT(*) c FROM follows WHERE followee=? AND status='pending'", uid),
    };
  };
  const avatarUrl = (uid) => {
    const r = row(uid);
    if (!r?.avatar_file) return null;
    return `/api/profiles/avatar/${encodeURIComponent(uid)}?v=${r.updated_at}&s=${sign(uid, r.updated_at)}`;
  };
  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip });
  const exists = (uid) => !!db.prepare('SELECT 1 FROM registrations WHERE user_id=?').get(uid);
  const cnt = (sql, ...a) => db.prepare(sql).get(...a).c;
  const acceptedFollowers = (uid) => cnt("SELECT COUNT(*) c FROM follows WHERE followee=? AND status='accepted'", uid);
  const acceptedFollowing = (uid) => cnt("SELECT COUNT(*) c FROM follows WHERE follower=? AND status='accepted'", uid);

  async function lite(uid) {
    const r = row(uid);
    return { user_id: uid, name: await displayName(uid), avatar: avatarUrl(uid), is_private: !!r?.is_private, verified: !!r?.verified };
  }
  async function full(uid, me) {
    const r = row(uid);
    const status = privacy.followStatus(me, uid);
    const canView = privacy.canView(me, uid);
    return {
      ...(await lite(uid)), bio: r?.bio || '', is_me: uid === me,
      posts: cnt('SELECT COUNT(*) c FROM posts WHERE user_id=?', uid),
      followers: acceptedFollowers(uid),
      following: acceptedFollowing(uid),
      followed_by_me: status === 'accepted',
      follow_status: status,
      is_private: !!r?.is_private,
      can_view: canView,
      // برای حساب خصوصی و غیرفالوور، محتوا در دسترس نیست ولی نام/آواتار/بیو/تعدادها می‌مانند.
      private: !!r?.is_private && !canView,
    };
  }

  // چند کاربر با هم (برای عکس و نام کنار پیام‌ها و نظرها)
  app.get('/api/profiles', auth, limiter, async (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 50);
    res.json({ profiles: await Promise.all(ids.map(lite)) });
  });

  app.get('/api/profiles/:id', auth, limiter, async (req, res) => {
    if (!exists(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (privacy.isBanned(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)')
      .get(req.userId, req.params.id, req.params.id, req.userId);
    if (blocked) return res.status(404).json({ error: 'not_found' });
    res.json(await full(req.params.id, req.userId));
  });

  // تغییر پروفایل: بیو و/یا حساب خصوصی. PATCH بخشی است؛ PUT برای سازگاری با نسخه‌های قبلی.
  function parsePrivate(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return null;
  }
  function setPrivate(uid, makePrivate) {
    let accepted = [];
    db.transaction(() => {
      const before = !!row(uid)?.is_private;
      db.prepare(`INSERT INTO profiles (user_id,bio,is_private,updated_at) VALUES (?,'',?,?)
        ON CONFLICT(user_id) DO UPDATE SET is_private=excluded.is_private`)
        .run(uid, makePrivate ? 1 : 0, now());
      // تصمیم Q1: برگشت از خصوصی به عمومی، همهٔ درخواست‌های pending را خودکار accepted می‌کند
      // (هم‌رفتار با اینستاگرام و بدون نیاز به کار دستی برای ده‌ها درخواست).
      if (before && !makePrivate) {
        accepted = db.prepare("SELECT follower FROM follows WHERE followee=? AND status='pending'").all(uid).map((r) => r.follower);
        db.prepare("UPDATE follows SET status='accepted' WHERE followee=? AND status='pending'").run(uid);
      }
    })();
    for (const follower of accepted) {
      interests?.bump(follower, `a:${uid}`, 1);
      notifications?.notify({ to: follower, kind: 'follow_accept', actor: uid });
    }
    return accepted.length;
  }

  async function updateProfile(req, res) {
    const hasBio = Object.prototype.hasOwnProperty.call(req.body || {}, 'bio');
    const hasPrivate = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_private');
    if (!hasBio && !hasPrivate) return res.status(400).json({ error: 'missing_fields' });
    const privateVal = hasPrivate ? parsePrivate(req.body.is_private) : null;
    if (hasPrivate && privateVal === null) return res.status(400).json({ error: 'bad_is_private' });
    forgetName(req.userId); // اسم نمایشی ممکن است همین حالا عوض شده باشد
    if (hasBio) {
      const bio = String(req.body.bio ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 150);
      db.prepare(`INSERT INTO profiles (user_id,bio,updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio`).run(req.userId, bio, now());
    }
    let autoAccepted = 0;
    if (hasPrivate) autoAccepted = setPrivate(req.userId, privateVal);
    res.json({ ...(await full(req.userId, req.userId)), auto_accepted: autoAccepted });
  }
  app.patch('/api/profile', auth, limiter, updateProfile);
  app.put('/api/profile', auth, limiter, updateProfile);

  // ---- حریم خصوصی ----
  app.get('/api/privacy', auth, limiter, (req, res) => {
    res.json(privacyOf(req.userId));
  });

  app.put('/api/privacy', auth, limiter, (req, res) => {
    const b = req.body || {};
    const hasAudience = Object.prototype.hasOwnProperty.call(b, 'story_audience');
    const hasHide = Object.prototype.hasOwnProperty.call(b, 'hide_follows');
    const hasPrivate = Object.prototype.hasOwnProperty.call(b, 'is_private');
    if (!hasAudience && !hasHide && !hasPrivate) return res.status(400).json({ error: 'missing_fields' });
    const current = privacyOf(req.userId);
    let audience = current.story_audience;
    let hide = current.hide_follows ? 1 : 0;
    if (hasAudience) {
      if (!['everyone', 'followers'].includes(b.story_audience)) return res.status(400).json({ error: 'bad_story_audience' });
      audience = b.story_audience;
    }
    if (hasHide) {
      hide = b.hide_follows === true || b.hide_follows === 1 ? 1 : b.hide_follows === false || b.hide_follows === 0 ? 0 : null;
      if (hide === null) return res.status(400).json({ error: 'bad_hide_follows' });
    }
    const privateVal = hasPrivate ? parsePrivate(b.is_private) : null;
    if (hasPrivate && privateVal === null) return res.status(400).json({ error: 'bad_is_private' });
    db.prepare(`INSERT INTO profiles (user_id,bio,story_audience,hide_follows,updated_at) VALUES (?,'',?,?,0)
      ON CONFLICT(user_id) DO UPDATE SET story_audience=excluded.story_audience, hide_follows=excluded.hide_follows`)
      .run(req.userId, audience, hide);
    let autoAccepted = 0;
    if (hasPrivate) autoAccepted = setPrivate(req.userId, privateVal);
    res.json({ ...privacyOf(req.userId), auto_accepted: autoAccepted });
  });

  app.put('/api/profile/avatar', auth, limiter, (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = IMG[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > 3 * 1024 * 1024) return res.status(413).json({ error: 'too_large', max_mb: 3 });
    const chunks = []; let got = 0; let dead = false;
    req.on('data', (c) => { got += c.length; if (got > len) { dead = true; req.destroy(); } else chunks.push(c); });
    req.on('error', () => { dead = true; });
    req.on('end', async () => {
      if (dead || got !== len) return res.status(400).json({ error: 'incomplete' });
      if (!sniffBuf(Buffer.concat(chunks), mime)) return res.status(415).json({ error: 'bad_content' });
      const file = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
      const old = row(req.userId)?.avatar_file;
      fs.writeFileSync(path.join(dir, file), stripImageBuf(Buffer.concat(chunks), mime));
      db.prepare(`INSERT INTO profiles (user_id,avatar_file,avatar_mime,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET avatar_file=excluded.avatar_file, avatar_mime=excluded.avatar_mime, updated_at=excluded.updated_at`)
        .run(req.userId, file, mime, now());
      if (old) fs.rmSync(path.join(dir, old), { force: true });
      res.json(await full(req.userId, req.userId));
    });
  });

  app.delete('/api/profile/avatar', auth, limiter, async (req, res) => {
    const old = row(req.userId)?.avatar_file;
    if (old) { fs.rmSync(path.join(dir, old), { force: true }); db.prepare('UPDATE profiles SET avatar_file=NULL, avatar_mime=NULL, updated_at=? WHERE user_id=?').run(now(), req.userId); }
    res.json(await full(req.userId, req.userId));
  });

  // عکس پروفایل با لینک امضادار (برای تگ img)
  app.get('/api/profiles/avatar/:id', (req, res) => {
    const r = row(req.params.id);
    const s = req.query.s;
    const good = r?.avatar_file && typeof s === 'string' && Buffer.byteLength(s) === SIGLEN
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(req.params.id, r.updated_at)));
    if (!good) return res.status(404).end();
    res.set({ 'content-type': r.avatar_mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400',
      'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(dir, r.avatar_file), { dotfiles: 'deny' });
  });

  // دنبال‌کردن: عمومی ← accepted، خصوصی ← pending. POST دیگر unfollow نمی‌کند؛ DELETE برای آنفالو/لغو درخواست است.
  app.post('/api/follow/:id', auth, limiter, (req, res) => {
    const target = req.params.id;
    if (target === req.userId) return res.status(400).json({ error: 'self' });
    if (!exists(target) || privacy.isBanned(target)) return res.status(404).json({ error: 'not_found' });
    if (privacy.isBlocked(req.userId, target)) return res.status(404).json({ error: 'not_found' });
    let status = privacy.followStatus(req.userId, target);
    if (status === 'accepted') {
      return res.json({ followed: true, following: true, requested: false, status, followers: acceptedFollowers(target) });
    }
    // اگر از قبل pending است و هدف عمومی شده، همان درخواست پذیرفته می‌شود.
    if (status === 'pending' && !privacy.isPrivate(target)) {
      db.prepare("UPDATE follows SET status='accepted' WHERE follower=? AND followee=?").run(req.userId, target);
      status = 'accepted';
      interests?.bump(req.userId, `a:${target}`, 3);
      notifications?.notify({ to: target, kind: 'follow', actor: req.userId });
    } else if (status === 'pending') {
      return res.json({ followed: false, following: false, requested: true, status, followers: acceptedFollowers(target) });
    } else {
      status = privacy.isPrivate(target) ? 'pending' : 'accepted';
      db.prepare('INSERT INTO follows (follower,followee,status,created_at) VALUES (?,?,?,?)')
        .run(req.userId, target, status, now());
      if (status === 'accepted') {
        interests?.bump(req.userId, `a:${target}`, 3);
        notifications?.notify({ to: target, kind: 'follow', actor: req.userId });
      } else {
        notifications?.notify({ to: target, kind: 'follow_request', actor: req.userId });
      }
    }
    res.json({
      followed: status === 'accepted', following: status === 'accepted',
      requested: status === 'pending', status, followers: acceptedFollowers(target),
    });
  });

  app.delete('/api/follow/:id', auth, limiter, (req, res) => {
    const target = req.params.id;
    if (target === req.userId) return res.status(400).json({ error: 'self' });
    const status = privacy.followStatus(req.userId, target);
    if (status === 'none') return res.json({ following: false, followed: false, requested: false, status: 'none', followers: acceptedFollowers(target) });
    db.prepare('DELETE FROM follows WHERE follower=? AND followee=?').run(req.userId, target);
    if (status === 'accepted') interests?.bump(req.userId, `a:${target}`, -1);
    res.json({ following: false, followed: false, requested: false, status: 'none', followers: acceptedFollowers(target) });
  });

  // درخواست‌های دریافتی من (فقط pending). هر کاربر فقط درخواست‌های خودش را می‌بیند.
  app.get('/api/follow/requests', auth, limiter, async (req, res) => {
    const rows = db.prepare(`SELECT f.follower, f.created_at FROM follows f
      WHERE f.followee=? AND f.status='pending'
        AND f.follower NOT IN (SELECT user_id FROM bans)
        AND f.follower NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
        AND f.follower NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
      ORDER BY f.created_at DESC LIMIT 100`).all(req.userId, req.userId, req.userId);
    const requests = [];
    for (const r of rows) requests.push({ ...(await lite(r.follower)), created_at: r.created_at });
    res.json({ requests, count: requests.length });
  });

  app.post('/api/follow/requests/:user/accept', auth, limiter, (req, res) => {
    const requester = req.params.user;
    const rowPending = db.prepare("SELECT created_at FROM follows WHERE follower=? AND followee=? AND status='pending'").get(requester, req.userId);
    if (!rowPending) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE follows SET status='accepted' WHERE follower=? AND followee=?").run(requester, req.userId);
    interests?.bump(requester, `a:${req.userId}`, 1);
    notifications?.notify({ to: requester, kind: 'follow_accept', actor: req.userId });
    res.json({ accepted: true, user_id: requester, followers: acceptedFollowers(req.userId) });
  });

  app.post('/api/follow/requests/:user/decline', auth, limiter, (req, res) => {
    const requester = req.params.user;
    const r = db.prepare("DELETE FROM follows WHERE follower=? AND followee=? AND status='pending'").run(requester, req.userId);
    res.json({ declined: r.changes > 0 });
  });

  // حذف یک دنبال‌کننده (هر وضعیتی) توسط صاحب حساب.
  app.delete('/api/followers/:user', auth, limiter, (req, res) => {
    const r = db.prepare('DELETE FROM follows WHERE follower=? AND followee=?').run(req.params.user, req.userId);
    res.json({ removed: r.changes > 0, followers: acceptedFollowers(req.userId) });
  });

  app.get('/api/profiles/:id/follows', auth, limiter, async (req, res) => {
    const kind = req.query.kind === 'following' ? 'following' : 'followers';
    if (!exists(req.params.id) || privacy.isBanned(req.params.id)) return res.status(404).json({ error: 'not_found' });
    if (privacy.isBlocked(req.userId, req.params.id)) return res.status(404).json({ error: 'not_found' });
    // حساب خصوصی: لیست‌ها فقط برای مالک و فالوور accepted قابل دیدن است.
    if (!privacy.canView(req.userId, req.params.id)) return res.status(404).json({ error: 'not_found' });
    // صاحب پروفایل می‌تواند لیست دنبال‌کننده/دنبال‌شده‌هایش را از دیگران پنهان کند
    if (req.params.id !== req.userId && row(req.params.id)?.hide_follows) {
      return res.json({ users: [], hidden: true });
    }
    const hide = `AND u NOT IN (SELECT user_id FROM bans)
      AND u NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      AND u NOT IN (SELECT blocker FROM blocks WHERE blocked=?)`;
    const rows = kind === 'followers'
      ? db.prepare(`SELECT follower AS u FROM follows WHERE followee=? AND status='accepted' ${hide} ORDER BY created_at DESC LIMIT 200`).all(req.params.id, req.userId, req.userId)
      : db.prepare(`SELECT followee AS u FROM follows WHERE follower=? AND status='accepted' ${hide} ORDER BY created_at DESC LIMIT 200`).all(req.params.id, req.userId, req.userId);
    res.json({ users: await Promise.all(rows.map((r) => lite(r.u))), hidden: false });
  });

  // پیشنهاد کاربر هنگام تایپ: prefix روی username/displayname اول، بعد substring؛ سقف ۸.
  const suggestLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip });
  app.get('/api/people/suggest', auth, suggestLimiter, async (req, res) => {
    const q = String(req.query.q || '').trim().replace(/^@/, '').split(':')[0].toLowerCase().slice(0, 40);
    if (!q) return res.json({ users: [] });
    const esc = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    const rows = db.prepare(`SELECT r.user_id FROM registrations r
      LEFT JOIN name_index n ON n.user_id=r.user_id
      WHERE r.user_id != ?
        AND r.user_id NOT IN (SELECT user_id FROM bans)
        AND r.user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
        AND r.user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
        AND (lower(substr(r.user_id, 2, instr(r.user_id, ':') - 2)) LIKE ? ESCAPE '\\' OR COALESCE(n.name_lc,'') LIKE ? ESCAPE '\\')
      ORDER BY CASE
        WHEN lower(substr(r.user_id, 2, instr(r.user_id, ':') - 2)) LIKE ? ESCAPE '\\' THEN 0
        WHEN COALESCE(n.name_lc,'') LIKE ? ESCAPE '\\' THEN 1
        ELSE 2 END,
        lower(r.user_id)
      LIMIT 8`).all(
      req.userId, req.userId, req.userId,
      `%${esc}%`, `%${esc}%`,
      `${esc}%`, `${esc}%`,
    );
    res.json({ users: await Promise.all(rows.map((r) => lite(r.user_id))) });
  });

  // جستجوی افراد با آیدی (نام کاربری) یا نام نمایشی؛ از فهرست نام‌ها در دیتابیس (بدون تماس به Synapse) و حداکثر ۱۵ نتیجه
  const searchLimiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip });
  app.get('/api/users/search', auth, searchLimiter, async (req, res) => {
    const q = String(req.query.q || '').trim().replace(/^@/, '').split(':')[0].toLowerCase().slice(0, 40);
    if (q.length < 2) return res.json({ users: [] });
    const esc = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    const ids = db.prepare(`SELECT user_id FROM registrations WHERE lower(user_id) LIKE ? ESCAPE '\\'
      AND user_id NOT IN (SELECT user_id FROM bans)
      AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      AND user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
      ORDER BY user_id LIMIT 15`).all(`@${esc}%`, req.userId, req.userId).map((r) => r.user_id);
    const seen = new Set(ids);
    if (seen.size < 15) {
      const byName = db.prepare(`SELECT n.user_id FROM name_index n JOIN registrations r ON r.user_id = n.user_id
        WHERE n.name_lc LIKE ? ESCAPE '\\' AND n.user_id NOT IN (SELECT user_id FROM bans)
        AND n.user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
        AND n.user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
        LIMIT 15`).all(`%${esc}%`, req.userId, req.userId);
      for (const r of byName) { if (seen.size < 15) seen.add(r.user_id); }
    }
    res.json({ users: await Promise.all([...seen].map(lite)) });
  });
}
