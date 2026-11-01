import fs from 'node:fs';
const base = process.env.BASE || 'http://localhost:8080';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const J = { 'content-type': 'application/json' };
const inv = (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': process.env.ADMIN || 'adminkey' }, body: JSON.stringify({ max_uses: 2, expires_days: 1 }) })).json()).code;
const u = 'sec' + Date.now().toString(36).slice(-5);
const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: inv, username: u, password: 'test12345678', displayname: u }) })).json();
const A = { authorization: 'Bearer ' + reg.access_token };
const post = (p, type, body, h = {}) => fetch(base + p, { method: 'POST', headers: { ...A, 'content-type': type, 'content-length': String(body.length), ...h }, body });
const fake = Buffer.from('<html><script>alert(1)</script></html> padding padding');
for (const [p, t] of [['/api/feed/posts', 'video/mp4'], ['/api/feed/posts', 'image/png'], ['/api/stories', 'image/jpeg'], ['/api/music/tracks', 'audio/mpeg']]) {
  const r = await post(p, t, fake, { 'x-title': 'x' });
  ok(r.status === 415, `${p} ${t} rejected with fake content (${r.status})`);
}
const real = fs.readFileSync('pic.png');
let r = await post('/api/feed/posts', 'image/png', real, { 'x-caption': 'ok' });
ok(r.status === 201, 'real PNG accepted ' + r.status);
r = await post('/api/feed/posts', 'video/webm', fs.readFileSync('clip.webm'), { 'x-caption': 'v' });
ok(r.status === 201, 'real webm accepted ' + r.status);
r = await post('/api/music/tracks', 'audio/wav', fs.readFileSync('song1.wav'), { 'x-title': 'w' });
ok(r.status === 201, 'real wav accepted ' + r.status);
const h = await fetch(base + '/api/auth/login', { method: 'POST', headers: J, body: '{}' });
ok(h.headers.get('cache-control') === 'no-store', 'login: no-store');
ok(h.headers.get('x-content-type-options') === 'nosniff' && !h.headers.get('x-powered-by'), 'API headers');
