import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { tr } from './i18n.js';

// منوی راست‌کلیک/لمس طولانی. روی دسکتاپ کنار نشانگر باز می‌شود و روی موبایل Bottom Sheet است.
// items: [{ key, label, icon, danger, hint, onClick }] یا 'sep'؛ header: ردیف ایموجی [{ key, label, onClick }]
export default function ContextMenu({ x = 0, y = 0, items, header, label, onClose }) {
  const ref = useRef(null);
  const pillRef = useRef(null);
  const cardRef = useRef(null);
  const [pos, setPos] = useState({ ready: false });
  const [touch] = useState(() => {
    try {
      return !!window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
    } catch { return false; }
  });

  // شیشه‌ای و کنار انگشت: ردیف واکنش بالای نقطهٔ لمس، منو پایین آن (مثل تلگرام)
  useLayoutEffect(() => {
    const card = cardRef.current;
    const pill = pillRef.current;
    if (!card) return;
    const pad = 10;
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const pw = pill ? pill.offsetWidth : 0;
    const ph = pill ? pill.offsetHeight : 0;
    const w = Math.max(cw, pw);
    let left = x - w / 2;
    left = Math.max(pad, Math.min(left, vw - w - pad));
    let pillTop = pill ? y - ph - gap : 0;
    let cardTop = y + gap;
    if (!pill) cardTop = y - 4;
    const total = (pill ? ph + gap : 0) + ch + gap;
    // اگر پایین جا نیست، همه را بالا ببر
    const overflow = cardTop + ch - (vh - pad);
    if (overflow > 0) { cardTop -= overflow; pillTop -= overflow; }
    // اگر بالا جا نیست، همه را پایین ببر
    const minTop = pill ? pillTop : cardTop;
    if (minTop < pad) { const d = pad - minTop; cardTop += d; pillTop += d; }
    // نقطهٔ شروع انیمیشن = جای لمس نسبت به هر قطعه
    setPos({
      ready: true,
      pill: { left: Math.max(pad, Math.min(x - pw / 2, vw - pw - pad)), top: pillTop, ox: x, oy: y },
      card: { left: Math.max(pad, Math.min(x - cw / 2, vw - cw - pad)), top: cardTop, ox: x, oy: y },
      total,
    });
  }, [x, y, header?.length, items.length]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const k = e.key.toLowerCase();
      const hot = items.find(i => i !== 'sep' && !i.disabled && i.hint && ((i.hint.length === 1 && i.hint.toLowerCase() === k && !e.ctrlKey && !e.metaKey) || (i.hint === 'Del' && e.key === 'Delete') || (i.hint === 'Ctrl+C' && (e.ctrlKey || e.metaKey) && k === 'c')));
      if (hot) { e.preventDefault(); onClose(); hot.onClick?.(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...ref.current.querySelectorAll('.ctx-item:not([disabled])')];
        const i = btns.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[n]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('contextmenu', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', close, true);
    if (!touch) ref.current?.querySelector('.ctx-item')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('contextmenu', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', close, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (it) => () => { if (!it.keepOpen) onClose(); it.onClick?.(); };
  const place = (p) => (p ? { left: p.left, top: p.top, transformOrigin: `${p.ox - p.left}px ${p.oy - p.top}px`, visibility: 'visible' } : { visibility: 'hidden' });
  const body = (
    <div className={`ctx-layer glass ${touch ? 'touch' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      <div ref={ref} className="ctx-stack" data-testid="ctx-menu" data-sheet="0">
        {header && <div ref={pillRef} role="menu" aria-label={tr('واکنش‌ها')} className="ctx-pill" style={place(pos.ready ? pos.pill : null)}>
          {header.map((h) => <button key={h.key} type="button" role="menuitem" aria-label={h.label} className={h.on ? 'on' : ''} onClick={run(h)}>{h.key}</button>)}
        </div>}
        <div ref={cardRef} role="menu" aria-label={label || tr('منو')} className="ctx-menu" style={place(pos.ready ? pos.card : null)}>
          {items.map((it, i) => it === 'sep'
            ? <div key={`s${i}`} className="ctx-sep" role="separator" />
            : <button key={it.key} type="button" role="menuitem" disabled={it.disabled} className={`ctx-item ${it.danger ? 'danger' : ''}`} onClick={run(it)}>
                {it.icon && <Icon n={it.icon} size={20} />}
                <span className="ctx-label">{it.label}</span>
                {it.hint && !touch && <kbd>{it.hint}</kbd>}
              </button>)}
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

// لمس طولانی (۴۵۰ms) برای موبایل؛ روی دسکتاپ راست‌کلیک با رویداد contextmenu
export function useLongPress(onOpen) {
  const t = useRef(null);
  const start = useRef(null);
  const fired = useRef(0);
  const clear = () => { clearTimeout(t.current); t.current = null; };
  return {
    onTouchStart: (e) => {
      const p = e.touches[0];
      start.current = { x: p.clientX, y: p.clientY };
      clear();
      t.current = setTimeout(() => { fired.current = Date.now(); onOpen(start.current.x, start.current.y, e); }, 450);
    },
    onTouchMove: (e) => {
      const p = e.touches[0];
      if (start.current && Math.hypot(p.clientX - start.current.x, p.clientY - start.current.y) > 10) clear();
    },
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu: (e) => {
      if (e.target.closest?.('a[href]') && !e.shiftKey) { /* لینک: منوی خودمان هم باز شود */ }
      e.preventDefault();
      if (Date.now() - fired.current < 700) return; // لمس طولانی قبلاً باز کرده
      onOpen(e.clientX, e.clientY, e);
    },
  };
}
