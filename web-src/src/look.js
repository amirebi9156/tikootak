import { useState } from 'react';
import { getItem, setItem } from './storage.js';

// شخصی‌سازی ظاهر چت (مثل تلگرام): رنگ‌بندی، اندازهٔ متن، گوشهٔ حباب و والپیپر.
// رنگ‌بندی‌های «سبز» و «آبی» دستی‌اند (CSS)؛ بقیه و رنگ دلخواه از روی یک رنگ ساخته می‌شوند.
const KEY = 'tikootak.look';
const OLD_PALETTE = 'tikootak.palette';
export const DEFAULT = { grad: true, palette: 'navy', custom: '#8b5cf6', fs: 15, radius: 20, wall: 'dusk', img: '' };
export const PRESETS = [
  { id: 'navy', sw: ['#070a14', '#101a7a', '#5a7bff'] },
  { id: 'green', sw: ['#07110d', '#1c6b4e', '#34d399'] },
  { id: 'blue', sw: ['#0e1621', '#2b5278', '#5eb5f7'] },
  { id: 'purple', hex: '#a78bfa' },
  { id: 'orange', hex: '#fb923c' },
  { id: 'rose', hex: '#fb7185' },
  { id: 'teal', hex: '#2dd4bf' }
];
export const WALLS = ['dusk', 'aurora', 'peaks', 'dots', 'lines', 'grad', 'plain', 'img'];
// والپیپرهای آمادهٔ داخلی (SVG کوچک، بدون دانلود): شیشه روی آن‌ها واقعاً دیده می‌شود
const svgUri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const SVG = {
  dusk: (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d ? '#0a1038' : '#c9d6ff'}"/><stop offset=".55" stop-color="${d ? '#131a5c' : '#e3d9ff'}"/><stop offset="1" stop-color="${d ? '#2a1d63' : '#ffe1d6'}"/></linearGradient></defs><rect width="400" height="800" fill="url(#g)"/><filter id="o" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter><g filter="url(#o)" opacity="${d ? 1 : .7}"><circle cx="330" cy="150" r="120" fill="${d ? '#3a55ff' : '#8aa2ff'}" opacity=".55"/><circle cx="40" cy="380" r="110" fill="${d ? '#8a3dff' : '#d1a8ff'}" opacity=".4"/><circle cx="310" cy="640" r="130" fill="${d ? '#16b7d6' : '#8fe3f2'}" opacity=".3"/></g>${d ? '<g fill="#fff" opacity=".7"><circle cx="60" cy="90" r="1.3"/><circle cx="310" cy="60" r="1.6"/><circle cx="220" cy="150" r="1"/><circle cx="130" cy="230" r="1.2"/><circle cx="350" cy="260" r="1"/><circle cx="40" cy="330" r="1"/></g>' : ''}<path d="M0 560 L90 470 L160 540 L250 440 L340 530 L400 480 V800 H0Z" fill="${d ? '#0d1250' : '#9fb1f2'}" opacity=".85"/><path d="M0 650 L110 560 L190 640 L290 540 L400 640 V800 H0Z" fill="${d ? '#080b33' : '#7f93e0'}"/><path d="M0 730 L120 670 L230 740 L330 680 L400 730 V800 H0Z" fill="${d ? '#04061c' : '#5d72c8'}"/></svg>`,
  aurora: (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d ? '#1fd1b0' : '#7be3cf'}" stop-opacity=".55"/><stop offset="1" stop-color="${d ? '#5a7bff' : '#9bb0ff'}" stop-opacity=".1"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="22"/></filter></defs><rect width="400" height="800" fill="${d ? '#050816' : '#eaf0ff'}"/><g filter="url(#b)"><path d="M-40 220 C80 120 160 340 280 200 S420 120 460 260 L460 420 C320 340 200 520 90 400 S-20 360 -40 420Z" fill="url(#a)"/><ellipse cx="300" cy="620" rx="190" ry="130" fill="${d ? '#6a3df0' : '#c4b0ff'}" opacity=".35"/></g></svg>`,
  peaks: (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d ? '#0b1530' : '#d6e6ff'}"/><stop offset="1" stop-color="${d ? '#1a3a6b' : '#f3e6d8'}"/></linearGradient></defs><rect width="400" height="800" fill="url(#p)"/><path d="M0 520 L70 420 L130 500 L210 380 L300 500 L360 440 L400 500 V800 H0Z" fill="${d ? '#16305a' : '#a9c1ea'}"/><path d="M0 620 L90 520 L170 610 L270 500 L400 630 V800 H0Z" fill="${d ? '#0d2043' : '#86a3d6'}"/><path d="M0 720 L140 640 L250 720 L400 650 V800 H0Z" fill="${d ? '#071228' : '#6685bf'}"/></svg>`
};

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = parseInt((m ? m[1] : '8b5cf6'), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}
const hsl = (h, s, l) => `hsl(${Math.round(h) % 360} ${Math.round(s)}% ${Math.round(l)}%)`;

export function buildVars(hex, mode) {
  const { h, s: s0 } = hexToHsl(hex);
  const s = Math.max(45, Math.min(90, s0));
  const v = {};
  if (mode === 'light') {
    Object.assign(v, {
      '--bg': hsl(h, 22, 90), '--night': hsl(h, 22, 90), '--deep': '#ffffff', '--surface': '#ffffff',
      '--surface-2': hsl(h, 25, 96), '--surface-3': hsl(h, 22, 92), '--raise': '#ffffff', '--raise2': hsl(h, 25, 95),
      '--line': `hsl(${h} 40% 20% / 0.10)`, '--line-soft': `hsl(${h} 40% 20% / 0.06)`, '--line2': `hsl(${h} 40% 20% / 0.16)`,
      '--ink': hsl(h, 40, 9), '--muted': hsl(h, 14, 36), '--dim': hsl(h, 10, 55),
      '--accent': hsl(h, s, 42), '--accent-2': hsl(h, s, 50), '--accent-3': hsl(h, s, 34), '--on-accent': '#ffffff',
      '--mine': hsl(h, 65, 82), '--mine-2': hsl(h + 20, 70, 93), '--on-mine': hsl(h, 40, 9), '--bubble-me': hsl(h, 60, 90), '--bubble-me-ink': hsl(h, 40, 9),
      '--bubble-other': '#ffffff', '--bt': '#ffffff', '--mine-meta': hsl(h, 35, 38), '--tick-read': hsl(h, s, 34),
      '--glow': `hsl(${h} ${s}% 42% / 0.10)`, '--glass': 'rgb(255 255 255 / 0.82)', '--ring': `0 0 0 3px hsl(${h} ${s}% 42% / 0.25)`,
      '--tg-wall': hsl(h, 25, 88), '--tg-pat': `hsl(${h} 45% 30% / 0.06)`
    });
  } else {
    const o = mode === 'oled';
    Object.assign(v, {
      '--bg': o ? '#000' : hsl(h, 30, 6), '--night': o ? '#000' : hsl(h, 30, 6),
      '--deep': o ? '#0a0a0b' : hsl(h, 24, 9.5), '--surface': o ? '#0a0a0b' : hsl(h, 24, 9.5), '--surface-2': o ? '#151517' : hsl(h, 22, 13.5), '--surface-3': o ? '#1e1e21' : hsl(h, 22, 18),
      '--raise': o ? '#0a0a0b' : hsl(h, 24, 9.5), '--raise2': o ? '#1e1e21' : hsl(h, 22, 18),
      '--line': 'rgb(255 255 255 / 0.07)', '--line-soft': 'rgb(255 255 255 / 0.045)', '--line2': 'rgb(255 255 255 / 0.12)',
      '--ink': hsl(h, 30, 95), '--muted': hsl(h, 14, 70), '--dim': hsl(h, 12, 50),
      '--accent': hsl(h, s, 62), '--accent-2': hsl(h, s, 72), '--accent-3': hsl(h, s, 52), '--on-accent': hsl(h, 60, 6),
      '--mine': hsl(h, 55, o ? 17 : 22), '--mine-2': hsl(h + 22, 48, o ? 33 : 38), '--on-mine': '#ffffff', '--bubble-me': hsl(h, 42, 28), '--bubble-me-ink': '#fff',
      '--bubble-other': hsl(h, 24, 12), '--bt': o ? '#1c1c1f' : hsl(h, 24, 12), '--mine-meta': 'rgb(255 255 255 / 0.68)', '--tick-read': hsl(h, s, 74),
      '--glow': `hsl(${h} ${s}% 62% / 0.14)`, '--glass': o ? 'rgb(0 0 0 / 0.82)' : `hsl(${h} 24% 10% / 0.78)`, '--ring': `0 0 0 3px hsl(${h} ${s}% 62% / 0.32)`,
      '--tg-wall': o ? '#000' : hsl(h, 30, 5.5), '--tg-pat': 'rgb(255 255 255 / 0.03)'
    });
  }
  return v;
}

let applied = [];
function wallVars(look, hue, mode) {
  const dark = mode !== 'light';
  switch (look.wall) {
    case 'dusk': case 'aurora': case 'peaks': return { '--wall-bg': svgUri(SVG[look.wall](dark)), '--wall-size': 'cover' };
    case 'plain': return { '--wall-bg': 'none', '--wall-size': 'auto' };
    case 'lines': return { '--wall-bg': 'repeating-linear-gradient(45deg, var(--tg-pat) 0 2px, transparent 2px 16px)', '--wall-size': 'auto' };
    case 'grad': return { '--wall-bg': dark ? `linear-gradient(160deg, hsl(${hue} 38% 14%), hsl(${(hue + 40) % 360} 40% 7%))` : `linear-gradient(160deg, hsl(${hue} 45% 92%), hsl(${(hue + 40) % 360} 50% 84%))`, '--wall-size': 'auto' };
    case 'img': return look.img ? { '--wall-bg': `linear-gradient(rgb(0 0 0 / ${dark ? 0.28 : 0}), rgb(0 0 0 / ${dark ? 0.28 : 0})), url("${look.img}")`, '--wall-size': 'cover' } : {};
    default: return { '--wall-bg': 'radial-gradient(var(--tg-pat) 1.2px, transparent 1.4px)', '--wall-size': '22px 22px' };
  }
}
const BASE_HUE = { green: 158, blue: 207, navy: 232 };
export function getLook() {
  let l = {};
  try { l = JSON.parse(getItem(KEY) || '{}') || {}; } catch { /* ignore */ }
  if (!l.palette) { try { const o = getItem(OLD_PALETTE); if (o === 'blue') l.palette = 'blue'; } catch { /* ignore */ } }
  return { ...DEFAULT, ...l };
}
export function applyLook(look = getLook()) {
  const root = document.documentElement, st = root.style;
  const mode = root.dataset.theme || 'dark';
  applied.forEach(k => st.removeProperty(k)); applied = [];
  const set = (k, val) => { st.setProperty(k, val); applied.push(k); };
  const pre = PRESETS.find(p => p.id === look.palette);
  const hex = look.palette === 'custom' ? look.custom : pre?.hex;
  let hue = BASE_HUE[look.palette] || 158;
  if (hex) {
    root.dataset.palette = 'gen';
    hue = hexToHsl(hex).h;
    Object.entries(buildVars(hex, mode)).forEach(([k, val]) => set(k, val));
  } else root.dataset.palette = ['blue', 'navy'].includes(look.palette) ? look.palette : 'green';
  root.dataset.grad = look.grad === false ? '0' : '1';
  if (look.grad === false && hex) set('--mine-2', 'var(--mine)');
  set('--msg-fs', `${Math.max(12, Math.min(22, +look.fs || 15))}px`);
  set('--msg-r', `${Math.max(4, Math.min(24, +look.radius || 14))}px`);
  Object.entries(wallVars(look, hue, mode)).forEach(([k, val]) => set(k, val));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--surface').trim() || '#0d1a14');
}
export function useLook() {
  const [look, setL] = useState(getLook);
  const update = (patch) => {
    const n = { ...look, ...patch };
    setL(n); applyLook(n);
    try { setItem(KEY, JSON.stringify(n)); } catch { /* حجم تصویر زیاد بود */ }
  };
  return [look, update, () => update({ ...DEFAULT })];
}
// تصویر دلخواه برای والپیپر: کوچک و فشرده می‌شود (فقط روی همین دستگاه ذخیره می‌شود)
export function fileToWall(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1280 / Math.max(im.width, im.height)); const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.78));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    im.src = url;
  });
}
