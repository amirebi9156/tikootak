import { useEffect, useMemo, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';
import RoomAvatar from './RoomAvatar.jsx';
import { profileGet } from './api.js';
import { fetchFile, fmtSize } from './media.js';
import { isMusic, musicMeta } from './chatMusic.js';
import { kindLabel, roomAlias } from './roomtype.js';
import { fa, fmtClock } from './util.js';
import { useBackLayer } from './backstack.js';
import { Avatar } from './ui.jsx';

const URL_RE = /https?:\/\/[^\s<>"']+/g;

// صفحهٔ مشخصات گفتگو (مثل تلگرام): عکس بزرگ، نام، دکمه‌های سریع، اطلاعات و تب‌های مدیا/فایل/لینک/موزیک
export function Thumb({ client, content, onOpen }) {
  const [url, setUrl] = useState(null);
  const isVideo = content.msgtype === 'm.video';
  useEffect(() => {
    let dead = false;
    let made = null;
    fetchFile(client, content).then(b => { if (dead) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => {});
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [client, content]);
  return <button type="button" className="ci-thumb" disabled={!url} onClick={() => url && onOpen?.({ url, kind: isVideo ? 'video' : 'image', name: content.body })} aria-label={content.body || tr('مدیا')}>
    {url ? (isVideo ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" /> : <img src={url} alt="" />) : <span className="ci-ph" />}
    {isVideo && <span className="ci-vid"><Icon n="play" size={18} /></span>}
  </button>;
}

export default function ChatInfo({ client, room, me, kind, muted, onMute, onClose, onCall, onSearch, onInvite, onSettings, onProfile, onOpenMedia, peerId, onUser, canSeeMembers }) {
  useBackLayer(true, onClose);
  const [tab, setTab] = useState('media');
  const [prof, setProf] = useState(null);
  const [menu, setMenu] = useState(false);
  const token = client.getAccessToken();
  useEffect(() => {
    if (kind !== 'dm' || !peerId) return undefined;
    let dead = false;
    profileGet(token, peerId).then(p => { if (!dead) setProf(p); }).catch(() => {});
    return () => { dead = true; };
  }, [kind, peerId, token]);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '';
  const members = room.getMembersWithMembership('join').length;
  const alias = roomAlias(room);
  const link = alias ? `${window.location.origin}/#/join/${encodeURIComponent(alias)}` : '';
  const items = useMemo(() => {
    const out = { media: [], files: [], links: [], music: [] };
    const evs = room.getLiveTimeline().getEvents();
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.getType() !== 'm.room.message' || ev.isRedacted?.()) continue;
      const c = ev.getContent();
      if (!c || !c.msgtype) continue;
      if (c.msgtype === 'm.image' || c.msgtype === 'm.video') { if (!c['ir.tikootak.sticker'] && out.media.length < 60) out.media.push({ id: ev.getId(), c }); }
      else if (isMusic(c)) out.music.push({ id: ev.getId(), c });
      else if (c.msgtype === 'm.file') out.files.push({ id: ev.getId(), c });
      else if (typeof c.body === 'string') {
        const m = c.body.match(URL_RE);
        if (m) m.forEach((u, j) => out.links.push({ id: ev.getId() + j, u }));
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, room.getLiveTimeline().getEvents().length]);

  const roster = useMemo(() => (kind === 'dm' || !canSeeMembers ? [] : room.getMembersWithMembership('join')
    .map(m => ({ id: m.userId, name: m.name || m.userId.split(':')[0].replace(/^@/, ''), power: m.powerLevel || 0 }))
    .sort((a, b) => (b.power >= 50) - (a.power >= 50) || a.name.localeCompare(b.name))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [room, kind, canSeeMembers, members]);
  const name = prof?.name || room.name;
  const sub = kind === 'dm'
    ? tr('پیوی')
    : `${kindLabel(kind)} · ${fa(members)} ${tr('عضو')}`;
  const tabs = [...(roster.length ? [['members', tr('اعضا')]] : []), ['media', tr('مدیا')], ['files', tr('فایل‌ها')], ['links', tr('لینک‌ها')], ['music', tr('موزیک')]];
  const act = (icon, label, fn, on) => <button type="button" className={`ci-act ${on ? 'on' : ''}`} onClick={fn}><Icon n={icon} size={24} /><span>{label}</span></button>;

  return <div className="cinfo" role="dialog" aria-label={tr('مشخصات گفتگو')} data-testid="chat-info">
    <div className="ci-top">
      <button type="button" className="ci-round" onClick={onClose} aria-label={tr('بازگشت')} data-testid="chat-info-back"><Icon n="back" size={22} /></button>
      <div className="ci-menu-wrap">
        <button type="button" className="ci-round" onClick={() => setMenu(m => !m)} aria-label={tr('بیشتر')} aria-expanded={menu}><Icon n="dots" size={22} /></button>
        {menu && <div className="ci-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onSettings(); }} data-testid="chat-info-settings"><Icon n="gear" size={18} /><span>{tr('تنظیمات و مدیریت')}</span></button>
          {kind === 'dm' && peerId && <button type="button" role="menuitem" onClick={() => { setMenu(false); onProfile(peerId); }}><Icon n="user" size={18} /><span>{tr('مشاهدهٔ پروفایل')}</span></button>}
        </div>}
      </div>
    </div>
    <div className="ci-scroll">
      <div className="ci-hero">
        <span className="ci-avatar"><RoomAvatar client={client} room={room} name={name} id={peerId || room.roomId} size={124} /></span>
        <h2 dir="auto">{name}</h2>
        <p className="ci-sub">{sub}{client.isRoomEncrypted(room.roomId) ? ` · ${tr('رمزنگاری‌شده')}` : ''}</p>
      </div>
      <div className="ci-acts">
        {act('chat', tr('پیام'), onClose)}
        {act(muted ? 'belloff' : 'bell', muted ? tr('باصدا') : tr('بی‌صدا'), () => onMute?.(muted ? 0 : true), muted)}
        {kind === 'channel' ? act('search', tr('جستجو'), onSearch) : act('phone', tr('تماس'), onCall)}
        {kind === 'dm' ? act('cam', tr('تصویری'), onCall) : act('userplus', tr('دعوت'), onInvite)}
      </div>
      {(prof?.bio || topic || link || kind === 'dm') && <div className="ci-card">
        {(prof?.bio || topic) && <div className="ci-line"><strong dir="auto">{prof?.bio || topic}</strong><span>{kind === 'dm' ? tr('درباره') : tr('توضیح')}</span></div>}
        {kind === 'dm' && peerId && <div className="ci-line"><strong dir="ltr">@{peerId.split(':')[0].replace(/^@/, '')}</strong><span>{tr('نام کاربری')}</span></div>}
        {link && <button type="button" className="ci-line ci-btn" onClick={() => navigator.clipboard?.writeText(link)}><strong dir="ltr">{link.replace(/^https?:\/\//, '')}</strong><span>{tr('لینک دعوت · لمس برای کپی')}</span></button>}
      </div>}
      <div className="ci-tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}{k === 'members' ? ` ${fa(roster.length)}` : items[k].length ? ` ${fa(items[k].length)}` : ''}</button>)}
      </div>
      <div className="ci-pane">
        {tab === 'members' && <ul className="ci-list ci-members" data-testid="info-members">{roster.map(m => <li key={m.id}><button type="button" className="ci-member" onClick={() => onUser?.(m.id)} data-testid="info-member"><Avatar name={m.name} id={m.id} size={42} /><span dir="auto">{m.name}</span>{m.power >= 50 && <em className="role-tag">{m.power >= 100 ? tr('مالک') : tr('مدیر')}</em>}</button></li>)}</ul>}
        {tab === 'media' && (items.media.length ? <div className="ci-grid">{items.media.map(m => <Thumb key={m.id} client={client} content={m.c} onOpen={onOpenMedia} />)}</div> : <p className="ci-empty">{tr('هنوز مدیایی نیست.')}</p>)}
        {tab === 'files' && (items.files.length ? <ul className="ci-list">{items.files.map(f => <li key={f.id}><Icon n="clip" size={20} /><span dir="auto">{f.c.body}</span><em>{f.c.info?.size ? fmtSize(f.c.info.size) : ''}</em></li>)}</ul> : <p className="ci-empty">{tr('فایلی نیست.')}</p>)}
        {tab === 'links' && (items.links.length ? <ul className="ci-list">{items.links.map(l => <li key={l.id}><Icon n="globe" size={20} /><a href={l.u} target="_blank" rel="noopener noreferrer" dir="ltr">{l.u}</a></li>)}</ul> : <p className="ci-empty">{tr('لینکی نیست.')}</p>)}
        {tab === 'music' && (items.music.length ? <ul className="ci-list">{items.music.map(s => { const m = musicMeta(s.c); return <li key={s.id}><Icon n="music" size={20} /><span dir="auto">{m.artist ? `${m.artist} – ${m.title}` : m.title}</span><em>{m.dur ? fmtClock(m.dur) : ''}</em></li>; })}</ul> : <p className="ci-empty">{tr('موزیکی نیست.')}</p>)}
      </div>
    </div>
  </div>;
}
