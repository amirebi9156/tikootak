import { tr } from './i18n.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureSavedRoom } from './forward.js';
import { sdk, localpart, normalizeUserId, mxError } from './matrix.js';
import { useMatrix } from './useMatrix.js';
import { Icon } from './icons.jsx';
import { usePwa, isMobile } from './pwa.js';
import { Avatar, Dialog, Logo, LogoMark, useTheme, ShareCtx, Switch } from './ui.jsx';
import { PostModal } from './Feed.jsx';
import { sendShare } from './share.js';
import Chat from './Chat.jsx';
import Feed from './Feed.jsx';
import StoriesBar from './Stories.jsx';
import Explore from './Explore.jsx';
import Music from './Music.jsx';
import Profile from './Profile.jsx';
import { roomsSuggest, feedPost, notificationsUnread, feedShare, followList, blocksList, unblockUser } from './api.js';
import { setPeopleToken, resetPeople, usePerson } from './people.js';
import { blockPerson, setIgnored } from './social.js';
import { usePlayer } from './player.js';
import NowPlaying, { FloatPlayer } from './NowPlaying.jsx';
import MiniPlayer from './MiniPlayer.jsx';
import { roomKind, kindIcon, kindIconName, kindLabel, ROOM_TYPE_EVENT, myPower, canModerate, roomAlias, mutedFromRules, muteUntil } from './roomtype.js';
import CallView from './Call.jsx';
import { useCall } from './call.js';
import { fmtTime, fa } from './util.js';
import { recoveryStatus, clearPending } from './recovery.js';
import ShareToChat from './ShareToChat.jsx';
import RoomAvatar from './RoomAvatar.jsx';
import ContextMenu, { useLongPress } from './ContextMenu.jsx';
import { RecoverySetup, RecoveryRestore } from './Recovery.jsx';
import { EV, EV_OLD, pickEvent, hasEvent } from './eventTypes.js';
import { getItem, setItem, removeItem, localStorageKeys } from './storage.js';
import Notifications from './Notifications.jsx';
import Settings from './Settings.jsx';
import { useDesktopNotify } from './notify.js';
import { useBackLayer } from './backstack.js';
import { isMusic, musicMeta } from './chatMusic.js';
import { PeopleSuggest, RoomSuggestList, usePeopleSuggest } from './Suggest.jsx';
function lastMessage(room) {
  const evs = room.getLiveTimeline().getEvents();
  let locked = null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.getType() === 'm.room.message' && !e.isRedacted() && !e.isRelation?.('m.replace')) return e;
    if (e.getType() === 'm.room.encrypted' && e.isDecryptionFailure() && !locked) locked = e;
  }
  return locked;
}
function Preview({
  room,
  kind = 'group'
}) {
  const typers = (room.getMembers?.() || []).filter(m => m.typing && m.userId !== room.client.getUserId());
  if (typers.length) return <span className="typing-text">{tr('در حال نوشتن')}<i>.</i><i>.</i><i>.</i></span>;
  let draft = '';
  try { draft = getItem(`tikootak.draft.${room.roomId}`) || ''; } catch { /* ignore */ }
  if (draft.trim()) return <span className="muted"><b className="draft-lbl">{tr('پیش‌نویس:')}</b> {draft.trim().slice(0, 60)}</span>;
  const e = lastMessage(room);
  if (!e) return <span className="muted">{tr("هنوز پیامی نیست")}</span>;
  if (e.isDecryptionFailure() || e.getType() === 'm.room.encrypted') return <span className="muted">{tr("🔒 پیام رمزنگاری‌شده")}</span>;
  const c = e.getContent();
  const mine = e.getSender() === room.client.getUserId();
  const senderName = room.getMember?.(e.getSender())?.name || localpart(e.getSender());
  const channel = kind === 'channel';
  // در کانال، پیش‌نمایش گفتگو به نام کانال است؛ نام ادمین فرستنده نمایش داده نمی‌شود.
  const who = channel ? `${room.name || tr('کانال')}: ` : mine ? tr("تو: ") : (kind === 'group' ? `${senderName}: ` : '');
  const body = c.msgtype === 'm.image' ? tr("تصویر") : c.msgtype === 'm.video' ? tr("ویدیو") : c.msgtype === 'm.audio' ? (isMusic(c) ? `🎵 ${musicMeta(c).title}` : tr("پیام صوتی")) : c.msgtype === 'm.file' ? tr("فایل") : hasEvent(c, 'share') ? tr("پست") : c.body || '';
  const tick = !channel && mine && e.status === 'sent' ? ' ✓' : !channel && mine && e.status ? ' …' : '';
  return <span className="muted">{who}{body}{tick}</span>;
}

// سطح دسترسی پیش‌فرض Matrix + اجازه پین کردن پیام برای همه اعضا
const PL_EVENTS = {
  'm.room.name': 50,
  'm.room.power_levels': 100,
  'm.room.history_visibility': 100,
  'm.room.canonical_alias': 50,
  'm.room.avatar': 50,
  'm.room.tombstone': 100,
  'm.room.server_acl': 100,
  'm.room.encryption': 100,
  'm.room.pinned_events': 0
};
function NewRoom({
  client,
  me,
  onClose,
  onCreated,
  canEncrypt
}) {
  const [name, setName] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const ids = who.split(/[\s,،]+/).map(x => normalizeUserId(x, me)).filter(Boolean);
      const r = await client.createRoom({
        name: name.trim(),
        visibility: 'private',
        preset: sdk.Preset.PrivateChat,
        invite: ids,
        power_level_content_override: {
          events: PL_EVENTS
        },
        initial_state: canEncrypt ? [{
          type: 'm.room.encryption',
          state_key: '',
          content: {
            algorithm: 'm.megolm.v1.aes-sha2'
          }
        }] : []
      });
      onCreated(r.room_id);
    } catch (x) {
      setErr(mxError(x));
      setBusy(false);
    }
  }
  return <Dialog title={tr("اتاق جدید")} onClose={onClose}>
      <form className="form" onSubmit={go}>
        <label>
          {tr("نام اتاق")}
          <input value={name} onChange={e => setName(e.target.value)} maxLength={60} required />
        </label>
        <label>
          {tr("دعوت دوستان (نام کاربری، با فاصله یا ویرگول جدا کن)")}
          <input value={who} onChange={e => setWho(e.target.value)} dir="ltr" placeholder="ali, sara" spellCheck="false" />
        </label>
        <p className="muted small-note">
          {canEncrypt ? tr("🔒 پیام‌های این اتاق رمزنگاری سرتاسری می‌شوند؛ حتی مدیر سرور هم نمی‌تواند آن‌ها را بخواند.") : tr("رمزنگاری در این مرورگر فعال نشد؛ اتاق بدون رمزنگاری ساخته می‌شود.")}
        </p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>{tr("انصراف")}</button>
          <button className="primary" disabled={busy}>{busy ? tr("صبر کن…") : tr("ساخت اتاق")}</button>
        </div>
      </form>
    </Dialog>;
}

// منوی کشویی تلگرامی: پروفایل، میان‌برها، تم شب
function InstallBar() {
  const pwa = usePwa();
  const [hide, setHide] = useState(() => { try { return localStorage.getItem('tikootak.installbar') === '1'; } catch { return false; } });
  const [help, setHelp] = useState(false);
  if (hide || pwa.standalone || !isMobile()) return null;
  const close = () => { setHide(true); try { localStorage.setItem('tikootak.installbar', '1'); } catch { /* ignore */ } };
  return (
    <div className="install-bar" data-testid="install-bar">
      <div className="install-row">
        <Icon n="download" size={20} />
        <div className="install-txt"><strong>{tr('نصب تیکوتاک به صورت برنامه')}</strong><span className="muted">{tr('تمام‌صفحه و بدون نوار مرورگر')}</span></div>
        <button type="button" className="btn primary install-go" onClick={() => { if (pwa.canInstall) pwa.install(); else setHelp(h => !h); }}>{tr('نصب')}</button>
        <button type="button" className="icon install-x" onClick={close} aria-label={tr('بستن')}><Icon n="close" size={16} /></button>
      </div>
      {help && <div className="muted install-help">{pwa.ios ? tr('در سافاری دکمه اشتراک‌گذاری را بزن و «Add to Home Screen» را انتخاب کن تا برنامه تمام‌صفحه باز شود.') : tr('در Chrome منوی سه‌نقطه (⋮) را باز کن و «Install app» یا «Add to Home screen» را بزن.')}</div>}
    </div>
  );
}

function MenuDrawer({ me, name, theme, onTheme, onClose, items }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const night = theme !== 'light';
  const pwa = usePwa();
  const [iosHint, setIosHint] = useState(false);
  const showInstall = !pwa.standalone && (pwa.canInstall || pwa.ios || isMobile());
  return (
    <div className="drawer-wrap" onClick={onClose} data-testid="drawer">
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={tr('منو')} onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <button type="button" className="drawer-me" onClick={() => { onClose(); items.profile(); }} aria-label={tr('پروفایل من')}>
            <Avatar name={name} id={me} size={64} />
            <span className="drawer-name" dir="auto">{name}</span>
            <span className="drawer-id muted" dir="ltr">@{localpart(me)}</span>
          </button>
          <button type="button" className="icon drawer-theme" onClick={() => onTheme(night ? 'light' : 'dark')} aria-label={tr('حالت شب')} title={tr('حالت شب')}><Icon n={night ? 'sun' : 'moon'} /></button>
        </div>
        <nav className="drawer-list">
          {[['user', tr('پروفایل من'), 'profile'], ['users', tr('گروه جدید'), 'group'], ['megaphone', tr('کانال جدید'), 'channel'], ['search', tr('جستجوی افراد'), 'people'], ['bookmark', tr('پیام‌های ذخیره‌شده'), 'saved'], ['userplus', tr('دعوت دوستان'), 'invite'], ['gear', tr('تنظیمات'), 'settings']].map(([ic, label, key]) =>
            <button type="button" key={key} className="drawer-item" onClick={() => { onClose(); items[key](); }} data-testid={`drawer-${key}`}>
              <Icon n={ic} size={20} /><span>{label}</span>
            </button>)}
          <button type="button" className="drawer-item" data-testid="drawer-privacy" onClick={() => { onClose(); items.profile(); }}>
            <Icon n="lock" size={20} /><span>{tr('حساب عمومی یا خصوصی')}</span>
          </button>
          {showInstall && <button type="button" className="drawer-item" data-testid="drawer-install" onClick={() => { if (pwa.canInstall) { onClose(); pwa.install(); } else setIosHint(h => !h); }}>
            <Icon n="download" size={20} /><span>{tr('نصب برنامه روی گوشی')}</span>
          </button>}
          {iosHint && <div className="muted" style={{ padding: '4px 16px 10px', fontSize: 13 }}>{pwa.ios ? tr('در سافاری دکمه اشتراک‌گذاری را بزن و «Add to Home Screen» را انتخاب کن تا برنامه تمام‌صفحه باز شود.') : tr('در Chrome منوی سه‌نقطه (⋮) را باز کن و «Install app» یا «Add to Home screen» را بزن.')}</div>}
          {pwa.canFullscreen && !pwa.standalone && <button type="button" className="drawer-item" data-testid="drawer-fullscreen" onClick={() => pwa.toggleFullscreen()}>
            <Icon n="expand" size={20} /><span>{pwa.fullscreen ? tr('خروج از تمام‌صفحه') : tr('تمام‌صفحه')}</span>
          </button>}
          <Switch title={tr('حالت شب')} checked={night} onChange={v => onTheme(v ? 'dark' : 'light')} testid="drawer-night" />
        </nav>
        <div className="drawer-foot muted">TIKOOTAK</div>
      </aside>
    </div>
  );
}

// ساخت سه نوع گفتگو: پی‌وی، گروه، کانال + کشف اتاق‌های عمومی
function NewConversation({ client, me, token, canEncrypt, onClose, onCreated, onDM, initialKind = 'group' }) {
  const [kind, setKind] = useState(initialKind);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [who, setWho] = useState('');
  const [pub, setPub] = useState(false);
  const [alias, setAlias] = useState('');
  const [enc, setEnc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState('form');
  const [q, setQ] = useState('');
  const [rooms, setRooms] = useState(null);
  const [suggIdx, setSuggIdx] = useState(0);
  const [suggHidden, setSuggHidden] = useState(false);
  const cleanAlias = (v) => String(v || '').trim().replace(/^#/, '').split(':')[0].toLowerCase().replace(/[^a-z0-9._=-]/g, '').slice(0, 50);
  const lastWho = who.split(/[\s,،]+/).filter(Boolean).pop() || '';
  const suggestQ = kind === 'dm' ? who.trim() : lastWho;
  const { users: suggestions } = usePeopleSuggest(token, suggestQ, { min: 1 });
  useEffect(() => { setSuggIdx(0); }, [suggestQ]);
  function pickPerson(u) {
    if (kind === 'dm') {
      setWho(u.user_id);
    } else {
      const cut = Math.max(who.lastIndexOf(' '), who.lastIndexOf(','), who.lastIndexOf('،')) + 1;
      setWho(who.slice(0, cut) + u.user_id + ', ');
    }
    setSuggHidden(true);
    setSuggIdx(0);
  }
  function onSuggestKey(e) {
    if (suggHidden || !suggestions?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggIdx(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickPerson(suggestions[Math.min(suggIdx, suggestions.length - 1)]);
    }
  }

  async function create(e) {
    e.preventDefault();
    setErr('');
    if (kind === 'dm') {
      const id = normalizeUserId(who, me);
      if (!id) return setErr(tr('نام کاربری را وارد کن.'));
      onDM(id);
      return;
    }
    if (!name.trim()) return setErr(tr('نام را وارد کن.'));
    if (pub && !cleanAlias(alias)) return setErr(tr('برای گفتگوی عمومی یک آدرس (alias) انگلیسی وارد کن.'));
    setBusy(true);
    try {
      const ids = who.split(/[\s,،]+/).map(x => normalizeUserId(x, me)).filter(Boolean);
      const publicRoom = pub;
      const initial = [
        { type: ROOM_TYPE_EVENT, state_key: '', content: { type: kind } },
        { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'shared' } },
      ];
      if (kind === 'group' && enc && canEncrypt) {
        initial.push({ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
      }
      const pl = kind === 'channel'
        ? {
            users_default: 0, events_default: 50, state_default: 50,
            ban: 50, kick: 50, redact: 50, invite: 0,
            events: { ...PL_EVENTS, 'm.room.message': 50, 'm.reaction': 0, 'm.room.pinned_events': 50 },
          }
        : { events: { ...PL_EVENTS, 'm.reaction': 0 } };
      const r = await client.createRoom({
        name: name.trim(),
        topic: topic.trim(),
        visibility: publicRoom ? 'public' : 'private',
        preset: publicRoom ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
        room_alias_name: cleanAlias(alias) || undefined,
        invite: ids,
        power_level_content_override: pl,
        initial_state: initial,
      });
      if (publicRoom) {
        try { await client.setRoomDirectoryVisibility(r.room_id, 'public'); } catch { /* در صورت نبود مجوز، اتاق باز می‌شود */ }
      }
      onCreated(r.room_id);
    } catch (x) {
      setErr(mxError(x));
      setBusy(false);
    }
  }

  async function discover(e) {
    if (e) e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await roomsSuggest(token, q.trim(), 8);
      setRooms(r.rooms || []);
    } catch (x) {
      setErr(mxError(x));
      setRooms([]);
    }
    setBusy(false);
  }

  async function join(room) {
    setBusy(true); setErr('');
    try {
      const id = room.alias || room.canonical_alias || room.room_id;
      const r = await client.joinRoom(id);
      onCreated(r.roomId);
    } catch (x) {
      setErr(mxError(x));
      setBusy(false);
    }
  }

  return <Dialog title={tr('گروه یا کانال جدید')} onClose={onClose}>
      {view === 'form' ? <>
        <div className="seg conv-kinds" role="tablist" aria-label={tr('نوع گفتگو')}>
          <button type="button" className={kind === 'group' ? 'on' : ''} onClick={() => { setKind('group'); setErr(''); }}><Icon n="users" size={16} /> {tr('گروه')}</button>
          <button type="button" className={kind === 'channel' ? 'on' : ''} onClick={() => { setKind('channel'); setErr(''); }}><Icon n="megaphone" size={16} /> {tr('کانال')}</button>
        </div>
        <form className="form" onSubmit={create}>
          {kind === 'dm' ? <>
            <label>{tr('نام کاربری طرف مقابل')}
              <span className="suggest-wrap">
                <input value={who} onChange={e => { setWho(e.target.value); setSuggHidden(false); }} onKeyDown={onSuggestKey} dir="ltr" placeholder="ali" spellCheck="false" autoComplete="off" required />
                {!suggHidden && <PeopleSuggest users={suggestions} active={suggIdx} onPick={pickPerson} testid="dm-suggest" />}
              </span>
            </label>
            <p className="muted small-note">{tr('پیوی با رمزنگاری سرتاسری ساخته می‌شود (اگر رمزنگاری این دستگاه فعال باشد).')}</p>
          </> : <>
            <label>{tr('نام')}<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
            <label>{tr('توضیح کوتاه (اختیاری)')}<input value={topic} onChange={e => setTopic(e.target.value)} maxLength={200} /></label>
            <label>{tr('دعوت دوستان (نام کاربری، با فاصله یا ویرگول)')}
              <span className="suggest-wrap">
                <input value={who} onChange={e => { setWho(e.target.value); setSuggHidden(false); }} onKeyDown={onSuggestKey} dir="ltr" placeholder="ali, sara" spellCheck="false" autoComplete="off" />
                {!suggHidden && <PeopleSuggest users={suggestions} active={suggIdx} onPick={pickPerson} testid="invite-suggest" />}
              </span>
            </label>
            {kind === 'group' && <Switch title={tr('رمزنگاری سرتاسری')} desc={canEncrypt ? tr('فقط اعضا پیام‌ها را می‌خوانند؛ سرور هم نمی‌تواند.') : tr('در این دستگاه رمزنگاری فعال نیست.')} checked={enc} disabled={!canEncrypt} onChange={setEnc} testid="sw-enc" />}
            <Switch title={tr('عمومی (در کشف دیده شود)')} desc={tr('هر کسی می‌تواند پیدایش کند و بپیوندد.')} checked={pub} onChange={setPub} testid="sw-pub" />
            {(pub || alias) && <label>{tr('آدرس عمومی (alias)')}<input value={alias} onChange={e => setAlias(e.target.value)} dir="ltr" placeholder="mygroup" spellCheck="false" /></label>}
            {kind === 'channel' && <p className="muted small-note">{tr('در کانال فقط مدیران پیام می‌گذارند؛ اعضا می‌خوانند و به پیام‌ها واکنش می‌دهند.')}</p>}
            {kind === 'group' && enc && <p className="muted small-note">{tr('عضو جدید تاریخچهٔ قبلی را نمی‌بیند؛ پیام‌های جدید را می‌بیند.')}</p>}
            {pub && <p className="muted small-note">{tr('گفتگو با این آدرس در فهرست عمومی و لینک دعوت دیده می‌شود.')}</p>}
          </>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={onClose}>{tr('انصراف')}</button>
            <button className="primary" disabled={busy}>{busy ? tr('صبر کن…') : kind === 'dm' ? tr('شروع پیوی') : tr('ساخت گفتگو')}</button>
          </div>
        </form>
        <button type="button" className="outline discover-btn" onClick={() => { setView('discover'); setRooms(null); discover(); }}><Icon n="search" size={16} /> {tr('کشف گفتگوهای عمومی')}</button>
      </> : <>
        <div className="row">
          <button type="button" className="icon" onClick={() => setView('form')} aria-label={tr('بازگشت')}><Icon n="back" /></button>
          <strong>{tr('کشف گفتگوهای عمومی')}</strong>
        </div>
        <form className="row" onSubmit={discover}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('جستجو در نام یا آدرس')} aria-label={tr('جستجو در گفتگوهای عمومی')} className="grow" />
          <button className="primary" disabled={busy}>{busy ? '…' : tr('جستجو')}</button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        {rooms === null && <p className="muted">…</p>}
        {rooms?.length === 0 && <p className="muted">{tr('گفتگوی عمومی پیدا نشد.')}</p>}
        <RoomSuggestList rooms={rooms || []} busy={busy} onJoin={join} />
      </>}
    </Dialog>;
}
function InviteDialog({
  client,
  room,
  me,
  token,
  onClose
}) {
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState([]);
  const [suggIdx, setSuggIdx] = useState(0);
  const [suggHidden, setSuggHidden] = useState(false);
  const { users: suggestions } = usePeopleSuggest(token, who, { min: 1 });
  useEffect(() => { setSuggIdx(0); }, [who]);
  function pickPerson(u) { setWho(u.user_id); setSuggHidden(true); }
  function onSuggestKey(e) {
    if (suggHidden || !suggestions?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggIdx(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickPerson(suggestions[Math.min(suggIdx, suggestions.length - 1)]);
    }
  }
  async function go(e) {
    e.preventDefault();
    const id = normalizeUserId(who, me);
    if (!id) return;
    setBusy(true);
    setErr('');
    try {
      await client.invite(room.roomId, id);
      setDone(d => [...d, id]);
      setWho('');
    } catch (x) {
      setErr(mxError(x));
    } finally {
      setBusy(false);
    }
  }
  return <Dialog title={tr("دعوت به «{0}»", [room.name])} onClose={onClose}>
      <form className="form" onSubmit={go}>
        <label>
          {tr("نام کاربری")}
          <span className="suggest-wrap">
            <input value={who} onChange={e => { setWho(e.target.value); setSuggHidden(false); }} onKeyDown={onSuggestKey} dir="ltr" placeholder="ali" spellCheck="false" autoComplete="off" required />
            {!suggHidden && <PeopleSuggest users={suggestions} active={suggIdx} onPick={pickPerson} testid="room-invite-suggest" />}
          </span>
        </label>
        {done.length > 0 && <p className="ok">{tr("دعوت شد:")} {done.map(localpart).join(tr("، "))}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>{tr("بستن")}</button>
          <button className="primary" disabled={busy}>{tr("دعوت")}</button>
        </div>
      </form>
    </Dialog>;
}
function FindPeople({
  token,
  onClose,
  onOpen
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const { users: res } = usePeopleSuggest(token, q, { min: 1 });
  useEffect(() => { setIdx(0); }, [q]);
  function onKey(e) {
    if (!res?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + res.length) % res.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const u = res[Math.min(idx, res.length - 1)];
      onClose();
      onOpen(u.user_id);
    }
  }
  return <Dialog title={tr("پیدا کردن افراد")} onClose={onClose}>
      <div className="form">
        <div className="suggest-wrap">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={tr("آیدی یا نام (مثلاً ali)")} aria-label={tr("جستجو")} dir="auto" autoFocus autoComplete="off" />
          {res?.length === 0 && q.trim() && <p className="muted">{tr("کسی پیدا نشد.")}</p>}
          <PeopleSuggest users={res} active={idx} testid="find-people-suggest" onPick={u => { onClose(); onOpen(u.user_id); }} />
        </div>
        <div className="row"><button className="primary" onClick={onClose}>{tr("بستن")}</button></div>
      </div>
    </Dialog>;
}
function ReqPerson({
  id
}) {
  const p = usePerson(id);
  return <strong>{p?.name || localpart(id)}</strong>;
}
function MessageRequests({
  rooms,
  onClose,
  onAccept,
  onDecline,
  onProfile
}) {
  return <Dialog title={tr("درخواست‌های پیام")} onClose={onClose}>
      <p className="muted small-note">{tr("پیام کسانی که دنبالشان نمی‌کنی اول اینجاست. با قبول‌کردن، گفتگو به پیام‌هایت اضافه می‌شود.")}</p>
      <ul className="plain msgreq-list">
        {rooms.length === 0 && <li className="muted">{tr("درخواست جدیدی نداری.")}</li>}
        {rooms.map(r => {
        const inv = r.getDMInviter?.();
        return <li key={r.roomId} className="msgreq">
            <Avatar id={inv || r.roomId} size={44} />
            <div className="msgreq-main">
              <button className="plainbtn" onClick={() => onProfile(inv)}><ReqPerson id={inv} /></button>
              <span className="muted">{tr("می‌خواهد به تو پیام خصوصی بدهد.")}</span>
            </div>
            <div className="msgreq-actions">
              <button className="small primary" onClick={() => onAccept(r.roomId)}>{tr("قبول")}</button>
              <button className="small ghost" onClick={() => onDecline(r.roomId)}>{tr("رد")}</button>
            </div>
          </li>;
      })}
      </ul>
      <div className="row"><button className="primary" onClick={onClose}>{tr("بستن")}</button></div>
    </Dialog>;
}
export default function Shell({
  session,
  onLogout
}) {
  const {
    client,
    sync,
    version,
    cryptoState
  } = useMatrix(session, onLogout);
  const call = useCall(session);
  const [pushRules, setPushRules] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [newKind, setNewKind] = useState('group');
  const [settingsStart, setSettingsStart] = useState(null);
  const [showCall, setShowCall] = useState(false);
  const [tab, setTab] = useState('chat');
  const [exploreQ, setExploreQ] = useState({ q: '', n: 0 });
  const [theme, setThemeMode] = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const [blocked, setBlocked] = useState(new Set());
  const [followingSet, setFollowingSet] = useState(new Set());
  const handledReq = useRef(new Set());
  const [filter, setFilter] = useState('');
  const { users: peopleHits } = usePeopleSuggest(session?.access_token, filter, { min: 1 });
  const [pubHits, setPubHits] = useState([]);
  const [joinBusy, setJoinBusy] = useState(false);
  useEffect(() => {
    const qq = filter.trim();
    if (!session?.access_token || !qq) { setPubHits([]); return undefined; }
    let dead = false;
    const t = setTimeout(() => {
      roomsSuggest(session.access_token, qq, 6).then(r => { if (!dead) setPubHits(r.rooms || []); }).catch(() => { if (!dead) setPubHits([]); });
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [filter, session?.access_token]);
  const [kindFilter, setKindFilter] = useState('all');
  const [composeN, setComposeN] = useState(0);
  const [plOpen, setPlOpen] = useState(null);
  const [npMode, setNpMode] = useState(null); // null | 'full' | 'float'
  const [postView, setPostView] = useState(null);
  const [postShare, setPostShare] = useState(null);
  const [sentTo, setSentTo] = useState('');
  useEffect(() => {
    if (tab !== 'music') setPlOpen(null);
  }, [tab]);
  const player = usePlayer();
  // لینک دعوت عمومی: https://site/#/join/#alias:server
  useEffect(() => {
    if (!client) return undefined;
    const m = /^#\/join\/(.+)$/.exec(window.location.hash || '');
    if (!m) return undefined;
    let dead = false;
    try {
      const raw = decodeURIComponent(m[1]);
      const alias = raw.startsWith('#') ? raw : `#${raw}`;
      client.joinRoom(alias).then(r => {
        if (dead) return;
        history.replaceState(null, '', window.location.pathname);
        setRoomId(r.roomId);
        setTab('chat');
      }).catch(() => { if (!dead) history.replaceState(null, '', window.location.pathname); });
    } catch { /* ignore */ }
    return () => { dead = true; };
  }, [client]);
  useEffect(() => {
    let dead = false;
    if (!client) return undefined;
    client.getPushRules().then(r => { if (!dead) setPushRules(r); }).catch(() => {});
    return () => { dead = true; };
  }, [client, version]);
  const isMuted = (rid) => mutedFromRules(pushRules, rid);
  async function muteRoom(rid, ms) {
    try {
      if (!ms) {
        await client.setRoomMutePushRule('global', rid, false);
        await client.setRoomAccountData(rid, 'ir.tikootak.mute_until', { until: 0 });
      } else {
        await client.setRoomMutePushRule('global', rid, true);
        if (ms === true) {
          await client.setRoomAccountData(rid, 'ir.tikootak.mute_until', { until: 0 });
        } else {
          const until = Date.now() + ms;
          await client.setRoomAccountData(rid, 'ir.tikootak.mute_until', { until });
          setTimeout(() => { muteRoom(rid, 0).catch(() => {}); }, ms);
        }
      }
      setPushRules(await client.getPushRules());
    } catch { /* ignore */ }
  }
  const [profileId, setProfileId] = useState(null);
  const prevTab = useRef('chat');
  setPeopleToken(session.access_token);
  const openProfile = id => {
    if (tab !== 'profile') prevTab.current = tab;
    setProfileId(id);
    setTab('profile');
  };
  const readRef = useRef({});
  const [rec, setRec] = useState('unknown');
  const ready0 = !!client && ['PREPARED', 'SYNCING'].includes(sync);
  const refreshRec = () => {
    if (client && cryptoState === 'on') recoveryStatus(client).then(setRec).catch(() => {});
  };
  useEffect(() => {
    if (ready0) refreshRec(); /* eslint-disable-next-line */
  }, [ready0, cryptoState]);

  // شمارنده اعلان‌های خوانده‌نشده: هر ۳۰ ثانیه و هر بار برگشتن به تب
  useEffect(() => {
    if (!client) return undefined;
    let dead = false;
    const tick = () => {
      if (document.hidden) return;
      notificationsUnread(session.access_token).then(d => {
        if (!dead) setNotifUnread(d.unread);
      }).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 30000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [client, session.access_token]);

  // وقتی تماس تمام شد (قطع یا خطا نداشتن)، نمای تماس بسته شود
  useEffect(() => {
    if (call.info.status === 'idle') setShowCall(false);
  }, [call.info.status]);
  const inCall = call.info.status !== 'idle';
  const callRoom = inCall && client ? client.getRoom(call.info.roomId) : null;
  const nameOf = identity => callRoom?.getMember(identity)?.name || localpart(identity);
  async function startCall(r) {
    if (!r) return;
    setShowCall(true);
    if (call.info.roomId === r.roomId && inCall) return; // قبلاً در همین تماس هستیم
    call.join(r.roomId, r.name);
    // اگر در ۱۰ دقیقه گذشته اعلام تماسی نیامده، یک کارت «پیوستن» در اتاق می‌گذاریم
    const recent = r.getLiveTimeline().getEvents().some(e => hasEvent(e.getContent(), 'call') && Date.now() - e.getTs() < 10 * 60 * 1000);
    if (!recent) {
      client.sendMessage(r.roomId, {
        msgtype: 'm.notice',
        body: tr("تماس گروهی شروع شد"),
        [EV.call]: {
          action: 'start'
        }
      }).catch(() => {});
    }
  }
  const rooms = useMemo(() => {
    if (!client) return [];
    return client.getRooms().filter(r => ['join', 'invite'].includes(r.getMyMembership())).sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, version]);
  const invites = rooms.filter(r => r.getMyMembership() === 'invite');
  const joined = rooms.filter(r => r.getMyMembership() === 'join');
  const savedRoomId = (client?.getAccountData(EV.savedRoom)?.getContent()
    || client?.getAccountData(EV_OLD.savedRoom)?.getContent())?.room_id || null;
  const kindCounts = joined.reduce((acc, r) => {
    const k = roomKind(r, client);
    acc.all += 1;
    if (acc[k] !== undefined) acc[k] += 1;
    return acc;
  }, { all: 0, dm: 0, group: 0, channel: 0 });
  const roomNameOf = (r) => roomKind(r, client) === 'saved' ? tr('پیام‌های ذخیره‌شده') : r.name;
  const visibleJoined = [...joined]
    .filter(r => kindFilter === 'all' || roomKind(r, client) === kindFilter)
    .filter(r => !filter.trim() || roomNameOf(r).toLowerCase().includes(filter.trim().toLowerCase()));
  const pinnedRooms = visibleJoined.filter(r => r.roomId === savedRoomId);
  const recentRooms = visibleJoined.filter(r => r.roomId !== savedRoomId)
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  // نشان پیام جدید: اتاق‌های بی‌صدا شمرده نمی‌شوند؛ otherUnread = بقیهٔ چت‌ها وقتی داخل یک چت هستیم.
  const chatUnread = joined.reduce((n, r) => isMuted(r.roomId) ? n : n + r.getUnreadNotificationCount(sdk.NotificationCountType.Total), 0);
  const otherUnread = joined.reduce((n, r) => (isMuted(r.roomId) || r.roomId === roomId) ? n : n + r.getUnreadNotificationCount(sdk.NotificationCountType.Total), 0);
  // جستجوی یکپارچه: چت‌های من ← آدم‌های جدید (بدون پیوی قبلی) ← گفتگوهای عمومی
  const dmPeers = new Set(Object.keys(client?.getAccountData('m.direct')?.getContent() || {}).filter(u => (client.getAccountData('m.direct').getContent()[u] || []).some(rid => client.getRoom(rid)?.getMyMembership() === 'join')));
  const newPeople = filter.trim() ? (peopleHits || []).filter(u => u.user_id !== session.user_id && !dmPeers.has(u.user_id)) : [];
  const joinedIds = new Set(joined.map(r => r.roomId));
  const newPublic = filter.trim() ? pubHits.filter(r => !joinedIds.has(r.room_id)) : [];
  function pickFound(u) { setFilter(''); openProfile(u.user_id); }
  async function joinFound(room) {
    setJoinBusy(true);
    try {
      const r = await client.joinRoom(room.alias || room.canonical_alias || room.room_id);
      setFilter(''); setRoomId(r.roomId); setTab('chat');
    } catch { /* ignore */ }
    setJoinBusy(false);
  }
  // دکمهٔ برگشت گوشی / سوییپ: لایهٔ بالایی بسته می‌شود، نه برنامه
  useBackLayer(tab !== 'chat', () => setTab(tab === 'profile' ? (prevTab.current || 'chat') : 'chat'));
  useBackLayer(tab === 'chat' && !!roomId, () => setRoomId(null));
  useBackLayer(notifOpen, () => setNotifOpen(false));
  useBackLayer(drawer, () => setDrawer(false));
  const roomIdRef = useRef(null); roomIdRef.current = roomId;
  const isMutedRef = useRef(null); isMutedRef.current = isMuted;
  useDesktopNotify({ client, me: session.user_id, roomIdRef, isMutedRef, unread: chatUnread, onOpenRoom: (rid) => { setRoomId(rid); setTab('chat'); } });
  const [roomCtx, setRoomCtx] = useState(null);
  const rowLp = useLongPress((x, y, e) => {
    const id = e.target.closest?.('[data-room-id]')?.dataset.roomId;
    if (id) setRoomCtx({ x, y, id });
  });
  function roomMenu(rid) {
    const r = client.getRoom(rid);
    if (!r) return [];
    const unread = r.getUnreadNotificationCount(sdk.NotificationCountType.Total);
    const m = isMuted(rid);
    const last = r.getLiveTimeline().getEvents().slice(-1)[0];
    return [
      unread > 0 && last && { key: 'read', icon: 'mailread', label: tr('علامت‌گذاری به‌عنوان خوانده'), onClick: () => client.sendReadReceipt(last).catch(() => {}) },
      m ? { key: 'unmute', icon: 'bell', label: tr('باصدا'), onClick: () => muteRoom(rid, 0) } : null,
      !m && { key: 'm1', icon: 'belloff', label: tr('بی‌صدا · ۱ ساعت'), onClick: () => muteRoom(rid, 3600000) },
      !m && { key: 'm8', icon: 'belloff', label: tr('بی‌صدا · ۸ ساعت'), onClick: () => muteRoom(rid, 28800000) },
      !m && { key: 'mw', icon: 'belloff', label: tr('بی‌صدا · ۱ هفته'), onClick: () => muteRoom(rid, 604800000) },
      !m && { key: 'ma', icon: 'belloff', label: tr('بی‌صدا · همیشه'), onClick: () => muteRoom(rid, true) },
      'sep',
      { key: 'leave', icon: 'logoutdoor', label: tr('ترک گفتگو'), danger: true, onClick: () => { if (window.confirm(tr('از این گفتگو خارج شوی؟'))) client.leave(rid).then(() => { if (roomId === rid) setRoomId(null); }).catch(() => {}); } },
    ].filter(Boolean);
  }
  const renderRoom = (r) => {
    const unread = r.getUnreadNotificationCount(sdk.NotificationCountType.Total);
    const t = r.getLastActiveTimestamp();
    const kind = roomKind(r, client);
    const muted = isMuted(r.roomId);
    const enc = client.isRoomEncrypted(r.roomId);
    const roomName = roomNameOf(r);
    return <button key={r.roomId} data-room-id={r.roomId} className={`room room-${kind} ${muted ? 'muted-room' : ''} ${r.roomId === savedRoomId ? 'pinned' : ''}`} aria-current={r.roomId === roomId} {...rowLp} onClick={() => {
      setRoomId(r.roomId);
      setTab('chat');
    }}>
        <span className={`room-avatar ${kind === 'dm' ? 'dm' : 'square'}`}>
          <RoomAvatar client={client} room={r} name={roomName} id={dmPeer(r) || r.roomId} size={52} />
        </span>
        <div className="room-main">
          <strong><span className="room-kind" title={kindLabel(kind)}><Icon n={kindIconName(kind)} size={14} /></span> <span className="room-name">{roomName}</span>{enc && <Icon n="lock" size={12} />}</strong>
          <Preview room={r} kind={kind} />
        </div>
        <div className="room-meta">
          <time>{t > 0 ? fmtTime(t) : ''}</time>
          <span className="room-meta-end">
            {muted && <Icon n="belloff" size={13} />}
            {unread > 0 && r.roomId !== roomId && <span className={`badge ${muted ? 'mute-badge' : ''}`}>{fa(unread > 99 ? '99+' : unread)}</span>}
          </span>
        </div>
      </button>;
  };
  const room = joined.find(r => r.roomId === roomId) || null;
  // پایان بی‌صداهای زمان‌دار (حتی بعد از رفرش، از room account data)
  useEffect(() => {
    if (!client) return undefined;
    const timers = [];
    for (const r of joined) {
      const until = muteUntil(r);
      if (!until) continue;
      const left = until - Date.now();
      if (left <= 0) muteRoom(r.roomId, 0).catch(() => {});
      else timers.push(setTimeout(() => muteRoom(r.roomId, 0).catch(() => {}), Math.min(left, 2147483647)));
    }
    return () => timers.forEach(clearTimeout);
  }, [client, version]);
  const me = session.user_id;
  const [profileName, setProfileName] = useState(null);
  useEffect(() => {
    if (!client) return;
    client.getProfileInfo(me).then(p => setProfileName(p.displayname || null)).catch(() => {});
  }, [client, me]);
  const myName = profileName || localpart(me);
  const dmInviter = r => {
    try {
      return r.getDMInviter?.() || null;
    } catch {
      return null;
    }
  };

  // فهرست بلاک‌ها و دنبال‌شده‌ها؛ برای جداکردن «درخواست پیام» از دعوت‌های آشنا
  useEffect(() => {
    if (!client) return undefined;
    let dead = false;
    blocksList(session.access_token).then(d => {
      if (!dead) setBlocked(new Set((d.blocks || []).map(b => b.user_id)));
    }).catch(() => {});
    followList(session.access_token, me, 'following').then(d => {
      if (!dead) setFollowingSet(new Set((d.users || []).map(u => u.user_id)));
    }).catch(() => {});
    return () => {
      dead = true;
    };
  }, [client, session.access_token, me]);

  const requestRooms = invites.filter(r => {
    const inv = dmInviter(r);
    return inv && !followingSet.has(inv) && !blocked.has(inv);
  });
  const normalInvites = invites.filter(r => !requestRooms.includes(r));

  // دعوت/گفتگوی کاربر بلاک‌شده خودکار بسته می‌شود
  useEffect(() => {
    if (!client) return;
    for (const r of invites) {
      const inv = dmInviter(r);
      if (inv && blocked.has(inv) && !handledReq.current.has(r.roomId)) {
        handledReq.current.add(r.roomId);
        client.leave(r.roomId).then(() => client.forget(r.roomId)).catch(() => {});
      }
    }
    for (const r of joined) {
      const peer = dmPeer(r);
      if (peer && blocked.has(peer) && !handledReq.current.has(r.roomId)) {
        handledReq.current.add(r.roomId);
        client.leave(r.roomId).catch(() => {});
      }
    }
  }, [client, invites, joined, blocked, version]);

  // علامت‌گذاری پیام‌ها به‌عنوان خوانده‌شده برای اتاق باز
  useEffect(() => {
    if (!client || !room || document.hidden) return;
    const evs = room.getLiveTimeline().getEvents();
    // پیام‌هایی که هنوز ارسال نشده‌اند (شناسه موقت با ~) رسید خواندن نمی‌گیرند
    let last = null;
    for (let i = evs.length - 1; i >= 0; i--) {
      const id = evs[i].getId();
      if (id && !id.startsWith('~')) {
        last = evs[i];
        break;
      }
    }
    if (last && readRef.current[room.roomId] !== last.getId()) {
      readRef.current[room.roomId] = last.getId();
      client.sendReadReceipt(last).catch(() => {});
    }
  }, [client, room, version]);
  async function accept(id) {
    try {
      const inviter = client.getRoom(id)?.getDMInviter?.();
      await client.joinRoom(id);
      if (inviter) await addDirect(inviter, id);
      setRoomId(id);
      setTab('chat');
    } catch {/* نمایش خطا در نسخه بعد */}
  }
  async function addDirect(userId, rid) {
    const cur = client.getAccountData('m.direct')?.getContent() || {};
    if ((cur[userId] || []).includes(rid)) return;
    await client.setAccountData('m.direct', {
      ...cur,
      [userId]: [...(cur[userId] || []), rid]
    });
  }
  // گفتگوی خصوصی با یک نفر: اگر قبلاً هست باز می‌شود، وگرنه (رمزنگاری‌شده) ساخته می‌شود
  async function openDM(userId) {
    const cur = client.getAccountData('m.direct')?.getContent() || {};
    const old = (cur[userId] || []).find(rid => client.getRoom(rid)?.getMyMembership() === 'join');
    if (old) {
      setRoomId(old);
      setTab('chat');
      return;
    }
    try {
      const r = await client.createRoom({
        is_direct: true,
        invite: [userId],
        preset: sdk.Preset.TrustedPrivateChat,
        power_level_content_override: {
          events: PL_EVENTS
        },
        initial_state: cryptoState === 'on' ? [{
          type: 'm.room.encryption',
          state_key: '',
          content: {
            algorithm: 'm.megolm.v1.aes-sha2'
          }
        }] : []
      });
      await addDirect(userId, r.room_id);
      setRoomId(r.room_id);
      setTab('chat');
    } catch {/* ignore */}
  }
  // طرف مقابل در گفتگوی خصوصی (برای نشان دادن عکس او در لیست)
  function dmPeer(r) {
    const cur = client?.getAccountData('m.direct')?.getContent() || {};
    for (const [u, ids] of Object.entries(cur)) if (ids.includes(r.roomId)) return u;
    return null;
  }
  async function decline(id) {
    try {
      await client.leave(id);
      await client.forget(id);
    } catch {/* ignore */}
  }
  async function logout() {
    // اگر کلیدها روی سرور پشتیبان دارند، نسخه محلی را پاک می‌کنیم (روی رایانه مشترک امن‌تر است)
    try {
      const active = await client?.getCrypto()?.getActiveSessionBackupVersion();
      await call.leave();
      await client?.logout(true);
      if (active) await client.clearStores();
    } catch {/* ignore */}
    clearPending();
    for (const prefix of ['tikootak.draft.', 'tikotak.draft.']) {
      for (const k of localStorageKeys(prefix)) removeItem(k);
    }
    resetPeople();
    onLogout();
  }

  // تنظیمات: تم سه‌حالته (تیره/روشن/OLED) از طریق useTheme

  // اعلان لایک/نظر → همان پست در پنجره باز شود
  async function openNotifPost(id) {
    try {
      setPostView(await feedPost(session.access_token, id));
    } catch {/* پست پاک شده */}
  }

  async function handleBlock(uid) {
    if (!uid || blocked.has(uid)) return false;
    if (!window.confirm(tr("این کاربر بلاک شود؟ دیگر پست‌هایش را نمی‌بینی و پیام‌هایش قطع می‌شود."))) return false;
    try {
      await blockPerson(session.access_token, client, uid);
      setBlocked(prev => new Set(prev).add(uid));
      setTab('chat');
      setRoomId(null);
      return true;
    } catch {
      return false;
    }
  }
  async function handleUnblock(uid) {
    try {
      await unblockUser(session.access_token, uid);
      await setIgnored(client, uid, false);
      setBlocked(prev => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }
  // میان‌برها: Ctrl+K جستجو، Alt+↑/↓ گفتگوی قبلی/بعدی
  useEffect(() => {
    const h = e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault();
        setTab('chat');
        document.querySelector('.sidebar .searchbox input')?.focus();
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const btns = [...document.querySelectorAll('.sidebar button.room[data-room-id]')].filter(b => !b.classList.contains('invite'));
        if (!btns.length) return;
        e.preventDefault();
        const cur = btns.findIndex(b => b.getAttribute('aria-current') === 'true');
        const next = btns[Math.max(0, Math.min(btns.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
        next?.click();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const offline = sync === 'ERROR' || sync === 'RECONNECTING';
  const ready = !!client && ['PREPARED', 'SYNCING', 'CATCHUP'].includes(sync);
  return <ShareCtx.Provider value={{
    sharePost: p => {
      setSentTo('');
      setPostShare(p);
    },
    openPost: setPostView,
    openTag: t => { setPostView(null); setExploreQ(x => ({ q: '#' + t, n: x.n + 1 })); setTab('explore'); }
  }}>
    <div className="shell" data-view={room || tab !== 'chat' ? 'chat' : 'list'} data-bar={tab === 'chat' && room || inCall && showCall ? 'off' : 'on'}>
      <aside className="sidebar">
        <header className="side-head">
          <button className="icon menu-btn" onClick={() => setDrawer(true)} aria-label={tr('منو')} title={tr('منو')} data-testid="menu-btn"><Icon n="menu" /></button>
          <div className="brand">
            <LogoMark size={34} className="brand-mark" />
            <div className="brand-text">
              <strong>TIKOOTAK</strong>
              <span>{tr('شبکه اجتماعی خصوصی')}</span>
            </div>
          </div>
          <span className="grow" />
          <button className="icon side-search" onClick={() => setDialog('people')} title={tr("جستجوی افراد")} aria-label={tr("جستجوی افراد")}><Icon n="search" /></button>
          <button className="icon bell-btn" onClick={() => setNotifOpen(true)} title={tr("اعلان‌ها")} aria-label={tr("اعلان‌ها")}>
            <Icon n="bell" />
            {(notifUnread + requestRooms.length) > 0 && <span className="bell-badge">{(notifUnread + requestRooms.length) > 99 ? '۹۹+' : fa(notifUnread + requestRooms.length)}</span>}
          </button>
          <button className="me-avatar-btn" onClick={() => openProfile(me)} aria-label={tr('پروفایل من')} title={tr('پروفایل من')}>
            <Avatar name={myName} id={me} size={34} />
          </button>
        </header>
        <InstallBar />

        <div className="side-stories">
          <div className="side-stories-head"><strong>{tr('استوری‌ها')}</strong><span>{tr('۲۴ ساعت')}</span></div>
          <StoriesBar token={session.access_token} me={me} onProfile={openProfile} />
        </div>

        <nav className="nav" aria-label={tr("بخش‌ها")}>
          {[['chat', tr("گفتگو"), null], ['feed', tr("فید"), 'film'], ['explore', tr("اکسپلور"), 'search'], ['music', tr("موزیک"), 'music']].map(([k, l, ic]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k} onClick={() => setTab(k)}>{ic && <Icon n={ic} size={18} />}{l}</button>)}
        </nav>

        {cryptoState === 'off' && <div className="banner action">
            <span>{tr("رمزنگاری روی این دستگاه فعال نشد؛ پیام‌های رمزنگاری‌شده باز نمی‌شوند.")}</span>
            <button className="small primary" onClick={() => window.location.reload()}>{tr("تلاش دوباره")}</button>
          </div>}
        {offline && <div className="banner">{tr("اتصال قطع شد. در حال تلاش دوباره…")}</div>}

        <div className="searchbox">
          <Icon n="search" size={18} />
          <input value={filter} onChange={e => setFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && filter.trim() && !visibleJoined.length && newPeople[0]) pickFound(newPeople[0]); }} placeholder={tr("جستجوی گفتگو یا آدم‌ها")} aria-label={tr("جستجوی گفتگو یا آدم‌ها")} data-testid="list-search" />
        </div>

        <div className="chips conv-filters" role="tablist" aria-label={tr('فیلتر گفتگوها')}>
          {[['all', tr('همه'), 'chat'], ['dm', tr('پیوی'), 'user'], ['group', tr('گروه'), 'users'], ['channel', tr('کانال'), 'megaphone']].map(([k, label, ic]) => (
            <button key={k} type="button" role="tab" aria-selected={kindFilter === k} className={`chip ${kindFilter === k ? 'on' : ''}`} onClick={() => setKindFilter(k)}>
              <Icon n={ic} size={13} />{label}<span className="chip-count">{fa(kindCounts[k] || 0)}</span>
            </button>
          ))}
        </div>


        <div className="list">
          {normalInvites.length > 0 && <>
              <h3 className="group">{tr("دعوت‌ها")}</h3>
              {normalInvites.map(r => <div key={r.roomId} className="room invite">
                  <Avatar name={r.name} id={r.roomId} />
                  <div className="room-main"><strong>{r.name}</strong><span className="muted">{tr("دعوتت کرده‌اند")}</span></div>
                  <div className="invite-actions">
                    <button className="small primary" onClick={() => accept(r.roomId)}>{tr("بپیوند")}</button>
                    <button className="small ghost" onClick={() => decline(r.roomId)}>{tr("رد")}</button>
                  </div>
                </div>)}
              <h3 className="group">{tr("گفتگوها")}</h3>
            </>}

          {pinnedRooms.length > 0 && <>
              <h3 className="group pinned-label">{tr('سنجاق‌شده‌ها')}</h3>
              {pinnedRooms.map(renderRoom)}
            </>}
          {recentRooms.length > 0 && <h3 className="group recent-label">{tr('پیام‌های اخیر')}</h3>}
          {recentRooms.map(renderRoom)}
          {filter.trim() && newPeople.length > 0 && <>
              <h3 className="group">{tr('افراد')}</h3>
              <PeopleSuggest users={newPeople} onPick={pickFound} testid="find-people" />
            </>}
          {filter.trim() && newPublic.length > 0 && <>
              <h3 className="group">{tr('گفتگوهای عمومی')}</h3>
              <RoomSuggestList rooms={newPublic} busy={joinBusy} onJoin={joinFound} testid="find-public" />
            </>}
          {ready && visibleJoined.length === 0 && !(filter.trim() && (newPeople.length || newPublic.length)) && <div className="empty small-empty"><p>{tr('گفتگویی با این فیلتر نیست.')}</p></div>}

          {ready && joined.length === 0 && normalInvites.length === 0 && <div className="empty">
              <LogoMark size={56} className="empty-logo" />
              <p>{tr("هنوز گفتگویی نداری.")}</p>
              <button className="primary" onClick={() => { setNewKind('group'); setDialog('new'); }}>{tr("گروه یا کانال بساز")}</button>
            </div>}
          {!ready && !offline && <div className="skeleton-list" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => <div className="skeleton-row" key={i}><span className="sk-av" /><span className="sk-lines"><span /><span /></span></div>)}
            </div>}
        </div>
        <div className="side-foot">
          <button className="new-conv-btn" data-testid="new-conv" title={tr('گروه یا کانال جدید')} aria-label={tr('گروه یا کانال جدید')} onClick={() => { setNewKind('group'); setDialog('new'); }}>
            <Icon n="pen" size={22} />
          </button>
        </div>
      </aside>

      <main className="main">
        {tab === 'settings' ? <Settings key={settingsStart || 'main'} startPage={settingsStart} client={client} token={session.access_token} session={session} me={me} theme={theme} onTheme={setThemeMode} onBack={() => setTab('chat')} onProfile={openProfile} onLogout={logout} onRecovery={mode => setDialog(mode)} blocked={blocked} onUnblock={handleUnblock} /> : tab === 'profile' && profileId ? <Profile key={profileId} client={client} token={session.access_token} me={me} id={profileId} blocked={blocked.has(profileId)} onBlock={handleBlock} onBack={() => setTab(prevTab.current)} onProfile={openProfile} onMessage={openDM} onPlaylist={pid => {
          setPlOpen(pid);
          setTab('music');
        }} /> : tab === 'explore' ? <Explore key={exploreQ.n} initialQ={exploreQ.q} token={session.access_token} me={me} client={client} onProfile={openProfile} onRoomJoined={id => { setRoomId(id); setTab('chat'); }} /> : tab === 'feed' ? <Feed token={session.access_token} me={me} compose={composeN} onBack={() => setTab('chat')} onProfile={openProfile} onBlock={handleBlock} /> : tab === 'music' ? <Music key={plOpen || 'm'} token={session.access_token} me={me} player={player} initial={plOpen} onBack={() => {
          setPlOpen(null);
          setTab('chat');
        }} /> : room ? <Chat key={room.roomId} topPlayer={player.track ? <MiniPlayer docked player={player} floating={npMode === 'float'} onOpen={() => setNpMode('full')} onFloat={() => setNpMode(m => m === 'float' ? null : 'float')} /> : null} client={client} room={room} version={version} me={me} otherUnread={otherUnread} onBack={() => setRoomId(null)} onInvite={() => setDialog('invite')} player={player} onOpenPost={setPostView} onProfile={openProfile} onMessage={openDM} onBlock={handleBlock} blocked={blocked} onCall={() => startCall(room)} callHere={inCall && call.info.roomId === room.roomId} onRecovery={() => setDialog('rrestore')} muted={isMuted(room.roomId)} onMute={(ms) => muteRoom(room.roomId, ms)} /> : <div className="placeholder">
            <LogoMark size={64} className="placeholder-logo" />
            <p>{tr("یک گفتگو را انتخاب کن یا گروه و کانال جدید بساز.")}</p>
          </div>}

        <audio ref={player.audio} {...player.handlers} preload="auto" />
                {player.track && !(tab === 'chat' && room) && <MiniPlayer player={player} floating={npMode === 'float'} onOpen={() => setNpMode('full')} onFloat={() => setNpMode(m => m === 'float' ? null : 'float')} />}
        {npMode === 'full' && player.track && <NowPlaying player={player} onClose={() => setNpMode(null)} onFloat={() => setNpMode('float')} />}
        {npMode === 'float' && player.track && <FloatPlayer player={player} onClose={() => setNpMode(null)} onFull={() => setNpMode('full')} />}
        {inCall && !showCall && <div className="call-bar" role="status">
            <span>{tr("در تماس:")} {call.info.title}</span>
            <button className="small primary" onClick={() => setShowCall(true)}>{tr("برگشت به تماس")}</button>
            <button className="small ghost" onClick={call.leave}>{tr("قطع")}</button>
          </div>}
        {inCall && showCall && <CallView call={call} nameOf={nameOf} onClose={() => setShowCall(false)} />}
      </main>

      <nav className="bottombar" aria-label={tr("ناوبری")}>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => {
          setTab('chat');
          setRoomId(null);
        }}><span className="tab-ico"><Icon n="chat" size={21} />{chatUnread > 0 && <span className="tab-badge">{fa(chatUnread > 99 ? '99+' : chatUnread)}</span>}</span><span>{tr("گفتگوها")}</span></button>
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}><span className="tab-ico"><Icon n="film" size={21} /></span><span>{tr("فید")}</span></button>
        <button className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}><span className="tab-ico"><Icon n="search" size={21} /></span><span>{tr("کشف")}</span></button>
        <button className={tab === 'music' ? 'on' : ''} onClick={() => setTab('music')}><span className="tab-ico"><Icon n="music" size={21} /></span><span>{tr("موزیک")}</span></button>
        <button className={tab === 'profile' && profileId === me ? 'on' : ''} onClick={() => openProfile(me)}><span className="tab-ico"><Icon n="user" size={21} /></span><span>{tr("من")}</span></button>
      </nav>

      {roomCtx && <ContextMenu x={roomCtx.x} y={roomCtx.y} label={tr('عملیات گفتگو')} items={roomMenu(roomCtx.id)} onClose={() => setRoomCtx(null)} />}
      {drawer && <MenuDrawer me={me} name={myName} theme={theme} onTheme={setThemeMode} onClose={() => setDrawer(false)} items={{
        profile: () => openProfile(me),
        group: () => { setNewKind('group'); setDialog('new'); },
        channel: () => { setNewKind('channel'); setDialog('new'); },
        people: () => setDialog('people'),
        saved: () => { ensureSavedRoom(client).then(id => { setRoomId(id); setTab('chat'); }).catch(() => {}); },
        invite: () => { setSettingsStart('invite'); setTab('settings'); },
        settings: () => { setSettingsStart(null); setTab('settings'); }
      }} />}
      {dialog === 'new' && <NewConversation key={newKind} initialKind={newKind} client={client} me={me} token={session.access_token} canEncrypt={cryptoState === 'on'} onClose={() => setDialog(null)} onCreated={id => {
        setDialog(null);
        setRoomId(id);
      }} onDM={id => {
        setDialog(null);
        openDM(id);
      }} />}
      {dialog === 'rsetup' && <RecoverySetup client={client} onClose={() => setDialog(null)} onDone={() => {
        setDialog(null);
        refreshRec();
      }} />}
      {dialog === 'rrestore' && <RecoveryRestore client={client} onClose={() => setDialog(null)} onDone={() => {
        setDialog(null);
        refreshRec();
      }} />}
      {dialog === 'people' && <FindPeople token={session.access_token} onClose={() => setDialog(null)} onOpen={openProfile} />}
      {notifOpen && <Notifications
        token={session.access_token}
        requests={requestRooms.map(r => ({ roomId: r.roomId, inviter: dmInviter(r) })).filter(r => r.inviter)}
        onClose={() => setNotifOpen(false)}
        onOpenPost={openNotifPost}
        onProfile={openProfile}
        onRead={setNotifUnread}
        onAccept={async id => { setNotifOpen(false); await accept(id); }}
        onDecline={decline}
      />}
      {dialog === 'invite' && room && <InviteDialog client={client} room={room} me={me} token={session.access_token} onClose={() => setDialog(null)} />}
      {postView && <PostModal token={session.access_token} me={me} post={postView} onBlock={handleBlock} onClose={() => setPostView(null)} onProfile={id => {
        setPostView(null);
        openProfile(id);
      }} />}
      {postShare && <ShareToChat post={postShare} rooms={joined} peerOf={dmPeer} onClose={() => setPostShare(null)} onSend={async rid => {
        await sendShare(client, rid, { kind: 'post', id: postShare.id, title: (postShare.caption || postShare.name || '').slice(0, 60) });
        feedShare(session.access_token, postShare.id).catch(() => {});
      }} />}
    </div>
    </ShareCtx.Provider>;
}