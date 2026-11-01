// لیکوید گلس: فیلتر SVG (نویز + جابجایی) فقط یک‌بار در صفحه؛ روی دستگاه‌های قوی Chromium فعال می‌شود، وگرنه تاری ساده.
export function initGlass() {
  try {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;pointer-events:none';
    svg.innerHTML = `<defs><filter id="tk-glass" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="t"/>
      <feGaussianBlur in="t" stdDeviation="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="B" result="d"/>
      <feGaussianBlur in="d" stdDeviation="3"/>
    </filter></defs>`;
    document.body.appendChild(svg);
    const chromium = /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent) || /Edg\//.test(navigator.userAgent);
    const strong = (navigator.hardwareConcurrency || 4) > 4 && (navigator.deviceMemory || 4) >= 4;
    const pref = localStorage.getItem('tikootak.glass'); // 'lite' | 'full'
    // حالت «full» (جابجایی SVG) روی لبهٔ قرص‌ها لکهٔ سفید می‌ساخت؛ فقط اگر کاربر دستی خواسته فعال می‌شود
    const full = pref === 'full' && chromium && strong;
    document.documentElement.classList.toggle('glass-full', full);
  } catch { /* بدون افکت ویژه هم کار می‌کند */ }
}
