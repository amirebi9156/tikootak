// وزن علاقه‌ی هر کاربر به «نویسنده» و «هشتگ». وزن‌ها با نیمه‌عمر ۱۴ روز کم می‌شوند
// تا فید با تغییر علاقه‌ها به‌روز بماند. کلیدها: a:<mxid> و t:<hashtag>.
export function tagsOf(caption) {
  const out = new Set();
  const re = /#([\p{L}\p{N}_]{2,30})/gu;
  let m;
  const text = String(caption || '');
  while ((m = re.exec(text))) out.add(m[1].toLowerCase());
  return [...out].slice(0, 12);
}

export function createInterests(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interests (
      user_id TEXT NOT NULL, key TEXT NOT NULL, weight REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, key)
    );
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const HALF = 14 * 86400;
  const decay = (w, dt) => w * Math.pow(0.5, Math.max(0, dt) / HALF);
  const sel = db.prepare('SELECT weight, updated_at FROM interests WHERE user_id=? AND key=?');
  const up = db.prepare(`INSERT INTO interests (user_id,key,weight,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id,key) DO UPDATE SET weight=excluded.weight, updated_at=excluded.updated_at`);

  function bump(uid, key, delta) {
    if (!uid || !key || !delta) return;
    const t = now();
    const row = sel.get(uid, key);
    let w = (row ? decay(row.weight, t - row.updated_at) : 0) + delta;
    w = Math.max(-30, Math.min(30, w));
    if (Math.abs(w) < 0.02) {
      db.prepare('DELETE FROM interests WHERE user_id=? AND key=?').run(uid, key);
      return;
    }
    up.run(uid, key, w, t);
  }

  function bumpPost(uid, post, { author = 0, tag = 0 } = {}) {
    if (!post) return;
    if (author) bump(uid, `a:${post.user_id}`, author);
    if (tag) for (const t of tagsOf(post.caption)) bump(uid, `t:${t}`, tag);
  }

  function forUser(uid) {
    const rows = db.prepare('SELECT key, weight, updated_at FROM interests WHERE user_id=?').all(uid);
    const m = new Map();
    const t = now();
    for (const r of rows) {
      const w = decay(r.weight, t - r.updated_at);
      if (Math.abs(w) > 0.02) m.set(r.key, w);
    }
    return m;
  }

  function top(uid, limit = 8) {
    const m = forUser(uid);
    return [...m.entries()]
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, weight]) => ({ key, weight }));
  }

  return { bump, bumpPost, forUser, top };
}
