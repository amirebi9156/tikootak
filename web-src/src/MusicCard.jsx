// Q4 — کارت آهنگ در چت (مثل تلگرام): کاور با دکمهٔ پلی/پاز وسطش، عنوان، خواننده · مدت · حجم.
// بدون مرحلهٔ «دانلود» دستی: با زدن پلی خودکار بارگیری می‌شود (حلقهٔ پیشرفت) و به‌محض آماده شدن پخش می‌شود.
import { useEffect, useRef, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';
import { fmtSize } from './media.js';
import { fmtClock } from './util.js';
import { musicMeta, loadMusic, cachedMusic, loadCover } from './chatMusic.js';

export default function MusicCard({ client, content, player }) {
  const meta = musicMeta(content);
  const id = content.file?.url || content.url || meta.title;
  const [cover, setCover] = useState(null);
  const [prog, setProg] = useState(null); // null = بیکار، 0..1 = در حال بارگیری
  const [err, setErr] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let dead = false;
    loadCover(client, content).then((u) => { if (!dead) setCover(u); }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const on = player.track?.id === id;
  const playing = on && player.playing;
  const pct = on && player.time.d ? Math.min(1, player.time.t / player.time.d) : 0;
  const mk = (url) => ({ id, url, title: meta.title, artist: meta.artist, cover, owner: '' });

  async function press() {
    setErr('');
    if (on) { player.toggle(); return; }
    const hit = cachedMusic(content);
    if (hit) { player.play([mk(hit.url)], 0); return; }
    setProg(0);
    try {
      const e = await loadMusic(client, content, (f) => { if (alive.current) setProg(f); });
      if (alive.current) setProg(null);
      player.play([mk(e.url)], 0);
    } catch {
      if (alive.current) { setProg(null); setErr(tr('دانلود نشد؛ دوباره بزن.')); }
    }
  }
  const R = 22;
  const C = 2 * Math.PI * R;
  const title = meta.artist ? `${meta.artist} – ${meta.title}` : meta.title;
  const sub = on && player.time.d
    ? `${fmtClock(player.time.t)} / ${fmtClock(player.time.d)}`
    : [meta.dur ? fmtClock(meta.dur) : '', meta.size ? fmtSize(meta.size) : ''].filter(Boolean).join(', ');
  return (
    <div className="music-card" data-testid="music-card" dir="ltr">
      <button type="button" className={`mc-cover ${cover ? 'has' : 'none'}`} onClick={press} aria-label={playing ? tr('توقف') : tr('پخش آهنگ')} data-testid="music-play">
        {cover && <img src={cover} alt="" />}
        <span className="mc-btn">
          {prog !== null
            ? <svg width="44" height="44" viewBox="0 0 48 48" className="mc-ring" aria-hidden="true">
                <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.06, prog))} transform="rotate(-90 24 24)" strokeLinecap="round" />
              </svg>
            : playing ? <Icon n="pause" size={22} /> : <Icon n="play" size={22} />}
        </span>
      </button>
      <div className="mc-main">
        <strong dir="auto" title={title}>{title}</strong>
        <span className="mc-sub" dir="ltr">{sub}</span>
        {err && <span className="error small-note" role="alert">{err}</span>}
      </div>
    </div>
  );
}
