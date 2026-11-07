// Design audit screenshots: seeds users/chats/posts/music, then captures every main screen on phone + desktop.
// Usage (test env running): cp tests/design/shots.mjs ~/tikootak-testenv/tools/ && cd ~/tikootak-testenv/tools && node shots.mjs [outdir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const base = 'http://localhost:8080', J = { 'content-type': 'application/json' };
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const sx = Date.now().toString(36).slice(-3);
const sh = (c) => execSync(c, { stdio: 'ignore' });
// fixtures
const photo = (n, col) => { sh(`python3 -c "from PIL import Image,ImageDraw;im=Image.new('RGB',(900,1100),'${col}');d=ImageDraw.Draw(im);[d.ellipse((i*40,i*50,900-i*30,1100-i*60),outline=(255,255,255),width=3) for i in range(8)];im.save('${out}/fx${n}.jpg')"`); return fs.readFileSync(`${out}/fx${n}.jpg`); };
sh(`ffmpeg -y -loglevel error -f lavfi -i testsrc=size=480x854:rate=24 -t 3 -pix_fmt yuv420p ${out}/fx.mp4`);
sh(`ffmpeg -y -loglevel error -f lavfi -i sine=frequency=440:duration=20 -b:a 96k ${out}/fx.mp3`);
async function code() { return (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': 'adminkey' }, body: JSON.stringify({ max_uses: 5, expires_days: 1 }) })).json()).code; }
const reg = async (u) => (await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: await code(), username: u, password: 'test12345678' }) })).json());
const mx = async (t, m, p, b) => (await fetch(base + '/_matrix/client/v3' + p, { method: m, headers: { ...J, authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })).json();
const api = async (t, m, p, body, h = {}) => (await fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + t, ...h }, body })).json();
const A = await reg('ada' + sx), B = await reg('bob' + sx), C = await reg('cat' + sx);
await mx(A.access_token, 'PUT', `/profile/${encodeURIComponent(A.user_id)}/displayname`, { displayname: 'آدا' });
await mx(B.access_token, 'PUT', `/profile/${encodeURIComponent(B.user_id)}/displayname`, { displayname: 'بابک محمدحسین‌زاده‌نژاد خیلی خیلی طولانی' });
await mx(C.access_token, 'PUT', `/profile/${encodeURIComponent(C.user_id)}/displayname`, { displayname: 'Catherine Montgomery-Wellington' });
const dm = await mx(A.access_token, 'POST', '/createRoom', { is_direct: true, preset: 'trusted_private_chat', invite: [B.user_id] });
await mx(B.access_token, 'POST', '/join/' + encodeURIComponent(dm.room_id), {});
const grp = await mx(A.access_token, 'POST', '/createRoom', { name: 'گروه دوستان با اسم خیلی خیلی خیلی طولانی برای تست کوتاه شدن عنوان', preset: 'private_chat', invite: [B.user_id, C.user_id] });
for (const t of [B, C]) await mx(t.access_token, 'POST', '/join/' + encodeURIComponent(grp.room_id), {});
const msgs = [[B, 'سلام! چطوری؟'], [A, 'خوبم، تو چطوری؟ 😄'], [B, 'این یک پیام خیلی طولانی است که باید چند خط بشکند و ببینیم حباب چطور رفتار می‌کند وقتی متن فارسی و English با هم قاطی می‌شود، مثل this is a mixed sentence with URL https://tikootak.ir/some/very/long/path/that/goes/on'], [A, 'okay 👍'], [B, 'aVeryLongUnbreakableTokenaVeryLongUnbreakableTokenaVeryLongUnbreakableTokenaVeryLongUnbreakableToken'], [A, '❤️'], [B, 'ساعت ۸ میبینمت'], [A, 'باشه، قراره کجا باشه؟']];
let i = 0; for (const [u, b] of msgs) await mx(u.access_token, 'PUT', `/rooms/${encodeURIComponent(dm.room_id)}/send/m.room.message/m${i++}`, { msgtype: 'm.text', body: b });
for (const [u, b] of [[B, 'سلام گروه'], [C, 'Hi everyone, long English message to check wrapping inside group bubbles with sender names'], [A, 'خوش اومدید']]) await mx(u.access_token, 'PUT', `/rooms/${encodeURIComponent(grp.room_id)}/send/m.room.message/g${i++}`, { msgtype: 'm.text', body: b });
for (const [n, col] of [[1, '#2a6f97'], [2, '#9b2226'], [3, '#386641']]) await api(B.access_token, 'POST', '/api/feed/posts', photo(n, col), { 'content-type': 'image/jpeg', 'x-caption': encodeURIComponent(n === 1 ? 'کپشن کوتاه' : 'یک کپشن بلندتر که چند خط می‌شود و هشتگ #تست و منشن @ada' + sx + ' را دارد تا ببینیم چطور نمایش داده می‌شود.') });
await api(B.access_token, 'POST', '/api/feed/posts', fs.readFileSync(`${out}/fx.mp4`), { 'content-type': 'video/mp4', 'x-caption': encodeURIComponent('ویدیو') });
const tr1 = await api(B.access_token, 'POST', '/api/music/tracks', fs.readFileSync(`${out}/fx.mp3`), { 'content-type': 'audio/mpeg', 'x-title': encodeURIComponent('آهنگ نمونه با عنوان طولانی برای تست'), 'x-artist': encodeURIComponent('هنرمند') });
const pl = await api(B.access_token, 'POST', '/api/music/playlists', JSON.stringify({ name: 'پلی‌لیست من', public: true }), { 'content-type': 'application/json' });
if (pl.id && tr1.id) await api(B.access_token, 'POST', `/api/music/playlists/${pl.id}/tracks`, JSON.stringify({ track_id: tr1.id }), { 'content-type': 'application/json' });
await api(A.access_token, 'POST', `/api/follow/${encodeURIComponent(B.user_id)}`, '{}', { 'content-type': 'application/json' });

const mk = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function run(tag, vp, mobile, locale) {
  const c = await mk.newContext({ viewport: vp, locale, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${tag}-${n}.png` }); };
  const step = async (n, fn) => { try { await fn(); await shot(n); } catch (e) { console.log('SKIP', tag, n, String(e).split('\n')[0]); } };
  const tap = (l) => (mobile ? l.tap() : l.click());
  await p.goto(base + '/'); await shot('00-first-screen');
  await p.addInitScript(() => { try { localStorage.setItem('tikotak.onboarded', '1'); } catch {} });
  await p.goto(base + '/?start=1'); await shot('01-login');
  await p.getByLabel(/نام کاربری|Username/).fill('ada' + sx); await p.getByLabel(/رمز عبور|Password/).fill('test12345678');
  await p.getByRole('button', { name: /^(ورود|Sign in|Log in)$/ }).click(); await p.waitForTimeout(6000);
  await shot('02-chat-list');
  await step('03-dm', async () => { await tap(p.locator('button.room').filter({ hasText: /بابک/ }).first()); await p.waitForTimeout(1500); });
  await step('04-chat-info', async () => { await tap(p.locator('.chat-avatar').first()); await p.waitForTimeout(800); });
  await step('05-after-back', async () => { await p.goBack(); await p.waitForTimeout(500); await p.goBack(); await p.waitForTimeout(500); });
  await step('06-group', async () => { await tap(p.locator('button.room').filter({ hasText: /گروه دوستان/ }).first()); await p.waitForTimeout(1500); });
  await step('07-new-conv', async () => { await p.goto(base + '/'); await p.waitForTimeout(3000); await tap(p.getByTestId('new-conv')); await p.waitForTimeout(600); });
  await step('08-drawer', async () => { await p.goto(base + '/'); await p.waitForTimeout(3000); await tap(p.getByTestId('menu-btn')); await p.waitForTimeout(600); });
  await step('09-feed', async () => { await p.goto(base + '/'); await p.waitForTimeout(3000); await tap(p.locator('button', { hasText: /^(فید|Feed)$/ }).first()); await p.waitForTimeout(1500); });
  await step('10-explore', async () => { await tap(p.locator('button', { hasText: /^(کشف|اکسپلور|Explore)$/ }).first()); await p.waitForTimeout(1500); });
  await step('11-music', async () => { await tap(p.locator('button', { hasText: /^(موزیک|Music)$/ }).first()); await p.waitForTimeout(1500); });
  await step('12-profile-me', async () => { await tap(p.locator('button', { hasText: /^(من|Me)$/ }).first()); await p.waitForTimeout(1500); });
  await step('13-profile-other', async () => { await p.goto(base + '/'); await p.waitForTimeout(3000); await tap(p.locator('button', { hasText: /^(کشف|اکسپلور|Explore)$/ }).first()); await p.waitForTimeout(800); await p.locator('input').first().fill('bob' + sx); await p.waitForTimeout(1500); await tap(p.getByTestId('person').first()); await p.waitForTimeout(1500); });
  if (errs.length) console.log('PAGEERRORS', tag, errs.slice(0, 3));
  await c.close();
}
await run('phone-fa', { width: 390, height: 780 }, true, 'fa-IR');
await run('phone-en', { width: 390, height: 780 }, true, 'en-US');
await run('desk-fa', { width: 1280, height: 800 }, false, 'fa-IR');
await mk.close(); console.log('done', fs.readdirSync(out).filter((f) => f.endsWith('.png')).length, 'shots');
