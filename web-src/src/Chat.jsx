import { tr } from './i18n.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sdk, localpart } from './matrix.js';
import { Icon } from './icons.jsx';
import { Avatar, Dialog } from './ui.jsx';
import Attachment from './Attachment.jsx';
import MediaViewer from './MediaViewer.jsx';
import ShareCard from './ShareCard.jsx';
import ShareMusic from './ShareMusic.jsx';
import { usePerson } from './people.js';
import { useBackLayer } from './backstack.js';
import { AddTo } from './Music.jsx';
import { isMusic, musicMeta, importFromMessage } from './chatMusic.js';
import RoomSettings from './RoomSettings.jsx';
import ForwardDialog from './ForwardDialog.jsx';
import { saveToSaved } from './forward.js';
import { sendShare } from './share.js';
import { sendFile, fetchFile, fmtSize } from './media.js';
import { roomKind, kindIcon, kindIconName, kindLabel, myPower, canModerate, roomAlias, disappearAfter, channelSigning, CHANNEL_SIGNING_EVENT } from './roomtype.js';
import RoomAvatar from './RoomAvatar.jsx';
import { PollDialog, PollCard } from './Poll.jsx';
import SendPreview from './SendPreview.jsx';
import { useReport } from './Report.jsx';
import ContextMenu from './ContextMenu.jsx';
import { canOpenMessageMenu, canReplyOnDoubleClick } from './msgGestures.js';
import { attachSwipeReply, rowFromEvent } from './swipeReply.js';
import { uploadPolicy, shareGet } from './api.js';
import EmojiPanel from './EmojiPanel.jsx';
import { sendSticker, stickerFromMessage, ST_FLAG } from './stickers.js';
import { keyboardHeight, lockViewport, unlockViewport, waitKeyboard } from './viewport.js';
import { fmtDay, fmtTime, sameDay, fa, hue } from './util.js';
import { EV, EV_OLD, pickEvent, hasEvent } from './eventTypes.js';
import { getItem, setItem, removeItem, localStorageKeys } from './storage.js';
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJIS = ['🔥', '🎉', '👏', '😍', '🤔', '😎'];
const QUICK = ['❤️', '👍', '😂', '🔥', '😮', '😢'];
const NAME_COLORS = ['var(--name-1)', 'var(--name-2)', 'var(--name-3)', 'var(--name-4)', 'var(--name-5)', 'var(--name-6)', 'var(--name-7)', 'var(--name-8)'];

// فقط پیام‌های واقعی؛ واکنش و ویرایش جدا حساب می‌شوند. پیام رمزنگاری‌شده تا وقتی رمزگشایی نشده پنهان است (فقط اگر خراب باشد نشان می‌دهیم)
function shown(e) {
  const t = e.getType();
  if (t === 'm.room.encrypted') return e.isDecryptionFailure();
  if (t !== 'm.room.message') return false;
  if (e.isRedacted()) return false;
  if (e.isRelation && e.isRelation('m.replace')) return false;
  return true;
}
function Linkified({
  text
}) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" dir="ltr">{p}</a> : p);
}

// ویرایش‌ها و واکنش‌ها را از روی رویدادهای اتاق جمع می‌کنیم
function collect(room) {
  const edits = new Map(); // اصلی -> آخرین ویرایش (فقط از خود فرستنده)
  const reacts = new Map(); // اصلی -> Map(emoji -> [{ sender, id }])
  const byId = new Map();
  for (const e of room.getLiveTimeline().getEvents()) if (e.getId()) byId.set(e.getId(), e);
  for (const e of room.getLiveTimeline().getEvents()) {
    if (e.isRedacted()) continue;
    const t = e.getType();
    const rel = e.getContent()?.['m.relates_to'];
    if (t === 'm.room.message' && rel?.rel_type === 'm.replace') {
      const orig = byId.get(rel.event_id);
      const nc = e.getContent()['m.new_content'];
      if (orig && orig.getSender() === e.getSender() && nc) {
        const cur = edits.get(rel.event_id);
        if (!cur || cur.ts <= e.getTs()) edits.set(rel.event_id, {
          ts: e.getTs(),
          content: nc
        });
      }
    } else if (t === 'm.reaction' && rel?.rel_type === 'm.annotation' && rel.key) {
      if (!reacts.has(rel.event_id)) reacts.set(rel.event_id, new Map());
      const m = reacts.get(rel.event_id);
      if (!m.has(rel.key)) m.set(rel.key, []);
      m.get(rel.key).push({
        sender: e.getSender(),
        id: e.getId()
      });
    }
  }
  return {
    edits,
    reacts,
    byId
  };
}
const contentOf = (ev, edits) => ({
  ...ev.getContent(),
  ...(edits.get(ev.getId())?.content || {})
});
function snippet(ev, edits) {
  if (!ev) return tr("پیام قبلی");
  if (ev.isRedacted()) return tr("پیام حذف شد");
  if (ev.getType() === 'm.room.encrypted') return tr("🔒 پیام رمزنگاری‌شده");
  const c = edits ? contentOf(ev, edits) : ev.getContent();
  const cap = c.filename && c.filename !== c.body ? ` ${c.body}`.slice(0, 60) : '';
  if (c.msgtype === 'm.image') return tr("📷 تصویر") + cap;
  if (isMusic(c)) return `🎵 ${musicMeta(c).title}`;
  if (c.msgtype === 'm.audio') return tr("🎤 پیام صوتی");
  if (c.msgtype === 'm.file') return `📎 ${c.body || tr("فایل")}`;
  if (c.msgtype === 'm.video') return tr("🎬 ویدیو") + cap;
  return (c.body || '').slice(0, 80);
}
function Body({
  ev,
  content,
  onJoinCall,
  client,
  player,
  onOpenPost,
  onOpenMedia
}) {
  if (ev.isDecryptionFailure()) {
    return <span className="muted">{tr("🔑 این پیام رمزگشایی نشد (کلیدش روی این دستگاه نیست)")}</span>;
  }
  const c = content;
  if (hasEvent(c, 'call')) {
    return <span className="call-card">
        <Icon n="phone" size={18} />
        <span>{tr("تماس گروهی شروع شد")}</span>
        <button className="small primary" onClick={onJoinCall}>{tr("پیوستن")}</button>
      </span>;
  }
  const poll = pickEvent(c, 'poll');
  if (poll) return <PollCard client={client} room={client.getRoom(ev.getRoomId())} ev={ev} poll={poll} me={client.getUserId()} />;
  const share = pickEvent(c, 'share');
  if (share) return <ShareCard client={client} share={share} player={player} onOpenPost={onOpenPost} />;
  if (c.msgtype === 'm.image' || c.msgtype === 'm.file' || c.msgtype === 'm.audio' || c.msgtype === 'm.video') return <Attachment client={client} content={c} onOpen={onOpenMedia} player={player} />;
  const text = c.msgtype === 'm.emote' ? `* ${c.body}` : c.body || '';
  const emojiOnly = !!c.body && /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\uFE0F\s]+$/u.test(c.body.trim());
  const mids = c['m.mentions']?.user_ids || [];
  if (mids.length) {
    const room = client.getRoom(ev.getRoomId());
    const names = mids.map(id => room?.getMember(id)?.name || localpart(id)).filter(Boolean).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(@(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
    return <span className="text" dir="auto" data-emoji-only={emojiOnly ? '' : undefined}>{text.split(re).map((p, i) => i % 2 ? <span key={i} className="mention">{p}</span> : <Linkified key={i} text={p} />)}</span>;
  }
  return <span className="text" dir="auto" data-emoji-only={emojiOnly ? '' : undefined}><Linkified text={text} /></span>;
}
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// نام امضای کانال: از پروفایل‌های gateway (چون با Q7 رویداد عضویت ادمین برای اعضا فیلتر می‌شود)
function SignName({ id, room }) {
  const p = usePerson(id);
  return <>{p?.name || room.getMember(id)?.name || localpart(id)}</>;
}
export default function Chat({
  topPlayer = null,
  otherUnread = 0,
  client,
  room,
  version,
  me,
  onBack,
  onInvite,
  onCall,
  callHere,
  onProfile,
  player,
  onOpenPost,
  onRecovery,
  muted = false,
  onMute
}) {
  const listRef = useRef(null);
  const stick = useRef(true);
  const draftKey = `tikootak.draft.${room.roomId}`;
  const [text, setText] = useState(() => getItem(draftKey) || '');
  const [loadingOld, setLoadingOld] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [report, reportNode] = useReport(client.getAccessToken());
  const [sending, setSending] = useState(0);
  const [fileErr, setFileErr] = useState('');
  const fileRef = useRef(null);
  const [sel, setSel] = useState(null); // پیام هدف منوی راست‌کلیک (هایلایت)
  const [ctx, setCtx] = useState(null); // { x, y, id }
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [rec, setRec] = useState(null); // { start }
  const [recErr, setRecErr] = useState('');
  const [pinIdx, setPinIdx] = useState(0);
  const [pinned, setPinned] = useState({}); // id -> رویداد بارگذاری‌شده
  const recRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [pickMusic, setPickMusic] = useState(false);
  const [addMusicEv, setAddMusicEv] = useState(null);
  const [addShareTrack, setAddShareTrack] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachBtnRef = useRef(null);
  const [attachPos, setAttachPos] = useState(null);
  useLayoutEffect(() => {
    if (!attachOpen) return undefined;
    const place = () => {
      const r = attachBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      const rtl = document.documentElement.dir === 'rtl';
      setAttachPos({ bottom: Math.round(window.innerHeight - r.top + 10), ...(rtl ? { right: Math.max(8, Math.round(window.innerWidth - r.right)) } : { left: Math.max(8, Math.round(r.left)) }) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [attachOpen]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forwardEv, setForwardEv] = useState(null);
  const [upAllowed, setUpAllowed] = useState({ image: true, video: true, voice: true, music: true, file: true });
  useEffect(() => {
    let on = true;
    uploadPolicy(client.getAccessToken(), true).then(p => { if (on && p?.allowed) setUpAllowed(p.allowed); });
    return () => { on = false; };
  }, [client, room.roomId]);
  const [multi, setMulti] = useState(null); // مجموعهٔ پیام‌های انتخاب‌شده (حالت انتخاب چندتایی)
  const [infoEv, setInfoEv] = useState(null);
  const [ctxMore, setCtxMore] = useState(false);
  const tapStart = useRef(null); // { id, x, y, t }
  const lastDownSelection = useRef({ text: '', at: 0, id: null }); // انتخاب متن قبل از دابل‌کلیک
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // خط «پیام‌های جدید»: اولین پیام دیگران بعد از آخرین پیامی که خوانده‌ام، فقط هنگام ورود به گفتگو محاسبه می‌شود
  const [firstUnread] = useState(() => {
    try {
      const evsNow = room.getLiveTimeline().getEvents();
      const readId = room.getEventReadUpTo(me);
      const idx = readId ? evsNow.findIndex(e => e.getId() === readId) : -1;
      for (let i = idx + 1; i < evsNow.length; i++) {
        const e = evsNow[i];
        if (e.getSender() !== me && ['m.room.message', 'm.room.encrypted', 'm.sticker'].includes(e.getType())) return { id: e.getId(), n: room.getUnreadNotificationCount(sdk.NotificationCountType.Total) };
      }
    } catch { /* ignore */ }
    return null;
  });
  const [away, setAway] = useState(0); // پیام‌های تازه‌ای که وقتی بالا بودم رسید
  const lastLen = useRef(0);
  const initialAwayCleared = useRef(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dockInstant, setDockInstant] = useState(false);
  const [dockOn, setDockOn] = useState(false); // پنل هنوز در DOM است (برای انیمیشن بسته‌شدن)
  const [dockMode] = useState(() => { try { return !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } });
  const kbH = useRef(0);
  const topRef = useRef(null);
  const chatRef = useRef(null);
  // ارتفاع نوار شناور بالا (هدر/پین/جستجو) تا لیست پیام زیر آن شروع شود و از زیرش رد شود
  useEffect(() => {
    const el = topRef.current;
    const root = chatRef.current;
    if (!el || !root || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => root.style.setProperty('--top-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // روی موبایل پنل جای کیبورد می‌نشیند: ارتفاع آخرین کیبورد را نگه می‌داریم
  function dockHeight() {
    let h = kbH.current;
    if (!h) { try { h = Number(localStorage.getItem('tikootak.kbh')) || 0; } catch { /* خالی */ } }
    return Math.max(240, Math.min(h || 310, 440));
  }
  const swap = useRef(0); // شمارندهٔ جابه‌جایی کیبورد/پنل؛ برای لغو انتظارهای قدیمی
  const setKb = (on) => { const el = taRef.current; if (el) el.inputMode = on ? 'text' : 'none'; };
  // کیبورد → پنل: ارتفاع قفل می‌شود، پنل بی‌انیمیشن جای کیبورد را می‌گیرد و کیبورد زیر آن پایین می‌رود
  async function openPanelFromKeyboard() {
    const id = ++swap.current;
    const kb = keyboardHeight();
    if (kb > 150) { kbH.current = kb; try { localStorage.setItem('tikootak.kbh', String(kb)); } catch { /* مهم نیست */ } }
    setDockInstant(true); lockViewport();
    setDockOn(true); setEmojiOpen(true);
    const el = taRef.current;
    if (el) { el.inputMode = 'none'; el.blur(); el.focus({ preventScroll: true }); }
    await waitKeyboard(h => h < 40, 700);
    if (swap.current === id) unlockViewport();
  }
  // پنل → کیبورد: ارتفاع قفل می‌ماند تا کیبورد کامل بالا بیاید، بعد پنل بی‌انیمیشن جمع می‌شود
  async function closePanelToKeyboard() {
    const id = ++swap.current;
    setDockInstant(true); lockViewport();
    setKb(true);
    const el = taRef.current;
    if (el && document.activeElement === el) { el.blur(); el.focus({ preventScroll: true }); } else el?.focus({ preventScroll: true });
    await waitKeyboard(h => h > 120, 700);
    if (swap.current !== id) return;
    setEmojiOpen(false); unlockViewport();
  }
  function toggleEmoji() {
    if (!dockMode) { setEmojiOpen(o => !o); return; }
    if (emojiOpen) { closePanelToKeyboard(); return; }
    if (keyboardHeight() > 120) { openPanelFromKeyboard(); return; }
    swap.current++;
    setDockInstant(false); setKb(false);
    const el = taRef.current;
    if (el && document.activeElement === el) { el.blur(); el.focus({ preventScroll: true }); }
    setDockOn(true); setEmojiOpen(true);
  }
  // پنل بسته شد بدون کیبورد (ارسال استیکر، لمس بیرون، برگشت): ارتفاع آزاد و انیمیشن عادی
  function closePanel() { swap.current++; unlockViewport(); setDockInstant(false); setKb(true); setEmojiOpen(false); }
  useEffect(() => {
    if (emojiOpen) { setDockOn(true); return undefined; }
    const t = setTimeout(() => setDockOn(false), dockInstant ? 0 : 300);
    return () => clearTimeout(t);
  }, [emojiOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { swap.current++; unlockViewport(); }, []);
  // لمس خود فیلد وقتی پنل باز است = برگشت به کیبورد
  function onFieldTouch() { if (dockMode && emojiOpen) { setKb(true); closePanelToKeyboard(); } }
  const taRef = useRef(null);
  const [mention, setMention] = useState(null); // { start, q, i }
  const mentionMap = useRef(new Map()); // نام نمایشی -> userId (برای m.mentions هنگام ارسال)
  const [pollOpen, setPollOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const lastTyping = useRef(0);

  // بستن منوی پیوست با کلیک بیرون یا Esc
  useEffect(() => {
    if (!attachOpen) return undefined;
    const onDoc = e => {
      if (!e.target.closest('.attach-wrap') && !e.target.closest('.attach-pop')) setAttachOpen(false);
    };
    const onEsc = e => {
      if (e.key === 'Escape') setAttachOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [attachOpen]);
  const roomId = room.roomId;
  const roomType = roomKind(room, client);
  const power = myPower(room, me);
  const canPost = roomType !== 'channel' || power >= 50;
  const isChannel = roomType === 'channel';
  const chanName = room.name || tr('کانال');
  const signChannel = isChannel && channelSigning(room);
  // در کانال، هویت نمایشی «کانال» است؛ فقط در حالت امضا نام ادمین هم دیده می‌شود.
  const senderLabel = (sender) => isChannel ? chanName : (room.getMember(sender)?.name || localpart(sender));
  const adminLabel = (sender) => room.getMember(sender)?.name || localpart(sender);
  useEffect(() => {
    const onState = (ev) => {
      if (ev?.getRoomId?.() === roomId && (ev.getType?.() === CHANNEL_SIGNING_EVENT || ev.getType?.() === 'ir.tikotak.channel_signing')) {
        setTick(n => n + 1);
      }
    };
    client.on('RoomState.events', onState);
    return () => client.off('RoomState.events', onState);
  }, [client, roomId]);
  const meta = collect(room);
  const pinIds = room.currentState.getStateEvents('m.room.pinned_events', '')?.getContent()?.pinned || [];
  const canPin = room.currentState.maySendStateEvent('m.room.pinned_events', me);

  // پیام‌های پین‌شده‌ای که در تایم‌لاین بارگذاری نشده‌اند را جدا می‌گیریم
  useEffect(() => {
    let dead = false;
    (async () => {
      for (const id of pinIds) {
        if (meta.byId.has(id) || pinned[id]) continue;
        try {
          const raw = await client.fetchRoomEvent(roomId, id);
          const ev = new sdk.MatrixEvent(raw);
          await client.decryptEventIfNeeded(ev).catch(() => {});
          if (!dead) setPinned(p => ({
            ...p,
            [id]: ev
          }));
        } catch {/* حذف‌شده یا در دسترس نیست */}
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinIds.join(','), roomId]);
  const pinEv = id => meta.byId.get(id) || pinned[id] || null;
  async function togglePin(ev) {
    const id = ev.getId();
    const next = pinIds.includes(id) ? pinIds.filter(x => x !== id) : [...pinIds, id];
    try {
      await client.sendStateEvent(roomId, 'm.room.pinned_events', {
        pinned: next
      }, '');
    } catch {
      setFileErr(tr("اجازه پین کردن نداری."));
    }
    setSel(null);
  }
  function jump(id) {
    const el = listRef.current?.querySelector(`[data-evid="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
  }
  async function react(ev, key) {
    // هر کاربر روی هر پیام فقط یک واکنش دارد: انتخاب ایموجی جدید جایگزین قبلی می‌شود و انتخاب دوباره‌ی همان، آن را برمی‌دارد
    const mineAll = [];
    for (const [k, list] of meta.reacts.get(ev.getId()) || []) for (const r of list) if (r.sender === me) mineAll.push({ k, id: r.id });
    try {
      const same = mineAll.some(m => m.k === key);
      for (const m of mineAll) if (!m.id.startsWith('~')) await client.redactEvent(roomId, m.id);
      if (!same) await client.sendEvent(roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: ev.getId(), key } });
    } catch {/* ignore */}
    setSel(null);
  }
  async function del(ev) {
    if (!window.confirm(tr("این پیام برای همه حذف شود؟"))) return;
    try {
      await client.redactEvent(roomId, ev.getId());
    } catch {
      setFileErr(tr("حذف نشد."));
    }
    setSel(null);
  }
  function startEdit(ev) {
    setEditing(ev);
    setReplyTo(null);
    setText(contentOf(ev, meta.edits).body || '');
    setSel(null);
  }
  // کشیدن پیام به چپ = پاسخ (موبایل: لمس، دسکتاپ: ترک‌پد یا کشیدن با موس)
  const swipeRef = useRef({});
  swipeRef.current = { multi, byId: meta.byId, startReply, canPost, setForwardEv };
  useEffect(() => {
    const el = listRef.current;
    return attachSwipeReply(el, {
      enabled: () => !swipeRef.current.multi,
      canReply: (id) => !!swipeRef.current.byId.get(id),
      iconKind: () => (swipeRef.current.canPost ? 'reply' : 'forward'),
      // کانال (بدون دسترسی نوشتن): کشیدن = فوروارد؛ وگرنه پاسخ
      onReply: (id) => {
        const r = swipeRef.current; const ev = r.byId.get(id);
        if (!ev) return;
        if (r.canPost) r.startReply(ev); else r.setForwardEv(ev);
      },
    });
  }, [roomId]);
  function startReply(ev) {
    setReplyTo(ev);
    setEditing(null);
    setSel(null);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  function isFinePointer() {
    try { return !window.matchMedia || window.matchMedia('(pointer: fine)').matches; } catch { return true; }
  }
  function isInteractiveMessageTarget(target) {
    const el = target?.closest ? target : target?.parentElement;
    return !!el?.closest?.('a[href],button,input,textarea,select,label,audio,video,.att-wrap,.att-img,.att-video,.att-audio,.att-file,.voice-box,.vp-btn,.vp-wave,.qr,.reacts,.quote');
  }
  function openMessageMenu(id, x = 0, y = 0) {
    if (!id || id.startsWith('~')) return;
    setCtxMore(false);
    setSel(id);
    setCtx({ x, y, id });
  }
  const closeCtx = () => { setCtx(null); setSel(null); setCtxMore(false); };

  // موبایل: یک تپ روی حباب. اسکرول/لمس طولانی/انتخاب متن/هدف تعاملی منو باز نمی‌کند.
  function onTimelinePointerDown(e) {
    const sel = window.getSelection()?.toString() || '';
    if (sel) lastDownSelection.current = { text: sel, at: Date.now(), id: e.target.closest?.('.msg')?.dataset.evid || null };
    const empty = !e.target.closest?.('.msg');
    if (e.pointerType === 'mouse' && (e.button !== 0 || !empty)) return;
    const row = rowFromEvent(listRef.current, e);
    if (!row) return;
    tapStart.current = { id: row.dataset.evid, x: e.clientX, y: e.clientY, t: Date.now(), empty };
  }
  function onTimelinePointerUp(e) {
    const st = tapStart.current;
    tapStart.current = null;
    if (!st) return;
    const selection = window.getSelection()?.toString() || '';
    const id = st.id;
    if (!st.empty && !e.target.closest?.('.bubble')) return;
    if (!canOpenMessageMenu({
      id, dx: e.clientX - st.x, dy: e.clientY - st.y, dt: Date.now() - st.t,
      selection, multi: !!multi, interactive: isInteractiveMessageTarget(e.target),
    })) return;
    openMessageMenu(id, e.clientX, e.clientY);
  }
  // دسکتاپ: راست‌کلیک. روی موبایل منوی بومی/انتخاب متن دست‌نخورده می‌ماند.
  function onTimelineContextMenu(e) {
    if (!isFinePointer()) return;
    const id = e.target.closest?.('.msg')?.dataset.evid;
    if (!id || id.startsWith('~')) return;
    e.preventDefault();
    openMessageMenu(id, e.clientX, e.clientY);
  }
  function onTimelineDoubleClick(e) {
    if (!isFinePointer() || multi || !canPost) return;
    if (isInteractiveMessageTarget(e.target)) return;
    const id = e.target.closest?.('.msg')?.dataset.evid;
    const ev = id ? meta.byId.get(id) : null;
    if (!ev) return;
    const selected = lastDownSelection.current;
    const selectionBefore = selected.text && selected.id === id && Date.now() - selected.at < 1500 ? selected.text : '';
    if (!canReplyOnDoubleClick({ id, selectionBefore, multi: !!multi })) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges?.();
    startReply(ev);
  }
  function onMessageKeyDown(e, id) {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    openMessageMenu(id, r.left + 12, r.top + 12);
  }

  function menuFor(ev) {
    const id = ev.getId();
    if (ev.status === 'not_sent') {
      return { header: null, items: [
        { key: 'retry', icon: 'retry', label: tr('تلاش دوباره'), onClick: () => client.resendEvent(ev, room).catch(() => {}) },
        { key: 'cancel', icon: 'trash', label: tr('حذف'), danger: true, onClick: () => client.cancelPendingEvent(ev) },
      ] };
    }
    const content = contentOf(ev, meta.edits);
    const mine = ev.getSender() === me;
    const isCall = hasEvent(content, 'call');
    const isText = !isCall && !hasEvent(content, 'share') && !hasEvent(content, 'poll') && (!content.msgtype || content.msgtype === 'm.text');
    const pinnedNow = pinIds.includes(id);
    const myKeys = new Set([...(meta.reacts.get(id)?.entries() || [])].filter(([, l]) => l.some(r => r.sender === me)).map(([k]) => k));
    const reacts = ctxMore ? [...EMOJIS, ...MORE_EMOJIS] : EMOJIS;
    const header = reacts.map(k => ({ key: k, label: tr("واکنش {0}", [k]), on: myKeys.has(k), onClick: () => react(ev, k) }));
    if (!ctxMore) header.push({ key: '+', label: tr('ایموجی بیشتر'), keepOpen: true, onClick: () => setCtxMore(true) });
    const items = [
      canPost && { key: 'reply', icon: 'reply', label: tr("پاسخ"), hint: 'R', onClick: () => startReply(ev) },
      content.body && isText && { key: 'copy', icon: 'copy', label: tr("کپی"), hint: 'Ctrl+C', onClick: () => navigator.clipboard?.writeText(content.body) },
      content.msgtype === 'm.image' && !content[ST_FLAG] && { key: 'addst', icon: 'image', label: tr('افزودن به استیکرها'), onClick: () => stickerFromMessage(client, content).then(() => setFileErr(tr('به استیکرها اضافه شد.'))).catch(e => setFileErr(e.message || '')) },
      isMusic(content) && { key: 'addpl', icon: 'music', label: tr('افزودن به پلی‌لیست'), onClick: () => setAddMusicEv(content) },
      pickEvent(content, 'share')?.code && pickEvent(content, 'share').kind !== 'post' && { key: 'addpl2', icon: 'music', label: tr('افزودن به پلی‌لیست'), onClick: () => shareGet(client.getAccessToken(), pickEvent(content, 'share').code).then(r => r?.track && setAddShareTrack(r.track)).catch(() => {}) },
      !isCall && { key: 'fwd', icon: 'forward', label: tr('ارسال به…'), onClick: () => setForwardEv(ev) },
      !isCall && { key: 'save', icon: 'bookmark', label: tr('ذخیره'), onClick: () => save(ev) },
      canPin && { key: 'pin', icon: 'pin', label: pinnedNow ? tr("برداشتن پین") : tr("پین"), onClick: () => togglePin(ev) },
      mine && isText && { key: 'edit', icon: 'pen', label: tr("ویرایش"), hint: 'E', onClick: () => startEdit(ev) },
      { key: 'select', icon: 'check', label: tr('انتخاب'), onClick: () => setMulti(new Set([id])) },
      mine && { key: 'info', icon: 'mailread', label: tr('اطلاعات پیام'), onClick: () => setInfoEv(ev) },
      !mine && { key: 'report', icon: 'flag', label: tr('گزارش'), onClick: () => report('user', ev.getSender()) },
      mine && 'sep',
      mine && { key: 'del', icon: 'trash', label: tr("حذف"), danger: true, hint: 'Del', onClick: () => del(ev) },
    ].filter(Boolean);
    return { header, items };
  }

  // پیش‌نویس: متن نیمه‌نوشته هر گفتگو فقط روی همین دستگاه نگه داشته می‌شود
  useEffect(() => {
    if (editing) return undefined;
    const t = setTimeout(() => {
      if (text.trim()) setItem(draftKey, text); else removeItem(draftKey);
    }, 250);
    return () => clearTimeout(t);
  }, [text, editing, draftKey]);

  // ---- در حال نوشتن ----
  useEffect(() => {
    const on = (_ev, m) => {
      if (m?.roomId === roomId) setTick(n => n + 1);
    };
    client.on('RoomMember.typing', on);
    return () => client.off('RoomMember.typing', on);
  }, [client, roomId]);
  const typers = room.currentState.getMembers().filter(m => m.typing && m.userId !== me);
  function pingTyping(v) {
    const now = Date.now();
    if (v.trim() && now - lastTyping.current > 4000) {
      lastTyping.current = now;
      client.sendTyping(roomId, true, 6000).catch(() => {});
    } else if (!v.trim() && lastTyping.current) {
      lastTyping.current = 0;
      client.sendTyping(roomId, false).catch(() => {});
    }
  }

  // ---- ویس ----
  async function startRec() {
    setRecErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder?.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? {
        mimeType: mime
      } : undefined);
      const chunks = [];
      mr.ondataavailable = e => {
        if (e.data.size) chunks.push(e.data);
      };
      recRef.current = {
        mr,
        stream,
        chunks,
        start: Date.now(),
        send: false
      };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const r = recRef.current;
        recRef.current = null;
        setRec(null);
        if (!r?.send || !chunks.length) return;
        const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File(chunks, `voice.${ext}`, {
          type
        });
        stick.current = true;
        setSending(n => n + 1);
        try {
          await sendFile(client, roomId, file, {
            msgtype: 'm.audio',
            body: tr("پیام صوتی"),
            info: {
              duration: Date.now() - r.start
            },
            extra: {
              'org.matrix.msc3245.voice': {}
            }
          });
        } catch (e) {
          setFileErr(e?.message || tr("ویس ارسال نشد"));
        }
        setSending(n => n - 1);
      };
      mr.start();
      setRec({
        start: Date.now()
      });
    } catch {
      setRecErr(tr("اجازه میکروفون داده نشد یا میکروفونی پیدا نشد."));
    }
  }
  function stopRec(send) {
    const r = recRef.current;
    if (!r) return;
    r.send = send;
    try {
      r.mr.stop();
    } catch {/* ignore */}
  }
  useEffect(() => {
    if (!rec) return undefined;
    const t = setInterval(() => {
      setTick(n => n + 1);
      if (recRef.current && Date.now() - recRef.current.start > 5 * 60 * 1000) stopRec(true);
    }, 500);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => () => {
    const r = recRef.current;
    if (r) {
      r.send = false;
      try {
        r.mr.stop();
      } catch {/* ignore */}
    }
  }, []);
  const [staged, setStaged] = useState(null);
  // دکمهٔ برگشت گوشی: ابتدا پنل/منوهای بازِ همین چت بسته می‌شوند، بعد خود چت
  useBackLayer(showMembers, () => setShowMembers(false));
  useBackLayer(!!ctx, () => { setCtx(null); setSel(null); setCtxMore(false); });
  useBackLayer(attachOpen, () => setAttachOpen(false));
  useBackLayer(emojiOpen, () => closePanel());
  useBackLayer(searchOpen, () => setSearchOpen(false));
  useBackLayer(!!multi, () => setMulti(null));
  useBackLayer(!!staged, () => setStaged(null));
  const stageFiles = files => { if (files?.length) { setFileErr(''); setStaged(files); } };
  async function sendFiles(files, caption = '') {
    setFileErr('');
    stick.current = true;
    for (const [i, f] of files.entries()) {
      setSending(n => n + 1);
      try {
        await sendFile(client, room.roomId, f, i === 0 && caption ? { body: caption, extra: { filename: f.name } } : {});
      } catch (e) {
        setFileErr(`${f.name}: ${e?.message || tr("ارسال نشد")}`);
      }
      setSending(n => n - 1);
    }
  }
  function onPaste(e) {
    const fs = [...(e.clipboardData?.files || [])];
    if (fs.length) {
      e.preventDefault();
      stageFiles(fs);
    }
  }
  const dsec = disappearAfter(room);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!dsec) return undefined;
    const t = setInterval(() => setNowTick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, [dsec]);
  const nowMs = Date.now();
  const evs = room.getLiveTimeline().getEvents().filter(shown).filter(e => !dsec || e.getTs() + dsec * 1000 > nowMs);
  // فرستنده پیام‌های منقضی خودش را از سرور حذف می‌کند (دیگران همان لحظه آن را نمی‌بینند)
  useEffect(() => {
    if (!dsec) return;
    for (const e of room.getLiveTimeline().getEvents()) {
      const id = e.getId();
      if (e.getSender() === me && id && !id.startsWith('~') && !e.isRedacted() && ['m.room.message', 'm.sticker'].includes(e.getType()) && e.getTs() + dsec * 1000 < Date.now()) {
        client.redactEvent(roomId, id).catch(() => {});
      }
    }
  });
  const hasMore = room.getLiveTimeline().getPaginationToken(sdk.Direction.Backward) != null;
  const members = room.getJoinedMemberCount();
  const encrypted = client.isRoomEncrypted(room.roomId);
  const decFail = evs.some(e => e.isDecryptionFailure());
  const initialScrolled = useRef(false);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!initialScrolled.current && evs.length && firstUnread) {
      const row = el.querySelector(`[data-evid="${CSS.escape(firstUnread.id)}"]`);
      initialScrolled.current = true;
      if (row) { stick.current = false; setAtBottom(false); el.scrollTop = Math.max(0, row.offsetTop - 70); lastLen.current = evs.length; return; }
    }
    initialScrolled.current = true;
    if (stick.current) { el.scrollTop = el.scrollHeight; }
    else if (evs.length > lastLen.current && lastLen.current > 0) {
      const lastEv = evs[evs.length - 1];
      if (lastEv && lastEv.getSender() !== me) setAway(n => n + (evs.length - lastLen.current));
    }
    lastLen.current = evs.length;
  }, [evs.length, version]);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);
  useEffect(() => {
    if (!emojiOpen) return undefined;
    const close = (e) => { if (!e.target.closest('.emoji-wrap, .emoji-dock') && !(dockMode && e.target.closest('textarea'))) closePanel(); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [emojiOpen]);
  function onScroll() {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(stick.current);
    if (stick.current) { setAway(0); initialAwayCleared.current = true; }
  }
  async function older() {
    const el = listRef.current;
    const before = el.scrollHeight;
    setLoadingOld(true);
    try {
      await client.scrollback(room, 30);
    } catch {/* ignore */}
    setLoadingOld(false);
    requestAnimationFrame(() => {
      el.scrollTop += el.scrollHeight - before;
    });
  }
  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    removeItem(draftKey);
    pingTyping('');
    stick.current = true;
    try {
      if (editing) {
        const id = editing.getId();
        const old = contentOf(editing, meta.edits).body;
        setEditing(null);
        if (t !== old) {
          await client.sendMessage(roomId, {
            msgtype: 'm.text',
            body: `* ${t}`,
            'm.new_content': {
              msgtype: 'm.text',
              body: t
            },
            'm.relates_to': {
              rel_type: 'm.replace',
              event_id: id
            }
          });
        }
      } else if (replyTo) {
        const id = replyTo.getId();
        setReplyTo(null);
        await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: t,
          'm.relates_to': {
            'm.in_reply_to': {
              event_id: id
            }
          }
        });
      } else {
        const ids = [...mentionMap.current].filter(([n]) => t.includes(`@${n}`)).map(([, id]) => id);
        mentionMap.current = new Map();
        if (ids.length) await client.sendMessage(roomId, { msgtype: 'm.text', body: t, 'm.mentions': { user_ids: ids } });
        else await client.sendTextMessage(roomId, t);
      }
    } catch {/* وضعیت «ارسال نشد» روی پیام دیده می‌شود */}
  }
  async function save(ev) {
    if (saving) return;
    setSaving(true); setSavedMsg('');
    try {
      const c = contentOf(ev, meta.edits);
      await saveToSaved(client, room, c, senderLabel(ev.getSender()));
      setSavedMsg(tr('ذخیره شد.'));
    } catch {
      setSavedMsg(tr('ذخیره نشد.'));
    }
    setSaving(false);
    setTimeout(() => setSavedMsg(''), 2500);
  }
  function pick(acc) {
    const el = fileRef.current;
    if (!el) return;
    el.accept = acc;
    el.click();
  }
  const mentionList = mention ? room.getJoinedMembers()
    .filter(m => m.userId !== me && ((m.name || '').toLowerCase().includes(mention.q.toLowerCase()) || localpart(m.userId).toLowerCase().includes(mention.q.toLowerCase())))
    .sort((a, b) => {
      const q = mention.q.toLowerCase();
      const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
      const ar = an.startsWith(q) || localpart(a.userId).toLowerCase().startsWith(q) ? 0 : 1;
      const br = bn.startsWith(q) || localpart(b.userId).toLowerCase().startsWith(q) ? 0 : 1;
      return ar - br || an.localeCompare(bn);
    })
    .slice(0, 8) : [];
  function pickMention(m) {
    const name = m.name || localpart(m.userId);
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(pos)}`;
    mentionMap.current.set(name, m.userId);
    setText(next);
    setMention(null);
    setTimeout(() => { if (ta) { const p = mention.start + name.length + 2; ta.focus(); ta.setSelectionRange(p, p); } }, 0);
  }
  function onKey(e) {
    if (mention && mentionList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMention(m => ({ ...m, i: (m.i + (e.key === 'ArrowDown' ? 1 : -1) + mentionList.length) % mentionList.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionList[Math.min(mention.i, mentionList.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === 'Escape') {
      setEditing(null);
      setReplyTo(null);
      setText('');
      return;
    }
    if (e.key === 'ArrowUp' && !text && !editing && !e.nativeEvent.isComposing) {
      const last = [...evs].reverse().find(x => x.getSender() === me && x.getType() !== 'm.sticker' && !x.getId()?.startsWith('~') && (() => { const k = contentOf(x, meta.edits); return !hasEvent(k, 'call') && !hasEvent(k, 'share') && (!k.msgtype || k.msgtype === 'm.text'); })());
      if (last) { e.preventDefault(); startEdit(last); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // کشیدن و رها کردن فایل روی چت
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const dnd = {
    onDragEnter: e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: e => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: e => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth.current = 0; setDragging(false);
      const fs = [...e.dataTransfer.files];
      if (fs.length) stageFiles(fs);
    }
  };
  // Esc: خروج از حالت انتخاب چندتایی
  useEffect(() => {
    if (!multi) return undefined;
    const h = e => { if (e.key === 'Escape') setMulti(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [multi]);
  // جستجوی داخل چت: روی پیام‌های بارگذاری‌شده (رمزگشایی‌شده روی همین دستگاه)
  const sq = searchQ.trim().toLowerCase();
  const hits = sq.length >= 1 ? evs.filter(e => {
    const k = contentOf(e, meta.edits);
    return !hasEvent(k, 'call') && !hasEvent(k, 'share') && (k.body || '').toLowerCase().includes(sq);
  }).map(e => e.getId()) : [];
  const hitSet = new Set(hits);
  const curHit = hits.length ? hits[Math.min(searchIdx, hits.length - 1)] : null;
  function goHit(i) {
    if (!hits.length) return;
    const n = (i + hits.length) % hits.length;
    setSearchIdx(n);
    stick.current = false;
    jump(hits[n]);
  }
  useEffect(() => { if (hits.length) { const n = hits.length - 1; setSearchIdx(n); stick.current = false; jump(hits[n]); } else setSearchIdx(0); /* eslint-disable-next-line */ }, [sq]);
  const rows = [];
  let prev = null;
  // آخرین زمانی که یکی از اعضای دیگر پیام را خوانده (برای ✓✓)
  let readTs = 0;
  const readTsList = [];
  try {
    for (const m of room.getJoinedMembers()) {
      if (m.userId === me) continue;
      const rid = room.getEventReadUpTo(m.userId);
      const re = rid && meta.byId.get(rid);
      if (re) { readTs = Math.max(readTs, re.getTs()); readTsList.push(re.getTs()); }
    }
  } catch { /* ignore */ }
  for (const [evIdx, ev] of evs.entries()) {
    const ts = ev.getTs();
    const id = ev.getId();
    if (!prev || !sameDay(prev.getTs(), ts)) rows.push(<div key={`d${id || ts}`} className="day">{fmtDay(ts)}</div>);
    const sender = ev.getSender();
    const mine = sender === me;
    const grouped = !isChannel && prev && prev.getSender() === sender && sameDay(prev.getTs(), ts) && ts - prev.getTs() < 5 * 60 * 1000;
    const nxt = evs[evIdx + 1];
    const tail = !nxt || nxt.getSender() !== sender || !sameDay(ts, nxt.getTs()) || nxt.getTs() - ts >= 5 * 60 * 1000;
    const name = senderLabel(sender);
    const avatarId = isChannel ? room.roomId : sender;
    const showIdentity = !grouped && (!mine || isChannel);
    const failed = ev.status === 'not_sent';
    const content = contentOf(ev, meta.edits);
    const edited = meta.edits.has(id);
    const replyId = ev.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id;
    const replyEv = replyId ? meta.byId.get(replyId) || null : null;
    const rx = meta.reacts.get(id);
    const isSel = sel === id;
    const isText = !hasEvent(content, 'call') && !hasEvent(content, 'share') && !hasEvent(content, 'poll') && (!content.msgtype || content.msgtype === 'm.text');
    const pinnedNow = pinIds.includes(id);
    const views = roomType === 'channel' && id && !id.startsWith('~') && isText ? readTsList.filter(t => t >= ts).length : -1;
    const viewsEl = views >= 0 ? <span className="views" data-testid="views" title={tr('بازدید')}><Icon n="eye" size={12} />{fa(views)}</span> : null;
    if (firstUnread && id === firstUnread.id) rows.push(<div key="unread-div" className="unread-div" data-testid="unread-divider"><span>{tr('پیام‌های جدید')}</span></div>);
    rows.push(<div key={id || `t${ts}`} data-evid={id} tabIndex={0} onKeyDown={e => onMessageKeyDown(e, id)} className={`msg ${isChannel ? 'theirs chan' : mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${tail ? 'tail' : ''} ${multi?.has(id) ? 'picked' : ''} ${hitSet.has(id) ? 'hit' : ''} ${curHit === id ? 'hit-cur' : ''} ${(content['m.mentions']?.user_ids || []).includes(me) ? 'mention-me' : ''}`}>
        {multi && <span className={`pick-mark ${multi.has(id) ? 'on' : ''}`} aria-hidden="true">{multi.has(id) && <Icon n="check" size={14} />}</span>}
        {showIdentity && <span className="msg-av">{isChannel ? <RoomAvatar client={client} room={room} name={chanName} id={avatarId} size={32} /> : <Avatar name={name} id={sender} size={32} />}</span>}
        {showIdentity && <span className="msg-name" data-testid={isChannel ? 'channel-name' : 'msg-sender'} style={isChannel ? undefined : {
        color: NAME_COLORS[hue(sender) % NAME_COLORS.length]
      }}>{name}</span>}
        <div className={`bubble ${isSel ? 'sel' : ''} ${content[ST_FLAG] ? 'sticker' : ''}`}>
          {replyId && <button className="quote" onClick={() => replyEv && jump(replyId)} data-testid="quote">
              <strong>{replyEv ? senderLabel(replyEv.getSender()) : tr("پیام")}</strong>
              <span dir="auto">{snippet(replyEv, meta.edits)}</span>
            </button>}
          {pickEvent(content, 'forwarded_from') && <span className="fwd-mark">{tr('فورواردشده از {0}', [pickEvent(content, 'forwarded_from')])}</span>}
          <Body ev={ev} content={content} onJoinCall={onCall} client={client} player={player} onOpenPost={onOpenPost} onOpenMedia={setViewer} />
          {isChannel && signChannel && <span className="chan-sign" data-testid="channel-sign"><SignName id={sender} room={room} /></span>}
          {rx && rx.size > 0 ? <div className="bubble-foot">
              <div className="reacts">
                {[...rx.entries()].map(([k, list]) => {
                  const mineR = list.some(r => r.sender === me);
                  const isChan = roomType === 'channel';
                  return <button key={k} className={`chip rx ${mineR ? 'on' : ''}`} onClick={() => react(ev, k)} data-testid="reaction" aria-label={tr("واکنش {0}", [k])}>
                    <span className="rx-emoji">{k}</span>
                    {!isChan && list.length <= 3 && <span className="rx-avs">{list.map(r => <Avatar key={r.sender} name={room.getMember(r.sender)?.name || localpart(r.sender)} id={r.sender} size={18} />)}</span>}
                    {(isChan || list.length > 1) && <span className="rx-n">{fa(list.length)}</span>}
                  </button>;
                })}
              </div>
          <span className="msg-time">
            {viewsEl}{pinnedNow && <span className="pin-ico" aria-label={tr('پین‌شده')}><Icon n="pin" size={11} /></span>}{edited && tr("ویرایش‌شده · ")}{failed ? tr("ارسال نشد") : fmtTime(ts)}
            {mine && !isChannel && !failed && <span className={`tick ${ts <= readTs && !(id || '').startsWith('~') ? 'read' : ''}`} data-testid="tick" aria-hidden="true">{(ev.status === 'sending' || ev.status === 'queued' || ev.status === 'encrypting' || (id || '').startsWith('~')) ? <Icon n="clock" size={12} /> : ts <= readTs ? <Icon n="check2" size={15} /> : <Icon n="check" size={13} />}</span>}
          </span>
            </div> : (
          <span className="msg-time">
            {viewsEl}{pinnedNow && <span className="pin-ico" aria-label={tr('پین‌شده')}><Icon n="pin" size={11} /></span>}{edited && tr("ویرایش‌شده · ")}{failed ? tr("ارسال نشد") : fmtTime(ts)}
            {mine && !isChannel && !failed && <span className={`tick ${ts <= readTs && !(id || '').startsWith('~') ? 'read' : ''}`} data-testid="tick" aria-hidden="true">{(ev.status === 'sending' || ev.status === 'queued' || ev.status === 'encrypting' || (id || '').startsWith('~')) ? <Icon n="clock" size={12} /> : ts <= readTs ? <Icon n="check2" size={15} /> : <Icon n="check" size={13} />}</span>}
          </span>
          )}
        </div>
        {!multi && !failed && id && !id.startsWith('~') && !hasEvent(content, 'call') && <span className="qr">
            <button className="qr-heart" onClick={() => react(ev, '❤️')} aria-label={tr('واکنش')} tabIndex={-1}>{(rx && [...rx.entries()].find(([, l]) => l.some(r => r.sender === me))?.[0]) || <Icon n="heart" size={17} />}</button>
            <span className="qr-list" role="menu">{QUICK.map(k => <button key={k} role="menuitem" tabIndex={-1} onClick={() => react(ev, k)}>{k}</button>)}</span>
          </span>}
      </div>);
    prev = ev;
  }
  let dmPeerId = null;
  if (roomType === 'dm') {
    const cur = client.getAccountData('m.direct')?.getContent() || {};
    for (const [u, ids] of Object.entries(cur)) if (ids.includes(room.roomId)) { dmPeerId = u; break; }
    if (!dmPeerId) dmPeerId = room.getJoinedMembers().find(m => m.userId !== me)?.userId || null;
  }
  return <div className="chat" ref={chatRef} {...dnd}>
      {dragging && <div className="drop-overlay" aria-hidden="true"><div><Icon n="clip" size={30} /><strong>{tr("فایل را اینجا رها کن")}</strong><span>{tr("برای ارسال در این گفتگو")}</span></div></div>}
      {multi && (() => {
        const picked = evs.filter(e => multi.has(e.getId()));
        const allMine = picked.length > 0 && picked.every(e => e.getSender() === me);
        const nameOf = e => senderLabel(e.getSender());
        return <div className="multi-bar" role="toolbar" aria-label={tr('انتخاب چندتایی')} data-testid="multi-bar">
          <button className="icon" onClick={() => setMulti(null)} aria-label={tr('انصراف')}><Icon n="close" size={18} /></button>
          <strong>{tr('{0} انتخاب‌شده', [fa(multi.size)])}</strong>
          <span className="grow" />
          {multi.size === 1 && allMine && <button className="icon" onClick={() => { setInfoEv(picked[0]); }} title={tr('اطلاعات پیام')} aria-label={tr('اطلاعات پیام')}><Icon n="mailread" /></button>}
          <button className="icon" onClick={() => { const t = picked.map(e => { const b = contentOf(e, meta.edits).body; return b ? `${nameOf(e)}: ${b}` : ''; }).filter(Boolean).join('\n'); if (t) navigator.clipboard?.writeText(t); setMulti(null); }} title={tr('کپی')} aria-label={tr('کپی')}><Icon n="copy" /></button>
          <button className="icon" onClick={() => setForwardEv(picked)} title={tr('ارسال به…')} aria-label={tr('ارسال به…')} data-testid="multi-fwd"><Icon n="forward" /></button>
          {allMine && <button className="icon danger-text" onClick={async () => {
            if (!window.confirm(tr('پیام‌های انتخاب‌شده برای همه حذف شوند؟'))) return;
            for (const e of picked) { try { await client.redactEvent(roomId, e.getId()); } catch { setFileErr(tr('حذف نشد.')); } }
            setMulti(null);
          }} title={tr('حذف')} aria-label={tr('حذف')} data-testid="multi-del"><Icon n="trash" /></button>}
        </div>;
      })()}
      <div className="chat-top" ref={topRef}>
      <header className="chat-head">
        <button className="icon back" onClick={onBack} aria-label={otherUnread > 0 ? tr("بازگشت") + ' (' + fa(otherUnread) + ')' : tr("بازگشت")} data-testid="chat-back"><Icon n="back" />{otherUnread > 0 && <span className="back-badge" data-testid="back-badge">{otherUnread > 99 ? '99+' : fa(otherUnread)}</span>}</button>
        <div className="hp hp-title lg">
        <span className={`chat-avatar ${roomType === 'dm' ? 'dm' : 'square'}`}><RoomAvatar client={client} room={room} name={room.name} id={dmPeerId || room.roomId} size={42} /></span>
        <button className="plainbtn chat-title" onClick={() => setSettingsOpen(true)} aria-label={tr("تنظیمات گفتگو")} data-testid="room-settings-btn">
          <strong><span className="room-kind"><Icon n={kindIconName(roomType)} size={16} /></span><span className="t-name" dir="auto">{room.name}</span></strong>
          <span className="muted sub-line">{typers.length ? <span className="typing">{typers.length === 1 ? tr("در حال نوشتن") : tr("چند نفر در حال نوشتن")}<i>.</i><i>.</i><i>.</i></span> : <><span className="sub-text">{kindLabel(roomType)} · {members === 1 ? tr("یک عضو") : tr("{0} عضو", [fa(members)])}</span>{encrypted && <span className="sub-lock" title={tr('رمزنگاری‌شده')}><Icon n="lock" size={11} /><span className="sub-lock-t">{tr('رمزنگاری‌شده')}</span></span>}</>}</span>
        </button>
        </div>
        <div className="hp hp-acts lg">
        <button className={`icon ${searchOpen ? 'on' : ''}`} onClick={() => { setSearchOpen(o => !o); setSearchQ(''); }} title={tr("جستجو در گفتگو")} aria-label={tr("جستجو در گفتگو")} aria-pressed={searchOpen} data-testid="chat-search-btn"><Icon n="search" /></button>
        <button className={`icon hide-sm ${muted ? 'on' : ''}`} onClick={() => onMute?.(muted ? 0 : true)} title={muted ? tr("باصدا") : tr("بی‌صدا")} aria-label={muted ? tr("باصدا") : tr("بی‌صدا")} data-testid="chat-mute"><Icon n={muted ? 'belloff' : 'bell'} /></button>
        <button className="icon" onClick={() => setSettingsOpen(true)} title={tr("تنظیمات گفتگو")} aria-label={tr("تنظیمات گفتگو")}><Icon n="dots" /></button>
        <button className={`icon hide-sm ${callHere ? 'live' : ''}`} onClick={onCall} title={tr("تماس تصویری")} aria-label={tr("تماس تصویری")}><Icon n="cam" /></button>
        <button className={`icon ${callHere ? 'live' : ''}`} onClick={onCall} title={tr("تماس صوتی")} aria-label={tr("تماس صوتی")}><Icon n="phone" /></button>
        <button className="icon hide-sm" onClick={onInvite} title={tr("دعوت")} aria-label={tr("دعوت")}><Icon n="userplus" /></button>
        </div>
      </header>

      {decFail && <div className="banner action" role="status">
          <span>{tr("بعضی پیام‌ها رمزگشایی نشدند. کلید بازیابی را امتحان کن.")}</span>
          <button className="small primary" onClick={onRecovery}>{tr("بازیابی کلید")}</button>
        </div>}

      {(pinIds.length > 0 || topPlayer) && <div className="pin-stack lg">
      {pinIds.length > 0 && <div className="pinbar" data-testid="pinbar">
          <button className="plainbtn pin-main" onClick={() => {
        const id = pinIds[Math.min(pinIdx, pinIds.length - 1)];
        if (meta.byId.has(id)) jump(id);
      }}>
            <strong>{tr("📌 پیام پین‌شده")}{pinIds.length > 1 ? tr(" {0} از {1}", [fa(Math.min(pinIdx, pinIds.length - 1) + 1), fa(pinIds.length)]) : ''}</strong>
            <span dir="auto">{snippet(pinEv(pinIds[Math.min(pinIdx, pinIds.length - 1)]), meta.edits)}</span>
          </button>
          {pinIds.length > 1 && <button className="icon" onClick={() => setPinIdx(i => (i + 1) % pinIds.length)} aria-label={tr("پین بعدی")}>⟳</button>}
          {canPin && <button className="icon" onClick={() => {
        const id = pinIds[Math.min(pinIdx, pinIds.length - 1)];
        client.sendStateEvent(roomId, 'm.room.pinned_events', {
          pinned: pinIds.filter(x => x !== id)
        }, '').catch(() => {});
        setPinIdx(0);
      }} aria-label={tr("برداشتن پین")}><Icon n="close" size={18} /></button>}
        </div>}
      {topPlayer}
      </div>}
      {searchOpen && <div className="chat-searchbar" role="search">
          <Icon n="search" size={18} />
          <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goHit(searchIdx + (e.shiftKey ? 1 : -1)); } if (e.key === 'Escape') { setSearchOpen(false); setSearchQ(''); } }} placeholder={tr("جستجو در این گفتگو")} aria-label={tr("جستجو در این گفتگو")} dir="auto" data-testid="chat-search-input" />
          <span className="muted sb-count" data-testid="chat-search-count">{sq ? (hits.length ? tr("{0} از {1}", [fa(Math.min(searchIdx, hits.length - 1) + 1), fa(hits.length)]) : tr("نتیجه‌ای نیست")) : ''}</span>
          {hasMore && sq && <button className="small ghost" onClick={older} disabled={loadingOld}>{loadingOld ? '…' : tr("پیام‌های قدیمی‌تر")}</button>}
          <button className="icon" onClick={() => goHit(searchIdx - 1)} disabled={!hits.length} aria-label={tr("نتیجهٔ قبلی")}><Icon n="up" size={18} /></button>
          <button className="icon" onClick={() => goHit(searchIdx + 1)} disabled={!hits.length} aria-label={tr("نتیجهٔ بعدی")}><Icon n="down" size={18} /></button>
          <button className="icon" onClick={() => { setSearchOpen(false); setSearchQ(''); }} aria-label={tr("بستن جستجو")}><Icon n="close" size={18} /></button>
        </div>}
      </div>
      <div className={`timeline ${multi ? 'multi-on' : ''}`} ref={listRef} onScroll={onScroll} onPointerDown={onTimelinePointerDown} onPointerUp={onTimelinePointerUp} onContextMenu={onTimelineContextMenu} onDoubleClick={onTimelineDoubleClick} onClick={e => {
        if (!multi) return;
        const id = e.target.closest?.('.msg')?.dataset.evid;
        if (!id || id.startsWith('~')) return;
        e.preventDefault();
        setMulti(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n.size ? n : null; });
      }}>
        {hasMore && <button className="older" onClick={older} disabled={loadingOld}>
            {loadingOld ? tr("صبر کن…") : tr("پیام‌های قدیمی‌تر")}
          </button>}
        {rows.length === 0 && <p className="empty-chat">{tr("اولین پیام را بفرست.")}</p>}
        {rows}
      </div>
      {!atBottom && <button className="scroll-down" onClick={() => {
        const el = listRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        stick.current = true;
        setAtBottom(true);
        setAway(0);
      }} aria-label={tr('رفتن به آخرین پیام')} title={tr('آخرین پیام')} data-testid="scroll-down"><Icon n="down" size={18} />{(away + (firstUnread && !initialAwayCleared.current ? firstUnread.n : 0)) > 0 && <span className="sd-badge" data-testid="sd-count">{fa(Math.min(99, away + (firstUnread && !initialAwayCleared.current ? firstUnread.n : 0)))}</span>}</button>}

      {(sending > 0 || fileErr) && <div className="file-status" role="status">{sending > 0 ? tr("در حال ارسال فایل…") : fileErr}</div>}
      {savedMsg && <div className="file-status" role="status">{savedMsg}</div>}
      {ctx && meta.byId.get(ctx.id) && (() => { const m = menuFor(meta.byId.get(ctx.id)); return <ContextMenu x={ctx.x} y={ctx.y} label={tr("عملیات پیام")} header={m.header} items={m.items} onClose={closeCtx} />; })()}
      {settingsOpen && <RoomSettings
          client={client}
          room={room}
          me={me}
          kind={roomType}
          muted={muted}
          onMute={onMute}
          onClose={() => setSettingsOpen(false)}
          onInvite={onInvite}
          onProfile={onProfile}
          onLeft={onBack}
        />}
      {forwardEv && <ForwardDialog
          client={client}
          sourceRoom={room}
          items={(Array.isArray(forwardEv) ? forwardEv : [forwardEv]).map(e => ({ content: contentOf(e, meta.edits), senderName: senderLabel(e.getSender()) }))}
          onClose={() => { setForwardEv(null); setMulti(null); }}
        />}
      {infoEv && (() => {
        const ets = infoEv.getTs();
        const seen = [], rest = [];
        for (const m of room.getJoinedMembers()) {
          if (m.userId === me) continue;
          let ts = 0;
          try { const rid = room.getEventReadUpTo(m.userId); const re = rid && meta.byId.get(rid); if (re) ts = re.getTs(); } catch { /* ignore */ }
          (ts >= ets ? seen : rest).push(m);
        }
        return <Dialog title={tr('اطلاعات پیام')} onClose={() => setInfoEv(null)}>
          <p className="muted" dir="auto">{snippet(infoEv, meta.edits)}</p>
          <p className="muted">{tr('ارسال')}: {fmtDay(ets)} {fmtTime(ets)}</p>
          <h4>{tr('دیده‌شده توسط')} ({fa(seen.length)})</h4>
          <ul className="plain members" data-testid="info-seen">{seen.length ? seen.map(m => <li key={m.userId} className="info-row"><Avatar name={m.name} id={m.userId} size={32} /><span dir="auto">{m.name || localpart(m.userId)}</span></li>) : <li className="muted">{tr('هنوز کسی ندیده')}</li>}</ul>
          {rest.length > 0 && <><h4>{tr('هنوز ندیده')} ({fa(rest.length)})</h4>
          <ul className="plain members">{rest.map(m => <li key={m.userId} className="info-row"><Avatar name={m.name} id={m.userId} size={32} /><span dir="auto">{m.name || localpart(m.userId)}</span></li>)}</ul></>}
        </Dialog>;
      })()}
      {showMembers && (roomType !== 'channel' || power >= 50) && <Dialog title={tr("اعضای «{0}»", [room.name])} onClose={() => setShowMembers(false)}>
          <ul className="plain members">
            {room.getMembersWithMembership('join').map(m => <li key={m.userId}>
                <button className="room" onClick={() => {
            setShowMembers(false);
            onProfile(m.userId);
          }} data-testid="member">
                  <Avatar name={m.name} id={m.userId} size={40} />
                  <div className="room-main"><strong dir="auto">{m.name}</strong><span className="muted" dir="ltr">{localpart(m.userId)}</span></div>
                </button>
              </li>)}
            {room.getMembersWithMembership('invite').map(m => <li key={m.userId} className="muted pad-s">{tr("دعوت‌شده:")} {m.name}</li>)}
          </ul>
          <div className="dlg-actions"><button className="outline wide" onClick={() => {
          setShowMembers(false);
          onInvite();
        }}>{tr("دعوت نفر جدید")}</button></div>
        </Dialog>}
      {(replyTo || editing) && <div className="ctx-bar" data-testid="ctxbar">
          <div><strong>{editing ? tr("ویرایش پیام") : tr("پاسخ به {0}", [senderLabel(replyTo.getSender())])}</strong>
            <span dir="auto">{snippet(editing || replyTo, meta.edits)}</span></div>
          <button className="icon" onClick={() => {
        setReplyTo(null);
        setEditing(null);
        setText('');
      }} aria-label={tr("لغو")}><Icon n="close" size={18} /></button>
        </div>}
      {staged && <SendPreview files={staged} encrypted={encrypted} onCancel={() => setStaged(null)} onSend={(fs, cap) => { setStaged(null); sendFiles(fs, cap); }} />}
      {pollOpen && <PollDialog onClose={() => setPollOpen(false)} onSend={p => client.sendMessage(roomId, { msgtype: 'm.text', body: `📊 ${p.question}\n` + p.options.map((o, i) => `${i + 1}. ${o.text}`).join('\n'), [EV.poll]: p })} />}
      {addShareTrack && <AddTo token={client.getAccessToken()} track={addShareTrack} onClose={() => setAddShareTrack(null)} />}
      {addMusicEv && <AddTo token={client.getAccessToken()} ensure={(p) => importFromMessage(client, client.getAccessToken(), addMusicEv, p)} onClose={() => setAddMusicEv(null)} />}
      {pickMusic && <ShareMusic token={client.getAccessToken()} onPick={sh => sendShare(client, roomId, sh)} onDevice={() => pick('audio/*')} onClose={() => setPickMusic(false)} />}
      {recErr && <div className="file-status" role="alert">{recErr}</div>}
      {!canPost ? <div className="channel-readonly" data-testid="channel-readonly">
          <span>{tr('فقط مدیران می‌توانند در این کانال پست بگذارند.')}</span>
          <div className="row">
            <button type="button" className="small outline" onClick={() => onMute?.(muted ? 0 : true)}>{muted ? tr('باصدا') : tr('بی‌صدا')}</button>
            <button type="button" className="small ghost" onClick={() => setSettingsOpen(true)}>{tr('تنظیمات')}</button>
          </div>
        </div> : rec ? <div className="composer recording" data-testid="recording">
          <button type="button" className="icon" onClick={() => stopRec(false)} aria-label={tr("لغو ضبط")}><Icon n="close" size={18} /></button>
          <span className="rec-dot" /><span className="rec-time" dir="ltr">{fmtDur(Date.now() - rec.start)}</span>
          <span className="muted grow">{tr("در حال ضبط…")}</span>
          <button type="button" className="send" onClick={() => stopRec(true)} aria-label={tr("ارسال ویس")}><Icon n="send" /></button>
        </div> : <>
        {mention && mentionList.length > 0 && <ul className="mention-pop" role="listbox" aria-label={tr("منشن")}>
            {mentionList.map((m, i) => <li key={m.userId} role="option" aria-selected={i === mention.i}><button type="button" className={i === mention.i ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pickMention(m); }}><Avatar name={m.name} id={m.userId} size={28} /><span dir="auto">{m.name || localpart(m.userId)}</span><span className="muted" dir="ltr">@{localpart(m.userId)}</span></button></li>)}
          </ul>}
        <form className="composer" onSubmit={e => {
        e.preventDefault();
        send();
      }}>
          <input ref={fileRef} type="file" multiple hidden data-testid="file-input" onChange={e => {
          stageFiles([...e.target.files]);
          e.target.value = '';
        }} />
          <div className="cpill lg">
          {encrypted && <span className="composer-lock" title={tr('رمزنگاری سرتاسری')} aria-label={tr('رمزنگاری سرتاسری')}><Icon n="lock" size={14} /></span>}
          <div className="attach-wrap">
            <button type="button" className={`icon ${attachOpen ? 'on' : ''}`} aria-label={tr("پیوست")} title={tr("پیوست")} ref={attachBtnRef} aria-haspopup="menu" aria-expanded={attachOpen} onClick={() => setAttachOpen(o => !o)}><Icon n="clip" /></button>
            {attachOpen && attachPos && createPortal(<div className="attach-menu attach-pop" style={attachPos} role="menu" aria-label={tr("پیوست")}>
              <button type="button" role="menuitem" onClick={() => {
              setAttachOpen(false);
              pick('image/*');
            }} disabled={!upAllowed.image} title={upAllowed.image ? undefined : tr('توسط ادمین غیرفعال است')}><Icon n="image" size={18} /><span>{tr("تصویر")}</span></button>
              <button type="button" role="menuitem" onClick={() => {
              setAttachOpen(false);
              setPickMusic(true);
            }} disabled={!upAllowed.music} title={upAllowed.music ? undefined : tr('توسط ادمین غیرفعال است')}><Icon n="music" size={18} /><span>{tr("موزیک")}</span></button>
              <button type="button" role="menuitem" onClick={() => {
              setAttachOpen(false);
              pick('');
            }} disabled={!upAllowed.file} title={upAllowed.file ? undefined : tr('توسط ادمین غیرفعال است')}><Icon n="clip" size={18} /><span>{tr("فایل")}</span></button>
              <button type="button" role="menuitem" onClick={() => { setAttachOpen(false); setPollOpen(true); }} data-testid="attach-poll"><Icon n="poll" size={18} /><span>{tr("نظرسنجی")}</span></button>
            </div>, document.body)}
          </div>
          <textarea ref={taRef} onPointerDown={onFieldTouch} onPaste={onPaste} value={text} onChange={e => {
          setText(e.target.value);
          pingTyping(e.target.value);
          const pos = e.target.selectionStart ?? e.target.value.length;
          const m = /(^|\s)@([^\s@]{0,30})$/.exec(e.target.value.slice(0, pos));
          setMention(m && roomType !== 'dm' && members > 1 ? { start: pos - m[2].length - 1, q: m[2], i: 0 } : null);
        }} onKeyDown={onKey} rows={1} dir="auto" placeholder={editing ? tr("پیام را ویرایش کن") : tr("پیام خود را بنویس…")} aria-label={tr("پیام")} />
          <div className="emoji-wrap">
            <button type="button" className="icon" aria-label={tr('ایموجی')} title={tr('ایموجی')} aria-expanded={emojiOpen} onMouseDown={e => { if (dockMode) e.preventDefault(); }} onClick={toggleEmoji}><Icon n="emoji" /></button>
            {emojiOpen && !dockMode && <EmojiPanel client={client} onToast={setFileErr}
                onEmoji={e => { setText(t => t + e); taRef.current?.focus({ preventScroll: true }); }}
                onBig={e => { closePanel(); stick.current = true; client.sendMessage(roomId, { msgtype: 'm.text', body: e }).catch(() => {}); }}
                onSticker={st => { closePanel(); stick.current = true; sendSticker(client, roomId, st).catch(err => setFileErr(err.message || '')); }} />}
          </div>
          </div>
          {text.trim() ? <button className="send" aria-label={tr("ارسال")}><Icon n="send" /></button> : <button type="button" className="send mic" aria-label={tr("ضبط ویس")} title={upAllowed.voice ? tr("ضبط پیام صوتی") : tr('توسط ادمین غیرفعال است')} disabled={!upAllowed.voice} onClick={startRec}><Icon n="mic" /></button>}
        </form>
        {dockMode && <div className={`emoji-dock ${emojiOpen ? 'open' : ''} ${dockInstant ? 'instant' : ''}`} style={{ '--dock-h': `${dockHeight()}px` }} aria-hidden={!emojiOpen}>
            {dockOn && <EmojiPanel docked client={client} onToast={setFileErr}
              onEmoji={e => setText(t => t + e)}
              onBig={e => { closePanel(); stick.current = true; client.sendMessage(roomId, { msgtype: 'm.text', body: e }).catch(() => {}); }}
              onSticker={st => { closePanel(); stick.current = true; sendSticker(client, roomId, st).catch(err => setFileErr(err.message || '')); }} />}
          </div>}
        </>}
      {viewer && <MediaViewer item={viewer} onClose={() => setViewer(null)} />}
      {reportNode}
    </div>;
}