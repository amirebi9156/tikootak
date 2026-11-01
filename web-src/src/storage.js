// مهاجرت کلیدهای localStorage از نام‌های قدیمی به TIKOOTAK.
// مقدار قدیمی کپی می‌شود (حذف نمی‌شود) تا نسخه‌های قدیمی/تب باز هم از کار نیفتند.
const PREFIX_OLD = 'tikotak.';
const PREFIX_NEW = 'tikootak.';
const EXACT = {
  'hamdam.session.v1': 'tikootak.session.v1',
  'hamdam.feedmode': 'tikootak.feedmode',
  'hamdam.crypto.store.v1': 'tikootak.crypto.store.v1',
};
const EXACT_REVERSE = Object.fromEntries(Object.entries(EXACT).map(([a, b]) => [b, a]));

function oldKey(key) {
  if (EXACT_REVERSE[key]) return EXACT_REVERSE[key];
  if (key.startsWith(PREFIX_NEW)) return PREFIX_OLD + key.slice(PREFIX_NEW.length);
  return null;
}

export function migrateStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) {
      if (!k) continue;
      let n = null;
      if (EXACT[k]) n = EXACT[k];
      else if (k.startsWith(PREFIX_OLD)) n = PREFIX_NEW + k.slice(PREFIX_OLD.length);
      if (n && localStorage.getItem(n) === null) {
        const v = localStorage.getItem(k);
        if (v !== null) localStorage.setItem(n, v);
      }
    }
  } catch { /* دسترسی به storage ممکن نیست */ }
}

export function getItem(key, fallback = null) {
  try {
    let v = localStorage.getItem(key);
    if (v !== null) return v;
    const old = oldKey(key);
    if (old) {
      v = localStorage.getItem(old);
      if (v !== null) { localStorage.setItem(key, v); return v; }
    }
  } catch { /* ignore */ }
  return fallback;
}

export function setItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
export function removeItem(key) {
  try {
    localStorage.removeItem(key);
    const old = oldKey(key);
    if (old) localStorage.removeItem(old);
  } catch { /* ignore */ }
}
export function localStorageKeys(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch { /* ignore */ }
  return out;
}
