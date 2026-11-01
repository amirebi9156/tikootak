import { tr, locale, isFa } from './i18n.js';
const faTime = new Intl.DateTimeFormat(locale, {
  hour: '2-digit',
  minute: '2-digit'
});
const faDay = new Intl.DateTimeFormat(locale, {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
});
export const fmtTime = ts => faTime.format(ts);
export const fmtDay = ts => faDay.format(ts);
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export const fa = n => Number(n).toLocaleString(locale);
export function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
export const fmtClock = t => {
  const s = Math.floor(t || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// زمان نسبی فارسی: «۲ ساعت پیش»
export function ago(ms) {
  const d = Math.max(0, Date.now() - ms);
  const m = Math.floor(d / 60000);
  const f = n => (isFa ? String(n).replace(/\d/g, x => '۰۱۲۳۴۵۶۷۸۹'[x]) : String(n));
  if (m < 1) return tr("همین الان");
  if (m < 60) return tr("{0} دقیقه پیش", [f(m)]);
  if (m < 60 * 24) return tr("{0} ساعت پیش", [f(Math.floor(m / 60))]);
  if (m < 60 * 24 * 7) return tr("{0} روز پیش", [f(Math.floor(m / 1440))]);
  return null;
}