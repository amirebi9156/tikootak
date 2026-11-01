// Migration 003 — نشان «تأییدشده» برای پروفایل (Q2؛ سوییچ مدیریت در مرحله‌های بعد).
function columns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)); } catch { return new Set(); }
}

export default {
  version: 3,
  name: 'profiles-verified',
  up(db) {
    if (!columns(db, 'profiles').has('verified')) {
      db.exec('ALTER TABLE profiles ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
    }
  },
};
