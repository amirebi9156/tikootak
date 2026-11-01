import { tr } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { profileGet, followToggle, followUnfollow, followList, feedList, profileSetBio, profileSetPrivate, profileSetAvatar, profileDelAvatar, playlistsList } from './api.js';
import { Avatar, Dialog } from './ui.jsx';
import CropDialog from './Crop.jsx';
import { Icon } from './icons.jsx';
import { PostGrid, PostModal } from './Feed.jsx';
import { setPerson } from './people.js';
import { fa } from './util.js';
import { useReport } from './Report.jsx';
import { PlaylistCover } from './cover.jsx';
async function cropSquare(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}
function EditProfile({
  token,
  client,
  profile,
  onClose,
  onSaved
}) {
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  function pickAvatar(f) { if (f) setCropFile(f); }
  async function uploadAvatar(blob) {
    setCropFile(null);
    setBusy(true);
    setErr('');
    try {
      const p = await profileSetAvatar(token, blob);
      setPerson(p);
      onSaved(p);
    } catch {
      setErr(tr("عکس ذخیره نشد. عکس دیگری امتحان کن."));
    }
    setBusy(false);
  }
  async function removeAvatar() {
    setBusy(true);
    try {
      const p = await profileDelAvatar(token);
      setPerson(p);
      onSaved(p);
    } catch {/* ignore */}
    setBusy(false);
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (name.trim() && name.trim() !== profile.name) await client.setDisplayName(name.trim());
      const p = await profileSetBio(token, bio);
      setPerson(p);
      onSaved(p);
      onClose();
    } catch {
      setErr(tr("ذخیره نشد. دوباره امتحان کن."));
      setBusy(false);
    }
  }
  return <Dialog title={tr("ویرایش پروفایل")} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="edit-av">
          <Avatar name={profile.name} id={profile.user_id} size={84} />
          <div className="col">
            <button type="button" className="ghost small" disabled={busy} onClick={() => fileRef.current.click()}>{tr("تغییر عکس")}</button>
            {profile.avatar && <button type="button" className="ghost small" disabled={busy} onClick={removeAvatar}>{tr("حذف عکس")}</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="avatar-input" onChange={e => {
          pickAvatar(e.target.files[0]);
          e.target.value = '';
        }} />
        </div>
        <label>{tr("نام نمایشی")}<input value={name} onChange={e => setName(e.target.value)} maxLength={40} required /></label>
        <label>{tr("بیو (حداکثر ۱۵۰ حرف)")}
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={150} rows={3} dir="auto" />
        </label>
        <span className="muted small-note" dir="ltr">{tr("آیدی تو: {0} (قابل تغییر نیست)", [profile.user_id.split(':')[0]])}</span>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row"><button type="button" className="ghost" onClick={onClose}>{tr("انصراف")}</button><button className="primary" disabled={busy}>{tr("ذخیره")}</button></div>
      </form>
      {cropFile && <CropDialog file={cropFile} shape="circle" out={512} title={tr('برش عکس پروفایل')} onCancel={() => setCropFile(null)} onDone={uploadAvatar} />}
    </Dialog>;
}
function PeopleList({
  token,
  id,
  kind,
  onClose,
  onProfile
}) {
  const [users, setUsers] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    followList(token, id, kind).then(d => {
      setUsers(d.users || []);
      setHidden(!!d.hidden);
    }).catch(() => { setUsers([]); setHidden(false); });
  }, [token, id, kind]);
  return <Dialog title={kind === 'followers' ? tr("دنبال‌کننده‌ها") : tr("دنبال‌شده‌ها")} onClose={onClose}>
      {hidden
        ? <p className="muted" data-testid="follows-hidden">{tr("این کاربر لیستش را پنهان کرده است.")}</p>
        : <ul className="plain">
            {users === null && <li className="muted">…</li>}
            {users?.length === 0 && <li className="muted">{tr("کسی نیست.")}</li>}
            {users?.map(u => <PersonRow key={u.user_id} u={u} onClick={() => {
              onClose();
              onProfile(u.user_id);
            }} />)}
          </ul>}
      <div className="row"><button className="primary" onClick={onClose}>{tr("بستن")}</button></div>
    </Dialog>;
}
export function PersonRow({
  u,
  onClick,
  extra
}) {
  return <li>
      <button className="room" onClick={onClick} data-testid="person">
        <Avatar name={u.name} id={u.user_id} size={40} />
        <div className="room-main"><strong dir="auto">{u.name}{u.verified && <span className="verified-badge" title={tr('تأییدشده')} data-testid="verified"><Icon n="check" size={11} /></span>}</strong><span className="muted" dir="ltr">{u.user_id.split(':')[0]}</span></div>
        {extra}
      </button>
    </li>;
}
export default function Profile({
  client,
  token,
  me,
  id,
  onBack,
  onMessage,
  onProfile,
  onPlaylist,
  blocked,
  onBlock
}) {
  const [p, setP] = useState(null);
  const [privAsk, setPrivAsk] = useState(false);
  const [privBusy, setPrivBusy] = useState(false);
  const [privErr, setPrivErr] = useState('');
  const [report, reportDialog] = useReport(token);
  const [err, setErr] = useState('');
  const [posts, setPosts] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followErr, setFollowErr] = useState('');
  const [modal, setModal] = useState(null);
  const [edit, setEdit] = useState(false);
  const [list, setList] = useState(null);
  const [ptab, setPtab] = useState('posts');
  const [lists, setLists] = useState(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (ptab !== 'lists') return;
    setLists(null);
    playlistsList(token, id === me ? 'mine' : 'public').then(d => setLists(d.playlists.filter(x => x.user_id === id))).catch(() => setLists([]));
  }, [ptab, token, id, me]);
  function share() {
    const text = id.split(':')[0];
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  useEffect(() => {
    let dead = false;
    setP(null);
    setPosts(null);
    setErr('');
    profileGet(token, id).then(x => {
      if (!dead) setP(x);
    }).catch(() => {
      if (!dead) setErr(tr("این کاربر پیدا نشد."));
    });
    return () => { dead = true; };
  }, [token, id]);
  const load = useCallback(async before => {
    setBusy(true);
    try {
      const d = await feedList(token, {
        user: id,
        before
      });
      setPosts(cur => before ? [...(cur || []), ...d.posts] : d.posts);
      setMore(d.posts.length >= 8);
    } catch {
      setPosts(c => c || []);
    }
    setBusy(false);
  }, [token, id]);
  useEffect(() => {
    if (!p) return;
    if (p.can_view === false) {
      setPosts([]);
      setMore(false);
      return;
    }
    load();
  }, [p, load]);
  async function follow() {
    if (!p || followBusy) return;
    setFollowBusy(true);
    setFollowErr('');
    const status = p.follow_status || (p.followed_by_me ? 'accepted' : 'none');
    try {
      const r = status === 'none' ? await followToggle(token, id) : await followUnfollow(token, id);
      setP(x => ({
        ...x,
        follow_status: r.status,
        followed_by_me: !!r.following,
        followers: typeof r.followers === 'number' ? r.followers : x.followers,
        can_view: r.status === 'accepted' ? true : (x.is_private ? false : x.can_view),
      }));
    } catch {
      setFollowErr(tr("درخواست فالو انجام نشد. دوباره امتحان کن."));
    }
    setFollowBusy(false);
  }
  const fstatus = p?.follow_status || (p?.followed_by_me ? 'accepted' : 'none');
  const followLabel = fstatus === 'accepted' ? tr("دنبال می‌کنی") : fstatus === 'pending' ? tr("درخواست شد") : tr("دنبال کردن");
  const canViewContent = !!p && p.can_view !== false;
  return <div className="feed">
      <header className="chat-head prof-head">
        <button className="icon back" onClick={onBack} aria-label={tr("بازگشت")}><Icon n="back" /></button>
        <div className="chat-title"><strong dir="ltr">{p ? p.user_id.split(':')[0].replace(/^@/, '') : tr("پروفایل")}</strong></div>
        {p && <span className="post-more prof-menu">
            <button className="icon" onClick={() => setMenu(m => !m)} aria-label={tr("گزینه‌ها")} aria-expanded={menu} data-testid="prof-menu-btn"><Icon n="dots" /></button>
            {menu && <span className="post-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); share(); }}>{tr("کپی آیدی")}</button>
                {!p.is_me && <button role="menuitem" onClick={() => { setMenu(false); report('user', p.user_id); }}>{tr("گزارش")}</button>}
                {!p.is_me && <button role="menuitem" className="danger-text" onClick={() => { setMenu(false); onBlock?.(p.user_id); }}>{tr("بلاک")}</button>}
              </span>}
          </span>}
      </header>
      <div className="feed-list prof-list">
        {err && <p className="error pad" role="alert">{err}</p>}
        {p && <section className="prof" data-testid="profile">
            <div className="prof-top">
              <span className="prof-av"><Avatar name={p.name} id={p.user_id} size={86} />
                {p.is_me && <button className="av-plus" onClick={() => setEdit(true)} aria-label={tr("تغییر عکس")}><Icon n="plus" size={16} /></button>}
              </span>
              <div className="prof-stats">
                <button className="plainbtn" disabled><strong className="num">{fa(p.posts)}</strong><span>{tr("پست")}</span></button>
                <button className="plainbtn" onClick={() => canViewContent && setList('followers')} disabled={!canViewContent}><strong className="num" data-testid="followers">{fa(p.followers)}</strong><span>{tr("دنبال‌کننده")}</span></button>
                <button className="plainbtn" onClick={() => canViewContent && setList('following')} disabled={!canViewContent}><strong className="num">{fa(p.following)}</strong><span>{tr("دنبال‌شده")}</span></button>
              </div>
            </div>
            <strong className="prof-name" dir="auto">{p.name}{p.verified && <span className="verified-badge" title={tr('تأییدشده')} data-testid="profile-verified"><Icon n="check" size={11} /></span>}{p.is_private && <span className="prof-lock" title={tr("حساب خصوصی")} data-testid="private-lock"><Icon n="lock" size={15} /></span>}</strong>
            {p.bio && <p className="prof-bio" dir="auto" data-testid="bio">{p.bio}</p>}
            {p.can_view === false && <p className="muted small-note prof-private-note" data-testid="private-note"><Icon n="lock" size={15} /> {tr("این حساب خصوصی است. برای دیدن پست‌ها و استوری‌هایش درخواست دنبال‌کردن بده.")}</p>}
            <div className="prof-btns">
              {p.is_me ? <>
                    <button className="outline" onClick={() => setEdit(true)}>{tr("ویرایش پروفایل")}</button>
                    <button className="outline" onClick={share}>{copied ? tr("کپی شد") : tr("کپی آیدی")}</button>
                  </> : <>
                    <button className={fstatus === 'none' ? 'primary' : 'outline'} onClick={follow} disabled={followBusy} data-testid="follow-btn">{followLabel}</button>
                    <button className="outline" onClick={() => onMessage(p.user_id)}>{tr("پیام")}</button>
                  </>}
            </div>
            {followErr && <p className="error small-note" role="alert">{followErr}</p>}
            {p.is_me && <button type="button" className={`acct-toggle ${p.is_private ? 'priv' : 'pub'}`} data-testid="acct-toggle" disabled={privBusy} onClick={() => setPrivAsk(true)}>
              <Icon n={p.is_private ? 'lock' : 'globe'} size={16} />
              <span><strong>{p.is_private ? tr('حساب خصوصی') : tr('حساب عمومی')}</strong><small>{p.is_private ? tr('فقط دنبال‌کننده‌های تأییدشده می‌بینند. برای عمومی‌شدن بزن.') : tr('همه می‌توانند پست‌هایت را ببینند. برای خصوصی‌شدن بزن.')}</small></span>
              <span className="acct-sw" aria-hidden="true"><i /></span>
            </button>}
            {privErr && <p className="error small-note" role="alert">{privErr}</p>}
          </section>}
        {privAsk && p && <Dialog title={p.is_private ? tr('حساب عمومی شود؟') : tr('حساب خصوصی شود؟')} onClose={() => setPrivAsk(false)}>
            <p className="muted">{p.is_private ? tr('همه می‌توانند پست‌ها و استوری‌هایت را ببینند و درخواست‌های دنبال‌کردنِ در انتظار خودکار پذیرفته می‌شوند.') : tr('فقط دنبال‌کننده‌هایی که تأیید می‌کنی پست‌ها و استوری‌هایت را می‌بینند. دنبال‌کننده‌های فعلی می‌مانند.')}</p>
            <div className="row">
              <button className="ghost" onClick={() => setPrivAsk(false)}>{tr('انصراف')}</button>
              <button className="primary" data-testid="acct-confirm" onClick={async () => {
                setPrivAsk(false); setPrivBusy(true); setPrivErr('');
                try { await profileSetPrivate(token, !p.is_private); setP(x => ({ ...x, is_private: !x.is_private })); } catch { setPrivErr(tr('تغییر انجام نشد؛ دوباره امتحان کن.')); }
                setPrivBusy(false);
              }}>{p.is_private ? tr('عمومی شود') : tr('خصوصی شود')}</button>
            </div>
          </Dialog>}
        {p && canViewContent && <div className="ptabs" role="tablist">
            <button role="tab" aria-selected={ptab === 'posts'} className={ptab === 'posts' ? 'on' : ''} onClick={() => setPtab('posts')} aria-label={tr("پست‌ها")} title={tr("پست‌ها")}><Icon n="grid" size={24} /></button>
            <button role="tab" aria-selected={ptab === 'lists'} className={ptab === 'lists' ? 'on' : ''} onClick={() => setPtab('lists')} aria-label={tr("پلی‌لیست‌ها")} title={tr("پلی‌لیست‌ها")}><Icon n="music" size={24} /></button>
          </div>}
        {canViewContent && ptab === 'posts' && posts?.length === 0 && <p className="empty-chat">{tr("هنوز پستی نیست.")}</p>}
        {canViewContent && ptab === 'posts' && posts?.length > 0 && <PostGrid posts={posts} onOpen={setModal} />}
        {canViewContent && ptab === 'posts' && more && <button className="older" disabled={busy} onClick={() => load(posts[posts.length - 1].created_at)}>{tr("پست‌های قدیمی‌تر")}</button>}
        {canViewContent && ptab === 'lists' && lists === null && <p className="muted pad">…</p>}
        {canViewContent && ptab === 'lists' && lists?.length === 0 && <p className="empty-chat">{tr("پلی‌لیست عمومی‌ای نیست.")}</p>}
        {canViewContent && ptab === 'lists' && lists?.length > 0 && <div className="pl-grid">
            {lists.map(l => <button key={l.id} className="pl-tile" onClick={() => onPlaylist?.(l.id)} data-testid="prof-playlist">
                <PlaylistCover covers={l.covers} seed={l.name} size={150} />
                <strong dir="auto">{l.name}</strong>
                <span className="muted">{fa(l.count)} {tr("آهنگ")}{l.is_public ? '' : tr(" · خصوصی")}</span>
              </button>)}
          </div>}
      </div>
      {modal && <PostModal token={token} me={me} post={modal} onClose={() => setModal(null)} onProfile={onProfile} onDeleted={pid => setPosts(l => l.filter(x => x.id !== pid))} />}
      {edit && p && <EditProfile token={token} client={client} profile={p} onClose={() => setEdit(false)} onSaved={np => setP(x => ({
      ...x,
      ...np
    }))} />}
      {list && <PeopleList token={token} id={id} kind={list} onClose={() => setList(null)} onProfile={onProfile} />}
      {reportDialog}
    </div>;
}