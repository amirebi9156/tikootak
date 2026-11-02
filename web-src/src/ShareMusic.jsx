import { tr } from './i18n.js';
import { useEffect, useState } from 'react';
import { musicTracks, playlistsList, shareCreate } from './api.js';
import { Dialog } from './ui.jsx';
import { Cover, PlaylistCover } from './cover.jsx';
import { fa } from './util.js';

// انتخاب آهنگ یا پلی‌لیست از کتابخانه‌ی خودت برای فرستادن در چت (بدون آپلود دوباره)
export default function ShareMusic({
  token,
  onPick,
  onDevice,
  onClose
}) {
  const [tab, setTab] = useState('tracks');
  const [tracks, setTracks] = useState(null);
  const [lists, setLists] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    musicTracks(token).then(d => setTracks(d.tracks)).catch(() => setTracks([]));
    playlistsList(token, 'mine').then(d => setLists(d.playlists)).catch(() => setLists([]));
  }, [token]);
  async function pick(kind, item) {
    setErr('');
    try {
      const {
        code
      } = await shareCreate(token, kind, item.id);
      await onPick({
        kind,
        code,
        title: kind === 'track' ? `${item.title}${item.artist ? ' — ' + item.artist : ''}` : item.name
      });
      onClose();
    } catch {
      setErr(tr("ارسال نشد."));
    }
  }
  return <Dialog title={tr("فرستادن موزیک")} onClose={onClose}>
      <div className="tabs pick-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tracks'} className={tab === 'tracks' ? 'on' : ''} onClick={() => setTab('tracks')}>{tr("آهنگ‌های من")}</button>
        <button role="tab" aria-selected={tab === 'lists'} className={tab === 'lists' ? 'on' : ''} onClick={() => setTab('lists')}>{tr("پلی‌لیست‌ها")}</button>
      </div>
      <ul className="plain pick-list">
        {tab === 'tracks' && tracks === null && <li className="muted">…</li>}
        {tab === 'tracks' && tracks?.length === 0 && <li className="muted">{tr("هنوز آهنگی نداری. از دستگاه بفرست یا در بخش موزیک آپلود کن.")}</li>}
        {tab === 'tracks' && tracks?.map(t => <li key={t.id}><button className="room" onClick={() => pick('track', t)} data-testid="pick-track">
            <Cover src={t.cover} seed={t.title} size={44} radius={0} />
            <div className="room-main"><strong dir="auto">{t.title}</strong><span className="muted" dir="auto">{t.artist || t.owner}</span></div>
          </button></li>)}
        {tab === 'lists' && lists?.length === 0 && <li className="muted">{tr("پلی‌لیستی نساخته‌ای.")}</li>}
        {tab === 'lists' && lists?.map(p => <li key={p.id}><button className="room" onClick={() => pick('playlist', p)} data-testid="pick-playlist">
            <PlaylistCover covers={p.covers} seed={p.name} size={44} />
            <div className="room-main"><strong dir="auto">{p.name}</strong><span className="muted">{fa(p.count)} {tr("آهنگ")}</span></div>
          </button></li>)}
      </ul>
      <p className="muted small-note">{tr("کتابخانه‌ی موزیک روی سرور رمز نیست؛ فقط متن پیام‌ها رمزنگاری می‌شود.")}</p>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row sm-actions">
        <button className="ghost" onClick={() => {
        onClose();
        onDevice();
      }}>{tr("فایل از دستگاه")}</button>
        <button className="primary" onClick={onClose}>{tr("بستن")}</button>
      </div>
    </Dialog>;
}