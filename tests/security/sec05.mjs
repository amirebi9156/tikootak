// تست S5: حذف متادیتا از عکس و ویدیو. نیاز: geo.jpg (EXIF با GPS و Orientation=6) و geo.mp4 (متادیتای SECRETGPS)
import fs from 'node:fs';
const base = process.env.BASE || 'http://localhost:8080'; const J = { 'content-type': 'application/json' };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const inv = (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': process.env.ADMIN || 'adminkey' }, body: JSON.stringify({ max_uses: 1, expires_days: 1 }) })).json()).code;
const u = 'mt' + Date.now().toString(36).slice(-5);
const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: inv, username: u, password: 'Zx9!kLm2pQ7w' }) })).json();
const H = { authorization: 'Bearer ' + reg.access_token };
const up = async (p, type, buf) => (await (await fetch(base + p, { method: 'POST', headers: { ...H, 'content-type': type, 'content-length': String(buf.length) }, body: buf })).json());
const get = async (url) => Buffer.from(await (await fetch(base + url)).arrayBuffer());
const jpg = fs.readFileSync('geo.jpg');
const p1 = await up('/api/feed/posts', 'image/jpeg', jpg);
const b1 = await get(p1.url);
ok(!b1.includes('SecretPhone') && !b1.includes('GPS'), 'device EXIF/GPS stripped from post JPEG');
ok(b1.includes(Buffer.from([0x01, 0x12])) && b1[0] === 0xff, 'Orientation kept and JPEG intact');
const s1 = await up('/api/stories', 'image/jpeg', jpg);
ok(!(await get(s1.url)).includes('SecretPhone'), 'story EXIF stripped');
const mp4 = fs.readFileSync('geo.mp4');
const v = await up('/api/feed/posts', 'video/mp4', mp4);
let cleaned = false;
for (let i = 0; i < 40 && !cleaned; i++) { await new Promise((r) => setTimeout(r, 1000)); const b = await get(v.url.startsWith('/') ? v.url : '/' + v.url); cleaned = !b.includes('SECRETGPS') && b.length > 500; }
ok(cleaned, 'video metadata (SECRETGPS) stripped after processing');
