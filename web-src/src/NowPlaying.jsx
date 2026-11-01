import { Icon } from './icons.jsx';
import { useBackLayer } from './backstack.js';
import { tr } from './i18n.js';
import { useEffect, useRef } from 'react';
import { useLens } from './lens.js';
import { Cover } from './cover.jsx';
import { fmtClock } from './util.js';

// صفحه کامل «در حال پخش»
export default function NowPlaying({
  player,
  onClose
}) {
  useBackLayer(true, onClose);
  const {
    track,
    time,
    playing
  } = player;
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const glassRef = useRef(null);
  useLens(glassRef, { radius: 36, bezel: 36, scale: 64 });
  if (!track) return null;
  const pct = time.d ? Math.min(1, time.t / time.d) : 0;
  const I = (d) => <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">{d}</svg>;
  const ico = {
    prev: I(<path d="M6 5h2v14H6zM20 5v14L9.5 12z" />),
    next: I(<path d="M16 5h2v14h-2zM4 5v14l10.5-7z" />),
    shuffle: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h3c5 0 5 10 10 10h5M3 17h3c1.6 0 2.7-.8 3.6-2M14.4 9C15.3 7.8 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3" /></svg>,
    repeat: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" /></svg>
  };
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
        <button className="np-x" onClick={onClose} aria-label={tr("بستن صفحه پخش")}><Icon n="close" size={18} /></button>
      </div>
      <div className="np-prog" dir="ltr">
        <input type="range" className="np-seek" min="0" max={Math.max(1, Math.round(time.d))} step="1" value={Math.round(time.t)} style={{ '--p': `${pct * 100}%` }}
          onChange={e => player.seek(+e.target.value)} aria-label={tr("جلو/عقب")} aria-valuenow={Math.round(time.t)} data-testid="np-seek" />
        <div className="np-times num"><span>{fmtClock(time.t)}</span><span>-{fmtClock(Math.max(0, time.d - time.t))}</span></div>
      </div>
      <div className="np-ctl" dir="ltr">
        <button className={`np-b ${player.shuffle ? 'act' : ''}`} onClick={player.toggleShuffle} aria-pressed={player.shuffle} aria-label={tr("پخش تصادفی")}>{ico.shuffle}</button>
        <button className="np-b" onClick={player.prev} aria-label={tr("قبلی")}>{ico.prev}</button>
        <button className="np-play" onClick={player.toggle} aria-label={playing ? tr("توقف") : tr("پخش")}>{playing ? <Icon n="pause" size={26} /> : <Icon n="play" size={26} />}</button>
        <button className="np-b" onClick={player.next} aria-label={tr("بعدی")}>{ico.next}</button>
        <button className={`np-b ${player.repeat !== 'off' ? 'act' : ''}`} onClick={player.cycleRepeat} aria-label={tr("تکرار: {0}", [player.repeat])}>{ico.repeat}{player.repeat === 'one' && <b className="np-one">1</b>}</button>
      </div>
    </div>
    </div>
  </div>;
}
