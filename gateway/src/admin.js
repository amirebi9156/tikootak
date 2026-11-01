// ابزار مدیریت (فقط با x-admin-key): آمار، فهرست کاربران/پست‌ها/آهنگ‌ها، حذف محتوا.
import fs from 'node:fs';
import path from 'node:path';

export function mountAdmin(app, { db, requireAdmin, dataDir, onPostDelete = null, onStoryDelete = null, transcodeStats = () => ({}) }) {
  // (برمی‌گرداند: عملیات حذف برای ماژول گزارش‌ها)
  const feedDir = path.join(dataDir, 'feed');
  const musicDir = path.join(dataDir, 'music');
  const rm = (dir, file) => fs.rmSync(path.join(dir, file), { force: true });
  const dirSize = (d) => { try { return fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0); } catch { return 0; } };

  function delPost(id) {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
    if (!p) return false;
    try { onPostDelete?.(p.id); } catch { /* مهم نیست */ }
    db.prepare('DELETE FROM likes WHERE post_id=?').run(id);
    db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?)').run(id);
    db.prepare('DELETE FROM comments WHERE post_id=?').run(id);
    db.prepare('DELETE FROM notifications WHERE ref_id=?').run(String(id));
    for (const t of ['post_views', 'post_seen', 'post_hidden', 'post_shares']) {
      try { db.prepare(`DELETE FROM ${t} WHERE post_id=?`).run(id); } catch { /* جدول هنوز ساخته نشده */ }
    }
    db.prepare('DELETE FROM posts WHERE id=?').run(id);
    rm(feedDir, p.file);
    if (p.thumb_file) rm(path.join(feedDir, 'thumbs'), p.thumb_file);
    return true;
  }
  function delComment(id) {
    const c = db.prepare('SELECT id FROM comments WHERE id=?').get(Number(id));
    if (!c) return false;
    db.prepare('DELETE FROM comment_likes WHERE comment_id=?').run(c.id);
    db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
    return true;
  }
  function delStory(id) {
    const s = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
    if (!s) return false;
    try { onStoryDelete?.(id); } catch { /* مهم نیست */ }
    rm(path.join(dataDir, 'stories'), s.file);
    db.prepare('DELETE FROM story_views WHERE story_id=?').run(id);
    db.prepare('DELETE FROM stories WHERE id=?').run(id);
    return true;
  }
  function delTrack(id) {
    const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
    if (!t) return false;
    db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(id);
    db.prepare("DELETE FROM shares WHERE kind='track' AND ref_id=?").run(id);
    db.prepare('DELETE FROM tracks WHERE id=?').run(id);
    const refs = db.prepare('SELECT COUNT(*) c FROM tracks WHERE file=?').get(t.file).c;
    if (!refs) rm(musicDir, t.file);
    if (t.cover_file) rm(path.join(dataDir, 'covers'), t.cover_file);
    return true;
  }

  app.get('/api/admin/posts', requireAdmin, (_req, res) => {
    res.json({ posts: db.prepare('SELECT id,user_id,caption,mime,size,created_at FROM posts ORDER BY created_at DESC LIMIT 200').all() });
  });
  app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => (delPost(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' })));

  app.get('/api/admin/tracks', requireAdmin, (_req, res) => {
    res.json({ tracks: db.prepare('SELECT id,user_id,title,artist,mime,size,created_at FROM tracks ORDER BY created_at DESC LIMIT 200').all() });
  });
  app.delete('/api/admin/tracks/:id', requireAdmin, (req, res) => (delTrack(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' })));

  app.get('/api/admin/bans', requireAdmin, (_req, res) => {
    res.json({ bans: db.prepare('SELECT * FROM bans ORDER BY created_at DESC').all() });
  });

  // همه محتوای یک کاربر (پست، نظر، لایک، آهنگ، پلی‌لیست، استوری، پروفایل)
  function wipeUser(uid) {
    const posts = db.prepare('SELECT id FROM posts WHERE user_id=?').all(uid).map((r) => r.id).filter(delPost).length;
    const tracks = db.prepare('SELECT id FROM tracks WHERE user_id=?').all(uid).map((r) => r.id).filter(delTrack).length;
    const lists = db.prepare('SELECT id FROM playlists WHERE user_id=?').all(uid);
    for (const l of lists) db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').run(l.id);
    db.prepare('DELETE FROM playlists WHERE user_id=?').run(uid);
    const comments = db.prepare('DELETE FROM comments WHERE user_id=?').run(uid).changes;
    db.prepare('DELETE FROM likes WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM comment_likes WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM follows WHERE follower=? OR followee=?').run(uid, uid);
    db.prepare('DELETE FROM notifications WHERE user_id=? OR actor=?').run(uid, uid);
    const sts = db.prepare('SELECT id, file FROM stories WHERE user_id=?').all(uid);
    for (const st of sts) { rm(path.join(dataDir, 'stories'), st.file); db.prepare('DELETE FROM story_views WHERE story_id=?').run(st.id); }
    db.prepare('DELETE FROM stories WHERE user_id=?').run(uid);
    db.prepare("DELETE FROM shares WHERE owner=?").run(uid);
    const pr = db.prepare('SELECT avatar_file FROM profiles WHERE user_id=?').get(uid);
    if (pr?.avatar_file) rm(path.join(dataDir, 'avatars'), pr.avatar_file);
    db.prepare('DELETE FROM profiles WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM story_views WHERE user_id=?').run(uid);
    return { posts, tracks, playlists: lists.length, comments, stories: sts.length };
  }
  app.delete('/api/admin/users/:id/content', requireAdmin, (req, res) => {
    const uid = req.params.id;
    const out = wipeUser(uid);
    if (req.query.ban === '1') db.prepare('INSERT OR REPLACE INTO bans (user_id, reason, created_at) VALUES (?,?,?)').run(uid, 'purged', Math.floor(Date.now() / 1000));
    res.json(out);
  });
  return { delPost, delTrack, delComment, delStory, wipeUser, dirSize, feedDir, musicDir };
}
