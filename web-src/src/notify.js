// Q5 — اعلان دسکتاپ وقتی وب‌اپ باز است. متن فقط در خود مرورگر از پیام رمزگشایی‌شده ساخته می‌شود؛
// هیچ چیزی از متن پیام به سرور فرستاده نمی‌شود (E2EE حفظ می‌شود).
import { useEffect, useRef } from 'react';
import { tr } from './i18n.js';
import { sdk } from './matrix.js';
import { roomKind } from './roomtype.js';
import { getItem, setItem } from './storage.js';

const KEY = 'tikootak.notif.v1';
const DEFAULTS = { on: false, text: true, sound: false };

export function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notifyPermission() {
  return notifySupported() ? Notification.permission : 'unsupported';
}
export function getNotifyPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(getItem(KEY, '{}') || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function setNotifyPrefs(p) {
  const next = { ...getNotifyPrefs(), ...p };
  setItem(KEY, JSON.stringify(next));
  try { window.dispatchEvent(new Event('tikootak-notif-prefs')); } catch { /* ignore */ }
  return next;
}
// فقط با کلیک کاربر صدا زده می‌شود.
export async function enableNotify() {
  if (!notifySupported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  setNotifyPrefs({ on: perm === 'granted' });
  return perm;
}

function beep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    const ctx = new A();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.28);
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch { /* ignore */ }
}

function previewOf(ev) {
  const c = ev.getContent?.() || {};
  const t = c.msgtype;
  const body = typeof c.body === 'string' ? c.body : '';
  if (ev.getType() === 'm.sticker') return tr('استیکر');
  if (t === 'm.image') return tr('عکس');
  if (t === 'm.video') return tr('ویدیو');
  if (t === 'm.audio') return c['org.matrix.msc3245.voice'] || c['m.voice'] ? tr('پیام صوتی') : tr('آهنگ');
  if (t === 'm.file') return tr('فایل');
  return body.length > 140 ? body.slice(0, 140) + '…' : body;
}

async function show(title, opts) {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg?.active) { await reg.showNotification(title, opts); return; }
  } catch { /* fall back */ }
  const n = new Notification(title, opts);
  n.onclick = () => { try { window.focus(); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('tikootak-open-room', { detail: opts.data?.roomId })); n.close(); };
}

// client: Matrix client، roomIdRef: ref به اتاق باز، isMutedRef: ref به تابع بی‌صدا
export function useDesktopNotify({ client, me, roomIdRef, isMutedRef, onOpenRoom, unread }) {
  const startedAt = useRef(Date.now());
  const lastAt = useRef(0);
  const seen = useRef(new Set());
  const openRef = useRef(onOpenRoom);
  openRef.current = onOpenRoom;

  useEffect(() => {
    if (!client) return undefined;
    startedAt.current = Date.now();
    async function handle(ev, room) {
      const prefs = getNotifyPrefs();
      if (!prefs.on || notifyPermission() !== 'granted' || !room) return;
      if (room.getMyMembership?.() !== 'join') return;
      const id = ev.getId();
      if (!id || seen.current.has(id)) return;
      if (ev.getSender() === me) return;
      if (ev.getTs() < startedAt.current - 2000) return;
      if (!['m.room.message', 'm.room.encrypted', 'm.sticker'].includes(ev.getType())) return;
      if (ev.getRelation?.()?.rel_type === 'm.replace') return;
      if (isMutedRef.current?.(room.roomId)) return;
      const active = !document.hidden && document.hasFocus();
      if (active && roomIdRef.current === room.roomId) return;
      if (ev.isBeingDecrypted?.() || (ev.getType() === 'm.room.encrypted' && !ev.isDecryptionFailure?.())) {
        await new Promise((res) => { ev.once(sdk.MatrixEventEvent.Decrypted, res); setTimeout(res, 4000); });
      }
      if (ev.isDecryptionFailure?.() || ev.getType() === 'm.room.encrypted') return;
      if (seen.current.has(id)) return;
      seen.current.add(id);
      if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value);
      const now = Date.now();
      if (now - lastAt.current < 1000) return;
      lastAt.current = now;
      const kind = roomKind(room, client);
      const sender = room.getMember?.(ev.getSender())?.name || ev.getSender();
      const title = kind === 'dm' ? sender : room.name;
      let body = tr('پیام جدید');
      if (prefs.text) {
        const p = previewOf(ev);
        if (p) body = kind === 'group' ? `${sender}: ${p}` : p;
      }
      await show(title, {
        body, tag: room.roomId, renotify: true, icon: './icon-192.png', badge: './icon-192.png',
        data: { roomId: room.roomId }, silent: !prefs.sound ? true : undefined,
      });
      if (prefs.sound) beep();
    }
    const onTimeline = (ev, room, toStart, removed, data) => {
      if (toStart || removed || data?.liveEvent === false) return;
      handle(ev, room).catch(() => {});
    };
    client.on(sdk.RoomEvent.Timeline, onTimeline);
    return () => client.off(sdk.RoomEvent.Timeline, onTimeline);
  }, [client, me]);

  // کلیک اعلان (از service worker یا Notification مستقیم)
  useEffect(() => {
    const open = (rid) => { if (rid) openRef.current?.(rid); };
    const onSw = (e) => { if (e.data?.type === 'tikootak-open-room') open(e.data.roomId); };
    const onEv = (e) => open(e.detail);
    navigator.serviceWorker?.addEventListener?.('message', onSw);
    window.addEventListener('tikootak-open-room', onEv);
    return () => {
      navigator.serviceWorker?.removeEventListener?.('message', onSw);
      window.removeEventListener('tikootak-open-room', onEv);
    };
  }, []);

  // عنوان تب و نشان آیکن
  useEffect(() => {
    const base = 'TIKOOTAK';
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
    try {
      if (unread > 0) navigator.setAppBadge?.(unread); else navigator.clearAppBadge?.();
    } catch { /* ignore */ }
  }, [unread]);
}
