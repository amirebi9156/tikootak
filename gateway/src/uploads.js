// کنترل ادمین روی آپلود: هر دسته (تصویر، ویدیو، ویس، موزیک، فایل) = همه | هیچ‌کس | فقط کاربران خاص.
// اعمال در سرور: آپلودهای Matrix از همین‌جا عبور می‌کنند و به Synapse پراکسی می‌شوند.
// دستهٔ آپلود از Content-Type می‌آید (برای فایل‌های رمزشده: application/octet-stream; tk=<kind>).
import http from 'node:http';
import https from 'node:https';

export const KINDS = ['image', 'video', 'voice', 'music', 'file'];
const DEFAULT_POLICY = { small_kb: 512, kinds: Object.fromEntries(KINDS.map((k) => [k, { mode: 'all', users: [] }])) };

export function makeUploadPolicy(settings) {
  const load = () => {
    let p = null;
    try { p = JSON.parse(settings.get('upload_policy') || 'null'); } catch { /* پیش‌فرض */ }
    const out = { small_kb: Number(p?.small_kb ?? DEFAULT_POLICY.small_kb), kinds: {} };
    for (const k of KINDS) {
      const e = p?.kinds?.[k] || {};
      out.kinds[k] = { mode: ['all', 'none', 'users'].includes(e.mode) ? e.mode : 'all', users: Array.isArray(e.users) ? e.users.map(String).slice(0, 500) : [] };
    }
    if (!Number.isFinite(out.small_kb) || out.small_kb < 0) out.small_kb = 512;
    return out;
  };
  const normUser = (u, server) => {
    const s = String(u || '').trim().toLowerCase();
    if (!s) return '';
    if (s.startsWith('@')) return s;
    return `@${s}:${server}`;
  };
  const save = (body, server) => {
    const cur = load();
    if (body && body.small_kb != null) cur.small_kb = Math.max(0, Math.min(Number(body.small_kb) || 0, 100_000));
    for (const k of KINDS) {
      const e = body?.kinds?.[k];
      if (!e) continue;
      if (['all', 'none', 'users'].includes(e.mode)) cur.kinds[k].mode = e.mode;
      if (Array.isArray(e.users)) cur.kinds[k].users = [...new Set(e.users.map((u) => normUser(u, server)).filter(Boolean))].slice(0, 500);
    }
    settings.set('upload_policy', JSON.stringify(cur));
    return cur;
  };
  const allowed = (p, userId, kind) => {
    const e = p.kinds[kind] || p.kinds.file;
    if (e.mode === 'all') return true;
    if (e.mode === 'none') return false;
    return e.users.includes(String(userId).toLowerCase());
  };
  return { load, save, allowed };
}

// دستهٔ آپلود از Content-Type
export function kindOf(contentType) {
  const ct = String(contentType || '').toLowerCase();
  const tk = /;\s*tk=([a-z]+)/.exec(ct)?.[1];
  if (tk && KINDS.includes(tk)) return tk;
  const mime = ct.split(';')[0].trim();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'music';
  return 'file';
}

export function mountUploads(app, { auth, requireAdmin, settings, serverName, synapseUrl }) {
  const pol = makeUploadPolicy(settings);

  // سیاست مؤثر برای کاربر جاری (برای مخفی/غیرفعال‌کردن دکمه‌ها در رابط)
  app.get('/api/uploads/policy', auth, (req, res) => {
    const p = pol.load();
    res.json({ small_kb: p.small_kb, allowed: Object.fromEntries(KINDS.map((k) => [k, pol.allowed(p, req.userId, k)])) });
  });

  app.get('/api/admin/upload-policy', requireAdmin, (_req, res) => res.json(pol.load()));
  app.post('/api/admin/upload-policy', requireAdmin, (req, res) => res.json(pol.save(req.body || {}, serverName)));

  // پراکسی آپلود Matrix با بررسی سیاست
  const target = new URL(synapseUrl);
  const lib = target.protocol === 'https:' ? https : http;
  const gate = (req, res, next) => {
    const len = Number(req.headers['content-length'] || 0);
    const p = pol.load();
    if (len && len <= p.small_kb * 1024) return next(); // فایل‌های کوچک (آواتار، کاور، بندانگشتی)
    const kind = kindOf(req.headers['content-type']);
    if (pol.allowed(p, req.userId, kind)) return next();
    return res.status(403).json({ errcode: 'IR_TIKOOTAK_UPLOAD_DISABLED', error: 'upload_disabled', kind });
  };
  const proxy = (req, res) => {
    const headers = { ...req.headers, host: target.host };
    const up = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.originalUrl, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'upstream_unavailable' }); else res.destroy(); });
    req.pipe(up);
  };
  app.post(/^\/_matrix\/media\/[^/]+\/upload\/?$/, auth, gate, proxy);
  app.put(/^\/_matrix\/media\/[^/]+\/upload\/.+$/, auth, gate, proxy);
  app.post(/^\/_matrix\/media\/[^/]+\/create\/?$/, auth, proxy);

  // برای ماژول‌های دیگر (کتابخانهٔ موزیک)
  return { allowedFor: (userId, kind, len = 0) => { const p = pol.load(); return (len && len <= p.small_kb * 1024) || pol.allowed(p, userId, kind); } };
}
