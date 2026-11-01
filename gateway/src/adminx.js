// پنل ادمین (بخش ۲): نمای کلی و هشدار ظرفیت، قفل ثبت‌نام، درخت دعوت، مشاهدهٔ محتوا و بن کامل.
import fs from 'node:fs';
import os from 'node:os';
import { getSchemaStatus } from './migrate.js';

const nowS = () => Math.floor(Date.now() / 1000);

export function mountAdminPlus(app, { db, requireAdmin, dataDir, ops, shape, displayName, settings, synapseAdmin, quotaBytes, dbPath }) {
  // ستون deactivated در migration 001 اضافه می‌شود.
  const uidOk = (u) => typeof u === 'string' && /^@[a-z0-9._=\-/]{1,80}:[A-Za-z0-9.\-:]{1,100}$/.test(u);

  // ---- کمک‌ها ----
  const usedBytes = (u) => db.prepare(`SELECT
    COALESCE((SELECT SUM(size) FROM posts WHERE user_id=@u),0) + COALESCE((SELECT SUM(size) FROM tracks WHERE user_id=@u),0)
    + COALESCE((SELECT SUM(size) FROM stories WHERE user_id=@u),0) AS b`).get({ u }).b;
  const inviterOf = (u) => db.prepare('SELECT i.owner o FROM registrations r JOIN invites i ON i.code=r.invite_code WHERE r.user_id=?').get(u)?.o || null;
  const descendants = (u) => db.prepare(`WITH RECURSIVE t(u) AS (
      SELECT r.user_id FROM registrations r JOIN invites i ON i.code=r.invite_code WHERE i.owner=@u
      UNION SELECT r.user_id FROM registrations r JOIN invites i ON i.code=r.invite_code JOIN t ON i.owner=t.u)
    SELECT u FROM t`).all({ u }).map((r) => r.u);

  async function banUser(uid, reason = 'admin', { deactivate = false } = {}) {
    let closed = false;
    if (deactivate) closed = await synapseAdmin.deactivate(uid);
    db.prepare('INSERT OR REPLACE INTO bans (user_id, reason, created_at, deactivated) VALUES (?,?,?,?)').run(uid, String(reason).slice(0, 200), nowS(), closed ? 1 : 0);
    return { banned: true, matrix_closed: closed };
  }
  ops.banUser = banUser;

  // «بن کامل»: بستن حساب + پاک‌کردن همهٔ محتوا + ابطال کدهای دعوتش (+ اختیاری: همهٔ دعوت‌شده‌ها)
  async function purge(uid, { cascade = false, deactivate = true } = {}) {
    const targets = [uid, ...(cascade ? descendants(uid) : [])];
    const out = { users: [], posts: 0, tracks: 0, comments: 0, stories: 0, matrix_closed: 0, matrix_failed: 0 };
    for (const t of targets) {
      db.prepare('UPDATE invites SET revoked=1 WHERE owner=?').run(t);
      const c = ops.wipeUser(t);
      const b = await banUser(t, t === uid ? 'purged' : `purged:branch of ${uid}`, { deactivate });
      out.posts += c.posts; out.tracks += c.tracks; out.comments += c.comments; out.stories += c.stories;
      if (deactivate) b.matrix_closed ? out.matrix_closed++ : out.matrix_failed++;
      out.users.push(t);
    }
    db.prepare("UPDATE reports SET status='closed', action='ban', handled_at=? WHERE status='open' AND target_user IN (" + targets.map(() => '?').join(',') + ')').run(nowS(), ...targets);
    return out;
  }

  // ---- نمای کلی ----
  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    const c = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    const t = ops.transcodeStats?.() || {};
    res.json({
      users: c('registrations'), posts: c('posts'), comments: c('comments'), tracks: c('tracks'), playlists: c('playlists'),
      stories: c('stories'), open_reports: db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get().c,
      feed_mb: Math.round(ops.dirSize(ops.feedDir) / 1048576), music_mb: Math.round(ops.dirSize(ops.musicDir) / 1048576),
      transcode_queued: t.queued || 0, transcode_failed: t.failed || 0,
    });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const c = (sql, ...a) => db.prepare(sql).get(...a).c;
    const t = nowS();
    let disk = null;
    try { const s = fs.statfsSync(dataDir); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; disk.used = disk.total - disk.free; } catch { /* قدیمی */ }
    let dbBytes = 0;
    try { for (const ext of ['', '-wal']) dbBytes += fs.statSync(dbPath + ext).size; } catch { /* هست */ }
    const media = { feed: ops.dirSize(ops.feedDir), music: ops.dirSize(ops.musicDir), stories: ops.dirSize(`${dataDir}/stories`), avatars: ops.dirSize(`${dataDir}/avatars`) };
    const days = [];
    const day0 = Math.floor(t / 86400) * 86400;
    for (let i = 13; i >= 0; i--) {
      const from = day0 - i * 86400;
      days.push({ day: from, signups: c('SELECT COUNT(*) c FROM registrations WHERE created_at>=? AND created_at<?', from, from + 86400), posts: c('SELECT COUNT(*) c FROM posts WHERE created_at>=? AND created_at<?', from, from + 86400) });
    }
    const users = c('SELECT COUNT(*) c FROM registrations');
    const s = settings.all();
    const alerts = [];
    if (disk) {
      const pct = disk.used / disk.total;
      if (pct >= 0.9) alerts.push({ level: 'crit', code: 'disk', value: Math.round(pct * 100) });
      else if (pct >= 0.8) alerts.push({ level: 'warn', code: 'disk', value: Math.round(pct * 100) });
    }
    const memFree = os.freemem() / os.totalmem();
    if (memFree < 0.1) alerts.push({ level: 'warn', code: 'mem', value: Math.round((1 - memFree) * 100) });
    if (s.user_cap > 0 && users >= s.user_cap * 0.8) alerts.push({ level: users >= s.user_cap ? 'crit' : 'warn', code: 'user_cap', value: users });
    const last1h = c('SELECT COUNT(*) c FROM registrations WHERE created_at>?', t - 3600);
    if (last1h >= 8) alerts.push({ level: 'warn', code: 'signup_burst', value: last1h });
    const openReports = c("SELECT COUNT(*) c FROM reports WHERE status='open'");
    if (openReports) alerts.push({ level: 'info', code: 'reports', value: openReports });
    res.json({
      users, banned: c('SELECT COUNT(*) c FROM bans'), active_24h: c(`SELECT COUNT(DISTINCT u) c FROM (
        SELECT user_id u FROM posts WHERE created_at>@t UNION SELECT user_id FROM comments WHERE created_at>@t UNION SELECT user_id FROM post_seen WHERE at>@t)`, { t: t - 86400 }),
      posts: c('SELECT COUNT(*) c FROM posts'), comments: c('SELECT COUNT(*) c FROM comments'), tracks: c('SELECT COUNT(*) c FROM tracks'), stories: c('SELECT COUNT(*) c FROM stories'),
      open_reports: openReports, signups_24h: c('SELECT COUNT(*) c FROM registrations WHERE created_at>?', t - 86400), signups_1h: last1h,
      disk, db_bytes: dbBytes, media, quota_bytes: quotaBytes,
      schema: getSchemaStatus(db),
      system: { load1: os.loadavg()[0], cpus: os.cpus().length, mem_total: os.totalmem(), mem_free: os.freemem(), uptime: os.uptime() },
      days, alerts, registration: { ...settings.registration(), settings: s },
      top_users: db.prepare(`SELECT r.user_id,
        (COALESCE((SELECT SUM(size) FROM posts WHERE user_id=r.user_id),0)+COALESCE((SELECT SUM(size) FROM tracks WHERE user_id=r.user_id),0)+COALESCE((SELECT SUM(size) FROM stories WHERE user_id=r.user_id),0)) AS bytes
        FROM registrations r ORDER BY bytes DESC LIMIT 5`).all(),
    });
  });

  // ---- تنظیمات و قفل ثبت‌نام ----
  app.get('/api/admin/settings', requireAdmin, (_req, res) => res.json({ ...settings.all(), status: settings.registration() }));
  app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const b = req.body || {};
    const int = (v, max) => Math.min(Math.max(parseInt(v, 10) || 0, 0), max);
    if ('registration_open' in b) settings.set('registration_open', b.registration_open ? 1 : 0);
    if ('user_cap' in b) settings.set('user_cap', int(b.user_cap, 1_000_000));
    if ('daily_cap' in b) settings.set('daily_cap', int(b.daily_cap, 100_000));
    if ('user_invite_quota' in b) settings.set('user_invite_quota', int(b.user_invite_quota, 50));
    if ('closed_message' in b) settings.set('closed_message', String(b.closed_message || '').slice(0, 200));
    res.json({ ...settings.all(), status: settings.registration() });
  });

  // ---- کاربران ----
  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    const quota = quotaBytes;
    const rows = db.prepare(`SELECT r.user_id, r.invite_code, r.created_at, i.owner AS inviter,
        (SELECT name_lc FROM name_index WHERE user_id=r.user_id) AS name,
        MAX(r.created_at,
          COALESCE((SELECT MAX(created_at) FROM posts WHERE user_id=r.user_id),0),
          COALESCE((SELECT MAX(created_at) FROM comments WHERE user_id=r.user_id),0),
          COALESCE((SELECT MAX(created_at) FROM tracks WHERE user_id=r.user_id),0),
          COALESCE((SELECT MAX(created_at) FROM stories WHERE user_id=r.user_id),0),
          COALESCE((SELECT MAX(at) FROM post_views WHERE user_id=r.user_id),0),
          COALESCE((SELECT MAX(at) FROM post_seen WHERE user_id=r.user_id),0)) AS last_active,
        (SELECT COUNT(*) FROM posts WHERE user_id=r.user_id) AS posts,
        (SELECT COUNT(*) FROM tracks WHERE user_id=r.user_id) AS tracks,
        (SELECT COUNT(*) FROM comments WHERE user_id=r.user_id) AS comments,
        (COALESCE((SELECT SUM(size) FROM posts WHERE user_id=r.user_id),0) + COALESCE((SELECT SUM(size) FROM tracks WHERE user_id=r.user_id),0)
          + COALESCE((SELECT SUM(size) FROM stories WHERE user_id=r.user_id),0)) AS bytes,
        (SELECT COUNT(*) FROM registrations r2 JOIN invites i2 ON i2.code=r2.invite_code WHERE i2.owner=r.user_id) AS invited,
        EXISTS(SELECT 1 FROM bans b WHERE b.user_id=r.user_id) AS banned,
        (SELECT COUNT(*) FROM reports WHERE target_user=r.user_id AND status='open') AS open_reports
        FROM registrations r LEFT JOIN invites i ON i.code=r.invite_code ORDER BY r.created_at DESC LIMIT 5000`).all();
    res.json({ quota_bytes: quota, users: rows });
  });

  app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const uid = req.params.id;
    const reg = db.prepare('SELECT * FROM registrations WHERE user_id=?').get(uid);
    if (!reg) return res.status(404).json({ error: 'not_found' });
    const chain = []; // از بالا به پایین: چه کسی او را آورد، و چه کسی آن‌ها را
    for (let u = inviterOf(uid), n = 0; u && n < 12; u = inviterOf(u), n++) chain.push(u);
    const invitees = db.prepare(`SELECT r.user_id, r.created_at, r.invite_code, EXISTS(SELECT 1 FROM bans b WHERE b.user_id=r.user_id) AS banned
      FROM registrations r JOIN invites i ON i.code=r.invite_code WHERE i.owner=? ORDER BY r.created_at DESC`).all(uid);
    const posts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 12').all(uid);
    res.json({
      user_id: uid, name: await displayName(uid), joined: reg.created_at, invite_code: reg.invite_code,
      bio: db.prepare('SELECT bio FROM profiles WHERE user_id=?').get(uid)?.bio || '',
      ban: db.prepare('SELECT * FROM bans WHERE user_id=?').get(uid) || null,
      bytes: usedBytes(uid), quota_bytes: quotaBytes,
      counts: {
        posts: db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id=?').get(uid).c, tracks: db.prepare('SELECT COUNT(*) c FROM tracks WHERE user_id=?').get(uid).c,
        comments: db.prepare('SELECT COUNT(*) c FROM comments WHERE user_id=?').get(uid).c, stories: db.prepare('SELECT COUNT(*) c FROM stories WHERE user_id=?').get(uid).c,
        followers: db.prepare("SELECT COUNT(*) c FROM follows WHERE followee=? AND status='accepted'").get(uid).c,
      },
      inviter_chain: chain, invitees, descendants: descendants(uid).length,
      codes: db.prepare('SELECT code,max_uses,uses,expires_at,revoked,created_at FROM invites WHERE owner=? ORDER BY created_at DESC').all(uid),
      reports: db.prepare('SELECT id,kind,reason,note,status,created_at FROM reports WHERE target_user=? ORDER BY created_at DESC LIMIT 20').all(uid),
      posts: await shape(posts, 'admin'),
    });
  });

  app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
    if (!uidOk(req.params.id)) return res.status(400).json({ error: 'bad_user' });
    res.json({ ok: true, ...(await banUser(req.params.id, String(req.body?.reason || 'admin'), { deactivate: !!req.body?.deactivate })) });
  });
  app.delete('/api/admin/users/:id/ban', requireAdmin, (req, res) => {
    const b = db.prepare('SELECT deactivated FROM bans WHERE user_id=?').get(req.params.id);
    const ok = db.prepare('DELETE FROM bans WHERE user_id=?').run(req.params.id).changes > 0;
    res.json({ ok, matrix_still_closed: !!b?.deactivated });
  });
  app.post('/api/admin/users/:id/purge', requireAdmin, async (req, res) => {
    if (!uidOk(req.params.id) || !db.prepare('SELECT 1 FROM registrations WHERE user_id=?').get(req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, ...(await purge(req.params.id, { cascade: !!req.body?.cascade, deactivate: req.body?.deactivate !== false })) });
  });

  // ---- دیدن محتوا ----
  app.get('/api/admin/moderation/posts', requireAdmin, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 36, 1), 100);
    const where = []; const args = [];
    if (req.query.user) { const u = String(req.query.user).replace(/^@/, ''); if (u.includes(':')) { where.push('user_id=?'); args.push(`@${u}`); } else { where.push('user_id LIKE ?'); args.push(`@${u.replace(/[%_\\]/g, '')}:%`); } }
    if (req.query.kind === 'video') where.push("mime LIKE 'video/%'");
    if (req.query.kind === 'image') where.push("mime LIKE 'image/%'");
    if (req.query.new === '1') where.push('user_id IN (SELECT user_id FROM registrations WHERE created_at > ?)'), args.push(nowS() - 3 * 86400);
    if (req.query.reported === '1') where.push("id IN (SELECT ref_id FROM reports WHERE kind='post' AND status='open')");
    if (req.query.q) { where.push('caption LIKE ?'); args.push(`%${String(req.query.q).slice(0, 60).replace(/[%_]/g, '')}%`); }
    const before = Number(req.query.before) || 0;
    if (before) { where.push('created_at < ?'); args.push(before); }
    const order = req.query.sort === 'popular' ? '(SELECT COUNT(*) FROM likes l WHERE l.post_id=posts.id) DESC, created_at DESC' : 'created_at DESC';
    const rows = db.prepare(`SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`).all(...args, limit);
    const shaped = await shape(rows, 'admin');
    const isBanned = db.prepare('SELECT 1 FROM bans WHERE user_id=?');
    const joined = db.prepare('SELECT created_at FROM registrations WHERE user_id=?');
    res.json({
      posts: shaped.map((p) => ({
        ...p, owner_banned: !!isBanned.get(p.user_id), owner_joined: joined.get(p.user_id)?.created_at || 0,
        reports: db.prepare("SELECT COUNT(*) c FROM reports WHERE kind='post' AND ref_id=? AND status='open'").get(p.id).c,
        inviter: inviterOf(p.user_id),
      })),
      next: rows.length === limit && req.query.sort !== 'popular' ? rows[rows.length - 1].created_at : null,
    });
  });
  app.post('/api/admin/posts/bulk-delete', requireAdmin, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200).map(String) : [];
    res.json({ deleted: ids.filter((id) => ops.delPost(id)).length });
  });
  app.get('/api/admin/moderation/comments', requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
    res.json({ comments: db.prepare(`SELECT c.id,c.post_id,c.user_id,c.text,c.created_at,
      EXISTS(SELECT 1 FROM bans b WHERE b.user_id=c.user_id) AS owner_banned FROM comments c ORDER BY c.id DESC LIMIT ?`).all(limit) });
  });
  app.delete('/api/admin/comments/:id', requireAdmin, (req, res) => (ops.delComment(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' })));

  // ---- درخت دعوت ----
  app.get('/api/admin/invites/tree', requireAdmin, (_req, res) => {
    const nodes = db.prepare(`SELECT r.user_id, r.created_at, i.owner AS inviter, i.code,
      EXISTS(SELECT 1 FROM bans b WHERE b.user_id=r.user_id) AS banned FROM registrations r LEFT JOIN invites i ON i.code=r.invite_code`).all();
    res.json({ nodes });
  });
  return { purge, banUser };
}
