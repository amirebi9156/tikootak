import { Icon } from './icons.jsx';
import { tr } from './i18n.js';
import { Cover } from './cover.jsx';
import { fmtClock } from './util.js';
import { PI } from './playerIcons.jsx';

// نوار پخش پایین صفحه: کپسول شیشه‌ای (لنز لیکوید گلس از lens.js روی .player-bar.lg اعمال می‌شود)
// موبایل: عنوان | کنترل‌ها | بستن + خط پیشرفت نازک؛ دسکتاپ: عنوان | نوار زمان با ساعت | کنترل‌ها | پنجرهٔ شناور و بستن
export default function MiniPlayer({ player, onOpen, onFloat, floating, docked }) {
  const { track, time, playing } = player;
  if (!track) return null;
  const max = time.d || 0;
  const t = Math.min(time.t, max);
  const pct = max ? Math.min(100, (t / max) * 100) : 0;
  return <div className={`player-bar mp ${docked ? 'docked' : 'lg'}`} role="region" aria-label={tr("پخش‌کننده")} data-testid="player" data-floating={floating ? '' : undefined}>
    <button type="button" className="plainbtn mp-open mini-open" onClick={onOpen} aria-label={tr("باز کردن صفحه پخش")}>
      <Cover src={track.cover} seed={track.title} size={44} radius={14} />
      <span className="mp-meta"><strong dir="auto">{track.title}</strong>
        <span dir="auto">{player.error || track.artist || track.owner}</span></span>
    </button>
    <div className="mp-seek" dir="ltr">
      <span className="clock num">{fmtClock(t)}</span>
      <input type="range" className="seek" min="0" max={max} step="1" value={t} style={{ '--p': `${pct}%` }}
        onChange={e => player.seek(Number(e.target.value))} aria-label={tr("جلو/عقب")} aria-valuetext={`${fmtClock(t)} / ${fmtClock(max)}`} />
      <span className="clock num">-{fmtClock(Math.max(0, max - t))}</span>
    </div>
    <div className="mp-ctl" dir="ltr">
      <button type="button" className="mp-b mp-skip" onClick={player.prev} aria-label={tr("قبلی")}>{PI.prev(20)}</button>
      <button type="button" className="mp-b mp-pp" onClick={player.toggle} aria-label={playing ? tr("توقف") : tr("پخش")} data-testid="pp">{playing ? <Icon n="pause" size={22} /> : <Icon n="play" size={22} />}</button>
      <button type="button" className="mp-b mp-skip" onClick={player.next} aria-label={tr("بعدی")}>{PI.next(20)}</button>
    </div>
    <div className="mp-end">
      <button type="button" className="mp-b mp-float" onClick={onFloat} aria-pressed={!!floating} aria-label={floating ? tr("بستن پنجرهٔ شناور") : tr("باز کردن در پنجرهٔ شناور")} title={floating ? tr("بستن پنجرهٔ شناور") : tr("باز کردن در پنجرهٔ شناور")}><Icon n="pip" size={20} /></button>
      <button type="button" className="mp-b" onClick={player.stop} aria-label={tr("بستن پخش‌کننده")}><Icon n="close" size={18} /></button>
    </div>
  </div>;
}
