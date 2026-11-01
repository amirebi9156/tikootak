// همگام‌سازی ارتفاع برنامه با کیبورد گوشی (فقط صفحه‌نمایش لمسی).
// --app-h = ارتفاع دیدِ واقعی (visualViewport)؛ هنگام جابه‌جایی «کیبورد ⇄ پنل ایموجی/استیکر» ارتفاع قفل می‌شود
// تا نوار پیام و لیست پیام‌ها نپرند و دو انیمیشن همزمان با هم تداخل نکنند.
let fullH = 0;
let locked = null;
let on = false;
const root = () => document.documentElement;
const vvH = () => Math.round(window.visualViewport?.height || window.innerHeight);
const apply = (h) => root().style.setProperty('--app-h', `${h}px`);

function sync() {
  const h = vvH();
  if (h > fullH) fullH = h;
  if (locked == null) apply(h);
}

export function initViewport() {
  try {
    if (on || !window.matchMedia?.('(pointer: coarse)').matches) return;
    on = true;
    const vv = window.visualViewport;
    let w = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== w) { w = window.innerWidth; fullH = 0; } sync(); };
    (vv || window).addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => { fullH = 0; setTimeout(sync, 350); });
    // iOS: با باز شدن کیبورد صفحه را بالا می‌کشد؛ برمی‌گردانیم
    vv?.addEventListener('scroll', () => { if (locked == null && window.scrollY) window.scrollTo(0, 0); });
    root().classList.add('vp-sync');
    sync();
  } catch { /* بدون آن هم کار می‌کند */ }
}

export const keyboardHeight = () => (on ? Math.max(0, fullH - vvH()) : 0);
export const viewportFull = () => fullH;

export function lockViewport() {
  if (!on) return;
  locked = fullH || vvH();
  apply(locked);
  root().classList.add('vp-lock');
}
export function unlockViewport() {
  if (!on) return;
  locked = null;
  root().classList.remove('vp-lock');
  sync();
}

// منتظر می‌ماند تا شرط روی ارتفاع کیبورد برقرار شود (یا مهلت تمام شود)
export function waitKeyboard(pred, ms = 600) {
  return new Promise((res) => {
    const vv = window.visualViewport || window;
    let done = false;
    const fin = () => { if (done) return; done = true; vv.removeEventListener('resize', chk); clearTimeout(t); res(); };
    const chk = () => { if (pred(keyboardHeight())) setTimeout(fin, 60); };
    const t = setTimeout(fin, ms);
    vv.addEventListener('resize', chk);
    chk();
  });
}
