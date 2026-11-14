// Profile page (ChatInfo): Telegram-like action tiles, pull-down to a square full-width photo with glass buttons on it,
// and music tab rows that play in place. Needs the local test env (bash tests/env/start.sh) and ffmpeg.
// Usage (from a dir with `playwright` resolvable, e.g. ~/tikootak-testenv/tools):  MEDIA_DIR=/path/with/t1.mp3,t2.mp3  node profile-telegram.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const base = 'http://localhost:8080', J = { 'content-type': 'application/json' };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sx = Date.now().toString(36).slice(-3);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
const gen = (name, freq, sec, title, artist) => { const f = path.join(tmp, name); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${sec}`, '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, f]); return f; };
const mp3s = [gen('t1.mp3', 440, 8, 'Track One', 'Artist A'), gen('t2.mp3', 660, 7, 'Track Two', 'Artist B')];
const jpg = path.join(tmp, 'face.jpg');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=512x512:rate=1', '-frames:v', '1', jpg]);

async function code() { return (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': 'adminkey' }, body: JSON.stringify({ max_uses: 5, expires_days: 1 }) })).json()).code; }
const reg = async u => (await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: await code(), username: u, password: 'test12345678' }) })).json());
const mx = async (t, m, p, b) => (await fetch(base + '/_matrix/client/v3' + p, { method: m, headers: { ...J, authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })).json();
const A = await reg('pta' + sx), B = await reg('ptb' + sx);

// B gets a profile photo (so the DM header shows a real picture)
await fetch(base + '/api/profile/avatar', { method: 'PUT', headers: { authorization: 'Bearer ' + B.access_token, 'content-type': 'image/jpeg' }, body: fs.readFileSync(jpg) });
// DM room A<->B with m.direct
const r = await mx(A.access_token, 'POST', '/createRoom', { preset: 'trusted_private_chat', is_direct: true, invite: [B.user_id] });
await mx(B.access_token, 'POST', '/join/' + encodeURIComponent(r.room_id), {});
await mx(A.access_token, 'PUT', `/user/${encodeURIComponent(A.user_id)}/account_data/m.direct`, { [B.user_id]: [r.room_id] });
// B sends two songs
for (const [i, f] of mp3s.entries()) {
  const buf = fs.readFileSync(f);
  const up = await (await fetch(base + '/_matrix/media/v3/upload?filename=' + path.basename(f), { method: 'POST', headers: { authorization: 'Bearer ' + B.access_token, 'content-type': 'audio/mpeg' }, body: buf })).json();
  await mx(B.access_token, 'PUT', `/rooms/${encodeURIComponent(r.room_id)}/send/m.room.message/pt${i}`, { msgtype: 'm.audio', body: path.basename(f), url: up.content_uri, info: { mimetype: 'audio/mpeg', size: buf.length, duration: 8000 }, 'ir.tikootak.music': { title: i ? 'Track Two' : 'Track One', artist: i ? 'Artist B' : 'Artist A' } });
}

const mk = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
async function login(c) {
  const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('tikotak.onboarded', '1'); } catch { /* */ } });
  await p.goto(base + '/?start=1');
  await p.getByLabel('نام کاربری').fill('pta' + sx); await p.getByLabel('رمز عبور').fill('test12345678');
  await p.getByRole('button', { name: /^ورود$/ }).click();
  await p.waitForTimeout(6000);
  await p.locator('.sidebar button.room').first().click(); await p.waitForTimeout(1500);
  await p.locator('.chat-avatar').first().click(); await p.waitForTimeout(900);
  return p;
}
// real touch drag through CDP
async function drag(p, x, y0, y1, steps = 14) {
  const cdp = await p.context().newCDPSession(p);
  const t = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await t('touchStart', y0);
  for (let i = 1; i <= steps; i++) { await t('touchMove', y0 + ((y1 - y0) * i) / steps); await p.waitForTimeout(16); }
  await t('touchEnd', y1);
  await p.waitForTimeout(650);
}
const box = (p, sel) => p.locator(sel).first().boundingBox();

// ---------------- phone ----------------
{
  const c = await mk.newContext({ viewport: { width: 390, height: 780 }, locale: 'fa-IR', hasTouch: true, isMobile: true });
  const p = await login(c);
  ok(await p.getByTestId('chat-info').isVisible(), 'phone: profile page opens');
  ok(await p.locator('.cinfo.big').count() === 0, 'phone: starts collapsed (round avatar)');

  // Telegram-like tiles
  const acts = await p.locator('.cinfo .ci-act').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const svg = e.querySelector('svg'); return { w: r.width, h: r.height, fs: parseFloat(cs.fontSize), radius: parseFloat(cs.borderTopLeftRadius), fill: svg && getComputedStyle(svg).fill, ico: svg && svg.getBoundingClientRect().width }; }));
  ok(acts.length === 4, 'phone: four action tiles (message, mute, call, video)');
  ok(acts.every(a => a.h >= 52 && a.h <= 64), 'phone: tile height is Telegram-sized (~58px): ' + acts.map(a => Math.round(a.h)).join(','));
  ok(acts.every(a => a.fs <= 13.5 && a.ico <= 24), 'phone: small label (<=13px) and icon (<=24px)');
  ok(acts.every(a => a.fill && a.fill !== 'none'), 'phone: icons are filled like Telegram');

  // short pull: must NOT expand
  await drag(p, 195, 260, 320);
  ok(await p.locator('.cinfo.big').count() === 0, 'phone: a short pull does not expand');
  // long pull: expands to a square photo, full width
  // sample the header height every frame while pulling + releasing: it must grow gradually (no one-frame jump)
  const samplesP = p.evaluate(() => new Promise(res => { const out = []; const t0 = performance.now(); const h = () => document.querySelector('.cinfo .ci-head')?.getBoundingClientRect().height || 0;
    const tick = () => { out.push(Math.round(h())); if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else res(out); }; tick(); }));
  await drag(p, 195, 220, 520);
  ok(await p.locator('.cinfo.big').count() === 1, 'phone: pulling down expands the photo');
  const hs = await samplesP; const lo = Math.min(...hs), hi = Math.max(...hs);
  const mid = new Set(hs.filter(v => v > lo + 8 && v < hi - 8)).size;
  ok(hi - lo > 60 && mid >= 3, `phone: header height animates smoothly (min ${lo}, max ${hi}, ${mid} in-between frames)`);
  const head = await box(p, '.cinfo.big .ci-head');
  ok(head && head.x <= 1 && Math.abs(head.width - 390) <= 2 && Math.abs(head.height - head.width) <= 3, `phone: header is a full-width square (${Math.round(head?.width)}x${Math.round(head?.height)})`);
  const av = await box(p, '.cinfo.big .ci-avatar');
  ok(av && Math.abs(av.width - head.width) <= 2 && Math.abs(av.height - head.height) <= 2, 'phone: photo fills the header');
  const img = await p.locator('.cinfo.big .ci-avatar img').first().evaluate(i => ({ w: i.naturalWidth, br: getComputedStyle(i).borderTopLeftRadius })).catch(() => null);
  ok(img && img.w > 0 && img.br === '0px', 'phone: real photo is shown square (no rounding)');
  const tiles = await p.locator('.cinfo.big .ci-act').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, bf: getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter }; }));
  ok(tiles.every(t => t.t >= head.y && t.b <= head.y + head.height), 'phone: all four buttons sit on top of the photo');
  ok(tiles.every(t => /blur/.test(t.bf)), 'phone: buttons are glass (backdrop blur)');
  const nm = await box(p, '.cinfo.big .ci-hero h2');
  ok(nm && nm.y > head.y + head.height * 0.4 && nm.y + nm.height <= tiles[0].t + 1, 'phone: name/status overlay the lower part of the photo above the buttons');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: no horizontal overflow');
  await p.screenshot({ path: path.join(tmp, 'phone-big.png') });

  // drag up at the top collapses
  await drag(p, 195, 520, 330);
  ok(await p.locator('.cinfo.big').count() === 0, 'phone: dragging up collapses back to the round avatar');
  const av2 = await box(p, '.ci-avatar');
  ok(av2 && Math.abs(av2.width - 124) <= 3, 'phone: collapsed avatar is 124px again');
  await p.screenshot({ path: path.join(tmp, 'phone-small.png') });

  // music tab: tap plays in place
  await p.getByRole('tab', { name: /موزیک/ }).click(); await p.waitForTimeout(500);
  ok(await p.getByTestId('info-track').count() === 2, 'phone: music tab lists both songs as playable rows');
  await p.getByTestId('info-track').first().click(); await p.waitForTimeout(2500);
  let st = await p.evaluate(() => { const a = document.querySelector('audio:not(.voice-el)'); return a ? { t: a.currentTime, paused: a.paused } : null; });
  ok(!!st && !st.paused && st.t > 0, 'phone: tapping a song in the profile plays it (without opening the chat)');
  ok(await p.getByTestId('chat-info').isVisible(), 'phone: still on the profile page while playing');
  ok(await p.locator('.ci-track.on').count() === 1, 'phone: playing row is highlighted');
  await p.getByTestId('info-track').first().click(); await p.waitForTimeout(500);
  st = await p.evaluate(() => document.querySelector('audio:not(.voice-el)')?.paused);
  ok(st === true, 'phone: tapping the playing row pauses it');
  await p.getByTestId('info-track').nth(1).click(); await p.waitForTimeout(2500);
  const t2 = await p.evaluate(() => { const a = document.querySelector('audio:not(.voice-el)'); return { paused: a.paused, t: a.currentTime }; });
  ok(!t2.paused && t2.t > 0, 'phone: tapping another song switches to it');
  await p.screenshot({ path: path.join(tmp, 'phone-music.png') });
  await c.close();
}
// ---------------- desktop: click the avatar toggles ----------------
{
  const c = await mk.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' });
  const p = await login(c);
  await p.getByTestId('chat-info-avatar').click(); await p.waitForTimeout(600);
  ok(await p.locator('.cinfo.big').count() === 1, 'desktop: clicking the avatar expands the photo');
  const h = await box(p, '.cinfo.big .ci-head');
  ok(h && h.height <= 800 * 0.78 + 2 && h.width <= 640 + 2, `desktop: header stays within the 640px column and 78% of the height (${Math.round(h.width)}x${Math.round(h.height)})`);
  const want = Math.min(640, 800 * 0.78);
  ok(Math.abs(h.height - want) <= 3, `desktop: header is not squeezed by the flex column (${Math.round(h.height)} ~ ${Math.round(want)})`);
  const tb = await box(p, '.cinfo .ci-tabs');
  ok(tb && tb.height >= 50, `desktop: tabs bar keeps its full height (${Math.round(tb?.height)}px)`);
  await p.screenshot({ path: path.join(tmp, 'desktop-big.png') });
  await p.getByTestId('chat-info-avatar').click(); await p.waitForTimeout(600);
  ok(await p.locator('.cinfo.big').count() === 0, 'desktop: clicking again collapses');
  await c.close();
}
await mk.close();
console.log('screenshots:', tmp);
