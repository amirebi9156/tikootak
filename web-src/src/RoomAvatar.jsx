import { useEffect, useState } from 'react';
import { Avatar } from './ui.jsx';

// عکس گروه/کانال از m.room.avatar؛ با توکن دانلود و در حافظه کش می‌شود. بدون عکس: حرف اول.
const cache = new Map(); // mxc|size -> objectURL
export function roomAvatarMxc(room) {
  try { return room?.currentState?.getStateEvents('m.room.avatar', '')?.getContent()?.url || null; } catch { return null; }
}
export default function RoomAvatar({ client, room, name, id, size = 44 }) {
  const mxc = roomAvatarMxc(room);
  const [src, setSrc] = useState(() => (mxc && cache.get(`${mxc}|${size}`)) || null);
  useEffect(() => {
    let dead = false;
    if (!mxc || !client) { setSrc(null); return undefined; }
    const k = `${mxc}|${size}`;
    if (cache.has(k)) { setSrc(cache.get(k)); return undefined; }
    (async () => {
      try {
        const url = client.mxcUrlToHttp(mxc, size * 2, size * 2, 'crop', false, false, true);
        const r = await fetch(url, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } });
        if (!r.ok) return;
        const u = URL.createObjectURL(await r.blob());
        cache.set(k, u);
        if (!dead) setSrc(u);
      } catch { /* بدون عکس */ }
    })();
    return () => { dead = true; };
  }, [mxc, client, size]);
  if (!src) return <Avatar name={name} id={id} size={size} />;
  return <span className="avatar" aria-hidden="true" style={{ width: size, height: size }}><img src={src} alt="" /></span>;
}

// کوچک‌کردن تصویر انتخابی تا ۵۱۲ پیکسل (JPEG) قبل از آپلود
export async function shrinkImage(file, max = 512) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
}
