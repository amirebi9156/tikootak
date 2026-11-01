// حذف متادیتای حساس (GPS، مشخصات دستگاه، توضیحات) از عکس‌ها. جهت عکس (Orientation) حفظ می‌شود.
import fs from 'node:fs';

function exifOrientation(seg) { // seg: بدنهٔ APP1 بعد از "Exif\0\0"
  try {
    const le = seg.toString('latin1', 0, 2) === 'II';
    const u16 = (o) => (le ? seg.readUInt16LE(o) : seg.readUInt16BE(o));
    const u32 = (o) => (le ? seg.readUInt32LE(o) : seg.readUInt32BE(o));
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < Math.min(n, 64); i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
  } catch { /* خراب */ }
  return 1;
}
const minimalExif = (o) => { // TIFF کوچک فقط با Orientation
  const b = Buffer.alloc(8 + 2 + 12 + 4);
  b.write('MM', 0, 'latin1'); b.writeUInt16BE(42, 2); b.writeUInt32BE(8, 4);
  b.writeUInt16BE(1, 8); b.writeUInt16BE(0x0112, 10); b.writeUInt16BE(3, 12); b.writeUInt32BE(1, 14); b.writeUInt16BE(o, 18);
  return b;
};

export function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let i = 2; let orient = 1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const m = buf[i + 1];
    if (m === 0xda || m === 0xd9) break; // شروع داده‌ی تصویر
    if (m === 0xff) { i++; continue; }
    const len = buf.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > buf.length) return buf;
    const isExif = m === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0';
    const drop = isExif || m === 0xe1 /* XMP */ || m === 0xed /* IPTC */ || m === 0xfe /* comment */ || (m >= 0xe3 && m <= 0xec) /* APPn غیر ICC */;
    if (isExif) orient = exifOrientation(buf.subarray(i + 10, end));
    if (!drop) out.push(buf.subarray(i, end));
    i = end;
  }
  const head = [out[0]];
  if (orient > 1 && orient <= 8) {
    const x = minimalExif(orient);
    const seg = Buffer.alloc(4 + 6 + x.length);
    seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(2 + 6 + x.length, 2); seg.write('Exif\0\0', 4, 'latin1'); x.copy(seg, 10);
    head.push(seg);
  }
  return Buffer.concat([...head, ...out.slice(1), buf.subarray(i)]);
}

export function stripPng(buf) {
  if (buf.length < 8 || buf.toString('latin1', 1, 4) !== 'PNG') return buf;
  const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i); const type = buf.toString('latin1', i + 4, i + 8); const end = i + 12 + len;
    if (end > buf.length) return buf;
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

export function stripWebp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF') return buf;
  const chunks = []; let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4); const len = buf.readUInt32LE(i + 4); const end = i + 8 + len + (len & 1);
    if (end > buf.length + 1) return buf;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const c = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X') c[8] &= ~(0x08 | 0x04);
      chunks.push(c);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

export function stripImageBuf(buf, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buf);
    if (mime === 'image/png') return stripPng(buf);
    if (mime === 'image/webp') return stripWebp(buf);
  } catch { /* اگر خراب بود، فایل اصلی بماند */ }
  return buf;
}

const MAX_BYTES = 30 * 1024 * 1024;
// فایل روی دیسک را درجا پاک‌سازی می‌کند؛ اندازهٔ جدید را برمی‌گرداند
export function stripImageFile(file, mime, size) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || size > MAX_BYTES) return size;
  try {
    const b = fs.readFileSync(file);
    const o = stripImageBuf(b, mime);
    if (o !== b && o.length > 0 && o.length <= b.length + 64) { fs.writeFileSync(file, o); return o.length; }
  } catch { /* بی‌خیال */ }
  return size;
}
