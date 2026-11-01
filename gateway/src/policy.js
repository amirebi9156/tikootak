// سیاست رمز و قفل موقت ورود (در حافظه؛ با ری‌استارت پاک می‌شود)
const COMMON = new Set(['password', 'passw0rd', 'qwertyuiop', 'qwerty123', '1234567890', '0123456789', '1q2w3e4r5t', 'iloveyou12', 'abcdefghij', 'asdfghjkl', 'zxcvbnm123', 'password12', 'password123', '12345678910', '0987654321', 'qazwsxedc1', 'welcome123', 'admin12345', 'tikootak123', 'tikootak1234', 'letmein123', 'a1234567890', '11111111111', 'tikotak123', 'hamdam1234']);

export function passwordProblem(pass, username = '') {
  const p = String(pass);
  const l = p.toLowerCase();
  if (COMMON.has(l)) return 'common';
  if (/^\d+$/.test(p)) return 'digits_only';
  if (new Set(p).size < 4) return 'repetitive';
  if (username && username.length >= 3 && l.includes(username.toLowerCase())) return 'has_username';
  if ('0123456789'.includes(l) || 'abcdefghijklmnopqrstuvwxyz'.includes(l) || 'qwertyuiopasdfghjklzxcvbnm'.includes(l)) return 'sequence';
  return null;
}

// ۱۰ تلاش ناموفق در ۱۵ دقیقه → قفل ۱۵ دقیقه‌ای همان نام کاربری (ورود درست هم تا پایان قفل رد می‌شود)
export function createLoginGuard({ max = 10, windowMs = 15 * 60_000, lockMs = 15 * 60_000 } = {}) {
  const m = new Map(); // name -> { fails:[ts], until }
  const prune = () => { if (m.size > 5000) m.delete(m.keys().next().value); };
  return {
    locked(name) {
      const e = m.get(name);
      if (!e?.until) return 0;
      const left = Math.ceil((e.until - Date.now()) / 1000);
      if (left <= 0) { m.delete(name); return 0; }
      return left;
    },
    fail(name) {
      const t = Date.now();
      const e = m.get(name) || { fails: [], until: 0 };
      e.fails = e.fails.filter((x) => t - x < windowMs); e.fails.push(t);
      if (e.fails.length >= max) { e.until = t + lockMs; e.fails = []; }
      m.set(name, e); prune();
    },
    ok(name) { m.delete(name); },
  };
}
