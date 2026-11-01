// بلاک‌کردن کاربر: محتوایش از فید/پروفایل/جستجو پنهان می‌شود و ارتباط دنبال‌کردن قطع می‌شود.
import rateLimit from 'express-rate-limit';

export function mountBlocks(app, { db, auth, displayName }) {
  const now = () => Math.floor(Date.now() / 1000);
  const limiter = rateLimit({
    windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });
  const list = db.prepare('SELECT blocked, created_at FROM blocks WHERE blocker=? ORDER BY created_at DESC LIMIT 200');

  app.get('/api/blocks', auth, limiter, async (req, res) => {
    const rows = list.all(req.userId);
    res.json({
      blocks: await Promise.all(rows.map(async (r) => ({
        user_id: r.blocked, name: await displayName(r.blocked), created_at: r.created_at,
      }))),
    });
  });

  app.post('/api/blocks/:id', auth, limiter, (req, res) => {
    const target = req.params.id;
    if (target === req.userId) return res.status(400).json({ error: 'self' });
    if (!db.prepare('SELECT 1 FROM registrations WHERE user_id=?').get(target)) {
      return res.status(404).json({ error: 'not_found' });
    }
    db.prepare('INSERT OR IGNORE INTO blocks (blocker,blocked,created_at) VALUES (?,?,?)').run(req.userId, target, now());
    // دنبال‌کردن دوطرفه قطع می‌شود
    db.prepare('DELETE FROM follows WHERE (follower=? AND followee=?) OR (follower=? AND followee=?)')
      .run(req.userId, target, target, req.userId);
    res.json({ blocked: true });
  });

  app.delete('/api/blocks/:id', auth, limiter, (req, res) => {
    const r = db.prepare('DELETE FROM blocks WHERE blocker=? AND blocked=?').run(req.userId, req.params.id);
    res.json({ unblocked: r.changes > 0 });
  });
}
