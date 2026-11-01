// تست نفوذ سبک (IDOR/احراز هویت). اجرا: node sec03.mjs  (BASE=http://localhost:8080 ADMIN=adminkey)
import fs from 'node:fs';
const base = process.env.BASE || 'http://localhost:8080';
const ADMIN = process.env.ADMIN || 'adminkey';
const J = { 'content-type': 'application/json' };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
async function user(tag) {
  const inv = (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': ADMIN }, body: JSON.stringify({ max_uses: 1, expires_days: 1 }) })).json()).code;
  const u = tag + Date.now().toString(36).slice(-5);
  const r = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: inv, username: u, password: 'Zx9!kLm2pQ7w', displayname: u }) })).json();
  return { id: r.user_id, h: { authorization: 'Bearer ' + r.access_token } };
}
const A = await user('ida'); const B = await user('idb');
const call = (u, m, p, body, extra = {}) => fetch(base + p, { method: m, headers: { ...u.h, ...J, ...extra }, body: body ? JSON.stringify(body) : undefined });
const png = fs.readFileSync(process.env.PNG || 'pic.png');
const up = (u, p, type, buf, h = {}) => fetch(base + p, { method: 'POST', headers: { ...u.h, 'content-type': type, 'content-length': String(buf.length), ...h }, body: buf });

// بدون توکن
for (const p of ['/api/feed/posts', '/api/music/tracks', '/api/stories', '/api/notifications', '/api/privacy']) {
  const r = await fetch(base + p); ok([401, 403, 404].includes(r.status), `no token ${p} -> ${r.status}`);
}
let r = await fetch(base + '/api/feed/posts', { headers: { authorization: 'Bearer invalid' } }); ok(r.status === 401, 'invalid token rejected');
r = await fetch(base + '/api/admin/stats'); ok(r.status === 401, 'admin without key 401');
r = await fetch(base + '/api/admin/stats', { headers: A.h }); ok(r.status === 401, 'normal user token is not admin');

// پست A
const pr = await up(A, '/api/feed/posts', 'image/png', png, { 'x-caption': 'secret' }); const post = await pr.json();
r = await call(B, 'DELETE', '/api/feed/posts/' + post.id); ok(r.status === 403 || r.status === 404, 'B cannot delete A post ' + r.status);
const cm = await (await call(A, 'POST', `/api/feed/posts/${post.id}/comments`, { text: 'hi from A' })).json();
r = await call(B, 'DELETE', '/api/feed/comments/' + cm.id); ok(r.status === 403 || r.status === 404, 'B cannot delete A comment ' + r.status);
// استوری A
const sr = await up(A, '/api/stories', 'image/png', png, { 'x-caption': 's' }); const story = await sr.json();
r = await call(B, 'DELETE', '/api/stories/' + story.id); ok(r.status === 403 || r.status === 404, 'B cannot delete A story ' + r.status);
// آهنگ A
const tr = await up(A, '/api/music/tracks', 'audio/wav', fs.readFileSync(process.env.WAV || 'song1.wav'), { 'x-title': 'mine' }); const track = await tr.json();
r = await call(B, 'DELETE', '/api/music/tracks/' + track.id); ok(r.status === 403 || r.status === 404, 'B cannot delete A track ' + r.status);
// پلی‌لیست خصوصی A
const pl = await (await call(A, 'POST', '/api/music/playlists', { name: 'private', public: false })).json();
if (pl.id) {
  r = await call(B, 'GET', '/api/music/playlists/' + pl.id); ok([403, 404].includes(r.status), 'A private playlist is closed to B ' + r.status);
  r = await call(B, 'DELETE', '/api/music/playlists/' + pl.id); ok([403, 404].includes(r.status), 'B cannot delete A playlist ' + r.status);
} else console.log('SKIP playlist (' + JSON.stringify(pl).slice(0, 80) + ')');
// لینک مدیا امضاشده: دستکاری امضا/کاربر
const mediaUrl = post.url || ''; const m = mediaUrl.match(/\/api\/feed\/media\/[^?]+/);
if (m) {
  r = await fetch(base + mediaUrl); ok(r.status === 200, 'signed link works');
  r = await fetch(base + mediaUrl.replace(/s=[^&]+/, 's=AAAA')); ok(r.status === 403, 'tampered signature rejected');
  r = await fetch(base + mediaUrl.replace(/u=[^&]+/, 'u=' + encodeURIComponent(B.id))); ok(r.status === 403, 'changed user in link rejected');
  r = await fetch(base + mediaUrl.replace(/e=\d+/, 'e=1')); ok(r.status === 403, 'expired link rejected');
}
// مسیر خارج از پوشه
r = await fetch(base + '/api/feed/media/..%2F..%2Fgw.db?u=x&e=9999999999&s=x'); ok([403, 404].includes(r.status), 'path traversal blocked ' + r.status);
// بلاک: B بلاک A می‌کند، A نمی‌تواند نظر بدهد
await call(B, 'POST', '/api/blocks/' + encodeURIComponent(A.id));
const bp = await (await up(B, '/api/feed/posts', 'image/png', png, { 'x-caption': 'b' })).json();
r = await call(A, 'POST', `/api/feed/posts/${bp.id}/comments`, { text: 'blocked?' }); ok(r.status === 403, 'blocked user cannot comment ' + r.status);
// JSON خراب / بزرگ
r = await fetch(base + '/api/auth/login', { method: 'POST', headers: J, body: '{bad' }); ok(r.status === 400, 'malformed JSON 400');
r = await fetch(base + '/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username: 'x'.repeat(20000), password: 'y' }) }); ok(r.status === 413, 'large body 413');
// SQL injection ساده
r = await call(A, 'GET', "/api/feed/posts?q=" + encodeURIComponent("' OR 1=1 --")); ok(r.status < 500, 'injection in q gave no 500');
// سیاست رمز
const inv = (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': ADMIN }, body: JSON.stringify({ max_uses: 5, expires_days: 1 }) })).json()).code;
for (const [pw, want] of [['short1', 'invalid_password'], ['1234567890', 'weak_password'], ['aaaaaaaaaaaa', 'weak_password'], ['password123', 'weak_password']]) {
  r = await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: inv, username: 'pw' + Math.random().toString(36).slice(2, 7), password: pw }) });
  const j = await r.json(); ok(j.error === want, `password '${pw}' -> ${j.error}`);
}
