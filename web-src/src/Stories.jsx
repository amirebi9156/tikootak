import { Icon } from './icons.jsx';
import { tr } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storiesList, storyView, storyViews, storyDelete, storyUpload } from './api.js';
import { compressImage } from './media.js';
import { Avatar, Dialog } from './ui.jsx';
import { fa, fmtTime } from './util.js';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
const IMAGE_MS = 5000;
const MAX_VIDEO_SEC = 60;
function videoDuration(file) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      res(v.duration);
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => res(0);
    v.src = URL.createObjectURL(file);
  });
}
function NewStory({
  token,
  onClose,
  onDone
}) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [pct, setPct] = useState(null);
  const [err, setErr] = useState('');
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  async function pick(f) {
    setErr('');
    if (!f) {
      setFile(null);
      return;
    }
    if (f.type.startsWith('video/') && (await videoDuration(f)) > MAX_VIDEO_SEC) {
      setErr(tr("ویدیوی استوری حداکثر {0} ثانیه است.", [fa(MAX_VIDEO_SEC)]));
      setFile(null);
      return;
    }
    // عکس استوری هم فشرده می‌شود (۲۴ ساعت عمر دارد و حجمش مهم است)
    if (f.type.startsWith('image/')) f = await compressImage(f);
    setFile(f);
  }
  async function go(e) {
    e.preventDefault();
    if (!file) return;
    setPct(0);
    setErr('');
    try {
      onDone(await storyUpload(token, file, caption.trim(), setPct));
    } catch (x) {
      setErr(x.code === 'too_large' ? tr("حجم فایل بیشتر از {0} مگابایت است.", [x.max_mb || 50]) : x.code === 'unsupported_type' ? tr("فرمت پشتیبانی نمی‌شود.") : tr("آپلود نشد."));
      setPct(null);
    }
  }
  const busy = pct !== null;
  return <Dialog title={tr("استوری جدید")} onClose={busy ? () => {} : onClose}>
      <form className="form" onSubmit={go}>
        <label>{tr("عکس یا ویدیو (تا ۲۴ ساعت دیده می‌شود)")}
          <input type="file" accept={ACCEPT} data-testid="story-file" onChange={e => pick(e.target.files[0])} disabled={busy} />
        </label>
        {file && (file.type.startsWith('video/') ? <video className="feed-prev" src={url} controls muted playsInline /> : <img className="feed-prev" src={url} alt="" />)}
        <label>{tr("متن کوتاه (اختیاری)")}<input value={caption} onChange={e => setCaption(e.target.value)} maxLength={200} dir="auto" disabled={busy} /></label>
        {busy && <div className="progress" role="progressbar"><span style={{
          width: `${pct * 100}%`
        }} /></div>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row"><button type="button" className="ghost" onClick={onClose} disabled={busy}>{tr("انصراف")}</button><button className="primary" disabled={!file || busy}>{tr("انتشار")}</button></div>
      </form>
    </Dialog>;
}
function Viewers({
  token,
  story,
  onClose,
  onProfile
}) {
  const [list, setList] = useState(null);
  useEffect(() => {
    storyViews(token, story.id).then(d => setList(d.views)).catch(() => setList([]));
  }, [token, story.id]);
  return <div className="sheet story-sheet" role="dialog" aria-label={tr("بیننده‌ها")} onClick={e => e.stopPropagation()}>
      <header><strong>{tr("بیننده‌ها ({0})", [fa(list?.length || 0)])}</strong><button className="icon" onClick={onClose} aria-label={tr("بستن بیننده‌ها")}><Icon n="close" size={18} /></button></header>
      {list?.length === 0 && <p className="muted">{tr("هنوز کسی ندیده.")}</p>}
      <ul className="plain">
        {list?.map(v => <li key={v.user_id}>
            <button className="room" onClick={() => onProfile(v.user_id)}><Avatar name={v.name} id={v.user_id} size={36} /><div className="room-main"><strong>{v.name}</strong></div><span className="muted">{fmtTime(v.viewed_at * 1000)}</span></button>
          </li>)}
      </ul>
    </div>;
}

// نمایشگر تمام‌صفحه: گروه‌ها پشت سر هم، هر گروه چند استوری
function Viewer({
  token,
  me,
  groups,
  start,
  onClose,
  onChanged,
  onProfile
}) {
  const [gi, setGi] = useState(start);
  const [si, setSi] = useState(() => {
    const g = groups[start];
    const firstUnseen = g.stories.findIndex(s => !s.seen);
    return g.user_id === me || firstUnseen < 0 ? 0 : firstUnseen;
  });
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showViews, setShowViews] = useState(false);
  const vref = useRef(null);
  const g = groups[gi];
  const s = g?.stories[si];
  const next = useCallback(() => {
    if (si + 1 < g.stories.length) {
      setSi(si + 1);
      setProgress(0);
      return;
    }
    if (gi + 1 < groups.length) {
      setGi(gi + 1);
      setSi(0);
      setProgress(0);
      return;
    }
    onClose();
  }, [si, gi, g, groups.length, onClose]);
  const prev = useCallback(() => {
    if (si > 0) {
      setSi(si - 1);
      setProgress(0);
      return;
    }
    if (gi > 0) {
      const pg = groups[gi - 1];
      setGi(gi - 1);
      setSi(pg.stories.length - 1);
      setProgress(0);
    }
  }, [si, gi, groups]);

  // ثبت دیده‌شدن
  useEffect(() => {
    if (s && g.user_id !== me) storyView(token, s.id).then(onChanged).catch(() => {});
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // زمان‌بندی عکس‌ها
  useEffect(() => {
    if (!s || s.kind === 'video' || paused || showViews) return undefined;
    const t0 = Date.now() - progress * IMAGE_MS;
    const iv = setInterval(() => {
      const p = (Date.now() - t0) / IMAGE_MS;
      if (p >= 1) {
        clearInterval(iv);
        next();
      } else setProgress(p);
    }, 50);
    return () => clearInterval(iv);
  }, [s?.id, paused, showViews, next]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    if (paused || showViews) v.pause();else v.play().catch(() => {});
  }, [paused, showViews, s?.id]);
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') onClose();else if (e.key === 'ArrowLeft') next();else if (e.key === 'ArrowRight') prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [next, prev, onClose]);
  async function del() {
    if (!window.confirm(tr("این استوری پاک شود؟"))) return;
    try {
      await storyDelete(token, s.id);
      onChanged();
      next();
    } catch {/* ignore */}
  }
  if (!s) return null;
  return <div className="story-view" role="dialog" aria-modal="true" aria-label={tr("استوری")} data-testid="story-viewer">
      <div className="story-bars">
        {g.stories.map((x, i) => <span key={x.id}><i style={{
          width: `${(i < si ? 1 : i === si ? progress : 0) * 100}%`
        }} /></span>)}
      </div>
      <header className="story-head">
        <button className="plainbtn reel-user" onClick={() => {
        onClose();
        onProfile(g.user_id);
      }}><Avatar name={g.name} id={g.user_id} size={36} /><strong>{g.name}</strong></button>
        <time className="muted">{fmtTime(s.created_at * 1000)}</time>
        <span className="grow" />
        {s.kind === 'video' && <button className="icon" onClick={() => setMuted(m => !m)} aria-label={muted ? tr("روشن کردن صدا") : tr("بی‌صدا")}>{muted ? '🔇' : '🔊'}</button>}
        {g.user_id === me && <button className="icon" onClick={del} aria-label={tr("حذف استوری")}><Icon n="trash" size={20} /></button>}
        <button className="icon" onClick={onClose} aria-label={tr("بستن استوری")}><Icon n="close" size={18} /></button>
      </header>
      <div className="story-media" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
        {s.kind === 'video' ? <video key={s.id} ref={vref} src={s.url} playsInline muted={muted} autoPlay onTimeUpdate={e => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} onEnded={next} /> : <img key={s.id} src={s.url} alt={s.caption} />}
        <button className="story-zone left" onClick={next} aria-label={tr("بعدی")} />
        <button className="story-zone right" onClick={prev} aria-label={tr("قبلی")} />
      </div>
      {s.caption && <p className="story-cap" dir="auto">{s.caption}</p>}
      {g.user_id === me && <button className="story-views" onClick={() => setShowViews(true)} data-testid="story-views"><Icon n="eye" size={16} /> {fa(s.views || 0)} {tr("بیننده")}</button>}
      {showViews && <Viewers token={token} story={s} onClose={() => setShowViews(false)} onProfile={id => {
      onClose();
      onProfile(id);
    }} />}
    </div>;
}
export default function StoriesBar({
  token,
  me,
  onProfile
}) {
  const [groups, setGroups] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => storiesList(token).then(d => setGroups(d.groups)).catch(() => setGroups(g => g || [])), [token]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  const mine = groups?.find(g => g.user_id === me);
  const others = (groups || []).filter(g => g.user_id !== me);
  const order = mine ? [mine, ...others] : others; // ترتیب نمایش و پخش
  return <div className="stories" aria-label={tr("استوری‌ها")} data-testid="stories-bar">
      <div className="story-item mine-item">
        <div className="story-av-wrap">
          <button className={`ring ${mine ? mine.all_seen ? 'seen' : '' : 'none'}`} onClick={() => mine ? setOpen(0) : setAdding(true)} aria-label={mine ? tr("استوری من") : tr("افزودن استوری")}>
            <Avatar id={me} size={54} />
          </button>
          <button className="add-dot" onClick={() => setAdding(true)} aria-label={tr("استوری جدید")} data-testid="add-story"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></button>
        </div>
        <span>{tr("استوری من")}</span>
      </div>
      {others.map(g => <div className="story-item" key={g.user_id}>
          <div className="story-av-wrap"><button className={`ring ${g.all_seen ? 'seen' : ''}`} onClick={() => setOpen(order.indexOf(g))} aria-label={tr("استوری {0}", [g.name])} data-testid="story-ring">
            <Avatar name={g.name} id={g.user_id} size={54} />
          </button></div>
          <span>{g.name}</span>
        </div>)}
      {open !== null && order[open] && <Viewer token={token} me={me} groups={order} start={open} onClose={() => {
      setOpen(null);
      load();
    }} onChanged={load} onProfile={onProfile} />}
      {adding && <NewStory token={token} onClose={() => setAdding(false)} onDone={() => {
      setAdding(false);
      load();
    }} />}
    </div>;
}