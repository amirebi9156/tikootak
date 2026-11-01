// کشیدن پیام به چپ = پاسخ (مثل تلگرام). موبایل: لمس؛ دسکتاپ: ترک‌پد (اسکرول افقی) و کشیدن با موس.
// پیام خودت و پیام طرف مقابل هر دو با کشیدن به چپ (به سمت داخل/بیرونِ صفحه، یکسان) پاسخ می‌شوند.
export const SWIPE_TRIGGER = 64; // px
export const SWIPE_MAX = 96;

export function swipeState({ dx = 0, dy = 0, locked = false } = {}) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (locked) return 'locked';
  if (ay > 12 && ay > ax) return 'scroll'; // عمودی؛ اسکرول عادی
  if (-dx > 10 && ax > ay * 1.4) return 'locked'; // افقی به چپ
  return 'wait';
}
export const swipeShift = (dx) => {
  const d = Math.max(0, -dx);
  const v = d <= SWIPE_TRIGGER ? d : SWIPE_TRIGGER + (d - SWIPE_TRIGGER) * 0.3;
  return -Math.min(v, SWIPE_MAX);
};

// ردیف پیام برای رویداد: یا خود پیام، یا (اگر روی فضای خالیِ کنار پیام زده شده) نزدیک‌ترین ردیف هم‌ارتفاع.
export function rowFromEvent(root, e) {
  const t = e.target;
  const own = t?.closest?.('.msg');
  if (own) return own;
  if (t !== root) return null;
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY;
  for (const r of root.querySelectorAll('.msg')) {
    const b = r.getBoundingClientRect();
    if (y >= b.top - 3 && y <= b.bottom + 3) return r;
  }
  return null;
}

const INTERACTIVE = 'a[href],button,input,textarea,select,label,audio,video,.voice-box,.vp-wave,.att-img,.music-card,.qr,.reacts,.poll,.share-card';

export function attachSwipeReply(root, { onReply, enabled = () => true, canReply = () => true, iconKind = () => 'reply' }) {
  if (!root) return () => {};
  let st = null; // { row, id, x, y, locked, ico, kind }
  let wheel = { sum: 0, t: 0, fired: false };

  const setShift = (row, px, ico) => {
    row.style.transform = px ? `translateX(${px}px)` : '';
    if (ico) {
      const k = Math.min(1, Math.abs(px) / SWIPE_TRIGGER);
      ico.style.opacity = String(k);
      ico.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * k})`;
      ico.classList.toggle('on', Math.abs(px) >= SWIPE_TRIGGER);
    }
  };
  const PATHS = {
    reply: '<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    forward: '<path d="m15 14 5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h16"/>',
  };
  const makeIcon = (row) => {
    const i = document.createElement('span');
    i.className = 'swipe-ico';
    i.setAttribute('aria-hidden', 'true');
    i.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (PATHS[iconKind()] || PATHS.reply) + '</svg>';
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
    row.appendChild(i);
    return i;
  };
  const finish = (fire) => {
    if (!st) return;
    const { row, ico, id } = st;
    st = null;
    row.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
    setShift(row, 0, ico);
    setTimeout(() => { row.style.transition = ''; ico?.remove(); }, 230);
    if (fire) { try { navigator.vibrate?.(8); } catch { /* ignore */ } onReply(id); }
  };
  const begin = (e, kind, x, y) => {
    if (!enabled()) return;
    const row = rowFromEvent(root, e);
    const id = row?.dataset?.evid;
    if (!row || !id || id.startsWith('~') || !canReply(id)) return;
    if (e.target.closest?.(INTERACTIVE) && kind !== 'touch') return;
    st = { row, id, x, y, locked: false, ico: null, kind, dx: 0 };
  };
  const move = (x, y, e) => {
    if (!st) return;
    const dx = x - st.x;
    const dy = y - st.y;
    const s = swipeState({ dx, dy, locked: st.locked });
    if (s === 'scroll') { finish(false); return; }
    if (s === 'locked') {
      if (st.kind === 'mouse' && !st.locked && (window.getSelection()?.toString() || '')) { finish(false); return; }
      if (!st.locked) { st.locked = true; st.ico = makeIcon(st.row); }
      if (e?.cancelable) e.preventDefault();
      st.dx = dx;
      setShift(st.row, swipeShift(dx), st.ico);
    }
  };
  const end = () => { if (st) finish(st.locked && -st.dx >= SWIPE_TRIGGER); };

  const ts = (e) => { if (e.touches.length === 1) begin(e, 'touch', e.touches[0].clientX, e.touches[0].clientY); else finish(false); };
  const tm = (e) => move(e.touches[0].clientX, e.touches[0].clientY, e);
  const pd = (e) => { if (e.pointerType === 'mouse' && e.button === 0) begin(e, 'mouse', e.clientX, e.clientY); };
  const pm = (e) => { if (e.pointerType === 'mouse' && st?.kind === 'mouse') move(e.clientX, e.clientY, e); };
  const pu = (e) => { if (e.pointerType === 'mouse') end(); };
  const wh = (e) => {
    if (!enabled() || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const row = rowFromEvent(root, e);
    const id = row?.dataset?.evid;
    if (!row || !id || id.startsWith('~') || !canReply(id)) return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheel.t > 350) { wheel = { sum: 0, t: now, fired: false }; }
    wheel.t = now;
    if (wheel.fired) return;
    wheel.sum += e.deltaX; // انگشت به چپ → deltaX مثبت
    if (wheel.sum >= 120) {
      wheel.fired = true;
      try { onReply(id); } catch { /* ignore */ }
      row.style.transition = 'transform .25s ease';
      row.style.transform = 'translateX(-40px)';
      setTimeout(() => { row.style.transform = ''; setTimeout(() => { row.style.transition = ''; }, 260); }, 120);
    }
  };
  root.addEventListener('touchstart', ts, { passive: true });
  root.addEventListener('touchmove', tm, { passive: false });
  root.addEventListener('touchend', end, { passive: true });
  root.addEventListener('touchcancel', () => finish(false), { passive: true });
  root.addEventListener('pointerdown', pd);
  window.addEventListener('pointermove', pm);
  window.addEventListener('pointerup', pu);
  root.addEventListener('wheel', wh, { passive: false });
  return () => {
    root.removeEventListener('touchstart', ts);
    root.removeEventListener('touchmove', tm);
    root.removeEventListener('touchend', end);
    root.removeEventListener('pointerdown', pd);
    window.removeEventListener('pointermove', pm);
    window.removeEventListener('pointerup', pu);
    root.removeEventListener('wheel', wh);
  };
}
