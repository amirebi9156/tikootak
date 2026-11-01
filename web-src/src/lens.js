// عدسی شیشهٔ مایع (Liquid Glass): پس‌زمینهٔ پشت پنجره در لبه‌ها خم می‌شود، مثل شیشهٔ ضخیم.
// روی Chromium با backdrop-filter + فیلتر SVG (نقشهٔ جابجایی از روی فاصله تا لبه ساخته می‌شود) کار می‌کند؛
// در مرورگرهای دیگر خودبه‌خود به تاری ساده برمی‌گردد.
import { useLayoutEffect } from 'react';

export const lensSupported = () => typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);

function makeMap(w, h, r, bezel) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5 - hw, py = y + 0.5 - hh;
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r; // منفی = داخل
    const dist = -sd; let vx = 0, vy = 0;
    if (dist >= 0 && dist < bezel) {
      let nx, ny;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = Math.sign(px) * qx / l; ny = Math.sign(py) * qy / l; }
      else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
      const t = dist / bezel; const mag = Math.pow(1 - t, 1.7);
      vx = -nx * mag; vy = -ny * mag; // نمونه‌برداری از سمت داخل
    }
    const i = (y * w + x) * 4;
    d[i] = Math.round(128 + 127 * vx); d[i + 1] = Math.round(128 + 127 * vy); d[i + 2] = 128; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

let host;
function getHost() {
  if (host) return host;
  host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('width', '0'); host.setAttribute('height', '0'); host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;pointer-events:none'; document.body.appendChild(host);
  return host;
}

// ref: عنصر شیشه‌ای؛ opts: radius (گردی گوشه)، bezel (پهنای خمیدگی لبه)، scale (شدت جابجایی)، aberration (پراکندگی رنگ)
export function useLens(ref, { radius = 36, bezel = 30, scale = 46, aberration = 0.1, extra = 'saturate(1.6) brightness(1.08)' } = {}) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !lensSupported()) return undefined;
    const id = 'tk-lens-' + Math.random().toString(36).slice(2, 8);
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
    getHost().appendChild(f);
    let alive = true;
    const build = async () => {
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight); if (w < 20 || h < 20) return;
      const url = makeMap(w, h, Math.min(radius, w / 2, h / 2), bezel);
      try { const im = new Image(); im.src = url; await im.decode(); } catch { /* ادامه می‌دهیم */ }
      if (!alive) return;
      const ch = (k, s) => `<feDisplacementMap in="SourceGraphic" in2="m" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="d${k}"/>`
        + `<feColorMatrix in="d${k}" type="matrix" values="${k === 'r' ? '1 0 0 0 0' : '0 0 0 0 0'} ${k === 'g' ? '0 1 0 0 0' : '0 0 0 0 0'} ${k === 'b' ? '0 0 1 0 0' : '0 0 0 0 0'} 0 0 0 1 0" result="c${k}"/>`;
      f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('x', '-40'); f.setAttribute('y', '-40'); f.setAttribute('width', String(w + 80)); f.setAttribute('height', String(h + 80));
      f.innerHTML = `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`
        + ch('r', scale * (1 + aberration)) + ch('g', scale) + ch('b', scale * (1 - aberration))
        + '<feBlend in="cr" in2="cg" mode="screen" result="rg"/><feBlend in="rg" in2="cb" mode="screen" result="rgb"/><feGaussianBlur in="rgb" stdDeviation="1.1"/>';
      el.style.setProperty('--lens', `url(#${id}) ${extra}`); el.classList.add('lens-on');
    };
    build();
    const ro = new ResizeObserver(build); ro.observe(el);
    return () => { alive = false; ro.disconnect(); f.remove(); el.classList.remove('lens-on'); el.style.removeProperty('--lens'); };
  }, [ref, radius, bezel, scale, aberration, extra]);
}

// ===== عدسی خودکار برای همهٔ سطوح شیشه‌ای (هدر، نوار نوشتن، منوها، پنل‌ها) =====
// یک فیلتر برای هر اندازهٔ یکتا ساخته و بین عنصرهای هم‌اندازه به اشتراک گذاشته می‌شود.
const AUTO = ['.hp.lg', '.player-bar.lg', '.chat-head .icon.back', '.pinbar', '.cpill.lg', '.ctx-pill', '.ctx-menu', '.attach-menu', '.emoji-pop', '.chat .day', '.chat .older', '.scroll-down'].join(',');
const filters = new Map(); // key -> {id, f, ready}
const tracked = new WeakMap(); // el -> {key, ro, t}

function filterFor(key, w, h, r, bezel, scale, ab) {
  let e = filters.get(key); if (e) return e.ready;
  const id = 'tk-lf-' + filters.size + '-' + Math.random().toString(36).slice(2, 5);
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('x', '-40'); f.setAttribute('y', '-40'); f.setAttribute('width', String(w + 80)); f.setAttribute('height', String(h + 80));
  const url = makeMap(w, h, r, bezel);
  const ch = (k, s) => `<feDisplacementMap in="SourceGraphic" in2="m" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="d${k}"/>`
    + `<feColorMatrix in="d${k}" type="matrix" values="${k === 'r' ? '1 0 0 0 0' : '0 0 0 0 0'} ${k === 'g' ? '0 1 0 0 0' : '0 0 0 0 0'} ${k === 'b' ? '0 0 1 0 0' : '0 0 0 0 0'} 0 0 0 1 0" result="c${k}"/>`;
  f.innerHTML = `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` + ch('r', scale * (1 + ab)) + ch('g', scale) + ch('b', scale * (1 - ab))
    + '<feBlend in="cr" in2="cg" mode="screen" result="rg"/><feBlend in="rg" in2="cb" mode="screen" result="rgb"/><feGaussianBlur in="rgb" stdDeviation="0.8"/>';
  getHost().appendChild(f);
  const ready = (async () => { try { const im = new Image(); im.src = url; await im.decode(); } catch { /* ادامه */ } return id; })();
  e = { id, f, ready }; filters.set(key, e);
  if (filters.size > 60) { const k0 = filters.keys().next().value; filters.get(k0).f.remove(); filters.delete(k0); }
  return ready;
}

async function apply(el) {
  if (!el.isConnected) return;
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight); if (w < 24 || h < 24) return;
  const cs = getComputedStyle(el); const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 20, w / 2, h / 2);
  const bezel = Math.max(10, Math.min(34, Math.min(w, h) * 0.34)); const scale = Math.round(bezel * 1.7);
  const key = `${w}x${h}r${Math.round(r)}`;
  const t = tracked.get(el); if (t && t.key === key) return;
  const id = await filterFor(key, w, h, Math.round(r), bezel, scale, 0.08);
  if (!el.isConnected) return;
  el.style.setProperty('--lens', `blur(2.5px) url(#${id}) saturate(1.7) brightness(1.1)`); el.classList.add('lens-on');
  const cur = tracked.get(el); if (cur) cur.key = key;
}

function track(el) {
  if (tracked.has(el)) return;
  let timer = 0;
  const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => apply(el), 120); });
  tracked.set(el, { key: '', ro }); ro.observe(el); apply(el);
}

export function initAutoLens() {
  try {
    if (!lensSupported() || localStorage.getItem('tikootak.glass') === 'lite') return;
    if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return;
    document.documentElement.classList.add('lens-auto');
    let q = 0;
    const scan = () => { q = 0; document.querySelectorAll(AUTO).forEach(track); };
    const sched = () => { if (!q) q = requestAnimationFrame(scan); };
    new MutationObserver(sched).observe(document.body, { childList: true, subtree: true });
    sched();
  } catch { /* بدون عدسی هم کار می‌کند */ }
}
