import { useEffect, useState } from 'react';
import { fetchFile } from './media.js';

// تصویر استیکر با توکن دانلود می‌شود (رسانهٔ Matrix احراز هویت می‌خواهد)
const cache = new Map();
export default function StickerImg({ client, st, size }) {
  const [src, setSrc] = useState(cache.get(st.url) || null);
  useEffect(() => {
    if (cache.has(st.url)) { setSrc(cache.get(st.url)); return undefined; }
    let on = true;
    fetchFile(client, { url: st.url, info: { mimetype: 'image/webp' } }).then((b) => {
      const u = URL.createObjectURL(b);
      cache.set(st.url, u);
      if (on) setSrc(u);
    }).catch(() => {});
    return () => { on = false; };
  }, [client, st.url]);
  return src ? <img src={src} alt="" draggable="false" style={size ? { width: size, height: size } : undefined} /> : <span className="st-ph" />;
}
