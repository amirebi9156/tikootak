// ذخیره نشست (توکن ورود) در مرورگر. اگر مرورگر اجازه نداد (حالت خصوصی و ...) برنامه
// باز هم کار می‌کنه، فقط بعد از بستن صفحه باید دوباره وارد شد.
const KEY = 'hamdam.session';

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.accessToken && s.userId ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
