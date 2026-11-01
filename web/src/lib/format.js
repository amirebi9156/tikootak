// ابزارهای نمایش: زمان فارسی، حرف اول اسم، رنگ ثابت برای هر کاربر

const timeFmt = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' });

export function timeFa(ts) {
  return timeFmt.format(new Date(ts));
}

export function dayFa(ts) {
  const d = new Date(ts);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? timeFmt.format(d) : dayFmt.format(d);
}

export function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function dayHeading(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'امروز';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'دیروز';
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

export function initial(name) {
  const clean = (name || '').replace(/^@/, '').trim();
  return clean ? [...clean][0].toUpperCase() : '؟';
}

export function localpart(userId) {
  return (userId || '').replace(/^@/, '').split(':')[0];
}

// پنج رنگ هماهنگ برای آواتارها
const HUES = ['#1F6F6B', '#A45A18', '#4C5FA3', '#8A4F7D', '#5E7F3A'];
export function colorFor(id) {
  let h = 0;
  for (const ch of id || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
