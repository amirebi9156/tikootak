// فید ویدیو/عکس (شبیه اینستاگرام). فایل‌ها روی دیسک (کنار دیتابیس gateway) و اطلاعات در SQLite.
// احراز هویت با همان توکن Matrix؛ هر کاربر واردشده همه پست‌ها را می‌بیند.
import { sniffOk } from './sniff.js';
import { stripImageFile } from './strip.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import rateLimit from 'express-rate-limit';

const TYPES = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};
// پوستر/تامبنیل ویدیو (سمت مرورگر ساخته می‌شود): کوچک نگه داشته می‌شود تا فقط برای پیش‌نمایش دانلود شود
const THUMB_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_THUMB = 512 * 1024;

export function mountFeed(app, { db, privacy, whoami, synapseUrl, secret, dataDir, maxMb = 150, notifications = null, quotaOk = () => true, interests = null, onVideoPost = null, onPostDelete = null }) {
  const dir = path.join(dataDir, 'feed');
  fs.mkdirSync(dir, { recursive: true });
  const MAX = maxMb * 1024 * 1024;
  const now = () => Math.floor(Date.now() / 1000);
  const key = crypto.createHash('sha256').update(`feed:${secret}`).digest();

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);
    CREATE TABLE IF NOT EXISTS likes (
      post_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      text TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, id);
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (comment_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower TEXT NOT NULL, followee TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (follower, followee)
    );
    CREATE TABLE IF NOT EXISTS bans (user_id TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS name_index (user_id TEXT PRIMARY KEY, name_lc TEXT NOT NULL);
  `);
  // ستون‌های تامبنیل در migration 001 اضافه می‌شوند.

  // ---- کمک‌ها ----
  const authCache = new Map(); // توکن -> { user_id, exp } (یا { bad: true } برای توکن نامعتبر)
  const failsByIp = new Map(); // ip -> { n, reset }
  const FAIL_LIMIT = 40; // توکن نامعتبر در هر دقیقه برای هر IP؛ جلوی فشار آوردن به Synapse را می‌گیرد
  const banned = db.prepare('SELECT 1 FROM bans WHERE user_id=?');
  async function auth(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const ip = req.ip || '?';
    const f = failsByIp.get(ip);
    if (f && f.reset > Date.now() && f.n >= FAIL_LIMIT) return res.status(429).json({ error: 'rate_limited' });
    const bad = () => {
      const x = failsByIp.get(ip);
      if (!x || x.reset <= Date.now()) failsByIp.set(ip, { n: 1, reset: Date.now() + 60_000 }); else x.n += 1;
      if (failsByIp.size > 5000) failsByIp.delete(failsByIp.keys().next().value);
      return res.status(401).json({ error: 'unauthorized' });
    };
    if (!m || m[1].length > 600) return bad();
    const hit = authCache.get(m[1]);
    if (hit && hit.exp > Date.now()) {
      if (hit.bad) return bad();
      if (banned.get(hit.user_id)) return res.status(403).json({ error: 'banned' });
      req.userId = hit.user_id; return next();
    }
    try {
      const me = await whoami(m[1]);
      if (!me) {
        authCache.set(m[1], { bad: true, exp: Date.now() + 30_000 });
        if (authCache.size > 2000) authCache.delete(authCache.keys().next().value);
        return bad();
      }
      authCache.set(m[1], { user_id: me.user_id, exp: Date.now() + 20_000 }); // خروج/باطل‌شدن توکن حداکثر ۲۰ ثانیه دیرتر اعمال می‌شود
      if (authCache.size > 2000) authCache.delete(authCache.keys().next().value);
      if (banned.get(me.user_id)) return res.status(403).json({ error: 'banned' });
      req.userId = me.user_id;
      return next();
    } catch {
      return res.status(502).json({ error: 'upstream_unavailable' });
    }
  }

  const names = new Map();
  async function displayName(uid) {
    const hit = names.get(uid);
    if (hit && hit.exp > Date.now()) return hit.name;
    let name = uid.replace(/^@/, '').split(':')[0];
    try {
      const r = await fetch(`${synapseUrl}/_matrix/client/v3/profile/${encodeURIComponent(uid)}`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) name = (await r.json()).displayname || name;
    } catch { /* همان نام کاربری */ }
    names.set(uid, { name, exp: Date.now() + 5 * 60_000 });
    if (names.size > 5000) names.delete(names.keys().next().value);
    try { db.prepare('INSERT OR REPLACE INTO name_index (user_id,name_lc) VALUES (?,?)').run(uid, name.toLowerCase().slice(0, 80)); } catch { /* مهم نیست */ }
    return name;
  }

  const sign = (id, uid, exp) => crypto.createHmac('sha256', key).update(`${id}|${uid}|${exp}`).digest('base64url');
  const mediaUrl = (id, uid) => {
    const exp = now() + 6 * 3600;
    return `/api/feed/media/${id}?u=${encodeURIComponent(uid)}&e=${exp}&s=${sign(id, uid, exp)}`;
  };
  const thumbUrl = (id, uid) => {
    const exp = now() + 6 * 3600;
    return `/api/feed/thumb/${id}?u=${encodeURIComponent(uid)}&e=${exp}&s=${sign(`thumb:${id}`, uid, exp)}`;
  };

  async function shape(rows, me) {
    const out = [];
    const followedStmt = db.prepare('SELECT status FROM follows WHERE follower=? AND followee=?');
    const mutualStmt = db.prepare(`SELECT l.user_id FROM likes l JOIN follows f ON f.followee = l.user_id
      WHERE l.post_id=? AND f.follower=? AND f.status='accepted' AND l.user_id != ? LIMIT 3`);
    for (const p of rows) {
      let shares = 0;
      try { shares = db.prepare('SELECT COUNT(*) c FROM post_shares WHERE post_id=?').get(p.id).c; } catch { shares = 0; }
      const follow = followedStmt.get(me, p.user_id)?.status || 'none';
      out.push({
        id: p.id, user_id: p.user_id, name: await displayName(p.user_id), caption: p.caption,
        kind: p.mime.startsWith('video/') ? 'video' : 'image', mime: p.mime, size: p.size, created_at: p.created_at,
        url: mediaUrl(p.id, me),
        thumb: p.thumb_file ? thumbUrl(p.id, me) : null,
        likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(p.id).c,
        liked: !!db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(p.id, me),
        comments: db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id=?').get(p.id).c,
        shares,
        followed: follow === 'accepted',
        follow_status: follow,
        is_private: privacy.isPrivate(p.user_id),
        liked_by_following: mutualStmt.all(p.id, me, p.user_id).map((r) => r.user_id),
      });
    }
    return out;
  }

  const postLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });
  const smallLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });

  // حساب تازه (کمتر از ۲۴ ساعت) سقف کمتری دارد؛ ضدهرزنامه
  const isNew = (uid) => {
    try { const r = db.prepare('SELECT created_at FROM registrations WHERE user_id=?').get(uid); return !!r && now() - r.created_at < 86400; } catch { return false; }
  };
  const NEW_POSTS_PER_DAY = 5;
  const NEW_COMMENTS_PER_HOUR = 20;
  const COMMENTS_PER_HOUR = 90;

  const forgetName = (uid) => names.delete(uid);
  const helpers = { auth, displayName, forgetName, shape };

  // ---- ساخت پست: بدنه خام فایل، توضیح در هدر x-caption (encodeURIComponent) ----
  app.post('/api/feed/posts', auth, postLimiter, (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > MAX) return res.status(413).json({ error: 'too_large', max_mb: maxMb });
    if (!quotaOk(req.userId, len)) return res.status(413).json({ error: 'quota_exceeded' });
    if (isNew(req.userId) && db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id=? AND created_at > ?').get(req.userId, now() - 86400).c >= NEW_POSTS_PER_DAY) {
      return res.status(429).json({ error: 'too_many_new' });
    }
    let caption = '';
    try { caption = decodeURIComponent(String(req.headers['x-caption'] || '')).slice(0, 500); } catch { /* خالی */ }

    const id = crypto.randomBytes(9).toString('base64url');
    const file = `${id}.${ext}`;
    const full = path.join(dir, file);
    const out = fs.createWriteStream(full);
    let got = 0;
    let failed = false;
    const fail = (code, status) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(full, { force: true }, () => {});
      if (!res.headersSent) res.status(status).json({ error: code });
    };
    req.on('data', (c) => { got += c.length; if (got > MAX) { fail('too_large', 413); req.destroy(); } });
    req.on('aborted', () => fail('aborted', 400));
    req.on('error', () => fail('aborted', 400));
    out.on('error', () => fail('write_failed', 500));
    out.on('finish', async () => {
      if (failed) return;
      if (got !== len) return fail('incomplete', 400);
      if (!sniffOk(full, mime)) return fail('bad_content', 415);
      got = stripImageFile(full, mime, got); // حذف GPS/EXIF
      db.prepare('INSERT INTO posts (id,user_id,caption,mime,file,size,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, req.userId, caption, mime, file, got, now());
      const row = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
      if (mime.startsWith('video/')) { try { onVideoPost?.(row); } catch { /* صف تبدیل نباید آپلود را بشکند */ } }
      res.status(201).json((await shape([row], req.userId))[0]);
    });
    req.pipe(out);
  });

  // ---- تامبنیل/پوستر ویدیو: بدنه خام تصویر کوچک (حداکثر ۵۱۲ کیلوبایت) ----
  app.post('/api/feed/posts/:id/thumb', auth, smallLimiter, (req, res) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (p.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = THUMB_TYPES[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > MAX_THUMB) return res.status(413).json({ error: 'too_large', max_kb: 512 });
    const thumbs = path.join(dir, 'thumbs');
    fs.mkdirSync(thumbs, { recursive: true });
    const file = `${p.id}.${ext}`;
    const full = path.join(thumbs, file);
    const out = fs.createWriteStream(full);
    let got = 0;
    let failed = false;
    const fail = (code, status) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(full, { force: true }, () => {});
      if (!res.headersSent) res.status(status).json({ error: code });
    };
    req.on('data', (c) => { got += c.length; if (got > MAX_THUMB) { fail('too_large', 413); req.destroy(); } });
    req.on('aborted', () => fail('aborted', 400));
    req.on('error', () => fail('aborted', 400));
    out.on('error', () => fail('write_failed', 500));
    out.on('finish', () => {
      if (failed) return;
      if (got !== len) return fail('incomplete', 400);
      if (!sniffOk(full, mime)) return fail('bad_content', 415);
      if (p.thumb_file && p.thumb_file !== file) fs.rm(path.join(thumbs, p.thumb_file), { force: true }, () => {});
      db.prepare('UPDATE posts SET thumb_file=?, thumb_mime=? WHERE id=?').run(file, mime, p.id);
      res.status(201).json({ ok: true, thumb: thumbUrl(p.id, req.userId) });
    });
    req.pipe(out);
  });

  app.get('/api/feed/posts', auth, smallLimiter, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
    // مرز صفحه: «زمان» یا «زمان_شناسه» (برای اینکه پست‌های هم‌ثانیه جا نیفتند)
    const [bt, bid] = String(req.query.before || '').split('_');
    const before = Number(bt) || 0;
    const user = req.query.user ? String(req.query.user) : null;
    // پروفایل/محتوای حساب خصوصی برای غیرفالوور ۴۰۴ است (نه لیست خالی؛ وجود محتوا لو نرود).
    if (user && !privacy.canView(req.userId, user)) return res.status(404).json({ error: 'not_found' });
    const where = []; const args = [];
    // کاربران بن‌شده و بلاک‌شده در فید دیده نمی‌شوند
    where.push('user_id NOT IN (SELECT user_id FROM bans)');
    where.push('user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)'); args.push(req.userId);
    where.push('user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)'); args.push(req.userId);
    if (req.query.following === '1') {
      where.push("(user_id IN (SELECT followee FROM follows WHERE follower = ? AND status='accepted') OR user_id = ?)");
      args.push(req.userId, req.userId);
    }
    if (before && bid) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); args.push(before, before, bid); }
    else if (before) { where.push('created_at < ?'); args.push(before); }
    if (user) { where.push('user_id = ?'); args.push(user); }
    const rawQ = String(req.query.q || '').trim().slice(0, 60);
    const isTag = rawQ.startsWith('#');
    const q = rawQ.replace(/^#/, '');
    if (q) { where.push("caption LIKE ? ESCAPE '\\'"); args.push((isTag ? '%#' : '%') + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
    // فیلتر حریم خصوصی داخل SQL (قبل از LIMIT): عمومی + خودم + فالوور accepted.
    // اگر بعد از LIMIT فیلتر می‌شد، پست‌های خصوصی صفحه را خالی می‌کردند.
    const vis = privacy.visibilityClause('posts.user_id', req.userId);
    where.push(vis.sql); args.push(...vis.args);
    const rows = db.prepare(`SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, limit);
    res.json({ posts: await shape(rows, req.userId) });
  });

  app.get('/api/feed/posts/:id', auth, smallLimiter, async (req, res) => {
    const row = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!row || !privacy.canView(req.userId, row.user_id)) return res.status(404).json({ error: 'not_found' });
    const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)')
      .get(req.userId, row.user_id, row.user_id, req.userId);
    if (blocked) return res.status(404).json({ error: 'not_found' });
    res.json((await shape([row], req.userId))[0]);
  });

  app.post('/api/feed/posts/:id/like', auth, smallLimiter, (req, res) => {
    const p = db.prepare('SELECT id, user_id, caption FROM posts WHERE id=?').get(req.params.id);
    if (!p || !privacy.canView(req.userId, p.user_id)) return res.status(404).json({ error: 'not_found' });
    if (privacy.isBlocked(req.userId, p.user_id)) return res.status(404).json({ error: 'not_found' });
    const had = db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(p.id, req.userId).changes;
    if (!had) {
      db.prepare('INSERT INTO likes (post_id,user_id) VALUES (?,?)').run(p.id, req.userId);
      interests?.bumpPost(req.userId, p, { author: 1, tag: 0.5 });
      notifications?.notify({
        to: p.user_id, kind: 'like', actor: req.userId, refId: p.id,
        extra: p.caption ? { preview: p.caption.slice(0, 90) } : null,
      });
    } else {
      interests?.bumpPost(req.userId, p, { author: -0.5, tag: -0.25 });
    }
    res.json({ liked: !had, likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(p.id).c });
  });

  const commentShape = async (c, me) => ({
    id: c.id, user_id: c.user_id, name: await displayName(c.user_id), text: c.text, created_at: c.created_at,
    likes: db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(c.id).c,
    liked: !!db.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?').get(c.id, me),
  });

  app.get('/api/feed/posts/:id/comments', auth, smallLimiter, async (req, res) => {
    const post = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
    if (!post || !privacy.canView(req.userId, post.user_id)) return res.status(404).json({ error: 'not_found' });
    const rows = db.prepare(`SELECT * FROM comments WHERE post_id=?
      AND user_id NOT IN (SELECT user_id FROM bans)
      AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      AND user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
      ORDER BY id ASC LIMIT 200`).all(req.params.id, req.userId, req.userId)
      .filter((c) => privacy.canView(req.userId, c.user_id));
    res.json({ comments: await Promise.all(rows.map((c) => commentShape(c, req.userId))) });
  });

  app.post('/api/feed/comments/:id/like', auth, smallLimiter, (req, res) => {
    const c = db.prepare('SELECT id, user_id, post_id, text FROM comments WHERE id=?').get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    const post = db.prepare('SELECT user_id FROM posts WHERE id=?').get(c.post_id);
    if (!post || !privacy.canView(req.userId, post.user_id) || !privacy.canView(req.userId, c.user_id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (privacy.isBlocked(req.userId, c.user_id)) return res.status(404).json({ error: 'not_found' });
    const had = db.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?').run(c.id, req.userId).changes;
    if (!had) {
      db.prepare('INSERT INTO comment_likes (comment_id,user_id) VALUES (?,?)').run(c.id, req.userId);
      interests?.bump(req.userId, `a:${c.user_id}`, 0.25);
      notifications?.notify({
        to: c.user_id, kind: 'comment_like', actor: req.userId, refId: c.post_id,
        extra: { text: c.text.slice(0, 100), comment_id: c.id },
      });
    }
    res.json({ liked: !had, likes: db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(c.id).c });
  });

  // صاحب نظر یا صاحب پست می‌تواند نظر را پاک کند
  app.delete('/api/feed/comments/:id', auth, smallLimiter, (req, res) => {
    const c = db.prepare('SELECT c.*, p.user_id AS owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id=?').get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    if (c.user_id !== req.userId && c.owner !== req.userId) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM comment_likes WHERE comment_id=?').run(c.id);
    db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
    res.json({ ok: true });
  });

  app.post('/api/feed/posts/:id/comments', auth, smallLimiter, async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'missing_fields' });
    const post = db.prepare('SELECT user_id, caption FROM posts WHERE id=?').get(req.params.id);
    if (!post || !privacy.canView(req.userId, post.user_id)) return res.status(404).json({ error: 'not_found' });
    if (privacy.isBlocked(req.userId, post.user_id)) return res.status(404).json({ error: 'not_found' });
    const lastHour = db.prepare('SELECT COUNT(*) c FROM comments WHERE user_id=? AND created_at > ?').get(req.userId, now() - 3600).c;
    if (lastHour >= (isNew(req.userId) ? NEW_COMMENTS_PER_HOUR : COMMENTS_PER_HOUR)) return res.status(429).json({ error: 'too_many_new' });
    if (db.prepare('SELECT COUNT(*) c FROM comments WHERE user_id=? AND text=? AND created_at > ?').get(req.userId, text, now() - 600).c >= 2) {
      return res.status(429).json({ error: 'duplicate' });
    }
    const r = db.prepare('INSERT INTO comments (post_id,user_id,text,created_at) VALUES (?,?,?,?)').run(req.params.id, req.userId, text, now());
    const cid = Number(r.lastInsertRowid);
    interests?.bumpPost(req.userId, post, { author: 1.5, tag: 0.7 });
    notifications?.notify({
      to: post.user_id, kind: 'comment', actor: req.userId, refId: String(req.params.id),
      extra: { text: text.slice(0, 120), comment_id: cid },
    });
    res.status(201).json(await commentShape(db.prepare('SELECT * FROM comments WHERE id=?').get(cid), req.userId));
  });

  app.delete('/api/feed/posts/:id', auth, smallLimiter, (req, res) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (p.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    try { onPostDelete?.(p.id); } catch { /* مهم نیست */ }
    db.prepare('DELETE FROM posts WHERE id=?').run(p.id);
    db.prepare('DELETE FROM likes WHERE post_id=?').run(p.id);
    db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?)').run(p.id);
    db.prepare('DELETE FROM comments WHERE post_id=?').run(p.id);
    for (const t of ['post_views', 'post_seen', 'post_hidden', 'post_shares']) {
      try { db.prepare(`DELETE FROM ${t} WHERE post_id=?`).run(p.id); } catch { /* ماژول رتبه‌بندی هنوز جدول را نساخته */ }
    }
    notifications?.removeForPost(p.id);
    fs.rm(path.join(dir, p.file), { force: true }, () => {});
    if (p.thumb_file) fs.rm(path.join(dir, 'thumbs', p.thumb_file), { force: true }, () => {});
    res.json({ ok: true });
  });

  // ---- تامبنیل امضادار (برای پیش‌نمایش ویدیو بدون دانلود کل فایل) ----
  app.get('/api/feed/thumb/:id', (req, res) => {
    const { u, e, s } = req.query;
    const exp = Number(e);
    const good = typeof s === 'string' && typeof u === 'string' && exp > now()
      && Buffer.byteLength(s) === sign('x', 'x', 0).length
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(`thumb:${req.params.id}`, u, exp)));
    if (!good) return res.status(403).json({ error: 'forbidden' });
    const p = db.prepare('SELECT user_id, thumb_file, thumb_mime FROM posts WHERE id=?').get(req.params.id);
    if (!p?.thumb_file || !privacy.canView(u, p.user_id)) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': p.thumb_mime || 'image/webp', 'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=86400', 'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(dir, 'thumbs', p.thumb_file), { dotfiles: 'deny' });
  });

  // ---- پخش فایل (برای تگ video/img که هدر Authorization نمی‌فرستند: لینک امضادار) ----
  app.get('/api/feed/media/:id', (req, res) => {
    const { u, e, s } = req.query;
    const exp = Number(e);
    const good = typeof s === 'string' && typeof u === 'string' && exp > now()
      && Buffer.byteLength(s) === sign('x', 'x', 0).length
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(req.params.id, u, exp)));
    if (!good) return res.status(403).json({ error: 'forbidden' });
    const p = db.prepare('SELECT user_id, file, mime FROM posts WHERE id=?').get(req.params.id);
    if (!p || !privacy.canView(u, p.user_id)) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': p.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(dir, p.file), { dotfiles: 'deny' });
  });
  return helpers;
}
