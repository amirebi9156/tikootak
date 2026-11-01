import { tr } from './i18n.js';
import { sdk } from './matrix.js';
import { fetchFile, encryptBlob } from './media.js';
import { ROOM_TYPE_EVENT } from './roomtype.js';
import { EV, EV_OLD, hasEvent } from './eventTypes.js';

// اتاق «پیام‌های ذخیره‌شده»: یک اتاق خصوصی تک‌نفره، idempotent
let savedPromise = null;
export async function ensureSavedRoom(client) {
  const cur = client.getAccountData(EV.savedRoom)?.getContent()?.room_id
    || client.getAccountData(EV_OLD.savedRoom)?.getContent()?.room_id;
  if (cur && client.getRoom(cur)?.getMyMembership() === 'join') {
    if (!client.getAccountData(EV.savedRoom)?.getContent()?.room_id) {
      await client.setAccountData(EV.savedRoom, { room_id: cur }).catch(() => {});
    }
    return cur;
  }
  if (savedPromise) return savedPromise;
  savedPromise = (async () => {
    const initial = [{ type: ROOM_TYPE_EVENT, state_key: '', content: { type: 'saved' } }];
    if (client.getCrypto()) {
      initial.push({ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
    }
    const r = await client.createRoom({
      name: tr('پیام‌های ذخیره‌شده'),
      preset: sdk.Preset.PrivateChat,
      initial_state: initial,
    });
    await client.setAccountData(EV.savedRoom, { room_id: r.room_id });
    return r.room_id;
  })().finally(() => { savedPromise = null; });
  return savedPromise;
}

function isMedia(content) {
  return ['m.image', 'm.video', 'm.audio', 'm.file'].includes(content.msgtype) && (content.url || content.file);
}

// فوروارد یک پیام به اتاق مقصد. اگر وضعیت رمزنگاری مبدأ/مقصد فرق کند، رسانه دانلود و دوباره رمز/آپلود می‌شود.
export async function forwardMessage(client, sourceRoom, targetRoomId, content, senderName) {
  if (hasEvent(content, 'call')) throw new Error('not_forwardable');
  const msg = { ...content, info: content.info ? { ...content.info } : undefined };
  delete msg['m.relates_to'];
  delete msg['m.new_content'];
  delete msg['m.mentions'];
  msg[EV.forwardedFrom] = senderName || '';
  if (isMedia(content)) {
    const srcEnc = client.isRoomEncrypted(sourceRoom.roomId);
    const dstEnc = client.isRoomEncrypted(targetRoomId);
    if (srcEnc !== dstEnc) {
      const blob = await fetchFile(client, content);
      const mime = content.info?.mimetype || blob.type || 'application/octet-stream';
      if (dstEnc) {
        const { blob: enc, info } = await encryptBlob(blob);
        const up = await client.uploadContent(enc, { type: 'application/octet-stream', includeFilename: false });
        msg.file = { ...info, url: up.content_uri, mimetype: mime };
        delete msg.url;
      } else {
        const up = await client.uploadContent(blob, { type: mime, name: content.body || 'file' });
        msg.url = up.content_uri;
        delete msg.file;
      }
      // پوستر رمزنگاری‌شده در مقصد ساده قابل استفاده نیست
      if (msg.info) {
        delete msg.info.thumbnail_file;
        if (!dstEnc) delete msg.info.thumbnail_url;
      }
      if (msg.info) msg.info.size = blob.size;
    }
  }
  return client.sendMessage(targetRoomId, msg);
}

export async function saveToSaved(client, sourceRoom, content, senderName) {
  const rid = await ensureSavedRoom(client);
  await forwardMessage(client, sourceRoom, rid, content, senderName);
  return rid;
}
