// آیکن‌های مشترک پخش‌کننده (نوار پخش، صفحهٔ کامل، پنجرهٔ شناور)
const fill = (d, s = 22) => <svg viewBox="0 0 24 24" width={s} height={s} fill="currentColor" aria-hidden="true">{d}</svg>;
const line = (d, s = 22) => <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

export const PI = {
  prev: (s) => fill(<path d="M6 5h2v14H6zM20 5v14L9.5 12z" />, s),
  next: (s) => fill(<path d="M16 5h2v14h-2zM4 5v14l10.5-7z" />, s),
  shuffle: (s) => line(<path d="M3 7h3c5 0 5 10 10 10h5M3 17h3c1.6 0 2.7-.8 3.6-2M14.4 9C15.3 7.8 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3" />, s),
  repeat: (s) => line(<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />, s),
};
