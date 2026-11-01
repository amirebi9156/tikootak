// تنظیمات قابل‌تغییر در زمان اجرا (ذخیره در دیتابیس): قفل ثبت‌نام، سقف کاربر، سهمیهٔ دعوت.
export function makeSettings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)');
  const DEFAULTS = { registration_open: 1, user_cap: 0, daily_cap: 0, user_invite_quota: 3, closed_message: '' };
  const get = (k) => {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
    return r ? r.value : (k in DEFAULTS ? String(DEFAULTS[k]) : null);
  };
  const set = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)').run(k, String(v), Math.floor(Date.now() / 1000));
  const num = (k) => Number(get(k)) || 0;
  const all = () => ({
    registration_open: num('registration_open') === 1, user_cap: num('user_cap'), daily_cap: num('daily_cap'),
    user_invite_quota: num('user_invite_quota'), closed_message: get('closed_message') || '',
  });
  // وضعیت واقعی ثبت‌نام (دستی + سقف‌های خودکار)
  function registration() {
    const s = all();
    if (!s.registration_open) return { open: false, reason: 'manual', message: s.closed_message };
    const total = db.prepare('SELECT COUNT(*) c FROM registrations').get().c;
    if (s.user_cap > 0 && total >= s.user_cap) return { open: false, reason: 'user_cap', message: s.closed_message };
    if (s.daily_cap > 0) {
      const today = db.prepare('SELECT COUNT(*) c FROM registrations WHERE created_at > ?').get(Math.floor(Date.now() / 1000) - 86400).c;
      if (today >= s.daily_cap) return { open: false, reason: 'daily_cap', message: s.closed_message };
    }
    return { open: true, reason: null, message: '' };
  }
  return { get, set, num, all, registration };
}
