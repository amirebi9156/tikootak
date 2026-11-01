// اعلان‌ها: لایک، نظر، لایک نظر و دنبال کردن. هر اعلان به صاحبش تعلق دارد و فقط خودش می‌بیند.
// جدول را قبل از mount بقیه ماژول‌ها می‌سازیم تا feed/profiles بتوانند اعلان ثبت کنند.
import rateLimit from 'express-rate-limit';

export function createNotifier(db) {
  const now = () => Math.floor(Date.now() / 1000);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
      ref_id TEXT, extra TEXT, read_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS notif_unread ON notifications(user_id, read_at);
  `);

  const insert = db.prepare(
    `INSERT INTO notifications (user_id, kind, actor, ref_id, extra, created_at) VALUES (?,?,?,?,?,?)`,
  );

  // اعلان تکراری (مثلاً لایک/آن‌لایک پشت‌سرهم) در یک ساعت اخیر ثبت نمی‌شود
  function notify({ to, kind, actor, refId = null, extra = null }) {
    try {
      if (!to || !actor || to === actor) return;
      const dupe = db.prepare(
        `SELECT 1 FROM notifications
         WHERE user_id=? AND actor=? AND kind=? AND ref_id IS ? AND created_at > ? LIMIT 1`,
      ).get(to, actor, kind, refId, now() - 3600);
      if (dupe) return;
      insert.run(to, kind, actor, refId, extra ? JSON.stringify(extra).slice(0, 500) : null, now());
    } catch { /* اعلان نباید مسیر اصلی را بشکند */ }
  }

  const removeForPost = (postId) => {
    try {
      db.prepare(
        `DELETE FROM notifications WHERE kind IN ('like','comment','comment_like') AND ref_id=?`,
      ).run(String(postId));
    } catch { /* ignore */ }
  };

  const countUnread = (uid) =>
    db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid).c;

  return { notify, removeForPost, countUnread };
}

export function mountNotifications(app, { db, auth, displayName }) {
  const limiter = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });
  const unread = (uid) =>
    db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid).c;
  const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

  async function shape(rows) {
    const actors = [...new Set(rows.map((r) => r.actor))];
    const names = new Map(await Promise.all(actors.map(async (a) => [a, await displayName(a)])));
    return rows.map((r) => ({
      id: r.id, kind: r.kind, actor: r.actor, actor_name: names.get(r.actor) || r.actor,
      ref_id: r.ref_id, extra: parse(r.extra), read: !!r.read_at, created_at: r.created_at,
    }));
  }

  // فهرست اعلان‌ها، جدید به قدیم. cursor همان id است تا صفحه‌بندی دقیق باشد.
  app.get('/api/notifications', auth, limiter, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
    const before = Number(req.query.before) || 0;
    const rows = before
      ? db.prepare('SELECT * FROM notifications WHERE user_id=? AND id<? ORDER BY id DESC LIMIT ?').all(req.userId, before, limit)
      : db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?').all(req.userId, limit);
    res.json({ notifications: await shape(rows), unread: unread(req.userId) });
  });

  app.get('/api/notifications/unread', auth, limiter, (req, res) => {
    res.set('cache-control', 'no-store');
    res.json({ unread: unread(req.userId) });
  });

  // خوانده‌شدن: یا ids مشخص، یا all
  app.post('/api/notifications/read', auth, limiter, (req, res) => {
    const t = Math.floor(Date.now() / 1000);
    if (req.body?.all) {
      db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(t, req.userId);
    } else {
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.slice(0, 200).map(Number).filter(Number.isFinite)
        : [];
      if (!ids.length) return res.status(400).json({ error: 'missing_fields' });
      const stmt = db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL');
      db.transaction(() => ids.forEach((id) => stmt.run(t, id, req.userId)))();
    }
    res.json({ ok: true, unread: unread(req.userId) });
  });

  app.delete('/api/notifications', auth, limiter, (req, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id=?').run(req.userId);
    res.json({ ok: true, unread: 0 });
  });
}
