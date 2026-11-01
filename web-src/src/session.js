// ذخیره نشست کاربر (توکن Matrix) در مرورگر. اگه localStorage در دسترس نبود، نشست فقط تا بستن تب می‌مونه.
import { getItem, setItem, removeItem } from './storage.js';
const KEY = 'tikootak.session.v1';
let memory = null;

export function loadSession() {
  try {
    const raw = getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return memory;
}

export function saveSession(s) {
  memory = s;
  setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  memory = null;
  removeItem(KEY);
}
