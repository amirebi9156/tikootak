// Migration 001 — وضعیت فعلی اسکیمای gateway (تا UI33) به‌صورت idempotent.
// روی DB موجود فقط ستون‌های جاافتاده اضافه می‌شود؛ روی DB خالی همه جدول‌ها ساخته می‌شوند.
function columns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)); } catch { return new Set(); }
}
function addColumn(db, table, name, ddl) {
  if (columns(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

export default {
  version: 1,
  name: 'initial-schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        code        TEXT PRIMARY KEY,
        max_uses    INTEGER NOT NULL DEFAULT 1,
        uses        INTEGER NOT NULL DEFAULT 0,
        expires_at  INTEGER,
        note        TEXT,
        revoked     INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        owner       TEXT
      );
      CREATE TABLE IF NOT EXISTS registrations (
        user_id     TEXT PRIMARY KEY,
        invite_code TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (
        blocker TEXT NOT NULL, blocked TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (blocker, blocked)
      );
      CREATE INDEX IF NOT EXISTS blocks_by_blocked ON blocks(blocked);

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL,
        thumb_file TEXT, thumb_mime TEXT
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
        follower TEXT NOT NULL, followee TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (follower, followee)
      );
      CREATE TABLE IF NOT EXISTS bans (
        user_id TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
        deactivated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS name_index (user_id TEXT PRIMARY KEY, name_lc TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL,
        cover_file TEXT, cover_mime TEXT, hash TEXT
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, pos INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );
      CREATE TABLE IF NOT EXISTS shares (
        code TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
        owner TEXT NOT NULL, created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
        ref_id TEXT, extra TEXT, read_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, id DESC);
      CREATE INDEX IF NOT EXISTS notif_unread ON notifications(user_id, read_at);

      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '',
        avatar_file TEXT, avatar_mime TEXT, updated_at INTEGER NOT NULL DEFAULT 0,
        story_audience TEXT NOT NULL DEFAULT 'everyone', hide_follows INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS post_views (
        post_id TEXT NOT NULL, user_id TEXT NOT NULL, pct REAL NOT NULL DEFAULT 0,
        watched_ms INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS post_seen (
        post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS post_seen_user ON post_seen(user_id, at);
      CREATE TABLE IF NOT EXISTS post_hidden (
        post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS post_shares (
        post_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
        target_user TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open', action TEXT,
        created_at INTEGER NOT NULL, handled_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(reporter, kind, ref_id);
      CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT NOT NULL, file TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stories_exp ON stories(expires_at);
      CREATE TABLE IF NOT EXISTS story_views (
        story_id TEXT NOT NULL, user_id TEXT NOT NULL, viewed_at INTEGER NOT NULL,
        PRIMARY KEY (story_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS transcode_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'queued',
        tries INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT,
        kind TEXT NOT NULL DEFAULT 'post'
      );
      CREATE INDEX IF NOT EXISTS transcode_status ON transcode_jobs(status, id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ip TEXT,
        method TEXT, path TEXT, status INTEGER, note TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

      CREATE TABLE IF NOT EXISTS interests (
        user_id TEXT NOT NULL, key TEXT NOT NULL, weight REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, key)
      );
    `);

    // ستون‌هایی که در نصب‌های قبلی با ALTER اضافه می‌شدند.
    addColumn(db, 'invites', 'owner', 'TEXT');
    addColumn(db, 'posts', 'thumb_file', 'TEXT');
    addColumn(db, 'posts', 'thumb_mime', 'TEXT');
    addColumn(db, 'tracks', 'cover_file', 'TEXT');
    addColumn(db, 'tracks', 'cover_mime', 'TEXT');
    addColumn(db, 'tracks', 'hash', 'TEXT');
    addColumn(db, 'profiles', 'story_audience', "TEXT NOT NULL DEFAULT 'everyone'");
    addColumn(db, 'profiles', 'hide_follows', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'bans', 'deactivated', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'transcode_jobs', 'kind', "TEXT NOT NULL DEFAULT 'post'");

    db.exec(`
      CREATE INDEX IF NOT EXISTS invites_owner ON invites(owner);
      CREATE INDEX IF NOT EXISTS tracks_hash ON tracks(hash);
    `);
  },
};
