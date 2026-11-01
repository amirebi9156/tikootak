// استوری: عکس یا ویدیوی کوتاه که ۲۴ ساعت بعد خودکار پاک می‌شود.
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
const TTL = 24 * 3600;

export function mountStories(app, { db, privacy, auth, displayName, secret, dataDir, maxMb = 50, quotaOk = () => true, onVideoStory = null, onStoryDelete = null }) {
  const dir = path.join(dataDir, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  const MAX = maxMb * 1024 * 1024;
  const now = () => Math.floor(Date.now() / 1000);
  const key = crypto.createHash('sha256').update(`story:${secret}`).digest();
  const sign = (id, uid, exp) => crypto.createHmac('sha256', key).update(`${id}|${uid}|${exp}`).digest('base64url');
  const SIGLEN = sign('x', 'x', 0).length;

  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT NOT NULL, file TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stories_exp ON stories(expires_at);
    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL, user_id TEXT NOT NULL, viewed_at INTEGER NOT NULL, PRIMARY KEY (story_id, user_id)
    );
  `);

  // حذف داستان‌های منقضی (فایل و ردیف). هر ۱۰ دقیقه، و یک بار موقع شروع.
  function purge() {
    const old = db.prepare('SELECT id, file FROM stories WHERE expires_at <= ?').all(now());
    for (const s of old) {
      try { onStoryDelete?.(s.id); } catch { /* مهم نیست */ }
      fs.rmSync(path.join(dir, s.file), { force: true });
      db.prepare('DELETE FROM story_views WHERE story_id=?').run(s.id);
      db.prepare('DELETE FROM stories WHERE id=?').run(s.id);
    }
  }
  purge();
  setInterval(purge, 10 * 60 * 1000).unref();

  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip });
  const upLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip });

  const mediaUrl = (id, uid) => {
    const exp = now() + 6 * 3600;
    return `/api/stories/media/${id}?u=${encodeURIComponent(uid)}&e=${exp}&s=${sign(id, uid, exp)}`;
  };
  const shape = (s, me) => ({
    id: s.id, user_id: s.user_id, kind: s.mime.startsWith('video/') ? 'video' : 'image', caption: s.caption,
    created_at: s.created_at, expires_at: s.expires_at, url: mediaUrl(s.id, me),
    seen: !!db.prepare('SELECT 1 FROM story_views WHERE story_id=? AND user_id=?').get(s.id, me),
    views: s.user_id === me ? db.prepare('SELECT COUNT(*) c FROM story_views WHERE story_id=?').get(s.id).c : undefined,
  });

  // آیا viewer اجازه دیدن استوری‌های owner را دارد؟ (canView مرکزی + مخاطب استوری)
  const canSee = (owner, viewer) => {
    if (!privacy.canView(viewer, owner)) return false;
    if (owner === viewer) return true;
    const audience = db.prepare('SELECT story_audience FROM profiles WHERE user_id=?').get(owner)?.story_audience;
    return audience !== 'followers' || privacy.followStatus(viewer, owner) === 'accepted';
  };

  app.post('/api/stories', auth, upLimiter, (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > MAX) return res.status(413).json({ error: 'too_large', max_mb: maxMb });
    if (!quotaOk(req.userId, len)) return res.status(413).json({ error: 'quota_exceeded' });
    let caption = '';
    try { caption = decodeURIComponent(String(req.headers['x-caption'] || '')).slice(0, 200); } catch { /* خالی */ }
    const id = crypto.randomBytes(9).toString('base64url');
    const file = `${id}.${ext}`;
    const full = path.join(dir, file);
    const out = fs.createWriteStream(full);
    let got = 0; let failed = false;
    const fail = (code, status) => {
      if (failed) return;
      failed = true; out.destroy(); fs.rm(full, { force: true }, () => {});
      if (!res.headersSent) res.status(status).json({ error: code });
    };
    req.on('data', (c) => { got += c.length; if (got > MAX) { fail('too_large', 413); req.destroy(); } });
    req.on('aborted', () => fail('aborted', 400));
    req.on('error', () => fail('aborted', 400));
    out.on('error', () => fail('write_failed', 500));
    out.on('finish', () => {
      if (failed) return;
      if (got !== len) return fail('incomplete', 400);
      if (!sniffOk(full, mime)) return fail('bad_content', 415);
      got = stripImageFile(full, mime, got);
      const t = now();
      db.prepare('INSERT INTO stories (id,user_id,mime,file,caption,size,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, req.userId, mime, file, caption, got, t, t + TTL);
      const row = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
      if (mime.startsWith('video/')) { try { onVideoStory?.(row); } catch { /* صف نباید آپلود را بشکند */ } }
      res.status(201).json(shape(row, req.userId));
    });
    req.pipe(out);
  });

  // استوری‌های فعال: فقط خودم + کسانی که accepted دنبال می‌کنم (طبق Q1، نه «همه»).
  app.get('/api/stories', auth, limiter, async (req, res) => {
    const me = req.userId;
    const rows = db.prepare(`SELECT * FROM stories WHERE expires_at > ?
      AND (user_id = ? OR user_id IN (SELECT followee FROM follows WHERE follower=? AND status='accepted'))
      AND user_id NOT IN (SELECT user_id FROM bans)
      AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      AND user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
      ORDER BY created_at ASC`).all(now(), me, me, me, me);
    const following = new Set(db.prepare("SELECT followee FROM follows WHERE follower=? AND status='accepted'").all(me).map((r) => r.followee));
    const visible = rows.filter((s) => canSee(s.user_id, me));
    const by = new Map();
    for (const s of visible) { if (!by.has(s.user_id)) by.set(s.user_id, []); by.get(s.user_id).push(shape(s, me)); }
    const groups = [];
    for (const [uid, stories] of by) {
      groups.push({
        user_id: uid, name: await displayName(uid), stories, all_seen: stories.every((x) => x.seen),
        rank: uid === me ? 0 : 1,
      });
    }
    groups.sort((a, b) => a.rank - b.rank || Number(a.all_seen) - Number(b.all_seen) || b.stories.at(-1).created_at - a.stories.at(-1).created_at);
    res.json({ groups });
  });

  app.post('/api/stories/:id/view', auth, limiter, (req, res) => {
    const s = db.prepare('SELECT * FROM stories WHERE id=? AND expires_at > ?').get(req.params.id, now());
    if (!s || !canSee(s.user_id, req.userId)) return res.status(404).json({ error: 'not_found' });
    if (db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(req.userId, s.user_id, s.user_id, req.userId)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (s.user_id !== req.userId) db.prepare('INSERT OR IGNORE INTO story_views (story_id,user_id,viewed_at) VALUES (?,?,?)').run(s.id, req.userId, now());
    res.json({ ok: true });
  });

  app.get('/api/stories/:id/views', auth, limiter, async (req, res) => {
    const s = db.prepare('SELECT * FROM stories WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    if (s.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    const rows = db.prepare(`SELECT user_id, viewed_at FROM story_views WHERE story_id=?
      AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      ORDER BY viewed_at DESC LIMIT 200`).all(s.id, req.userId);
    res.json({ views: await Promise.all(rows.map(async (r) => ({ user_id: r.user_id, name: await displayName(r.user_id), viewed_at: r.viewed_at }))) });
  });

  app.delete('/api/stories/:id', auth, limiter, (req, res) => {
    const s = db.prepare('SELECT * FROM stories WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    if (s.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    try { onStoryDelete?.(s.id); } catch { /* مهم نیست */ }
    fs.rmSync(path.join(dir, s.file), { force: true });
    db.prepare('DELETE FROM story_views WHERE story_id=?').run(s.id);
    db.prepare('DELETE FROM stories WHERE id=?').run(s.id);
    res.json({ ok: true });
  });

  app.get('/api/stories/media/:id', (req, res) => {
    const { u, e, s } = req.query;
    const exp = Number(e);
    const good = typeof s === 'string' && typeof u === 'string' && exp > now() && Buffer.byteLength(s) === SIGLEN
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(req.params.id, u, exp)));
    if (!good) return res.status(403).json({ error: 'forbidden' });
    const r = db.prepare('SELECT user_id, file, mime FROM stories WHERE id=? AND expires_at > ?').get(req.params.id, now());
    if (!r) return res.status(404).json({ error: 'not_found' });
    // حتی با لینک امضاشده، بیننده باید مجاز باشد (حساب خصوصی/مخاطب استوری/بلاک)؛ ۴۰۴ تا وجودش لو نرود.
    if (!canSee(r.user_id, u)) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': r.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(dir, r.file), { dotfiles: 'deny' });
  });
}
