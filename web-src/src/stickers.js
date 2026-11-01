// استیکرهای شخصی: تصویر کوچک ذخیره‌شده در Account Data (روی همهٔ دستگاه‌ها همگام)، ارسال به‌صورت m.image با نشانهٔ استیکر.
import { fetchFile, encryptBlob } from './media.js';
import { tr } from './i18n.js';

export const ST_EVENT = 'ir.tikootak.stickers';
export const ST_FLAG = 'ir.tikootak.sticker';
const MAX_STICKERS = 150;

export function loadStickers(client) {
  const l = client.getAccountData(ST_EVENT)?.getContent()?.list;
  return Array.isArray(l) ? l : [];
}

async function toWebp(file, max = 384) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', 0.9));
  if (!blob) throw new Error('encode_failed');
  return { blob, w, h };
}

async function up(client, blob) {
  try {
    return await client.uploadContent(blob, { type: 'image/webp', name: 'sticker.webp' });
  } catch (e) {
    if (e?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED' || e?.data?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED') {
      throw new Error(tr('ارسال این نوع فایل توسط ادمین غیرفعال شده است.'));
    }
    throw e;
  }
}

// فایل تصویر (یا Blob) → استیکر جدید
export async function addSticker(client, file) {
  const cur = loadStickers(client);
  if (cur.length >= MAX_STICKERS) throw new Error(tr('حداکثر ۱۵۰ استیکر می‌توانی داشته باشی.'));
  const { blob, w, h } = await toWebp(file);
  const r = await up(client, blob);
  const st = { url: r.content_uri, w, h, size: blob.size, id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` };
  await client.setAccountData(ST_EVENT, { list: [st, ...cur] });
  return st;
}

export async function removeSticker(client, id) {
  const cur = loadStickers(client).filter((s) => s.id !== id);
  await client.setAccountData(ST_EVENT, { list: cur });
}

// ارسال استیکر به اتاق؛ اتاق رمزشده: دوباره رمز می‌شود
export async function sendSticker(client, roomId, st) {
  const info = { mimetype: 'image/webp', w: st.w, h: st.h, size: st.size };
  const content = { msgtype: 'm.image', body: tr('استیکر'), info, [ST_FLAG]: true };
  if (client.isRoomEncrypted(roomId)) {
    const blob = await fetchFile(client, { url: st.url, info });
    const { blob: enc, info: ei } = await encryptBlob(blob);
    let r;
    try { r = await client.uploadContent(enc, { type: 'application/octet-stream; tk=image', includeFilename: false }); } catch (e) {
      if (e?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED' || e?.data?.errcode === 'IR_TIKOOTAK_UPLOAD_DISABLED') throw new Error(tr('ارسال این نوع فایل توسط ادمین غیرفعال شده است.'));
      throw e;
    }
    content.file = { ...ei, url: r.content_uri, mimetype: 'image/webp' };
  } else {
    content.url = st.url;
  }
  return client.sendMessage(roomId, content);
}

// یک پیام تصویری → استیکر
export async function stickerFromMessage(client, content) {
  const blob = await fetchFile(client, content);
  return addSticker(client, blob);
}
