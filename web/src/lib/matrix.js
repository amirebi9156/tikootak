import { createClient } from 'matrix-js-sdk';

// کلاینت Matrix هم‌دامنه با صفحه: Caddy مسیر /_matrix رو به Synapse می‌رسونه.
export function makeClient(session) {
  return createClient({
    baseUrl: window.location.origin,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    timelineSupport: true,
  });
}

// فقط پیام‌های قابل نمایش از خط زمانی روم
export function visibleMessages(room) {
  return room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => ev.getType() === 'm.room.message' || ev.getType() === 'm.room.encrypted')
    .filter((ev) => !ev.isRedacted());
}

export function lastMessage(room) {
  const evs = room.getLiveTimeline().getEvents();
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i];
    if (ev.getType() === 'm.room.message' && !ev.isRedacted()) return ev;
  }
  return null;
}

export function previewText(ev) {
  if (!ev) return '';
  const c = ev.getContent();
  if (c.msgtype === 'm.text' || c.msgtype === 'm.notice' || c.msgtype === 'm.emote') return c.body || '';
  return 'پیوست';
}

// ورودی کاربر (ali یا @ali:server) به شناسه کامل Matrix تبدیل می‌شه
export function toUserId(input, domain) {
  const v = input.trim().replace(/\s+/g, '');
  if (!v) return null;
  if (v.startsWith('@')) return v.includes(':') ? v : `${v}:${domain}`;
  return `@${v.toLowerCase()}:${domain}`;
}
