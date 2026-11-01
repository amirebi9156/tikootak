import { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from './i18n.js';
import { fetchFile, fmtSize } from './media.js';
import { fmtClock } from './util.js';
import { Icon } from './icons.jsx';
import MusicCard from './MusicCard.jsx';
import { isMusic } from './chatMusic.js';

const AUTO_MAX = 8 * 1024 * 1024;
const BARS = 34;

// شکل موج تزئینی (از روی نام و حجم فایل ساخته می‌شود، نه از صدای واقعی)
export function wave(seed, n = BARS) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ h >>> 13, 1274126177);
    out.push(0.25 + (h >>> 8 & 255) / 255 * 0.75);
  }
  return out;
}

function VoicePlayer({ url, seed, dur }) {
  const a = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(dur || 0);
  const [rate, setRate] = useState(1);
  const bars = useMemo(() => wave(seed), [seed]);
  const total = Number.isFinite(d) && d > 0 ? d : dur || 0;
  const pct = total ? Math.min(1, t / total) : 0;
  function toggle() {
    const el = a.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }
  function nextRate() {
    const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(r);
    if (a.current) a.current.playbackRate = r;
  }
  function seek(e) {
    const el = a.current;
    if (!el || !total) return;
    const box = e.currentTarget.getBoundingClientRect();
    // جهت صفحه راست‌به‌چپ است: ابتدای موج سمت راست قرار دارد
    const f = Math.min(1, Math.max(0, (box.right - e.clientX) / box.width));
    el.currentTime = f * total;
    setT(el.currentTime);
  }
  return (
    <div className="voice-box" dir="ltr">
      <audio ref={a} className="voice-el" src={url} preload="metadata" data-testid="voice"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setT(0); }}
        onTimeUpdate={e => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={e => { if (Number.isFinite(e.currentTarget.duration)) setD(e.currentTarget.duration); }}
        onDurationChange={e => { if (Number.isFinite(e.currentTarget.duration)) setD(e.currentTarget.duration); }} />
      <button type="button" className="vp-btn" onClick={toggle} aria-label={playing ? tr('توقف') : tr('پخش')} data-testid="voice-play">
        {playing ? <Icon n="pause" size={20} /> : <Icon n="play" size={20} />}
      </button>
      <div className="vp-wave" onClick={seek} role="slider" aria-label={tr('موقعیت پخش')}
        aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}>
        {bars.map((h, i) => <i key={i} className={i / BARS < pct ? 'on' : ''} style={{ height: `${h * 100}%` }} />)}
      </div>
      <span className="vp-time num">{fmtClock(playing || t > 0 ? t : total)}</span>
      <button type="button" className="vp-rate" onClick={nextRate} aria-label={tr('سرعت پخش')}>{rate}x</button>
    </div>
  );
}

// فایل‌های چت: عکس و ویدیو داخل خود برنامه باز می‌شوند (بدون دانلود)؛ صدا با پلیر و فایل با دکمه ذخیره.
export default function Attachment({ client, content, onOpen, player }) {
  if (player && isMusic(content)) return <MusicCard client={client} content={content} player={player} />;
  // کپشن (MSC2530): body = کپشن، filename = نام فایل
  const cap = content.filename && content.filename !== content.body ? content.body : '';
  const inner = <AttachmentBody client={client} content={cap ? { ...content, body: content.filename } : content} onOpen={onOpen} />;
  if (!cap) return inner;
  return <span className="att-wrap">{inner}<span className="att-cap" dir="auto" data-testid="att-caption">{cap}</span></span>;
}

function AttachmentBody({ client, content, onOpen }) {
  const mime = content.info?.mimetype || '';
  const isImage = content.msgtype === 'm.image' || (content.msgtype === 'm.file' && mime.startsWith('image/'));
  const isVideo = content.msgtype === 'm.video' || (content.msgtype === 'm.file' && mime.startsWith('video/'));
  const isAudio = content.msgtype === 'm.audio';
  const size = content.info?.size || 0;
  const dur = (content.info?.duration || 0) / 1000;
  const thumbRef = content.info?.thumbnail_file || content.info?.thumbnail_url;

  const [url, setUrl] = useState(null);
  const [state, setState] = useState((isImage || isAudio) && size <= AUTO_MAX ? 'loading' : 'idle');
  const [thumb, setThumb] = useState(null);
  const [thumbErr, setThumbErr] = useState(false);

  // پیش‌نمایش ویدیو: فقط تامبنیل کوچک دانلود می‌شود، نه کل ویدیو
  useEffect(() => {
    if (!isVideo || !thumbRef) return undefined;
    let dead = false;
    let made = null;
    (async () => {
      try {
        const tc = {
          file: content.info.thumbnail_file,
          url: content.info.thumbnail_url,
          info: content.info.thumbnail_info,
        };
        const blob = await fetchFile(client, tc);
        made = URL.createObjectURL(blob);
        if (dead) URL.revokeObjectURL(made);
        else setThumb(made);
      } catch {
        if (!dead) setThumbErr(true);
      }
    })();
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(openAfter) {
    setState('loading');
    try {
      const u = URL.createObjectURL(await fetchFile(client, content));
      setUrl(u);
      setState('done');
      if (openAfter) onOpen?.({ url: u, kind: isVideo ? 'video' : 'image', name: content.body });
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    if (state === 'loading' && !url) load(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  function view() {
    if (url) onOpen?.({ url, kind: isVideo ? 'video' : 'image', name: content.body });
    else load(true);
  }

  if (isImage && url) {
    const { w, h } = content.info || {};
    return (
      <button type="button" className="att-img" onClick={view} aria-label={tr('باز کردن تصویر')}>
        <img src={url} alt={content.body} width={w} height={h} data-testid="att-img" />
        <span className="att-expand"><Icon n="zoom" size={16} /></span>
      </button>
    );
  }

  if (isVideo) {
    return (
      <span className="att-video">
        <button type="button" className="att-video-card" onClick={view} aria-label={tr('پخش ویدیو')} data-testid="att-video">
          <span className="att-video-thumb">
            {thumb && <img src={thumb} alt="" />}
            <span className="att-video-play"><Icon n="play" size={18} /></span>
            {dur > 0 && <span className="att-video-dur num" dir="ltr">{fmtClock(dur)}</span>}
            {state === 'loading' && <span className="att-video-load">…</span>}
          </span>
          <span className="att-video-meta">
            <strong dir="auto">{content.body}</strong>
            <span className="muted" dir="ltr">
              {[tr('ویدیو'), size ? fmtSize(size) : '', thumbErr && !thumb ? tr('بدون پیش‌نمایش') : ''].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        {state === 'error' && <button className="small ghost" onClick={() => load(true)}>{tr('خطا؛ دوباره')}</button>}
      </span>
    );
  }

  if (isAudio && url) return <VoicePlayer url={url} seed={`${content.body}${size}`} dur={dur} />;

  return (
    <span className="att-file">
      <span className="att-ico">
        <Icon n={isImage ? 'image' : isAudio ? 'mic' : 'clip'} size={18} />
      </span>
      <span className="att-file-main">
        <span className="att-name" dir="auto">{content.body}</span>
        <span className="muted att-size">{size ? fmtSize(size) : ''}</span>
      </span>
      {state === 'idle' && (
        <button className="small primary" onClick={() => load(isImage)}>
          {isImage ? tr('نمایش') : isAudio ? tr('پخش') : tr('دریافت')}
        </button>
      )}
      {state === 'loading' && <span className="muted">…</span>}
      {state === 'error' && <button className="small ghost" onClick={() => load(isImage)}>{tr('خطا؛ دوباره')}</button>}
      {state === 'done' && !isImage && !isAudio && url && (
        <a className="small primary btnlink" href={url} download={content.body}>{tr('ذخیره')}</a>
      )}
    </span>
  );
}
