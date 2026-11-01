// موزیک: آهنگ‌ها (آپلود شخصی) و پلی‌لیست‌های شخصی/عمومی.
// پلی‌لیست خصوصی فقط برای صاحبش است؛ عمومی برای همه کاربران واردشده.
import { sniffOk, sniffBuf } from './sniff.js';
import { stripImageBuf } from './strip.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import rateLimit from 'express-rate-limit';

const TYPES = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
  'audio/x-flac': 'flac', 'audio/webm': 'webm',
};

export function mountMusic(app, { db, auth, displayName, secret, dataDir, maxMb = 60, quotaOk = () => true, uploadAllowed = () => true }) {
  const dir = path.join(dataDir, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const MAX = maxMb * 1024 * 1024;
  const now = () => Math.floor(Date.now() / 1000);
  const key = crypto.createHash('sha256').update(`music:${secret}`).digest();

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id)
    );
  `);

  db.exec(`CREATE TABLE IF NOT EXISTS shares (
    code TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, owner TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  // ستون‌های cover/hash در migration 001 اضافه می‌شوند.
  const coverDir = path.join(dataDir, 'covers');
  fs.mkdirSync(coverDir, { recursive: true });
  const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  const sign = (id, uid, exp) => crypto.createHmac('sha256', key).update(`${id}|${uid}|${exp}`).digest('base64url');
  const SIGLEN = sign('x', 'x', 0).length;
  const mediaUrl = (id, uid) => {
    const exp = now() + 6 * 3600;
    return `/api/music/media/${id}?u=${encodeURIComponent(uid)}&e=${exp}&s=${sign(id, uid, exp)}`;
  };
  const limiter = rateLimit({
    windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip,
  });
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip,
  });

  const coverUrl = (t, me) => {
    if (!t.cover_file) return null;
    const exp = now() + 6 * 3600;
    return `/api/music/cover/${t.id}?u=${encodeURIComponent(me)}&e=${exp}&s=${sign(`c${t.id}`, me, exp)}`;
  };
  const trackShape = async (t, me) => ({
    cover: coverUrl(t, me),
    id: t.id, user_id: t.user_id, owner: await displayName(t.user_id), title: t.title, artist: t.artist,
    mime: t.mime, size: t.size, url: mediaUrl(t.id, me), mine: t.user_id === me,
  });
  const canSee = (pl, me) => pl && (pl.is_public || pl.user_id === me);
  const canUseTrack = (t, me) => t && (t.user_id === me || db.prepare(
    `SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE pt.track_id = ? AND p.is_public = 1`,
  ).get(t.id));
  const cleanName = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

  // ---- آهنگ ----
  app.post('/api/music/tracks', auth, uploadLimiter, (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > MAX) return res.status(413).json({ error: 'too_large', max_mb: maxMb });
    if (!uploadAllowed(req.userId, 'music', 0)) return res.status(403).json({ error: 'upload_disabled', kind: 'music' });
    if (!quotaOk(req.userId, len)) return res.status(413).json({ error: 'quota_exceeded' });
    const dec = (h) => { try { return decodeURIComponent(String(req.headers[h] || '')); } catch { return ''; } };
    const title = cleanName(dec('x-title'), 120) || 'بدون نام';
    const artist = cleanName(dec('x-artist'), 120);
    const id = crypto.randomBytes(9).toString('base64url');
    const file = `${id}.${ext}`;
    const full = path.join(dir, file);
    const out = fs.createWriteStream(full);
    const hasher = crypto.createHash('sha256');
    let got = 0; let failed = false;
    const fail = (code, status) => {
      if (failed) return;
      failed = true; out.destroy(); fs.rm(full, { force: true }, () => {});
      if (!res.headersSent) res.status(status).json({ error: code });
    };
    req.on('data', (c) => { got += c.length; hasher.update(c); if (got > MAX) { fail('too_large', 413); req.destroy(); } });
    req.on('aborted', () => fail('aborted', 400));
    req.on('error', () => fail('aborted', 400));
    out.on('error', () => fail('write_failed', 500));
    out.on('finish', async () => {
      if (failed) return;
      if (got !== len) return fail('incomplete', 400);
      if (!sniffOk(full, mime)) return fail('bad_content', 415);
      const hash = hasher.digest('hex');
      // Q4: the same user uploading the same file again gets their existing track back (no duplicate row).
      const own = db.prepare('SELECT * FROM tracks WHERE hash=? AND user_id=? AND file IS NOT NULL LIMIT 1').get(hash, req.userId);
      if (own) {
        fs.rm(full, { force: true }, () => {});
        return res.status(200).json({ ...(await trackShape(own, req.userId)), existing: true });
      }
      const dup = db.prepare('SELECT file, mime FROM tracks WHERE hash=? AND file IS NOT NULL LIMIT 1').get(hash);
      let storedFile = file;
      let storedMime = mime;
      if (dup) {
        // فایل تازه را دور بریز و به همان فایل قبلی اشاره کن
        fs.rm(full, { force: true }, () => {});
        storedFile = dup.file;
        storedMime = dup.mime;
      }
      db.prepare('INSERT INTO tracks (id,user_id,title,artist,mime,file,size,created_at,hash) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, req.userId, title, artist, storedMime, storedFile, got, now(), hash);
      res.status(201).json(await trackShape(db.prepare('SELECT * FROM tracks WHERE id=?').get(id), req.userId));
    });
    req.pipe(out);
  });

  // Q4: each of my tracks carries the list of MY playlists that contain it (one join, no N+1).
  const myTracks = async (req, res) => {
    const rows = db.prepare('SELECT * FROM tracks WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 500').all(req.userId);
    const memb = db.prepare(`SELECT pt.track_id AS tid, p.id AS id, p.name AS name FROM playlist_tracks pt
      JOIN playlists p ON p.id = pt.playlist_id
      WHERE p.user_id = ? AND pt.track_id IN (SELECT id FROM tracks WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 500)
      ORDER BY pt.pos ASC`).all(req.userId, req.userId);
    const by = new Map();
    for (const m of memb) { if (!by.has(m.tid)) by.set(m.tid, []); by.get(m.tid).push({ id: m.id, name: m.name }); }
    res.json({ tracks: await Promise.all(rows.map(async (t) => ({ ...(await trackShape(t, req.userId)), playlists: by.get(t.id) || [] }))) });
  };
  app.get('/api/music/tracks', auth, limiter, myTracks);
  app.get('/api/music/tracks/mine', auth, limiter, myTracks);

  // which of MY playlists contain this track (any visible track, e.g. one shared in a chat)
  app.get('/api/music/tracks/:id/playlists', auth, limiter, (req, res) => {
    const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(req.params.id);
    if (!canUseTrack(t, req.userId)) return res.status(404).json({ error: 'not_found' });
    const rows = db.prepare(`SELECT p.id, p.name FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
      WHERE pt.track_id = ? AND p.user_id = ?`).all(t.id, req.userId);
    res.json({ playlists: rows });
  });

  app.delete('/api/music/tracks/:id', auth, limiter, (req, res) => {
    const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if (t.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(t.id);
    db.prepare("DELETE FROM shares WHERE kind='track' AND ref_id=?").run(t.id);
    db.prepare('DELETE FROM tracks WHERE id=?').run(t.id);
    const refs = db.prepare('SELECT COUNT(*) c FROM tracks WHERE file=?').get(t.file).c;
    if (!refs) fs.rm(path.join(dir, t.file), { force: true }, () => {});
    if (t.cover_file) fs.rm(path.join(coverDir, t.cover_file), { force: true }, () => {});
    res.json({ ok: true });
  });

  // ---- کاور آهنگ (عکس کوچک؛ از داخل فایل آهنگ در مرورگر استخراج و فرستاده می‌شود) ----
  app.put('/api/music/tracks/:id/cover', auth, limiter, (req, res) => {
    const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if (t.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = IMG[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_type' });
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return res.status(411).json({ error: 'length_required' });
    if (len > 2 * 1024 * 1024) return res.status(413).json({ error: 'too_large', max_mb: 2 });
    const chunks = []; let got = 0; let dead = false;
    req.on('data', (c) => { got += c.length; if (got > len) { dead = true; req.destroy(); } else chunks.push(c); });
    req.on('error', () => { dead = true; });
    req.on('end', async () => {
      if (dead || got !== len) return res.status(400).json({ error: 'incomplete' });
      if (!sniffBuf(Buffer.concat(chunks), mime)) return res.status(415).json({ error: 'bad_content' });
      const file = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
      fs.writeFileSync(path.join(coverDir, file), stripImageBuf(Buffer.concat(chunks), mime));
      if (t.cover_file) fs.rmSync(path.join(coverDir, t.cover_file), { force: true });
      db.prepare('UPDATE tracks SET cover_file=?, cover_mime=? WHERE id=?').run(file, mime, t.id);
      res.json(await trackShape(db.prepare('SELECT * FROM tracks WHERE id=?').get(t.id), req.userId));
    });
  });

  app.get('/api/music/cover/:id', (req, res) => {
    const { u, e, s } = req.query;
    const exp = Number(e);
    const good = typeof s === 'string' && typeof u === 'string' && exp > now() && Buffer.byteLength(s) === SIGLEN
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(`c${req.params.id}`, u, exp)));
    if (!good) return res.status(403).json({ error: 'forbidden' });
    const t = db.prepare('SELECT cover_file, cover_mime FROM tracks WHERE id=?').get(req.params.id);
    if (!t?.cover_file) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': t.cover_mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400',
      'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(coverDir, t.cover_file), { dotfiles: 'deny' });
  });

  // ---- پلی‌لیست ----
  const plShape = async (p, me) => ({
    covers: db.prepare(`SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ? AND t.cover_file IS NOT NULL ORDER BY pt.pos ASC LIMIT 4`).all(p.id).map((t) => coverUrl(t, me)),
    id: p.id, name: p.name, is_public: !!p.is_public, user_id: p.user_id, owner: await displayName(p.user_id),
    count: db.prepare('SELECT COUNT(*) c FROM playlist_tracks WHERE playlist_id=?').get(p.id).c,
  });

  app.post('/api/music/playlists', auth, limiter, async (req, res) => {
    const name = cleanName(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: 'missing_fields' });
    if (db.prepare('SELECT COUNT(*) c FROM playlists WHERE user_id=?').get(req.userId).c >= 100) return res.status(429).json({ error: 'too_many' });
    const id = crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO playlists (id,user_id,name,is_public,created_at) VALUES (?,?,?,?,?)').run(id, req.userId, name, req.body?.is_public ? 1 : 0, now());
    res.status(201).json(await plShape(db.prepare('SELECT * FROM playlists WHERE id=?').get(id), req.userId));
  });

  app.get('/api/music/playlists', auth, limiter, async (req, res) => {
    const pub = req.query.scope === 'public';
    const rows = pub
      ? db.prepare('SELECT * FROM playlists WHERE is_public=1 ORDER BY created_at DESC LIMIT 200').all()
      : db.prepare('SELECT * FROM playlists WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(req.userId);
    res.json({ playlists: await Promise.all(rows.map((r) => plShape(r, req.userId))) });
  });

  app.get('/api/music/playlists/:id', auth, limiter, async (req, res) => {
    const p = db.prepare('SELECT * FROM playlists WHERE id=?').get(req.params.id);
    if (!canSee(p, req.userId)) return res.status(404).json({ error: 'not_found' }); // وجود پلی‌لیست خصوصی را هم لو نمی‌دهیم
    const rows = db.prepare(`SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ? ORDER BY pt.pos ASC`).all(p.id);
    res.json({ playlist: await plShape(p, req.userId), tracks: await Promise.all(rows.map((t) => trackShape(t, req.userId))) });
  });

  const owned = (req, res) => {
    const p = db.prepare('SELECT * FROM playlists WHERE id=?').get(req.params.id);
    if (!canSee(p, req.userId)) { res.status(404).json({ error: 'not_found' }); return null; }
    if (p.user_id !== req.userId) { res.status(403).json({ error: 'forbidden' }); return null; }
    return p;
  };

  app.patch('/api/music/playlists/:id', auth, limiter, async (req, res) => {
    const p = owned(req, res); if (!p) return;
    const name = req.body?.name !== undefined ? cleanName(req.body.name, 80) : p.name;
    if (!name) return res.status(400).json({ error: 'missing_fields' });
    const pub = req.body?.is_public !== undefined ? (req.body.is_public ? 1 : 0) : p.is_public;
    db.prepare('UPDATE playlists SET name=?, is_public=? WHERE id=?').run(name, pub, p.id);
    res.json(await plShape(db.prepare('SELECT * FROM playlists WHERE id=?').get(p.id), req.userId));
  });

  app.delete('/api/music/playlists/:id', auth, limiter, (req, res) => {
    const p = owned(req, res); if (!p) return;
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').run(p.id);
    db.prepare('DELETE FROM playlists WHERE id=?').run(p.id);
    res.json({ ok: true });
  });

  app.post('/api/music/playlists/:id/tracks', auth, limiter, (req, res) => {
    const p = owned(req, res); if (!p) return;
    const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(String(req.body?.track_id || ''));
    if (!canUseTrack(t, req.userId)) return res.status(404).json({ error: 'not_found' });
    const pos = (db.prepare('SELECT COALESCE(MAX(pos),0) m FROM playlist_tracks WHERE playlist_id=?').get(p.id).m) + 1;
    db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,pos) VALUES (?,?,?)').run(p.id, t.id, pos);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/music/playlists/:id/tracks/:track', auth, limiter, (req, res) => {
    const p = owned(req, res); if (!p) return;
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?').run(p.id, req.params.track);
    res.json({ ok: true });
  });

  // ---- اشتراک‌گذاری در چت: یک کد تصادفی؛ هر کاربر واردشده‌ای که کد را در پیام ببیند می‌تواند گوش بدهد ----
  app.post('/api/music/share', auth, limiter, (req, res) => {
    const kind = req.body?.kind; const id = String(req.body?.id || '');
    if (kind === 'track') {
      if (!canUseTrack(db.prepare('SELECT * FROM tracks WHERE id=?').get(id), req.userId)) return res.status(404).json({ error: 'not_found' });
    } else if (kind === 'playlist') {
      if (!canSee(db.prepare('SELECT * FROM playlists WHERE id=?').get(id), req.userId)) return res.status(404).json({ error: 'not_found' });
    } else return res.status(400).json({ error: 'bad_kind' });
    const old = db.prepare('SELECT code FROM shares WHERE kind=? AND ref_id=? AND owner=?').get(kind, id, req.userId);
    if (old) return res.json({ code: old.code });
    const code = crypto.randomBytes(12).toString('base64url');
    db.prepare('INSERT INTO shares (code,kind,ref_id,owner,created_at) VALUES (?,?,?,?,?)').run(code, kind, id, req.userId, now());
    res.status(201).json({ code });
  });

  app.get('/api/music/share/:code', auth, limiter, async (req, res) => {
    const sh = db.prepare('SELECT * FROM shares WHERE code=?').get(String(req.params.code).slice(0, 40));
    if (!sh) return res.status(404).json({ error: 'not_found' });
    if (sh.kind === 'track') {
      const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(sh.ref_id);
      // کد اشتراک فقط تا وقتی معتبر است که فرستنده هنوز به آهنگ دسترسی داشته باشد (لغو دسترسی = لغو لینک)
      if (!t || !canUseTrack(t, sh.owner)) return res.status(404).json({ error: 'not_found' });
      return res.json({ kind: 'track', track: await trackShape(t, req.userId) });
    }
    const p = db.prepare('SELECT * FROM playlists WHERE id=?').get(sh.ref_id);
    if (!p || !canSee(p, sh.owner)) return res.status(404).json({ error: 'not_found' });
    const rows = db.prepare(`SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.pos ASC`).all(p.id)
      .filter((t) => canUseTrack(t, sh.owner));
    res.json({ kind: 'playlist', playlist: await plShape(p, req.userId), tracks: await Promise.all(rows.map((t) => trackShape(t, req.userId))) });
  });

  // ---- پخش (لینک امضادار برای تگ audio) ----
  app.get('/api/music/media/:id', (req, res) => {
    const { u, e, s } = req.query;
    const exp = Number(e);
    const good = typeof s === 'string' && typeof u === 'string' && exp > now() && Buffer.byteLength(s) === SIGLEN
      && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(req.params.id, u, exp)));
    if (!good) return res.status(403).json({ error: 'forbidden' });
    const t = db.prepare('SELECT file, mime FROM tracks WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': t.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox" });
    res.sendFile(path.join(dir, t.file), { dotfiles: 'deny' });
  });
}
