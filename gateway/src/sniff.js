// بررسی محتوای واقعی فایل (magic bytes) تا فقط به Content-Type هدر اعتماد نشود
import fs from 'node:fs';

const ascii = (b, s, e) => b.toString('latin1', s, e);

function kindOf(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 0, 3) === 'GIF') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'wav';
  if (ascii(b, 4, 8) === 'ftyp') return 'mp4'; // mp4 / mov / m4a
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'; // EBML (webm/mkv)
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG audio / ADTS aac
  return null;
}

const OK = {
  'image/jpeg': ['jpeg'], 'image/png': ['png'], 'image/gif': ['gif'], 'image/webp': ['webp'],
  'video/mp4': ['mp4'], 'video/quicktime': ['mp4'], 'video/webm': ['webm'],
  'audio/mpeg': ['mp3'], 'audio/mp3': ['mp3'], 'audio/aac': ['mp3'],
  'audio/mp4': ['mp4'], 'audio/x-m4a': ['mp4'],
  'audio/ogg': ['ogg'], 'audio/opus': ['ogg'], 'audio/wav': ['wav'], 'audio/x-wav': ['wav'],
  'audio/flac': ['flac'], 'audio/x-flac': ['flac'], 'audio/webm': ['webm'],
};

export function sniffBuf(buf, mime) {
  const allowed = OK[mime];
  return !!allowed && allowed.includes(kindOf(buf.subarray(0, 16)));
}

export function sniffOk(file, mime) {
  const allowed = OK[mime];
  if (!allowed) return false;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, 16, 0);
    return allowed.includes(kindOf(b.subarray(0, n)));
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ } }
}
