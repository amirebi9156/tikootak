import { tr } from './i18n.js';
import { useEffect, useState } from 'react';
import { shareGet, feedPost } from './api.js';
import { Cover, PlaylistCover } from './cover.jsx';
import { Icon } from './icons.jsx';
import { fa } from './util.js';

// کارت داخل چت: آهنگ و پلی‌لیست مستقیم در همین برنامه پخش می‌شوند (بدون دانلود روی دستگاه)
export default function ShareCard({
  client,
  share,
  player,
  onOpenPost
}) {
  const token = client.getAccessToken();
  const [d, setD] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let dead = false;
    const run = share.kind === 'post' ? feedPost(token, share.id).then(p => ({
      kind: 'post',
      post: p
    })) : shareGet(token, share.code);
    run.then(r => {
      if (!dead) setD(r);
    }).catch(() => {
      if (!dead) setGone(true);
    });
    return () => {
      dead = true;
    };
  }, [token, share.kind, share.id, share.code]);
  if (gone) return <span className="muted" data-testid="share-gone">{share.title || tr("مورد")} {tr("(دیگر در دسترس نیست)")}</span>;
  if (!d) return <span className="muted">…</span>;
  if (d.kind === 'track') {
    const t = d.track;
    const on = player.track?.id === t.id;
    return <div className="share-card" data-testid="share-track">
        <Cover src={t.cover} seed={t.title} size={56} radius={0} />
        <div className="share-main"><strong dir="auto">{t.title}</strong><span dir="auto">{t.artist || t.owner}</span></div>
        <button className="vp-btn" onClick={() => on ? player.toggle() : player.play([t], 0)} aria-label={on && player.playing ? tr("توقف") : tr("پخش آهنگ")} data-testid="share-play">
          {on && player.playing ? <Icon n="pause" size={18} /> : <Icon n="play" size={18} />}
        </button>
      </div>;
  }
  if (d.kind === 'playlist') {
    const p = d.playlist;
    return <div className="share-card" data-testid="share-playlist">
        <PlaylistCover covers={p.covers} seed={p.name} size={56} />
        <div className="share-main"><strong dir="auto">{p.name}</strong><span>{tr("{0} آهنگ · {1}", [fa(d.tracks.length), p.owner])}</span></div>
        <button className="vp-btn" onClick={() => player.play(d.tracks, 0)} disabled={!d.tracks.length} aria-label={tr("پخش همه")}>▶</button>
      </div>;
  }
  const p = d.post;
  return <div className="share-card share-post reel-card" data-testid="share-post">
      <button type="button" className="rc-media" onClick={() => onOpenPost?.(p)} aria-label={tr("مشاهده")}>
        {p.thumb
          ? <img src={p.thumb} alt="" loading="lazy" />
          : p.kind === 'video'
            ? <video src={`${p.url}#t=0.1`} preload="metadata" muted playsInline />
            : <img src={p.url} alt="" loading="lazy" />}
        <span className="rc-kind"><Icon n="film" size={13} /> {p.kind === 'video' ? tr("ریل") : tr("عکس")}</span>
        {p.kind === 'video' && <span className="rc-play"><Icon n="play" size={22} /></span>}
        <span className="rc-info">
          <strong dir="auto">{p.name}</strong>
          {p.caption && <span dir="auto">{p.caption}</span>}
        </span>
      </button>
    </div>;
}
