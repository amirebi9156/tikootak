// Migration 002 — حساب خصوصی و درخواست دنبال‌کردن.
// ردیف‌های قبلی follows بدون status با مقدار پیش‌فرض accepted می‌مانند تا دنبال‌کردن‌های فعلی قطع نشوند.
function columns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)); } catch { return new Set(); }
}
function addColumn(db, table, name, ddl) {
  if (columns(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

export default {
  version: 2,
  name: 'follow-privacy',
  up(db) {
    addColumn(db, 'profiles', 'is_private', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'follows', 'status', "TEXT NOT NULL DEFAULT 'accepted'");
    // اگر DB قدیمی مقدار NULL داشته باشد، به accepted برمی‌گردد.
    db.exec(`UPDATE follows SET status='accepted' WHERE status IS NULL OR status NOT IN ('pending','accepted')`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS follows_followee_status ON follows(followee, status);
      CREATE INDEX IF NOT EXISTS follows_follower_status ON follows(follower, status);
    `);
  },
};
