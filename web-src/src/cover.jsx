import { hue } from './util.js';

// کاور آهنگ: عکس واقعی اگر هست، وگرنه یک مربع رنگی با نت موسیقی (رنگ از نام آهنگ)
export function Cover({ src, seed = '', size = 48, radius = 10 }) {
  const h = hue(seed || 'x');
  return (
    <span className="cover" style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(135deg, hsl(0 0% ${30 + (h % 20)}%), hsl(0 0% ${10 + (h % 8)}%))`, fontSize: size * 0.45 }}>
      {src ? <img src={src} alt="" loading="lazy" /> : '♪'}
    </span>
  );
}

// کاور پلی‌لیست: تا ۴ کاور آهنگ‌ها به‌صورت کاشی
export function PlaylistCover({ covers = [], seed = '', size = 56 }) {
  if (covers.length === 0) return <Cover seed={seed} size={size} />;
  if (covers.length < 4) return <Cover src={covers[0]} seed={seed} size={size} />;
  const h = size / 2;
  return (
    <span className="cover quad" style={{ width: size, height: size }}>
      {covers.slice(0, 4).map((c, i) => <img key={i} src={c} alt="" style={{ width: h, height: h }} />)}
    </span>
  );
}

// خواندن عنوان، خواننده و عکس کاور از داخل فایل آهنگ (ID3 / m4a / flac)
export async function readTags(file) {
  try {
    const mod = await import('jsmediatags/dist/jsmediatags.min.js');
    const jsm = mod.default || mod;
    const tags = await new Promise((res, rej) => jsm.read(file, { onSuccess: (t) => res(t.tags), onError: rej }));
    let blob = null;
    const pic = tags.picture;
    if (pic?.data?.length) {
      const raw = new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' });
      blob = await shrink(raw);
    }
    return { title: tags.title || '', artist: tags.artist || '', cover: blob };
  } catch { return { title: '', artist: '', cover: null }; }
}

async function shrink(blob, max = 400) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}
