import { tr } from './i18n.js';
import { useCallback, useEffect, useState } from 'react';
import { trackPlaylists, musicTracks, musicUpload, musicSetCover, musicDeleteTrack, playlistsList, playlistGet, playlistCreate, playlistPatch, playlistDelete, playlistAdd, playlistRemove } from './api.js';
import { Dialog } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fa } from './util.js';
import { Cover, PlaylistCover, readTags } from './cover.jsx';
const ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/opus,audio/wav,audio/flac,audio/webm,.mp3,.m4a,.flac,.ogg,.opus,.wav';
const guessTitle = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac'
};
const mimeOf = f => f.type || MIME_BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || '';
function Row({
  t,
  onPlay,
  children,
  active
}) {
  return <li className={`trk ${active ? 'on' : ''}`} data-testid="track">
      <button className="plainbtn trk-cover" onClick={onPlay} aria-label={tr("پخش {0}", [t.title])}><Cover src={t.cover} seed={t.title} size={48} /><span className="play-dot">▶</span></button>
      <div className="trk-main"><strong dir="auto">{t.title}</strong><span className="muted" dir="auto">{t.artist || t.owner}</span>
        {t.playlists?.length > 0 && <span className="trk-pls" data-testid="trk-pls">{t.playlists.slice(0, 2).map(p => <em key={p.id}>{p.name}</em>)}{t.playlists.length > 2 && <em>+{fa(t.playlists.length - 2)}</em>}</span>}
      </div>
      {children}
    </li>;
}
export function AddTo({
  token,
  track,
  ensure,
  onClose,
  onChanged
}) {
  // track: آهنگ موجود در کتابخانه؛ ensure: برای آهنگ چت، اول آن را به کتابخانه می‌آورد (آپلود با پیشرفت)
  const [lists, setLists] = useState(null);
  const [inSet, setInSet] = useState(new Set());
  const [trk, setTrk] = useState(track || null);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    playlistsList(token, 'mine').then(d => setLists(d.playlists)).catch(() => setLists([]));
    if (track?.id) trackPlaylists(token, track.id).then(d => setInSet(new Set(d.playlists.map(p => p.id)))).catch(() => {});
  }, [token, track?.id]);
  async function resolve() {
    if (trk) return trk;
    setProg(0);
    try {
      const t = await ensure(setProg);
      setTrk(t);
      const d = await trackPlaylists(token, t.id).catch(() => ({ playlists: [] }));
      setInSet(new Set(d.playlists.map(p => p.id)));
      return t;
    } finally {
      setProg(null);
    }
  }
  async function toggle(p) {
    setErr('');
    setBusy(p.id);
    try {
      const t = await resolve();
      const has = new Set((await trackPlaylists(token, t.id)).playlists.map(x => x.id)).has(p.id);
      if (has) await playlistRemove(token, p.id, t.id); else await playlistAdd(token, p.id, t.id);
      setInSet(prev => { const n = new Set(prev); if (has) n.delete(p.id); else n.add(p.id); return n; });
      onChanged?.();
    } catch (e) {
      setErr(e?.code === 'quota_exceeded' ? tr("فضای ذخیره‌سازی‌ات پر است.") : e?.code === 'too_large' ? tr("فایل از سقف مجاز بزرگ‌تر است.") : tr("انجام نشد."));
    }
    setBusy('');
  }
  async function create(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setErr('');
    try {
      const p = await playlistCreate(token, n, false);
      setLists(l => [p, ...(l || [])]);
      setName('');
      await toggle(p);
    } catch {
      setErr(tr("ساخته نشد."));
    }
  }
  return <Dialog title={tr("افزودن به پلی‌لیست")} onClose={onClose}>
      <div className="form">
        {lists === null && <p className="muted">…</p>}
        {lists?.length === 0 && <p className="muted">{tr("هنوز پلی‌لیستی نداری؛ یکی بساز.")}</p>}
        <ul className="plain addto-list">{lists?.map(p => <li key={p.id}>
            <button type="button" className={`ghost addto-row ${inSet.has(p.id) ? 'on' : ''}`} disabled={!!busy} aria-pressed={inSet.has(p.id)} onClick={() => toggle(p)} data-testid="addto-row">
              <span className="addto-tick">{inSet.has(p.id) ? <Icon n="check" size={16} /> : null}</span>
              <span dir="auto">{p.name}</span>
            </button>
          </li>)}</ul>
        {prog !== null && <div className="progress" role="progressbar" aria-label={tr("در حال آماده‌سازی آهنگ")}><span style={{ width: `${Math.max(0.05, prog) * 100}%` }} /></div>}
        <form className="row" onSubmit={create}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tr("پلی‌لیست جدید…")} aria-label={tr("نام پلی‌لیست جدید")} className="grow" maxLength={80} data-testid="addto-new" />
          <button className="small" disabled={!name.trim() || !!busy}>{tr("ساخت و افزودن")}</button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row"><button type="button" className="primary" onClick={onClose}>{tr("بستن")}</button></div>
      </div>
    </Dialog>;
}
function NewList({
  token,
  onClose,
  onDone
}) {
  const [name, setName] = useState('');
  const [pub, setPub] = useState(false);
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    try {
      onDone(await playlistCreate(token, name.trim(), pub));
    } catch {
      setErr(tr("ساخته نشد."));
    }
  }
  return <Dialog title={tr("پلی‌لیست جدید")} onClose={onClose}>
      <form className="form" onSubmit={go}>
        <label>{tr("نام")}<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
        <label className="check"><input type="checkbox" checked={pub} onChange={e => setPub(e.target.checked)} /> {tr("عمومی (همه کاربران ببینند و گوش بدهند)")}</label>
        {err && <p className="error">{err}</p>}
        <div className="row"><button type="button" className="ghost" onClick={onClose}>{tr("انصراف")}</button><button className="primary">{tr("ساخت")}</button></div>
      </form>
    </Dialog>;
}
function PlaylistView({
  token,
  me,
  id,
  player,
  onBack,
  onChanged
}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [addFor, setAddFor] = useState(null);
  const load = useCallback(() => playlistGet(token, id).then(setData).catch(() => setErr(tr("پلی‌لیست پیدا نشد."))), [token, id]);
  useEffect(() => {
    load();
  }, [load]);
  if (err) return <div className="music-body"><button className="ghost" onClick={onBack}>{tr("بازگشت")}</button><p className="error">{err}</p></div>;
  if (!data) return <div className="music-body"><p className="muted">…</p></div>;
  const {
    playlist: p,
    tracks
  } = data;
  const mine = p.user_id === me;
  return <div className="music-body">
      <div className="row between">
        <button className="ghost" onClick={onBack}>{tr("بازگشت")}</button>
        {tracks.length > 0 && <button className="primary small" onClick={() => player.play(tracks, 0)}>{tr("پخش همه")}</button>}
      </div>
      <div className="pl-head">
        <PlaylistCover covers={p.covers} seed={p.name} size={96} />
        <h3 dir="auto">{p.name}<br /><span className="muted small-note">{p.is_public ? tr("عمومی") : tr("خصوصی")} · {p.owner} · {fa(tracks.length)} {tr("آهنگ")}</span></h3>
      </div>
      {mine && <div className="row">
          <button className="ghost small" onClick={async () => {
        await playlistPatch(token, p.id, {
          is_public: !p.is_public
        });
        load();
        onChanged();
      }}>
            {p.is_public ? tr("خصوصی کن") : tr("عمومی کن")}
          </button>
          <button className="ghost small" onClick={async () => {
        if (window.confirm(tr("پلی‌لیست پاک شود؟ (آهنگ‌ها پاک نمی‌شوند)"))) {
          await playlistDelete(token, p.id);
          onChanged();
          onBack();
        }
      }}>{tr("حذف پلی‌لیست")}</button>
        </div>}
      {tracks.length === 0 && <p className="muted">{tr("خالی است.")}</p>}
      <ul className="plain">
        {tracks.map((t, i) => <Row key={t.id} t={t} active={player.track?.id === t.id} onPlay={() => player.play(tracks, i)}>
            {!mine && <button className="ghost small" onClick={() => setAddFor(t)}>{tr("+ پلی‌لیست")}</button>}
            {mine && <button className="icon" aria-label={tr("حذف از پلی‌لیست")} title={tr("حذف از پلی‌لیست")} onClick={async () => {
          await playlistRemove(token, p.id, t.id);
          load();
          onChanged();
        }}><Icon n="close" size={18} /></button>}
          </Row>)}
      </ul>
      {addFor && <AddTo token={token} track={addFor} onClose={() => setAddFor(null)} />}
    </div>;
}
function Songs({
  token,
  player
}) {
  const [tracks, setTracks] = useState(null);
  const [busy, setBusy] = useState(null); // { name, pct }
  const [err, setErr] = useState('');
  const [addFor, setAddFor] = useState(null);
  const load = useCallback(() => musicTracks(token).then(d => setTracks(d.tracks)).catch(() => setTracks([])), [token]);
  useEffect(() => {
    load();
  }, [load]);
  async function upload(files) {
    setErr('');
    for (const f of files) {
      const m = mimeOf(f);
      setBusy({
        name: f.name,
        pct: 0
      });
      try {
        const tags = await readTags(f);
        const t = await musicUpload(token, new File([f], f.name, {
          type: m
        }), tags.title || guessTitle(f.name), tags.artist || '', pct => setBusy({
          name: f.name,
          pct
        }));
        if (tags.cover) await musicSetCover(token, t.id, tags.cover).catch(() => {});
      } catch (e) {
        setErr(e.code === 'too_large' ? tr("«{0}» بزرگ‌تر از {1} مگابایت است.", [f.name, e.max_mb || 60]) : e.code === 'unsupported_type' ? tr("«{0}»: فرمت پشتیبانی نمی‌شود.", [f.name]) : tr("«{0}» آپلود نشد.", [f.name]));
      }
    }
    setBusy(null);
    load();
  }
  return <div className="music-body">
      <label className="primary btnlike">
        {tr("افزودن آهنگ")} <input type="file" accept={ACCEPT} multiple hidden data-testid="music-file" onChange={e => {
        upload([...e.target.files]);
        e.target.value = '';
      }} />
      </label>
      {busy && <div className="progress" role="progressbar"><span style={{
        width: `${busy.pct * 100}%`
      }} /></div>}
      {busy && <span className="muted small-note">{busy.name}</span>}
      {err && <p className="error" role="alert">{err}</p>}
      {tracks?.length === 0 && !busy && <p className="muted">{tr("هنوز آهنگی نداری.")}</p>}
      <ul className="plain">
        {tracks?.map((t, i) => <Row key={t.id} t={t} active={player.track?.id === t.id} onPlay={() => player.play(tracks, i)}>
            <button className="ghost small" onClick={() => setAddFor(t)}>{tr("+ پلی‌لیست")}</button>
            <button className="icon" aria-label={tr("حذف آهنگ")} title={tr("حذف آهنگ")} onClick={async () => {
          if (window.confirm(tr("«{0}» برای همیشه پاک شود؟", [t.title]))) {
            await musicDeleteTrack(token, t.id);
            load();
          }
        }}><Icon n="close" size={18} /></button>
          </Row>)}
      </ul>
      {addFor && <AddTo token={token} track={addFor} onChanged={load} onClose={() => setAddFor(null)} />}
    </div>;
}
function Lists({
  token,
  scope,
  onOpen,
  reload
}) {
  const [lists, setLists] = useState(null);
  useEffect(() => {
    playlistsList(token, scope).then(d => setLists(d.playlists)).catch(() => setLists([]));
  }, [token, scope, reload]);
  return <>
      {lists === null && <p className="muted pad">…</p>}
      {lists?.length === 0 && <p className="empty-chat">{scope === 'public' ? tr("هنوز پلی‌لیست عمومی نیست.") : tr("هنوز پلی‌لیستی نساخته‌ای.")}</p>}
      <div className="pl-grid">
        {lists?.map(p => <button key={p.id} className="pl-tile" onClick={() => onOpen(p.id)} data-testid="playlist">
            <PlaylistCover covers={p.covers} seed={p.name} size={150} />
            <strong dir="auto">{p.name}</strong>
            <span className="muted">{tr("{0} آهنگ · {1}", [fa(p.count), p.owner])}{p.is_public ? tr(" · عمومی") : ''}</span>
          </button>)}
      </div>
    </>;
}
export default function Music({
  token,
  me,
  player,
  onBack,
  initial = null
}) {
  const [tab, setTab] = useState('mine'); // mine | public | songs
  const [open, setOpen] = useState(initial);
  const [dlg, setDlg] = useState(false);
  const [reload, setReload] = useState(0);
  const bump = () => setReload(n => n + 1);
  return <div className="feed">
      <header className="chat-head">
        <button className="icon back" onClick={onBack} aria-label={tr("بازگشت")}><Icon n="back" /></button>
        <div className="chat-title"><strong>{tr("موزیک")}</strong><span className="muted">{tr("آهنگ و پلی‌لیست")}</span></div>
        {tab !== 'songs' && !open && <button className="primary small" onClick={() => setDlg(true)}>{tr("پلی‌لیست جدید")}</button>}
      </header>
      {!open && <div className="tabs" role="tablist">
          {[['mine', tr("پلی‌لیست‌های من")], ['public', tr("عمومی")], ['songs', tr("آهنگ‌های من")]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>}
      <div className="feed-list music">
        {open ? <PlaylistView token={token} me={me} id={open} player={player} onBack={() => setOpen(null)} onChanged={bump} /> : tab === 'songs' ? <Songs token={token} player={player} /> : <Lists token={token} scope={tab} onOpen={setOpen} reload={reload} />}
      </div>
      {dlg && <NewList token={token} onClose={() => setDlg(false)} onDone={p => {
      setDlg(false);
      setTab('mine');
      bump();
      setOpen(p.id);
    }} />}
    </div>;
}