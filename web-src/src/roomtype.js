// نوع گفتگو و ابزارهای مشترک چت
import { tr } from './i18n.js';
import { EV, EV_OLD } from './eventTypes.js';
export const ROOM_TYPE_EVENT = EV.roomType;
export const CHANNEL_SIGNING_EVENT = EV.channelSigning;

// «امضای پیام‌ها» در کانال: فقط یک boolean در state event؛ متن پیام‌ها رمزنگاری‌شده می‌مانند.
export function channelSigning(room) {
  try {
    const ev = room?.currentState?.getStateEvents(CHANNEL_SIGNING_EVENT, '')
      || room?.currentState?.getStateEvents(EV_OLD.channelSigning, '');
    return ev?.getContent()?.enabled === true;
  } catch { return false; }
}

export function roomKind(room, client) {
  if (!room) return 'group';
  const t = room.currentState?.getStateEvents(ROOM_TYPE_EVENT, '')?.getContent()?.type
    ?? room.currentState?.getStateEvents(EV_OLD.roomType, '')?.getContent()?.type;
  if (t === 'saved') return 'saved';
  if (t === 'channel' || t === 'group') return t;
  // DM از روی m.direct
  try {
    const direct = client?.getAccountData('m.direct')?.getContent() || {};
    for (const ids of Object.values(direct)) {
      if (Array.isArray(ids) && ids.includes(room.roomId)) return 'dm';
    }
  } catch { /* ignore */ }
  // کانال‌های قدیمی: فقط مدیران پیام می‌فرستند
  try {
    const pl = room.currentState?.getStateEvents('m.room.power_levels', '')?.getContent();
    if ((pl?.events_default || 0) >= 50) return 'channel';
  } catch { /* ignore */ }
  return 'group';
}

export function kindIcon(kind) {
  return kind === 'dm' ? '👤' : kind === 'channel' ? '📢' : kind === 'saved' ? '🔖' : '👥';
}
export function kindIconName(kind) {
  return kind === 'dm' ? 'user' : kind === 'channel' ? 'megaphone' : kind === 'saved' ? 'bookmark' : 'users';
}

export function kindLabel(kind) {
  const map = {
    dm: 'پیوی',
    group: 'گروه',
    channel: 'کانال',
    saved: 'پیام‌های ذخیره‌شده',
  };
  return tr(map[kind] || map.group);
}

export function myPower(room, me) {
  try {
    const pl = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent() || {};
    const n = pl.users?.[me];
    if (Number.isFinite(n)) return n;
    // سازندهٔ اتاق طبق Matrix قدرت ۱۰۰ دارد، حتی اگر در users نیامده باشد
    const create = room.currentState.getStateEvents('m.room.create', '');
    const creator = create?.getSender?.() || create?.getContent?.()?.creator;
    if (creator && me === creator) return 100;
    return Number(pl.users_default || 0);
  } catch { return 0; }
}

export function canModerate(room, me) {
  return myPower(room, me) >= 50;
}

export function roomAlias(room) {
  try {
    return room.currentState.getStateEvents('m.room.canonical_alias', '')?.getContent()?.alias
      || (room.getCanonicalAlias?.() || null);
  } catch { return null; }
}

export function mutedFromRules(rules, roomId) {
  const list = rules?.global?.room || [];
  return list.some((r) => r.rule_id === roomId && Array.isArray(r.actions) && r.actions.includes('dont_notify'));
}

export function muteUntil(room) {
  try {
    return Number(room.getAccountData?.(EV.muteUntil)?.getContent()?.until
      ?? room.getAccountData?.(EV_OLD.muteUntil)?.getContent()?.until ?? 0);
  } catch { return 0; }
}

// پیام‌های ناپدیدشونده: زمان‌سنج اتاق (ثانیه) در رویداد حالت؛ ۰ یعنی خاموش
export const DISAPPEAR_EVENT = EV.disappear;
export function disappearAfter(room) {
  const s = room?.currentState?.getStateEvents(DISAPPEAR_EVENT, '')?.getContent()?.seconds
    ?? room?.currentState?.getStateEvents(EV_OLD.disappear, '')?.getContent()?.seconds;
  return Number.isFinite(s) && s > 0 ? s : 0;
}
