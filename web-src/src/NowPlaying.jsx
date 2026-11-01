import { Icon } from './icons.jsx';
import { useBackLayer } from './backstack.js';
import { tr } from './i18n.js';
import { useCallback, useEffect, useRef } from 'react';
import { useLens } from './lens.js';
import { Cover } from './cover.jsx';
import { fmtClock } from './util.js';
import { PI } from './playerIcons.jsx';

function Seek({ player, testid }) {
  const { time } = player;
  const max = Math.max(1, Math.round(time.d));
  const v = Math.min(Math.round(time.t), max);
  const pct = time.d ? Math.min(1, time.t / time.d) : 0;
  return <div className="np-prog" dir="ltr">
    <input type="range" className="np-seek" min="0" max={max} step="1" value={v} style={{ '--p': `${pct * 100}%` }}
      onChange={e => player.seek(+e.target.value)} aria-label={tr("جلو/عقب")} aria-valuetext={`${fmtClock(time.t)} / ${fmtClock(time.d)}`} data-testid={testid} />
    <div className="np-times num"><span>{fmtClock(time.t)}</span><span>-{fmtClock(Math.max(0, time.d - time.t))}</span></div>
  </div>;
}

function Controls({ player, size = 22, compact = false }) {
  return <div className="np-ctl" dir="ltr">
    {!compact && <button type="button" className={`np-b ${player.shuffle ? 'act' : ''}`} onClick={player.toggleShuffle} aria-pressed={player.shuffle} aria-label={tr("پخش تصادفی")}>{PI.shuffle(size)}</button>}
    <button type="button" className="np-b" onClick={player.prev} aria-label={tr("قبلی")}>{PI.prev(size)}</button>
    <button type="button" className="np-play" onClick={player.toggle} aria-label={player.playing ? tr("توقف") : tr("پخش")}>{player.playing ? <Icon n="pause" size={compact ? 22 : 26} /> : <Icon n="play" size={compact ? 22 : 26} />}</button>
    <button type="button" className="np-b" onClick={player.next} aria-label={tr("بعدی")}>{PI.next(size)}</button>
    {!compact && <button type="button" className={`np-b ${player.repeat !== 'off' ? 'act' : ''}`} onClick={player.cycleRepeat} aria-label={tr("تکرار: {0}", [player.repeat])}>{PI.repeat(size)}{player.repeat === 'one' && <b className="np-one">1</b>}</button>}
  </div>;
}

// صفحهٔ کامل «در حال پخش»؛ دکمهٔ «پنجرهٔ شناور» آن را از حالت تمام‌صفحه درمی‌آورد
export default function NowPlaying({ player, onClose, onFloat }) {
  useBackLayer(true, onClose);
  const { track } = player;
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const glassRef = useRef(null);
  useLens(glassRef, { radius: 36, bezel: 36, scale: 64 });
  if (!track) return null;
  return <div className="np-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} data-testid="np-scrim">
    <div className="np-ambient" aria-hidden="true" style={track.cover ? { backgroundImage: `url("${track.cover}")` } : undefined} />
    <div className="np-wrap"><span className="np-shadow" aria-hidden="true" />
    <div className="np lens" ref={glassRef} role="dialog" aria-modal="true" aria-label={tr("در حال پخش")} data-testid="nowplaying">
      <div className="np-top">
        <div className="np-cover"><Cover src={track.cover} seed={track.title} size={84} radius={20} /></div>
        <div className="np-info">
          <h2 dir="auto">{track.title}</h2>
          <p dir="auto">{track.artist || track.owner}</p>
        </div>
        <div className="np-acts">
          <button type="button" className="np-x" onClick={onFloat} aria-label={tr("باز کردن در پنجرهٔ شناور")} title={tr("باز کردن در پنجرهٔ شناور")} data-testid="np-float"><Icon n="pip" size={18} /></button>
          <button type="button" className="np-x" onClick={onClose} aria-label={tr("بستن صفحه پخش")}><Icon n="close" size={18} /></button>
        </div>
      </div>
      <Seek player={player} testid="np-seek" />
      <Controls player={player} />
    </div>
    </div>
  </div>;
}

const POS_KEY = 'tikootak.np.pos';
const STEP = 16;
function readPos() { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch { /* خالی */ } return null; }

// پنجرهٔ شیشه‌ای شناور و جابه‌جاشدنی داخل برنامه (بدون صفحهٔ کدرکننده؛ چت زیرش قابل استفاده است)
export function FloatPlayer({ player, onClose, onFull }) {
  const { track } = player;
  const box = useRef(null);
  const pos = useRef(readPos());
  const drag = useRef(null);
  const glass = useRef(null);
  useLens(glass, { radius: 28, bezel: 24, scale: 44, extra: 'blur(12px) saturate(1.6) brightness(1.04)' });

  const clamp = useCallback((x, y) => {
    const el = box.current; const w = el?.offsetWidth || 320; const h = el?.offsetHeight || 150;
    const m = 8;
    return { x: Math.round(Math.min(Math.max(m, x), Math.max(m, window.innerWidth - w - m))), y: Math.round(Math.min(Math.max(m, y), Math.max(m, window.innerHeight - h - m))) };
  }, []);
  const place = useCallback((p, save) => {
    const el = box.current; if (!el) return;
    const c = clamp(p.x, p.y); pos.current = c;
    el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
    if (save) { try { localStorage.setItem(POS_KEY, JSON.stringify(c)); } catch { /* مهم نیست */ } }
  }, [clamp]);

  // جای اولیه: گوشهٔ پایین-راست (یا آخرین جای ذخیره‌شده)
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const init = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      place(pos.current || { x: window.innerWidth - w - 16, y: window.innerHeight - h - 96 }, false);
      el.style.visibility = 'visible';
    };
    init();
    const onResize = () => place(pos.current || { x: 9999, y: 9999 }, false);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize); ro.observe(el);
    return () => { window.removeEventListener('resize', onResize); ro.disconnect(); };
  }, [place, !!track]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, input')) return;
    const p = pos.current || { x: 0, y: 0 };
    drag.current = { dx: e.clientX - p.x, dy: e.clientY - p.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    box.current?.classList.add('dragging');
  };
  const move = (e) => { if (drag.current) place({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, false); };
  const up = () => { if (!drag.current) return; drag.current = null; box.current?.classList.remove('dragging'); place(pos.current, true); };
  // جایگزین کشیدن برای کیبورد و فناوری‌های کمکی (WCAG 2.5.7)
  const key = (e) => {
    const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (!d) return;
    e.preventDefault();
    const p = pos.current || { x: 0, y: 0 };
    place({ x: p.x + d[0], y: p.y + d[1] }, true);
  };

  if (!track) return null;
  return <div className="np-float" ref={box} role="dialog" aria-label={tr("پخش‌کنندهٔ شناور")} data-testid="np-floating" style={{ visibility: 'hidden' }}>
    <span className="npf-shadow" aria-hidden="true" />
    <div className="npf-glass lg" ref={glass}>
    <div className="npf-bar" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="npf-grip" role="button" tabIndex={0} onKeyDown={key} aria-label={tr("جابه‌جایی پنجره؛ با کلیدهای جهت‌دار")} data-testid="np-drag"><i /><i /><i /></span>
      <span className="npf-sp" />
      <button type="button" className="npf-x" onClick={onFull} aria-label={tr("تمام‌صفحه")} title={tr("تمام‌صفحه")} data-testid="np-full"><Icon n="expand" size={16} /></button>
      <button type="button" className="npf-x" onClick={onClose} aria-label={tr("بستن پنجرهٔ شناور")} title={tr("بستن پنجرهٔ شناور")}><Icon n="close" size={16} /></button>
    </div>
    <div className="npf-top">
      <Cover src={track.cover} seed={track.title} size={52} radius={16} />
      <div className="npf-info"><strong dir="auto">{track.title}</strong><span dir="auto">{track.artist || track.owner}</span></div>
    </div>
    <Seek player={player} testid="npf-seek" />
    <Controls player={player} size={20} compact />
    </div>
  </div>;
}
