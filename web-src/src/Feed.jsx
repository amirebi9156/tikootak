import { tr } from './i18n.js';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { feedTrendingTags, feedList, feedForYou, feedViews, feedSeen, feedNotInterested, feedLike, feedDelete, feedComments, feedComment, feedUpload, feedPost, feedThumb, commentLike, commentDelete, followToggle, followUnfollow } from './api.js';
import { compressImage, videoMeta, videoPoster } from './media.js';
import { Avatar, Dialog, ShareCtx } from './ui.jsx';
import { usePerson } from './people.js';
import { Icon } from './icons.jsx';
import { fmtDay, fmtTime, fa, ago } from './util.js';
import StoriesBar from './Stories.jsx';
import { useReport } from './Report.jsx';
import { getItem, setItem } from './storage.js';
const ACCEPT = 'video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp,image/gif';
function uploadError(e) {
  if (e.code === 'too_large') return tr("حجم فایل بیشتر از {0} مگابایت است.", [e.max_mb || 150]);
  if (e.code === 'quota_exceeded') return tr("فضای ذخیره‌ی تو پر شده؛ چند پست یا آهنگ قدیمی را پاک کن.");
  if (e.code === 'unsupported_type') return tr("فرمت پشتیبانی نمی‌شود (mp4، webm، mov، jpg، png، webp، gif).");
  if (e.code === 'network') return tr("ارتباط قطع شد. دوباره امتحان کن.");
  if (e.status === 429 || e.code === 'http_429') return tr("امروز خیلی پست گذاشتی؛ کمی بعد دوباره.");
  return tr("آپلود انجام نشد.");
}
function NewPost({
  token,
  onClose,
  onDone
}) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [trend, setTrend] = useState([]);
  useEffect(() => { feedTrendingTags(token).then(d => setTrend(d.tags || [])).catch(() => {}); }, [token]);
  const [pct, setPct] = useState(null);
  const [err, setErr] = useState('');
  const preview = useRef(null);
  useEffect(() => {
    if (!file) {
      preview.current = null;
      return undefined;
    }
    const u = URL.createObjectURL(file);
    preview.current = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  async function go(e) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      setErr(tr("حجم فایل بیشتر از ۱۵۰ مگابایت است. اول آن را کوچک‌تر کن."));
      return;
    }
    setErr('');
    setPct(0);
    try {
      // عکس قبل از آپلود به WebP و حداکثر ۱۶۰۰ پیکسل تبدیل می‌شود
      let send = file.type.startsWith('image/') ? await compressImage(file) : file;
      if (send.size > 150 * 1024 * 1024) {
        setErr(tr("حجم فایل بیشتر از ۱۵۰ مگابایت است."));
        setPct(null);
        return;
      }
      if (file.type.startsWith('video/')) {
        const meta = await videoMeta(file);
        if (meta?.duration > 60000) {
          setErr(tr("مدت ویدیوی پست حداکثر ۶۰ ثانیه است."));
          setPct(null);
          return;
        }
      }
      let post = await feedUpload(token, send, caption.trim(), setPct);
      // پوستر کوچک برای پیش‌نمایش فید و اشتراک‌گذاری (بدون دانلود ویدیو)
      if (file.type.startsWith('video/')) {
        try {
          const poster = await videoPoster(file);
          if (poster) {
            await feedThumb(token, post.id, poster.blob);
            const fresh = await feedPost(token, post.id);
            if (fresh?.thumb) post = fresh;
          }
        } catch { /* پوستر اختیاری است */ }
      }
      onDone(post);
    } catch (x) {
      setErr(uploadError(x));
      setPct(null);
    }
  }
  const busy = pct !== null;
  return <Dialog title={tr("پست جدید")} onClose={busy ? () => {} : onClose}>
      <form className="form" onSubmit={go}>
        <label>{tr("ویدیو یا عکس")}
          <input type="file" accept={ACCEPT} data-testid="feed-file" onChange={e => setFile(e.target.files[0] || null)} disabled={busy} />
        </label>
        {file && (file.type.startsWith('video/') ? <video className="feed-prev" src={preview.current} controls muted playsInline /> : <img className="feed-prev" src={preview.current} alt="" />)}
        <label>{tr("توضیح (اختیاری)")}
          <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={500} rows={2} dir="auto" disabled={busy} />
        <div className="tag-sugg" aria-label={tr("هشتگ‌های پرطرفدار")}>
          <span className="muted">{tr("هشتگ بگذار تا پستت به دست آدم‌های علاقه‌مند برسد")}</span>
          {trend.slice(0, 8).map(t => <button type="button" key={t.tag} className="chip-btn" disabled={busy} onClick={() => setCaption(c => (c && !/\s$/.test(c) ? c + ' ' : c) + '#' + t.tag + ' ')}>#{t.tag}</button>)}
        </div>
        </label>
        {busy && <div className="progress" role="progressbar" aria-valuenow={Math.round(pct * 100)}><span style={{
          width: `${pct * 100}%`
        }} /></div>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>{tr("انصراف")}</button>
          <button className="primary" disabled={!file || busy}>{busy ? tr("{0}٪", [fa(Math.round(pct * 100))]) : tr("انتشار")}</button>
        </div>
      </form>
    </Dialog>;
}

// ---------- نظرها ----------
export function Comments({
  token,
  me,
  post,
  onCount,
  onProfile,
  postOwner
}) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [report, reportDialog] = useReport(token);
  useEffect(() => {
    feedComments(token, post.id).then(d => setList(d.comments)).catch(() => setList([]));
  }, [token, post.id]);
  async function add(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      const c = await feedComment(token, post.id, t);
      setList(l => [...(l || []), c]);
      onCount(1);
    } catch {
      setText(t);
    }
  }
  async function like(c) {
    setList(l => l.map(x => x.id === c.id ? {
      ...x,
      liked: !x.liked,
      likes: x.likes + (x.liked ? -1 : 1)
    } : x));
    try {
      const r = await commentLike(token, c.id);
      setList(l => l.map(x => x.id === c.id ? {
        ...x,
        ...r
      } : x));
    } catch {/* ignore */}
  }
  async function del(c) {
    try {
      await commentDelete(token, c.id);
      setList(l => l.filter(x => x.id !== c.id));
      onCount(-1);
    } catch {/* ignore */}
  }
  return <div className="comments">
      {list === null && <span className="muted">…</span>}
      {list?.length === 0 && <span className="muted">{tr("هنوز نظری نیست.")}</span>}
      {list?.map(c => <div key={c.id} className="cmt" data-testid="comment">
          <button className="plainbtn" onClick={() => onProfile(c.user_id)} aria-label={tr("صفحه {0}", [c.name])}><Avatar name={c.name} id={c.user_id} size={30} /></button>
          <div className="cmt-main">
            <button className="plainbtn cmt-name" onClick={() => onProfile(c.user_id)}>{c.name}</button>
            <span dir="auto">{c.text}</span>
          </div>
          <button className={`like small-like ${c.liked ? 'on' : ''}`} onClick={() => like(c)} aria-pressed={c.liked} aria-label={tr("پسندیدن نظر")}>
            <Icon n="heart" size={14} />{c.likes > 0 ? ` ${fa(c.likes)}` : ''}
          </button>
          {(c.user_id === me || postOwner === me) && <button className="plainbtn muted" onClick={() => del(c)} aria-label={tr("حذف نظر")}><Icon n="close" size={18} /></button>}
          {c.user_id !== me && <button className="plainbtn muted" onClick={() => report('comment', c.id)} aria-label={tr("گزارش نظر")} title={tr("گزارش")}>⚑</button>}
        </div>)}
      {reportDialog}
      <form onSubmit={add} className="comment-form">
        <input value={text} onChange={e => setText(e.target.value)} placeholder={tr("نظر بنویس")} aria-label={tr("نظر")} maxLength={500} dir="auto" />
        <button className="small primary" disabled={!text.trim()}>{tr("ارسال")}</button>
      </form>
    </div>;
}

// لایک و شمارنده یک پست؛ مشترک بین کارت، ریلز و پنجره
function usePost(token, initial) {
  const [p, setP] = useState(initial);
  const like = async () => {
    setP(x => ({
      ...x,
      liked: !x.liked,
      likes: x.likes + (x.liked ? -1 : 1)
    }));
    try {
      const r = await feedLike(token, p.id);
      setP(x => ({
        ...x,
        liked: r.liked,
        likes: r.likes
      }));
    } catch {/* ignore */}
  };
  const bumpComments = d => setP(x => ({
    ...x,
    comments: x.comments + d
  }));
  return [p, like, bumpComments];
}

function useFollow(token, post) {
  const [status, setStatus] = useState(post.follow_status || (post.followed ? 'accepted' : 'none'));
  const toggle = async () => {
    try {
      const r = status === 'none' ? await followToggle(token, post.user_id) : await followUnfollow(token, post.user_id);
      setStatus(r.status || 'none');
    } catch {/* ignore */}
  };
  return [status, toggle];
}
function followLabel(status) {
  return status === 'accepted' ? tr("دنبال می‌کنی") : status === 'pending' ? tr("درخواست شد") : tr("دنبال کردن");
}
function TrackedVideo({
  src,
  onWatch,
  ...rest
}) {
  const ref = useRef(null);
  const max = useRef(0);
  const started = useRef(Date.now());
  const reported = useRef(false);
  function report() {
    const v = ref.current;
    if (reported.current || !onWatch || !v || max.current <= 0) return;
    reported.current = true;
    onWatch(max.current, Date.now() - started.current, Math.round((v.duration || 0) * 1000));
  }
  useEffect(() => () => report(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <video ref={ref} src={src} onTimeUpdate={e => {
    const v = e.currentTarget;
    if (v.duration) max.current = Math.max(max.current, v.currentTime / v.duration);
  }} onPause={report} onEnded={report} {...rest} />;
}

function Media({
  p,
  onWatch,
  ...rest
}) {
  return p.kind === 'video' ? <TrackedVideo src={p.url} poster={p.thumb || undefined} onWatch={onWatch} playsInline preload="metadata" {...rest} /> : <img src={p.url} alt={p.caption} {...rest} />;
}

function PersonName({
  id
}) {
  const person = usePerson(id);
  return <bdi>{person?.name || id.replace(/^@/, '').split(':')[0]}</bdi>;
}

// «یکی از دنبال‌شده‌هایت این پست را پسندید»
export function MutualLikes({
  ids = [],
  total = 0
}) {
  if (!ids.length) return null;
  const extra = Math.max(0, (total || 0) - ids.length);
  return <div className="mutual-like">
      <span className="mutual-avs">
        {ids.slice(0, 3).map(id => <Avatar key={id} name={id} id={id} size={20} />)}
      </span>
      <span className="mutual-txt">
        {ids.length === 1
          ? extra > 0
            ? <><PersonName id={ids[0]} /> {tr("و {0} نفر دیگر این پست را پسندیدند", [fa(extra)])}</>
            : <><PersonName id={ids[0]} /> {tr("این پست را پسندید")}</>
          : <><PersonName id={ids[0]} /> {tr("و")} <PersonName id={ids[1]} /> {tr("این پست را پسندیدند")}</>}
      </span>
    </div>;
}

// ---------- کارت پست (برای پنجره و صفحه پروفایل) ----------
export function PostCard({
  token,
  me,
  post,
  onDeleted,
  onProfile,
  compact = false,
  onBlock,
  onWatch,
  onHidden
}) {
  const [p, like, bump] = usePost(token, post);
  const [open, setOpen] = useState(!compact);
  const [followStatus, toggleFollow] = useFollow(token, post);
  const [menu, setMenu] = useState(false);
  const [report, reportDialog] = useReport(token);
  const share = useContext(ShareCtx);
  async function del() {
    if (!window.confirm(tr("این پست پاک شود؟"))) return;
    try {
      await feedDelete(token, p.id);
      onDeleted?.(p.id);
    } catch {/* ignore */}
  }
  async function hide() {
    setMenu(false);
    try {
      await feedNotInterested(token, p.id);
      onHidden?.(p.id);
    } catch {/* ignore */}
  }
  function block() {
    setMenu(false);
    onBlock?.(p.user_id);
  }
  const when = ago(p.created_at * 1000) || `${fmtDay(p.created_at * 1000)} ${fmtTime(p.created_at * 1000)}`;
  return <article className="post" data-testid="post" data-pid={p.id}>
      <header>
        <button className="plainbtn" onClick={() => onProfile(p.user_id)}><Avatar name={p.name} id={p.user_id} size={44} /></button>
        <div>
          <span className="post-name-row">
            <button className="plainbtn name-btn" onClick={() => onProfile(p.user_id)}><strong>{p.name}</strong></button>
            {p.user_id !== me && <button className={`follow-chip ${followStatus === 'accepted' ? 'on' : ''} ${followStatus === 'pending' ? 'pending' : ''}`} onClick={toggleFollow} aria-pressed={followStatus === 'accepted'}>{followLabel(followStatus)}</button>}
          </span>
          <time className="muted">{when}</time>
        </div>
        {p.user_id === me ? <button className="icon" onClick={del} aria-label={tr("حذف پست")} title={tr("حذف")}><Icon n="close" size={18} /></button> : <span className="post-more">
            <button className="icon" onClick={() => setMenu(m => !m)} aria-label={tr("گزینه‌ها")} aria-expanded={menu}><Icon n="dots" /></button>
            {menu && <span className="post-menu" role="menu">
                <button role="menuitem" onClick={hide}>{tr("علاقه ندارم")}</button>
                <button role="menuitem" onClick={() => { setMenu(false); report('post', p.id); }}>{tr("گزارش")}</button>
                <button role="menuitem" className="danger-text" onClick={block}>{tr("بلاک")}</button>
              </span>}
          </span>}
        {reportDialog}
      </header>
      {p.caption && <Caption className="caption" text={p.caption} />}
      <div className="post-media"><Media p={p} controls onWatch={onWatch} /></div>
      <div className="post-actions">
        <button className={`like ${p.liked ? 'on' : ''}`} onClick={like} aria-pressed={p.liked} aria-label={tr("پسندیدن")}><Icon n="heart" size={20} /><span className="num">{fa(p.likes)}</span></button>
        <button className="like" onClick={() => setOpen(o => !o)} aria-expanded={open}><Icon n="chat" size={18} /> <span>{tr("نظرها")}</span> <span className="num">({fa(p.comments)})</span></button>
        {share && <button className="like" onClick={() => share.sharePost(p)} aria-label={tr("ارسال به چت")}><Icon n="send" size={18} /> <span>{tr("ارسال")}</span></button>}
      </div>
      {!!p.liked_by_following?.length && <MutualLikes ids={p.liked_by_following} total={p.likes} />}
      {open && <Comments token={token} me={me} post={p} postOwner={p.user_id} onCount={bump} onProfile={onProfile} />}
    </article>;
}
export function PostModal({
  token,
  me,
  post,
  onClose,
  onDeleted,
  onProfile,
  onBlock,
  onWatch,
  onHidden
}) {
  return <div className="scrim modal-scrim" onMouseDown={e => {
    if (e.target === e.currentTarget) onClose();
  }}>
      <div className="modal-post" role="dialog" aria-modal="true">
        <button className="icon modal-x" onClick={onClose} aria-label={tr("بستن")}><Icon n="close" size={18} /></button>
        <PostCard token={token} me={me} post={post} onBlock={onBlock} onWatch={onWatch} onDeleted={id => {
        onDeleted?.(id);
        onClose();
      }} onHidden={id => {
        onHidden?.(id);
        onClose();
      }} onProfile={id => {
        onClose();
        onProfile(id);
      }} />
      </div>
    </div>;
}


// ---------- شبکه ----------
export function PostGrid({
  posts,
  onOpen
}) {
  return <div className="pgrid">
      {posts.map(p => <button key={p.id} className="ptile" onClick={() => onOpen(p)} aria-label={p.caption || tr("پست")} data-testid="tile-post" data-pid={p.id}>
          {p.kind === 'video' ? <video src={`${p.url}#t=0.1`} poster={p.thumb || undefined} preload="metadata" muted playsInline /> : <img src={p.url} alt="" loading="lazy" />}
          {p.kind === 'video' && <span className="tile-badge" aria-hidden="true"><Icon n="play" size={12} /></span>}
          {p.likes > 0 && <span className="tile-likes"><Icon n="heart" size={12} /> {fa(p.likes)}</span>}
        </button>)}
    </div>;
}

// ---------- ریلز: هر پست یک صفحه، اسکرول/سوایپ ----------
function Reel({
  token,
  me,
  post,
  active,
  muted,
  onMute,
  onProfile,
  onComments,
  onBlock,
  onWatch,
  onSeen,
  onHidden
}) {
  const [p, like, bump] = usePost(token, post);
  const [report, reportDialog] = useReport(token);
  const [followStatus, toggleFollow] = useFollow(token, post);
  const [menu, setMenu] = useState(false);
  const vref = useRef(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  const watch = useRef({
    max: 0,
    start: Date.now()
  });
  const [burst, setBurst] = useState(0);
  const [prog, setProg] = useState(0);
  const [portrait, setPortrait] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const share = useContext(ShareCtx);
  function reportWatch() {
    const v = vref.current;
    if (watch.current.max <= 0) return;
    onWatch?.(p.id, watch.current.max, Date.now() - watch.current.start, Math.round((v?.duration || 0) * 1000));
    watch.current = {
      max: 0,
      start: Date.now()
    };
  }
  useEffect(() => {
    if (!active) reportWatch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => () => reportWatch(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (active) onSeen?.(p.id); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // یک ضربه: پخش/توقف. دو ضربه پشت‌سرهم: لایک (مثل اینستاگرام)
  const [capOpen, setCapOpen] = useState(false);
  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (!p.liked) like();
      setBurst(b => b + 1);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      const v = vref.current;
      if (v) {
        if (v.paused) v.play().catch(() => {});else v.pause();
        setPaused(v.paused);
      }
    }, 300);
  }
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    if (active) v.play().catch(() => {});else v.pause();
  }, [active]);
  async function hide() {
    setMenu(false);
    try {
      await feedNotInterested(token, p.id);
      onHidden?.(p.id);
    } catch {/* ignore */}
  }
  return <section className={`reel ${portrait ? 'portrait' : ''}`} data-testid="reel" data-pid={p.id}>
      <div className={`reel-media ${portrait ? 'portrait' : ''} ${ready ? 'ready' : 'loading'}`} onClick={tap}>
        {!portrait && (p.thumb || p.kind !== 'video') && <div className="reel-bg" aria-hidden="true" style={{
        backgroundImage: `url(${p.thumb || p.url})`
      }} />}
        {p.kind === 'video' ? <video ref={vref} src={p.url} poster={p.thumb || undefined} loop playsInline muted={muted} preload={active ? 'auto' : 'metadata'} onLoadedData={() => setReady(true)} onPlay={() => setPaused(false)} onLoadedMetadata={e => setPortrait(e.currentTarget.videoHeight >= e.currentTarget.videoWidth * 1.2)} onTimeUpdate={e => {
        const v = e.currentTarget;
        if (v.duration) watch.current.max = Math.max(watch.current.max, v.currentTime / v.duration);
        setProg(v.duration ? v.currentTime / v.duration : 0);
      }} /> : <img src={p.url} alt={p.caption} onLoad={e => { setReady(true); setPortrait(e.currentTarget.naturalHeight >= e.currentTarget.naturalWidth * 1.2); }} />}
        {paused && p.kind === 'video' && <span className="pause-badge" aria-hidden="true"><Icon n="play" size={34} /></span>}
        {burst > 0 && <span key={burst} className="burst" aria-hidden="true"><Icon n="heart" size={90} /></span>}
      </div>
      {p.kind === 'video' && <div className="reel-prog" aria-hidden="true"><i style={{
        width: `${prog * 100}%`
      }} /></div>}
      <div className="reel-info">
        <div className="reel-user-row">
          <button className="plainbtn reel-user" onClick={() => onProfile(p.user_id)}>
            <Avatar name={p.name} id={p.user_id} size={36} /><strong>{p.name}</strong>
          </button>
          {p.user_id !== me && <button className={`follow-chip ${followStatus === 'accepted' ? 'on' : ''} ${followStatus === 'pending' ? 'pending' : ''}`} onClick={toggleFollow} aria-pressed={followStatus === 'accepted'}>{followLabel(followStatus)}</button>}
        </div>
        {p.caption && <div className={`reel-cap ${capOpen ? 'open' : ''}`} onClick={() => setCapOpen(o => !o)}><Caption text={p.caption} /></div>}
        {!!p.liked_by_following?.length && <MutualLikes ids={p.liked_by_following} total={p.likes} />}
      </div>
      <div className="reel-side">
        <button className={`rbtn ${p.liked ? 'on' : ''}`} onClick={like} aria-pressed={p.liked} aria-label={tr("پسندیدن")}><Icon n="heart" size={28} /><span>{p.likes ? fa(p.likes) : ''}</span></button>
        <button className="rbtn" onClick={() => onComments(p, bump)} aria-label={tr("نظرها")}><Icon n="chat" size={26} /><span>{p.comments ? fa(p.comments) : ''}</span></button>
        {share && <button className="rbtn" onClick={() => share.sharePost(p)} aria-label={tr("ارسال به چت")}><Icon n="send" size={24} /><span aria-hidden="true">&nbsp;</span></button>}
        {p.kind === 'video' && <button className="rbtn" onClick={onMute} aria-label={muted ? tr("روشن کردن صدا") : tr("بی‌صدا")}><Icon n={muted ? 'volumeoff' : 'volume'} size={24} /><span aria-hidden="true">&nbsp;</span></button>}
        <span className="post-more">
          <button className="rbtn" onClick={() => setMenu(m => !m)} aria-label={tr("گزینه‌ها")} aria-expanded={menu}><Icon n="dots" size={24} /><span aria-hidden="true">&nbsp;</span></button>
          {menu && <span className="post-menu reel-menu" role="menu">
              <button role="menuitem" onClick={hide}>{tr("علاقه ندارم")}</button>
              <button role="menuitem" onClick={() => { setMenu(false); report('post', p.id); }}>{tr("گزارش")}</button>
              <button role="menuitem" className="danger-text" onClick={() => {
            setMenu(false);
            onBlock?.(p.user_id);
          }}>{tr("بلاک")}</button>
            </span>}
          {reportDialog}
        </span>
      </div>
    </section>;
}

// توضیح پست با هشتگ‌های کلیک‌پذیر (به جستجوی اکسپلور می‌رود)
export function Caption({ text, className, tag: Tag = 'p' }) {
  const share = useContext(ShareCtx);
  const parts = String(text || '').split(/(#[\p{L}\p{N}_]{2,30})/gu);
  return <Tag className={className} dir="auto">{parts.map((s, i) => i % 2 ? <button key={i} type="button" className="hashtag" onClick={e => { e.stopPropagation(); share?.openTag?.(s.slice(1)); }}>{s}</button> : s)}</Tag>;
}

export function Reels({
  token,
  me,
  posts,
  more,
  busy,
  loadMore,
  onProfile,
  start = 0,
  onWatch,
  onSeen,
  onBlock,
  onHidden
}) {
  const box = useRef(null);
  const [active, setActive] = useState(start);
  const [muted, setMuted] = useState(true);
  const [sheet, setSheet] = useState(null); // { post, bump }
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    if (start) el.scrollTop = start * el.clientHeight;
    const io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) setActive(Number(e.target.dataset.i));
    }, {
      root: el,
      threshold: [0.6]
    });
    el.querySelectorAll('[data-i]').forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [posts.length, start]);
  useEffect(() => {
    if (more && !busy && active >= posts.length - 2) loadMore();
  }, [active, posts.length, more, busy, loadMore]);
  useEffect(() => {
    const p = posts[active];
    if (p) onSeen?.(p.id); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, posts]);
  const go = useCallback(d => {
    const el = box.current;
    if (el) el.scrollBy({
      top: d * el.clientHeight,
      behavior: 'smooth'
    });
  }, []);
  useEffect(() => {
    const key = e => {
      if (e.target.closest('input,textarea') || sheet) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, sheet]);
  return <div className="reels-wrap">
      <div className="reels" ref={box} data-testid="reels">
        {posts.map((p, i) => <div key={p.id} data-i={i} className="reel-slot">
            <Reel token={token} me={me} post={p} active={i === active} muted={muted} onMute={() => setMuted(m => !m)} onProfile={onProfile} onWatch={onWatch} onSeen={onSeen} onBlock={onBlock} onHidden={onHidden} onComments={(post, bump) => setSheet({
          post,
          bump
        })} />
          </div>)}
      </div>
      {sheet && <div className="sheet" role="dialog" aria-label={tr("نظرها")}>
          <header><strong>{tr("نظرها")}</strong><button className="icon" onClick={() => setSheet(null)} aria-label={tr("بستن")}><Icon n="close" size={18} /></button></header>
          <Comments token={token} me={me} post={sheet.post} postOwner={sheet.post.user_id} onCount={sheet.bump} onProfile={id => {
        setSheet(null);
        onProfile(id);
      }} />
        </div>}
    </div>;
}

// ---------- ریلز تمام‌صفحه (از اکسپلور) ----------
export function ReelsViewer({
  token,
  me,
  posts,
  start,
  more,
  busy,
  loadMore,
  onClose,
  onProfile,
  onWatch,
  onSeen,
  onBlock,
  onHidden
}) {
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return <div className="rv" role="dialog" aria-label={tr("ریلز")} aria-modal="true" data-testid="reels-viewer">
      <button className="rv-x" onClick={onClose} aria-label={tr("بستن ریلز")}><Icon n="back" size={22} /></button>
      <Reels token={token} me={me} posts={posts} start={start} more={more} busy={busy} loadMore={loadMore} onWatch={onWatch} onSeen={onSeen} onBlock={onBlock} onHidden={onHidden} onProfile={id => {
      onClose();
      onProfile(id);
    }} />
    </div>;
}


// ---------- صفحه فید ----------
export default function Feed({
  token,
  me,
  onBack,
  onProfile,
  compose = 0,
  onBlock
}) {
  const [posts, setPosts] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dlg, setDlg] = useState(false);
  const [mode, setMode] = useState(() => {
    try {
      return getItem('tikootak.feedmode') || (window.matchMedia?.('(max-width: 760px)').matches ? 'reels' : 'list');
    } catch {
      return 'reels';
    }
  });
  const [scope, setScope] = useState('foryou');
  const [modal, setModal] = useState(null);
  const gen = useRef(0);
  const busyRef = useRef(false);
  const loadedRef = useRef([]);
  const seenRef = useRef(new Set());
  const seenQueue = useRef(new Set());
  const viewQueue = useRef([]);
  useEffect(() => {
    if (compose) setDlg(true);
  }, [compose]);
  useEffect(() => {
    loadedRef.current = (posts || []).map(p => p.id);
  }, [posts]);
  const setModeSave = m => {
    setMode(m);
    setItem('tikootak.feedmode', m);
  };

  const flushViews = useCallback(() => {
    const evs = viewQueue.current.splice(0, 50);
    if (evs.length) feedViews(token, evs).catch(() => {});
  }, [token]);
  useEffect(() => {
    const t = setInterval(flushViews, 8000);
    const onVis = () => {
      if (document.hidden) flushViews();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      flushViews();
    };
  }, [flushViews]);
  useEffect(() => {
    const t = setInterval(() => {
      const ids = [...seenQueue.current];
      seenQueue.current.clear();
      if (ids.length) feedSeen(token, ids).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [token]);
  const onWatch = useCallback((id, pct, ms, dur) => {
    viewQueue.current.push({
      id,
      pct,
      ms,
      dur
    });
    if (viewQueue.current.length >= 20) flushViews();
  }, [flushViews]);
  const onSeen = useCallback(id => {
    if (!id || seenRef.current.has(id)) return;
    seenRef.current.add(id);
    seenQueue.current.add(id);
  }, []);

  const load = useCallback(async before => {
    if (busyRef.current) return;
    busyRef.current = true;
    const g = before ? gen.current : ++gen.current;
    setBusy(true);
    setErr('');
    try {
      let d;
      if (scope === 'foryou') {
        d = await feedForYou(token, {
          exclude: loadedRef.current,
          limit: 20
        });
      } else {
        d = await feedList(token, {
          before,
          following: scope === 'following'
        });
      }
      if (g !== gen.current) return;
      setPosts(cur => before ? [...(cur || []), ...d.posts] : d.posts);
      setMore(d.posts.length >= (scope === 'foryou' ? 20 : 8));
    } catch {
      if (g === gen.current) {
        setErr(tr("فید بارگذاری نشد."));
        if (!before) setPosts([]);
      }
    }
    if (g === gen.current) {
      busyRef.current = false;
      setBusy(false);
    }
  }, [token, scope]);
  useEffect(() => {
    busyRef.current = false;
    setPosts(null);
    loadedRef.current = [];
    load();
  }, [load]);
  const loadMore = useCallback(() => {
    if (!posts?.length || busy || busyRef.current) return;
    if (scope === 'foryou') load(true);
    else load(`${posts[posts.length - 1].created_at}_${posts[posts.length - 1].id}`);
  }, [load, posts, busy, scope]);
  useEffect(() => {
    if (mode === 'reels' || !posts?.length) return undefined;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) onSeen(e.target.dataset.pid);
    }), {
      threshold: 0.6
    });
    document.querySelectorAll('[data-pid]').forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [mode, posts, onSeen]);
  async function blockUser(uid) {
    const ok = await onBlock?.(uid);
    if (ok) setPosts(l => (l || []).filter(x => x.user_id !== uid));
  }
  const hidePost = id => setPosts(l => (l || []).filter(x => x.id !== id));
  return <div className={`feed ${mode === 'reels' ? 'full' : ''}`}>
      <header className="chat-head feed-head">
        <button className="icon back" onClick={onBack} aria-label={tr("بازگشت")}><Icon n="back" /></button>
        <div className="chat-title"><strong>{tr("فید")}</strong></div>
        <div className="seg" role="group" aria-label={tr("نحوه نمایش")}>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setModeSave('list')} aria-pressed={mode === 'list'}>{tr("لیست")}</button>
          <button className={mode === 'reels' ? 'on' : ''} onClick={() => setModeSave('reels')} aria-pressed={mode === 'reels'}>{tr("ریلز")}</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setModeSave('grid')} aria-pressed={mode === 'grid'}>{tr("شبکه")}</button>
        </div>
        <button className="feed-list-btn" onClick={() => setModeSave('list')} aria-label={tr("نمایش لیستی")} title={tr("نمایش لیستی")}><Icon n="rows" size={22} /></button>
        <button className="primary small" onClick={() => setDlg(true)} aria-label={tr("پست جدید")}>{tr("پست جدید")}</button>
      </header>
      <StoriesBar token={token} me={me} onProfile={onProfile} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={scope === 'foryou'} className={scope === 'foryou' ? 'on' : ''} onClick={() => setScope('foryou')}>{tr("برای تو")}</button>
        <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>{tr("همه")}</button>
        <button role="tab" aria-selected={scope === 'following'} className={scope === 'following' ? 'on' : ''} onClick={() => setScope('following')}>{tr("دنبال‌شده‌ها")}</button>
      </div>

      {posts === null && <p className="muted center pad">{tr("در حال بارگذاری…")}</p>}
      {posts?.length === 0 && !err && <p className="empty-chat">{scope === 'following' ? tr("هنوز کسی را دنبال نکرده‌ای، یا پستی نگذاشته‌اند.") : scope === 'foryou' ? tr("چند پست را ببین تا فیدت هوشمند شود.") : tr("هنوز پستی نیست. اولین نفر باش.")}</p>}
      {err && <p className="error pad" role="alert">{err} <button className="small ghost" onClick={() => load()}>{tr("دوباره")}</button></p>}

      {posts?.length > 0 && mode === 'reels' && <Reels key={scope} token={token} me={me} posts={posts} more={more} busy={busy} loadMore={loadMore} onProfile={onProfile} onWatch={onWatch} onSeen={onSeen} onBlock={blockUser} onHidden={hidePost} />}
      {posts?.length > 0 && mode === 'list' && <div className="feed-list timeline-feed">
          {posts.map(p => <PostCard key={p.id} token={token} me={me} post={p} compact onProfile={onProfile} onWatch={onWatch} onHidden={hidePost} onBlock={blockUser} onDeleted={id => setPosts(l => l.filter(x => x.id !== id))} />)}
          {more && <button className="older" disabled={busy} onClick={loadMore}>{busy ? tr("صبر کن…") : tr("بیشتر")}</button>}
        </div>}
      {posts?.length > 0 && mode === 'grid' && <div className="feed-list">
          <PostGrid posts={posts} onOpen={setModal} />
          {more && <button className="older" disabled={busy} onClick={loadMore}>{busy ? tr("صبر کن…") : tr("بیشتر")}</button>}
        </div>}

      {modal && <PostModal token={token} me={me} post={modal} onClose={() => setModal(null)} onProfile={onProfile} onBlock={blockUser} onWatch={onWatch} onHidden={hidePost} onDeleted={id => setPosts(l => l.filter(x => x.id !== id))} />}
      {dlg && <NewPost token={token} onClose={() => setDlg(false)} onDone={post => {
        setDlg(false);
        setPosts(l => [post, ...(l || [])]);
      }} />}
    </div>;
}
