// نسخه‌ی ساده‌ی i18n: کلید همان متن فارسی است؛ در حالت انگلیسی از en.js ترجمه می‌شود.
// تغییر زبان صفحه را دوباره بارگذاری می‌کند (ساده و بدون خطای نمایش).
import EN from './en.js';
import { getItem, setItem } from './storage.js';

const KEY = 'tikootak.lang';
function detect() {
  try { const s = getItem(KEY); if (s === 'fa' || s === 'en') return s; } catch {}
  return (typeof navigator !== 'undefined' && /^fa/i.test(navigator.language || '')) ? 'fa' : 'en';
}
export const lang = detect();
export const isFa = lang === 'fa';
export const locale = isFa ? 'fa-IR' : 'en-US';

export function tr(key, args) {
  let s = isFa ? key : (EN[key] ?? key);
  if (args) s = s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
  return s;
}
export function setLang(l) {
  setItem(KEY, l);
  location.reload();
}
export function applyLangAttrs() {
  document.documentElement.lang = lang;
  document.documentElement.dir = isFa ? 'rtl' : 'ltr';
}
