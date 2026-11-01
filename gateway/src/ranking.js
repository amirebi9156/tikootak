// فید «برای تو»: امتیازدهی ساده روی سیگنال‌های موجود + تنوع و کشف.
// هیچ سرویس بیرونی لازم نیست؛ همه‌چیز روی SQLite همین سرور است.
import rateLimit from 'express-rate-limit';
import { tagsOf } from './interests.js';

export function mountRanking(app, { db, privacy, auth, shape, interests, displayName }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_views (
      post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      pct REAL NOT NULL DEFAULT 0, watched_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS post_seen (
      post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS post_seen_user ON post_seen(user_id, at);
    CREATE TABLE IF NOT EXISTS post_hidden (
      post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS post_shares (
      post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
    );
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const limiter = rateLimit({
    windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });

  // ---- رویدادهای تماشا (دسته‌ای از سمت کلاینت) ----
  const upsertView = db.prepare(`INSERT INTO post_views (post_id,user_id,pct,watched_ms,duration_ms,at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(post_id,user_id) DO UPDATE SET
      pct=MAX(post_views.pct, excluded.pct),
      watched_ms=MAX(post_views.watched_ms, excluded.watched_ms),
      duration_ms=excluded.duration_ms, at=excluded.at`);
  const markSeen = db.prepare('INSERT OR IGNORE INTO post_seen (post_id,user_id,at) VALUES (?,?,?)');

  app.post('/api/feed/views', auth, limiter, (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
    const getPost = db.prepare('SELECT id,user_id,caption FROM posts WHERE id=?');
    for (const ev of events) {
      const id = String(ev?.id || ev?.post_id || '');
      const post = id ? getPost.get(id) : null;
      if (!post || !privacy.canView(req.userId, post.user_id)) continue;
      const pct = Math.max(0, Math.min(1, Number(ev.pct) || 0));
      const watched = Math.max(0, Math.min(3600_000, Number(ev.ms) || 0));
      const dur = Math.max(0, Math.min(3600_000, Number(ev.dur) || 0));
      upsertView.run(post.id, req.userId, pct, watched, dur, now());
      markSeen.run(post.id, req.userId, now());
      if (pct >= 0.8) interests.bumpPost(req.userId, post, { author: 0.35, tag: 0.2 });
      else if (pct >= 0.4) interests.bumpPost(req.userId, post, { author: 0.15, tag: 0.1 });
      else if (watched >= 2500) interests.bumpPost(req.userId, post, { author: -0.25, tag: -0.12 });
    }
    res.json({ ok: true });
  });

  // دیده‌شدن بدون سیگنال منفی (برای عکس‌ها و کارت‌ها)
  app.post('/api/feed/seen', auth, limiter, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100).map(String) : [];
    const stmt = db.prepare('INSERT OR IGNORE INTO post_seen (post_id,user_id,at) VALUES (?,?,?)');
    db.transaction(() => ids.forEach((id) => stmt.run(id, req.userId, now())))();
    res.json({ ok: true });
  });

  // «علاقه ندارم»: پست پنهان می‌شود و وزن نویسنده/هشتگ کم می‌شود
  app.post('/api/feed/posts/:id/not-interested', auth, limiter, (req, res) => {
    const post = db.prepare('SELECT id,user_id,caption FROM posts WHERE id=?').get(req.params.id);
    if (!post || !privacy.canView(req.userId, post.user_id)) return res.status(404).json({ error: 'not_found' });
    db.prepare('INSERT OR IGNORE INTO post_hidden (post_id,user_id,at) VALUES (?,?,?)').run(post.id, req.userId, now());
    db.prepare('INSERT OR IGNORE INTO post_seen (post_id,user_id,at) VALUES (?,?,?)').run(post.id, req.userId, now());
    interests.bumpPost(req.userId, post, { author: -2, tag: -1 });
    res.json({ ok: true, hidden: true });
  });
  app.delete('/api/feed/posts/:id/not-interested', auth, limiter, (req, res) => {
    res.json({ ok: db.prepare('DELETE FROM post_hidden WHERE post_id=? AND user_id=?').run(req.params.id, req.userId).changes > 0 });
  });

  // سیگنال اشتراک‌گذاری در چت (کلاینت بعد از فرستادن کارت صدا می‌زند)
  app.post('/api/feed/posts/:id/share', auth, limiter, (req, res) => {
    const post = db.prepare('SELECT id,user_id,caption FROM posts WHERE id=?').get(req.params.id);
    if (!post || !privacy.canView(req.userId, post.user_id)) return res.status(404).json({ error: 'not_found' });
    db.prepare('INSERT OR IGNORE INTO post_shares (post_id,user_id,at) VALUES (?,?,?)').run(post.id, req.userId, now());
    interests.bumpPost(req.userId, post, { author: 1.5, tag: 0.8 });
    res.json({ ok: true, shares: db.prepare('SELECT COUNT(*) c FROM post_shares WHERE post_id=?').get(post.id).c });
  });

  // هشتگ‌های پرطرفدار ۱۴ روز اخیر (بدون پست کاربران بلاک‌شده/بن‌شده)
  app.get('/api/feed/tags/trending', auth, limiter, (req, res) => {
    const since = Math.floor(Date.now() / 1000) - 14 * 86400;
    const rows = db.prepare(`SELECT user_id, caption FROM posts WHERE created_at > ? AND caption LIKE '%#%'
      AND user_id NOT IN (SELECT user_id FROM bans)
      AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
      ORDER BY created_at DESC LIMIT 500`).all(since, req.userId)
      .filter((r) => privacy.canView(req.userId, r.user_id));
    const count = new Map();
    for (const r of rows) for (const t of tagsOf(r.caption)) count.set(t, (count.get(t) || 0) + 1);
    const tags = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, n]) => ({ tag, count: n }));
    res.json({ tags });
  });

  // فهرست علاقه‌ها (برای نمایش در اکسپلور)
  app.get('/api/feed/interests', auth, limiter, async (req, res) => {
    const top = interests.top(req.userId, 14);
    const tags = top.filter((x) => x.key.startsWith('t:')).map((x) => ({ tag: x.key.slice(2), weight: Math.round(x.weight * 10) / 10 }));
    const authors = await Promise.all(top.filter((x) => x.key.startsWith('a:')).slice(0, 6).map(async (x) => ({
      user_id: x.key.slice(2), name: await displayName(x.key.slice(2)), weight: Math.round(x.weight * 10) / 10,
    })));
    res.json({ tags, authors });
  });

  // ---- فید الگوریتمی ----
  app.get('/api/feed/for-you', auth, limiter, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 30);
    const exclude = new Set(String(req.query.exclude || '').split(',').filter(Boolean).slice(0, 100));
    const me = req.userId;
    const pool = db.prepare(`
      SELECT p.* FROM posts p
      WHERE p.user_id NOT IN (SELECT user_id FROM bans)
        AND p.user_id NOT IN (SELECT blocked FROM blocks WHERE blocker=?)
        AND p.user_id NOT IN (SELECT blocker FROM blocks WHERE blocked=?)
        AND p.id NOT IN (SELECT post_id FROM post_hidden WHERE user_id=?)
      ORDER BY p.created_at DESC LIMIT 500
    `).all(me, me, me).filter((p) => privacy.canView(me, p.user_id) && !exclude.has(p.id));
    if (!pool.length) return res.json({ posts: [], mode: 'for-you' });

    const ids = pool.map((p) => p.id);
    const ph = ids.map(() => '?').join(',');
    const countMap = (sql, extra = []) => new Map(db.prepare(sql).all(...extra, ...ids).map((r) => [r.post_id, r.c]));
    const likeCount = countMap(`SELECT post_id, COUNT(*) c FROM likes WHERE post_id IN (${ph}) GROUP BY post_id`);
    const commentCount = countMap(`SELECT post_id, COUNT(*) c FROM comments WHERE post_id IN (${ph}) GROUP BY post_id`);
    const shareCount = countMap(`SELECT post_id, COUNT(*) c FROM post_shares WHERE post_id IN (${ph}) GROUP BY post_id`);
    const likedByMe = new Set(db.prepare(`SELECT post_id FROM likes WHERE user_id=? AND post_id IN (${ph})`).all(me, ...ids).map((r) => r.post_id));
    const seen = new Set(db.prepare(`SELECT post_id FROM post_seen WHERE user_id=? AND post_id IN (${ph})`).all(me, ...ids).map((r) => r.post_id));
    const following = new Set(db.prepare("SELECT followee FROM follows WHERE follower=? AND status='accepted'").all(me).map((r) => r.followee));
    const weights = interests.forUser(me);
    const t = now();

    const scored = pool.map((p) => {
      const ageH = Math.max(0, (t - p.created_at) / 3600);
      const tags = tagsOf(p.caption);
      const aRaw = Math.max(-3, Math.min(6, weights.get(`a:${p.user_id}`) || 0));
      const tagRaw = tags.length
        ? Math.max(-2, Math.min(4, tags.reduce((s, x) => s + Math.max(-1, Math.min(2, weights.get(`t:${x}`) || 0)), 0) / Math.sqrt(tags.length)))
        : 0;
      const engagement = (
        (likeCount.get(p.id) || 0)
        + 2.2 * (commentCount.get(p.id) || 0)
        + 3.5 * (shareCount.get(p.id) || 0)
        + (likedByMe.has(p.id) ? 1.2 : 0)
      ) / Math.pow(ageH + 2, 1.25);
      const freshness = Math.exp(-ageH / 60);
      const follow = following.has(p.user_id) ? 0.9 : 0;
      const seenPenalty = seen.has(p.id) ? 1.1 : 0;
      const own = p.user_id === me ? -0.9 : 0;
      const unknown = !following.has(p.user_id) && Math.abs(aRaw) < 0.5;
      const score = (aRaw * 0.9) + (tagRaw * 1.0) + (engagement * 1.7)
        + (freshness * 0.9) + follow - seenPenalty + own + Math.random() * 0.3;
      return { p, score, unknown };
    }).sort((x, y) => y.score - x.score);

    // تنوع: حداکثر ۲ پست پشت‌سرهم از یک نویسنده، و حدود ۱۵٪ کشف (نویسنده‌ی ناشناخته)
    const picked = [];
    const used = new Set();
    const explore = scored.filter((x) => x.unknown);
    let runAuthor = null;
    let run = 0;
    while (picked.length < limit) {
      let pick = null;
      if (picked.length >= 5 && picked.length % 6 === 5) {
        pick = explore.find((x) => !used.has(x.p.id) && x.p.user_id !== runAuthor);
      }
      if (!pick) pick = scored.find((x) => !used.has(x.p.id) && !(x.p.user_id === runAuthor && run >= 2));
      if (!pick) pick = scored.find((x) => !used.has(x.p.id));
      if (!pick) break;
      used.add(pick.p.id);
      picked.push(pick);
      if (pick.p.user_id === runAuthor) run += 1;
      else { runAuthor = pick.p.user_id; run = 1; }
    }

    res.set('cache-control', 'no-store');
    res.json({ posts: await shape(picked.map((x) => x.p), me), mode: 'for-you' });
  });
}
