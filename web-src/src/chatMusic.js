// Q4 — آهنگ‌های داخل چت: تشخیص، دانلود با پیشرفت و کش، و تبدیل پیام به track شخصی.
// در اتاق رمزشده سرور محتوای فایل را نمی‌بیند؛ پس کلاینت رمزگشایی می‌کند و با آپلود عادی (/api/music/tracks)
// به‌عنوان track جدید می‌فرستد. سرور فایل تکراری (هش) را دوباره نمی‌سازد و سهمیه را رعایت می‌کند.
import { fetchFile } from './media.js';
import { musicUpload, musicSetCover } from './api.js';
import { readTags } from './cover.jsx';

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i;
const MIME_BY_EXT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };

export function isVoice(c) {
  return !!(c && (c['org.matrix.msc3245.voice'] || c['m.voice']));
}
// کارت آهنگ: m.audio که ویس نیست، یا فایل قدیمی m.file با نوع صوتی
export function isMusic(c) {
  if (!c || isVoice(c)) return false;
  const mime = c.info?.mimetype || '';
  if (c.msgtype === 'm.audio') return true;
  return c.msgtype === 'm.file' && (mime.startsWith('audio/') || AUDIO_EXT.test(c.body || ''));
}
export function musicMeta(c) {
  const t = c['ir.tikootak.music'] || {};
  const name = String(c.filename || c.body || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
  return { title: t.title || name || '—', artist: t.artist || '', dur: (c.info?.duration || 0) / 1000, size: c.info?.size || 0 };
}
const mxcOf = (c) => c.file?.url || c.url || '';

// ---- کش LRU برای Blob آهنگ‌ها (سقف ۱۰۰MB) ----
const CAP = 100 * 1024 * 1024;
const cache = new Map(); // mxc -> { blob, url }
let used = 0;
function remember(mxc, blob) {
  const old = cache.get(mxc);
  if (old) { used -= old.blob.size; URL.revokeObjectURL(old.url); cache.delete(mxc); }
  const url = URL.createObjectURL(blob);
  cache.set(mxc, { blob, url });
  used += blob.size;
  while (used > CAP && cache.size > 1) {
    const k = cache.keys().next().value;
    const e = cache.get(k);
    used -= e.blob.size;
    cache.delete(k);
    // آدرس ممکن است هنوز در حال پخش باشد؛ با تأخیر آزاد می‌شود
    setTimeout(() => URL.revokeObjectURL(e.url), 60_000);
  }
  return cache.get(mxc);
}
export function cachedMusic(c) {
  const e = cache.get(mxcOf(c));
  if (e) { cache.delete(mxcOf(c)); cache.set(mxcOf(c), e); }
  return e || null;
}
const inflight = new Map();
export function loadMusic(client, c, onProgress) {
  const mxc = mxcOf(c);
  const hit = cachedMusic(c);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(mxc)) {
    const p = inflight.get(mxc);
    p.listeners.add(onProgress);
    return p.promise;
  }
  const listeners = new Set([onProgress]);
  const promise = fetchFile(client, c, (f) => listeners.forEach((l) => l?.(f)))
    .then((blob) => remember(mxc, blob))
    .finally(() => inflight.delete(mxc));
  inflight.set(mxc, { promise, listeners });
  return promise;
}
export async function loadCover(client, c) {
  const info = c.info || {};
  if (!info.thumbnail_file && !info.thumbnail_url) return null;
  const blob = await fetchFile(client, { file: info.thumbnail_file, url: info.thumbnail_url, info: info.thumbnail_info });
  return URL.createObjectURL(blob);
}

// پیام صوتی/آهنگ چت → track شخصی در کتابخانه (با هش، تکراری ساخته نمی‌شود)
export async function importFromMessage(client, token, c, onProgress) {
  const { blob } = await loadMusic(client, c, (f) => onProgress?.(f * 0.5));
  const m = blob.type || c.info?.mimetype || MIME_BY_EXT[(String(c.body).split('.').pop() || '').toLowerCase()] || 'audio/mpeg';
  const meta = musicMeta(c);
  const name = String(c.filename || c.body || 'track');
  const file = new File([blob], name, { type: m });
  const tags = await readTags(file);
  const t = await musicUpload(token, file, tags.title || meta.title, tags.artist || meta.artist, (p) => onProgress?.(0.5 + p * 0.5));
  if (!t.existing && tags.cover) await musicSetCover(token, t.id, tags.cover).catch(() => {});
  return t;
}
