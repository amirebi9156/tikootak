// تبدیل سبک ویدیوهای پست به H.264 ≤720p با ffmpeg.
// برای سرور ضعیف: یک worker، nice، یک thread، سقف ۱۸۰ ثانیه، توقف وقتی load بالا است.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const TIMEOUT_MS = Number(process.env.TRANSCODE_TIMEOUT_MS) || 180_000;
const SKIP_MB = Number(process.env.TRANSCODE_SKIP_MB) || 10;
const POLL_MS = 5_000;
const COOLDOWN_MS = 15_000;

export function createTranscoder({ db, dataDir, enabled = true, log = console }) {
  const dir = path.join(dataDir, 'feed');
  const now = () => Math.floor(Date.now() / 1000);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcode_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      tries INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS transcode_status ON transcode_jobs(status, id);
  `);
  // ستون kind در migration 001 اضافه می‌شود.
  // اگر وسط تبدیل ری‌استارت شد، کار را دوباره در صف بگذار (فایل اصلی دست‌نخورده است)
  try { db.exec("UPDATE transcode_jobs SET status='queued', started_at=NULL WHERE status='running'"); } catch { /* مهم نیست */ }
  // فایل‌های موقت قبلی را پاک کن
  for (const base of [dir, path.join(dataDir, 'stories')]) {
    try {
      for (const f of fs.readdirSync(base)) {
        if (f.startsWith('.transcode-')) fs.rmSync(path.join(base, f), { force: true });
      }
    } catch { /* پوشه هنوز نیست */ }
  }

  let timer = null;
  let stopped = false;
  let current = null; // { postId, child }

  const stats = () => ({
    queued: db.prepare("SELECT COUNT(*) c FROM transcode_jobs WHERE status='queued'").get().c,
    failed: db.prepare("SELECT COUNT(*) c FROM transcode_jobs WHERE status='failed'").get().c,
  });

  function schedule(ms = POLL_MS) {
    if (stopped || !enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
    timer.unref?.();
  }

  function enqueue(target) {
    if (!enabled || !target?.id || !String(target.mime || '').startsWith('video/')) return;
    const kind = target.kind === 'story' ? 'story' : 'post';
    db.prepare(`INSERT OR IGNORE INTO transcode_jobs (post_id, kind, status, tries, created_at) VALUES (?, ?, 'queued', 0, ?)`)
      .run(target.id, kind, now());
  }

  function cancel(postId) {
    db.prepare('DELETE FROM transcode_jobs WHERE post_id=?').run(postId);
    for (const base of [dir, path.join(dataDir, 'stories')]) {
      try {
        for (const f of fs.readdirSync(base)) {
          if (f.startsWith(`.transcode-${postId}-`)) fs.rmSync(path.join(base, f), { force: true });
        }
      } catch { /* مهم نیست */ }
    }
    if (current?.postId === postId && current.child) {
      try { current.child.kill('SIGKILL'); } catch { /* مهم نیست */ }
    }
  }

  function probe(file) {
    return new Promise((resolve) => {
      const args = ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height',
        '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration,size', '-of', 'json', file];
      const child = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 20_000);
      child.stdout.on('data', (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); });
      child.on('error', () => { clearTimeout(t); resolve(null); });
      child.on('close', () => {
        clearTimeout(t);
        try {
          const j = JSON.parse(out);
          const s = j.streams?.[0];
          resolve(s ? {
            codec: s.codec_name, width: Number(s.width) || 0, height: Number(s.height) || 0,
            size: Number(j.format?.size) || 0, duration: Number(j.format?.duration) || 0,
          } : null);
        } catch { resolve(null); }
      });
    });
  }

  // اگر ffprobe نبود (build سبک)، با خود ffmpeg اطلاعات را از stderr بخوان
  function probeWithFfmpeg(file) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(FFMPEG, ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch { return resolve(null); }
      let err = '';
      let done = false;
      let t = null;
      const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish(null); }, 20_000);
      child.stderr.on('data', (c) => { err += c; if (err.length > 60_000) err = err.slice(-30_000); });
      child.on('error', () => finish(null));
      child.on('close', () => {
        const vm = /Video:\s*([a-zA-Z0-9_]+).*?(\d{2,5})x(\d{2,5})/s.exec(err);
        if (!vm) return finish(null);
        const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err);
        let size = 0;
        try { size = fs.statSync(file).size; } catch { /* ignore */ }
        finish({
          codec: vm[1], width: Number(vm[2]) || 0, height: Number(vm[3]) || 0, size,
          duration: dm ? (Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])) : 0,
        });
      });
    });
  }

  function runFfmpeg(src, dst, { copy = false } = {}) {
    return new Promise((resolve) => {
      const vf = "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2";
      // protocol_whitelist: فقط فایل محلی خوانده شود (جلوی SSRF/LFI با playlist یا URL داخل فایل). متادیتا (GPS و ...) همیشه حذف می‌شود.
      const common = ['-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', src,
        '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '-1', '-map_chapters', '-1'];
      const args = copy
        ? [...common, '-c', 'copy', ...(dst.endsWith('.mp4') || dst.endsWith('.mov') ? ['-movflags', '+faststart'] : []), dst]
        : [...common, '-vf', vf,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-threads', '1',
          '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dst];
      let child;
      try {
        child = spawn('nice', ['-n', '19', FFMPEG, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      }
      let err = '';
      let timedOut = false;
      const t = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, TIMEOUT_MS);
      child.stderr.on('data', (c) => { err += c; if (err.length > 4000) err = err.slice(-2000); });
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, timedOut, err: e.message }); });
      child.on('close', (code) => {
        clearTimeout(t);
        resolve({ code, timedOut, err: err.trim().slice(0, 800) });
      });
      if (current?.postId) current.child = child;
    });
  }

  async function processJob(job) {
    const marked = db.prepare("UPDATE transcode_jobs SET status='running', tries=tries+1, started_at=? WHERE id=? AND status='queued'")
      .run(now(), job.id);
    if (!marked.changes) return;
    const kind = job.kind === 'story' ? 'story' : 'post';
    const table = kind === 'story' ? 'stories' : 'posts';
    const base = kind === 'story' ? path.join(dataDir, 'stories') : dir;
    const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(job.post_id);
    if (!item) {
      db.prepare('DELETE FROM transcode_jobs WHERE id=?').run(job.id);
      return;
    }
    const src = path.join(base, item.file);
    const tmp = path.join(base, `.transcode-${item.id}-${job.id}.mp4`);
    const cleanup = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } };
    const finish = (status, error = null) => {
      cleanup();
      db.prepare('UPDATE transcode_jobs SET status=?, finished_at=?, error=? WHERE id=?').run(status, now(), error, job.id);
    };
    try {
      if (!fs.existsSync(src)) return finish('failed', 'missing_file');
      let info = await probe(src);
      if (!info) info = await probeWithFfmpeg(src);
      if (!info) return finish('failed', 'probe_failed');
      // ابعاد غیرمعمول (Decompression/Pixel bomb): پردازش نمی‌کنیم
      if (info.width * info.height > 40_000_000) return finish('failed', 'dimensions_too_large');
      // فقط حذف متادیتا بدون کدگذاری مجدد (برای ویدیوی سبک یا وقتی خروجی بزرگ‌تر شد)
      const stripOnly = async (why) => {
        const ext = path.extname(item.file) || '.mp4';
        const t2 = path.join(base, `.strip-${item.id}-${job.id}${ext}`);
        try {
          const r2 = await runFfmpeg(src, t2, { copy: true });
          const sz = fs.existsSync(t2) ? fs.statSync(t2).size : 0;
          if (r2.code === 0 && sz > 0) {
            fs.renameSync(t2, src);
            db.prepare(`UPDATE ${table} SET size=? WHERE id=?`).run(sz, item.id);
          }
        } finally { try { fs.rmSync(t2, { force: true }); } catch { /* ignore */ } }
        return finish(why);
      };
      const skipBytes = SKIP_MB * 1024 * 1024;
      if (info.codec === 'h264' && info.width > 0 && info.height > 0 &&
          info.width <= 1280 && info.height <= 720 && info.size > 0 && info.size <= skipBytes) {
        return stripOnly('skipped');
      }
      current = { postId: item.id, child: null };
      const r = await runFfmpeg(src, tmp);
      if (r.timedOut) return finish('failed', 'timeout');
      if (r.code !== 0 || !fs.existsSync(tmp)) return finish('failed', r.err || `ffmpeg_${r.code}`);
      // اگر هدف در همین فاصله حذف شده باشد، خروجی را دور بریز
      if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(item.id)) {
        cleanup();
        db.prepare('DELETE FROM transcode_jobs WHERE id=?').run(job.id);
        return;
      }
      const before = fs.statSync(src).size;
      const after = fs.statSync(tmp).size;
      if (!after || after >= before) { cleanup(); return stripOnly('skipped'); }
      // جایگزینی اتمیک: خروجی mp4 در کنار فایل اصلی، بعد آپدیت دیتابیس
      const newName = `${item.id}.mp4`;
      const newPath = path.join(base, newName);
      fs.renameSync(tmp, newPath);
      db.prepare(`UPDATE ${table} SET file=?, mime=?, size=? WHERE id=?`).run(newName, 'video/mp4', after, item.id);
      if (item.file !== newName) { try { fs.rmSync(path.join(base, item.file), { force: true }); } catch { /* ignore */ } }
      finish('done');
      log.info?.(`transcode done ${kind}:${item.id}: ${before} -> ${after}`);
    } catch (e) {
      finish('failed', String(e.message || e).slice(0, 500));
    } finally {
      current = null;
    }
  }

  async function tick() {
    timer = null;
    if (stopped || !enabled) return;
    try {
      if (os.loadavg()[0] > 2) return schedule(COOLDOWN_MS);
      const job = db.prepare("SELECT * FROM transcode_jobs WHERE status='queued' ORDER BY id LIMIT 1").get();
      if (!job) return schedule(POLL_MS);
      await processJob(job);
    } catch (e) {
      log.error?.('transcode worker', e.message);
    }
    schedule(1_500);
  }

  function start() {
    if (!enabled || stopped) return;
    schedule(1_500);
  }
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (current?.child) { try { current.child.kill('SIGKILL'); } catch { /* ignore */ } }
  }

  return { enqueue, cancel, start, stop, stats };
}
