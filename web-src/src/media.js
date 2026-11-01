import { tr } from './i18n.js';
// ارسال و دریافت فایل. در اتاق رمزنگاری‌شده، فایل قبل از آپلود با AES-256-CTR رمز می‌شود
// (فرمت استاندارد Matrix)، پس سرور فقط داده بی‌معنی می‌بیند.
export const MAX_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PX = 1600;
const IMAGE_QUALITY = 0.82;
const THUMB_MAX_W = 480;
const b64 = (buf, url = false) => {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  s = s.replace(/=+$/, '');
  return url ? s.replace(/\+/g, '-').replace(/\//g, '_') : s;
};
const unb64 = s => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
export async function encryptBlob(file) {
  const data = await file.arrayBuffer();
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8)); // نیمه دوم صفر: شمارنده
  const key = await crypto.subtle.generateKey({
    name: 'AES-CTR',
    length: 256
  }, true, ['encrypt', 'decrypt']);
  const enc = await crypto.subtle.encrypt({
    name: 'AES-CTR',
    counter: iv,
    length: 64
  }, key, data);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return {
    blob: new Blob([enc], {
      type: 'application/octet-stream'
    }),
    info: {
      v: 'v2',
      key: jwk,
      iv: b64(iv),
      hashes: {
        sha256: b64(hash)
      }
    }
  };
}
function imageSize(file) {
  return new Promise(res => {
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      res({
        w: im.naturalWidth,
        h: im.naturalHeight
      });
      URL.revokeObjectURL(u);
    };
    im.onerror = () => {
      res(null);
      URL.revokeObjectURL(u);
    };
    im.src = u;
  });
}
export function videoMeta(file) {
  return new Promise(res => {
    const u = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = out => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(u);
      res(out);
    };
    const timer = setTimeout(() => finish(null), 6000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => finish({
      w: v.videoWidth,
      h: v.videoHeight,
      duration: Math.round((v.duration || 0) * 1000)
    });
    v.onerror = () => finish(null);
    v.src = u;
  });
}

// فشرده‌سازی عکس قبل از آپلود: حداکثر ۱۶۰۰ پیکسل، WebP با کیفیت ۰٫۸۲ (۵ تا ۱۰ برابر کوچک‌تر)
export async function compressImage(file) {
  if (!file || !file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    let w = bmp.width;
    let h = bmp.height;
    const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w, h));
    if (scale < 1) {
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], name, { type: 'image/webp', lastModified: Date.now() });
  } catch {
    return file;
  }
}

// گرفتن یک فریم از ویدیو (حدود ۵٪ ابتدا) به‌عنوان پوستر کوچک برای پیش‌نمایش
export function videoPoster(file) {
  return new Promise(res => {
    const u = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    let timer = null;
    const finish = out => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(u);
      res(out);
    };
    timer = setTimeout(() => finish(null), 8000);
    const capture = () => {
      try {
        const scale = Math.min(1, THUMB_MAX_W / (v.videoWidth || THUMB_MAX_W));
        const w = Math.max(1, Math.round((v.videoWidth || THUMB_MAX_W) * scale));
        const h = Math.max(1, Math.round((v.videoHeight || THUMB_MAX_W) * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob(b => {
          if (b) return finish({ blob: b, w, h });
          c.toBlob(b2 => finish(b2 ? { blob: b2, w, h } : null), 'image/jpeg', 0.8);
        }, 'image/webp', 0.8);
      } catch {
        finish(null);
      }
    };
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      const t = Math.min(Math.max(0.1, (v.duration || 0) * 0.05), 1);
      try { v.currentTime = t; } catch { capture(); }
    };
    v.onseeked = capture;
    v.onloadeddata = () => { if (!v.videoWidth) return; if (v.currentTime === 0) { try { v.currentTime = 0.1; } catch { capture(); } } };
    v.onerror = () => finish(null);
    v.src = u;
  });
}

// آپلود با پیام فارسیِ خطای «بسته‌شده توسط ادمین»
async function upl(client, blob, opts) {
  try {
    return await client.uploadContent(blob, opts);
  } catch (e) {
    if (e?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED' || e?.data?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED') {
      throw Object.assign(new Error(tr('ارسال این نوع فایل توسط ادمین غیرفعال شده است.')), { code: 'upload_disabled' });
    }
    throw e;
  }
}

export async function sendFile(client, roomId, file, opts = {}) {
  if (file.size > MAX_BYTES) throw new Error(tr("حجم فایل بیشتر از ۵۰ مگابایت است."));
  const originalIsImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
  const isImage = originalIsImage;
  const isVideo = file.type.startsWith('video/');
  // عکس‌های چت قبل از رمزنگاری فشرده می‌شوند (سرور به محتوای رمز دسترسی ندارد)
  const payload = isImage ? await compressImage(file) : file;
  const encrypted = client.isRoomEncrypted(roomId);
  const info = {
    mimetype: payload.type || 'application/octet-stream',
    size: payload.size
  };
  if (isImage) {
    const d = await imageSize(payload);
    if (d) {
      info.w = d.w;
      info.h = d.h;
    }
  } else if (isVideo) {
    const d = await videoMeta(file);
    if (d) Object.assign(info, d);
  }
  const isMusic = file.type.startsWith('audio/') && !opts.msgtype;
  const kind = isImage ? 'image' : isVideo ? 'video' : file.type.startsWith('audio/') ? (opts.msgtype ? 'voice' : 'music') : 'file';
  let musicTags = null;
  if (isMusic) {
    try {
      const { readTags } = await import('./cover.jsx');
      musicTags = await readTags(file);
    } catch { /* برچسب‌ها اختیاری‌اند */ }
    const d = await audioDuration(file);
    if (d) info.duration = d;
  }
  Object.assign(info, opts.info || {});
  const content = {
    msgtype: opts.msgtype || (isImage ? 'm.image' : isVideo ? 'm.video' : isMusic ? 'm.audio' : 'm.file'),
    body: opts.body || file.name || 'file',
    info,
    ...(isMusic && musicTags && (musicTags.title || musicTags.artist) ? { 'ir.tikootak.music': { title: musicTags.title || '', artist: musicTags.artist || '' } } : {}),
    ...(opts.extra || {})
  };
  // کاور آهنگ (کوچک) مثل پوستر ویدیو آپلود می‌شود؛ در اتاق رمزشده جداگانه رمز می‌شود
  if (isMusic && musicTags?.cover) {
    try {
      const cov = musicTags.cover;
      const ci = { mimetype: cov.type || 'image/jpeg', size: cov.size };
      if (encrypted) {
        const { blob, info: ei } = await encryptBlob(cov);
        const up = await client.uploadContent(blob, { type: 'application/octet-stream', includeFilename: false });
        info.thumbnail_file = { ...ei, url: up.content_uri, mimetype: ci.mimetype };
      } else {
        const up = await client.uploadContent(cov, { type: ci.mimetype, name: 'cover.jpg' });
        info.thumbnail_url = up.content_uri;
      }
      info.thumbnail_info = ci;
    } catch { /* کاور اختیاری است */ }
  }
  // آپلود پوستر ویدیو (کوچک)؛ در اتاق رمزنگاری‌شده جداگانه رمز می‌شود
  if (isVideo) {
    try {
      const poster = await videoPoster(file);
      if (poster) {
        const thumbMime = poster.blob.type || 'image/webp';
        const thumbnailInfo = { mimetype: thumbMime, size: poster.blob.size, w: poster.w, h: poster.h };
        if (encrypted) {
          const {
            blob,
            info: ei
          } = await encryptBlob(poster.blob);
          const up = await client.uploadContent(blob, {
            type: 'application/octet-stream',
            includeFilename: false
          });
          info.thumbnail_file = {
            ...ei,
            url: up.content_uri,
            mimetype: thumbMime
          };
        } else {
          const up = await client.uploadContent(poster.blob, {
            type: thumbMime,
            name: 'thumb.webp'
          });
          info.thumbnail_url = up.content_uri;
        }
        info.thumbnail_info = thumbnailInfo;
      }
    } catch { /* پیش‌نمایش اختیاری است؛ ارسال ویدیو نباید به آن وابسته باشد */ }
  }
  if (encrypted) {
    const {
      blob,
      info: ei
    } = await encryptBlob(payload);
    const up = await upl(client, blob, {
      type: `application/octet-stream; tk=${kind}`,
      includeFilename: false
    });
    content.file = {
      ...ei,
      url: up.content_uri,
      mimetype: info.mimetype
    };
  } else {
    const up = await upl(client, payload, {
      type: kind === 'voice' ? `${info.mimetype}; tk=voice` : info.mimetype,
      name: file.name
    });
    content.url = up.content_uri;
  }
  return client.sendMessage(roomId, content);
}

// فایل را (با توکن) دانلود می‌کند و اگر رمز باشد رمزگشایی می‌کند. خروجی: Blob
export async function fetchFile(client, content, onProgress) {
  const mxc = content.file?.url || content.url;
  const url = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, false, true);
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${client.getAccessToken()}`
    }
  });
  if (!r.ok) throw new Error(tr("دانلود نشد"));
  let buf;
  const total = Number(r.headers.get('content-length')) || content.info?.size || 0;
  if (onProgress && r.body?.getReader) {
    // دانلود تدریجی تا حلقهٔ پیشرفت نمایش داده شود
    const rd = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(total ? Math.min(1, got / total) : 0);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else {
    buf = await r.arrayBuffer();
  }
  const mimetype = content.info?.mimetype || 'application/octet-stream';
  if (!content.file) return new Blob([buf], {
    type: mimetype
  });
  const f = content.file;
  const hash = b64(await crypto.subtle.digest('SHA-256', buf));
  if (hash !== f.hashes?.sha256) throw new Error(tr("فایل خراب یا دستکاری شده است"));
  const key = await crypto.subtle.importKey('jwk', f.key, {
    name: 'AES-CTR'
  }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({
    name: 'AES-CTR',
    counter: unb64(f.iv),
    length: 64
  }, key, buf);
  return new Blob([plain], {
    type: mimetype
  });
}
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// مدت آهنگ بر حسب میلی‌ثانیه (فقط از متادیتا؛ فایل را کامل نمی‌خواند)
export function audioDuration(file) {
  return new Promise((resolve) => {
    try {
      const a = document.createElement('audio');
      const u = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(u); resolve(v); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 4000);
      a.src = u;
    } catch { resolve(0); }
  });
}
