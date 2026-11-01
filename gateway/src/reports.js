// گزارش محتوا/کاربر توسط کاربران + صف رسیدگی برای ادمین.
import rateLimit from 'express-rate-limit';

const KINDS = ['post', 'comment', 'user', 'story', 'track'];
const REASONS = ['spam', 'abuse', 'nudity', 'violence', 'other'];

export function mountReports(app, { db, auth, requireAdmin, shape, ops }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, target_user TEXT NOT NULL,
      reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', action TEXT, created_at INTEGER NOT NULL, handled_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(reporter, kind, ref_id);
    CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const limiter = rateLimit({
    windowMs: 3600_000, limit: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
    message: { error: 'rate_limited' },
  });

  // مالک هدف را پیدا می‌کند (null اگر وجود ندارد)
  function targetOwner(kind, id) {
    if (kind === 'post') return db.prepare('SELECT user_id u FROM posts WHERE id=?').get(id)?.u;
    if (kind === 'comment') return db.prepare('SELECT user_id u FROM comments WHERE id=?').get(Number(id))?.u;
    if (kind === 'story') return db.prepare('SELECT user_id u FROM stories WHERE id=?').get(id)?.u;
    if (kind === 'track') return db.prepare('SELECT user_id u FROM tracks WHERE id=?').get(id)?.u;
    if (kind === 'user') return db.prepare('SELECT user_id u FROM registrations WHERE user_id=?').get(id)?.u;
    return null;
  }

  app.post('/api/reports', auth, limiter, (req, res) => {
    const kind = String(req.body?.kind || '');
    const id = String(req.body?.id || '').slice(0, 200);
    const reason = REASONS.includes(req.body?.reason) ? req.body.reason : 'other';
    const note = String(req.body?.note || '').trim().slice(0, 300);
    if (!KINDS.includes(kind) || !id) return res.status(400).json({ error: 'bad_request' });
    const owner = targetOwner(kind, id);
    if (!owner) return res.status(404).json({ error: 'not_found' });
    if (owner === req.userId) return res.status(400).json({ error: 'self' });
    const r = db.prepare(`INSERT OR IGNORE INTO reports (reporter,kind,ref_id,target_user,reason,note,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(req.userId, kind, id, owner, reason, note, now());
    res.status(r.changes ? 201 : 200).json({ ok: true, duplicate: !r.changes });
  });

  // ---- ادمین ----
  async function enrich(row) {
    const out = { ...row, reports_for_target: db.prepare('SELECT COUNT(DISTINCT reporter) c FROM reports WHERE kind=? AND ref_id=?').get(row.kind, row.ref_id).c };
    if (row.kind === 'post') {
      const p = db.prepare('SELECT * FROM posts WHERE id=?').get(row.ref_id);
      if (p) { const [s] = await shape([p], 'admin'); out.preview = { caption: p.caption, kind: s.kind, url: s.url, thumb: s.thumb }; }
    } else if (row.kind === 'comment') {
      out.preview = { text: db.prepare('SELECT text FROM comments WHERE id=?').get(Number(row.ref_id))?.text };
    } else if (row.kind === 'track') {
      const t = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(row.ref_id);
      if (t) out.preview = { title: t.title, artist: t.artist };
    } else if (row.kind === 'story') {
      out.preview = { caption: db.prepare('SELECT caption FROM stories WHERE id=?').get(row.ref_id)?.caption };
    }
    out.gone = row.kind !== 'user' && !out.preview;
    out.banned = !!db.prepare('SELECT 1 FROM bans WHERE user_id=?').get(row.target_user);
    return out;
  }

  app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    const status = req.query.status === 'closed' ? 'closed' : 'open';
    const rows = db.prepare('SELECT * FROM reports WHERE status=? ORDER BY created_at DESC LIMIT 100').all(status);
    res.json({
      open_total: db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get().c,
      reports: await Promise.all(rows.map(enrich)),
    });
  });

  // action: dismiss | remove | ban  (remove = حذف محتوا، ban = حذف محتوا + مسدودکردن صاحبش)
  app.post('/api/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
    const row = db.prepare('SELECT * FROM reports WHERE id=?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    const action = ['dismiss', 'remove', 'ban'].includes(req.body?.action) ? req.body.action : null;
    if (!action) return res.status(400).json({ error: 'bad_action' });
    if (action !== 'dismiss') {
      if (row.kind === 'post') ops.delPost(row.ref_id);
      else if (row.kind === 'track') ops.delTrack(row.ref_id);
      else if (row.kind === 'comment') ops.delComment(row.ref_id);
      else if (row.kind === 'story') ops.delStory(row.ref_id);
    }
    if (action === 'ban') {
      await ops.banUser(row.target_user, `report:${row.reason}`, { deactivate: true });
    }
    // همهٔ گزارش‌های باز همان هدف (یا همان کاربر در حالت ban) بسته می‌شوند
    const t = now();
    if (action === 'ban') {
      db.prepare("UPDATE reports SET status='closed', action=?, handled_at=? WHERE status='open' AND target_user=?").run(action, t, row.target_user);
    } else {
      db.prepare("UPDATE reports SET status='closed', action=?, handled_at=? WHERE status='open' AND kind=? AND ref_id=?").run(action, t, row.kind, row.ref_id);
    }
    res.json({ ok: true, action });
  });
}
