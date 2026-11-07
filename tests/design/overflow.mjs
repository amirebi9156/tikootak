// Harden check: finds elements that overflow the viewport horizontally on narrow phones, per screen.
// Usage: cp to ~/tikootak-testenv/tools && node overflow.mjs   (test env running)
import { chromium } from 'playwright';
const base = 'http://localhost:8080', J = { 'content-type': 'application/json' };
const sx = Date.now().toString(36).slice(-3);
const code = async () => (await (await fetch(base + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': 'adminkey' }, body: JSON.stringify({ max_uses: 5, expires_days: 1 }) })).json()).code;
const reg = async (u) => (await (await fetch(base + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: await code(), username: u, password: 'test12345678' }) })).json());
const mx = async (t, m, p, b) => (await fetch(base + '/_matrix/client/v3' + p, { method: m, headers: { ...J, authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })).json();
const A = await reg('ovA' + sx), B = await reg('ovB' + sx);
await mx(B.access_token, 'PUT', `/profile/${encodeURIComponent(B.user_id)}/displayname`, { displayname: 'Wolfeschlegelsteinhausenbergerdorff-Pneumonoultramicroscopic محمدحسین‌زاده‌نژاد' });
const r = await mx(A.access_token, 'POST', '/createRoom', { name: 'Supercalifragilisticexpialidocious_group_with_an_extremely_long_name_without_spaces_at_all', preset: 'private_chat', invite: [B.user_id] });
await mx(B.access_token, 'POST', '/join/' + encodeURIComponent(r.room_id), {});
const L = ['https://example.com/' + 'a'.repeat(120), 'x'.repeat(90), '😀'.repeat(40), 'متن فارسی خیلی طولانی '.repeat(12)];
let i = 0; for (const b of L) await mx(B.access_token, 'PUT', `/rooms/${encodeURIComponent(r.room_id)}/send/m.room.message/o${i++}`, { msgtype: 'm.text', body: b });
const mk = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let bad = 0;
for (const w of [320, 360]) {
  const c = await mk.newContext({ viewport: { width: w, height: 700 }, locale: 'fa-IR', hasTouch: true, isMobile: true });
  const p = await c.newPage(); p.setDefaultTimeout(7000);
  await p.addInitScript(() => { try { localStorage.setItem('tikotak.onboarded', '1'); } catch {} });
  await p.goto(base + '/?start=1'); await p.getByLabel('نام کاربری').fill('ovA' + sx); await p.getByLabel('رمز عبور').fill('test12345678');
  await p.getByRole('button', { name: /^ورود$/ }).click(); await p.waitForTimeout(6000);
  const scan = async (name) => {
    const res = await p.evaluate(() => {
      const vw = innerWidth, out = [];
      const clipped = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && a !== document.documentElement && a !== document.body) return true; } return false; };
      document.querySelectorAll('body *').forEach((el) => { const b = el.getBoundingClientRect(); if (!b.width || !b.height) return; const cs = getComputedStyle(el); if (cs.position === 'fixed' && cs.visibility === 'hidden') return; if ((b.right > vw + 1 || b.left < -1) && !clipped(el)) out.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.')) + ' [' + Math.round(b.left) + ',' + Math.round(b.right) + ']'); });
      return { sw: document.documentElement.scrollWidth, vw, out: [...new Set(out)].slice(0, 6) };
    });
    const ok = res.sw <= res.vw + 1 && res.out.length === 0; if (!ok) bad++;
    console.log((ok ? 'PASS ' : 'FAIL ') + w + 'px ' + name + (ok ? '' : ' scrollW=' + res.sw + ' ' + JSON.stringify(res.out)));
  };
  const tap = (l) => l.tap();
  await scan('chat list');
  await tap(p.locator('button.room').first()); await p.waitForTimeout(1500); await scan('chat with long text');
  await tap(p.locator('.chat-avatar').first()); await p.waitForTimeout(900); await scan('chat info');
  await p.goBack(); await p.waitForTimeout(400); await p.goBack(); await p.waitForTimeout(500);
  await p.goto(base + '/'); await p.waitForTimeout(3500);
  await tap(p.getByTestId('new-conv')); await p.waitForTimeout(700); await scan('new group dialog');
  await p.goto(base + '/'); await p.waitForTimeout(3500);
  await tap(p.getByTestId('menu-btn')); await p.waitForTimeout(600); await scan('drawer');
  for (const [label, name] of [[/^(فید)$/, 'feed'], [/^(کشف)$/, 'explore'], [/^(موزیک)$/, 'music'], [/^(من)$/, 'profile']]) { await p.goto(base + '/'); await p.waitForTimeout(3000); await tap(p.locator('button:visible', { hasText: label }).first()); await p.waitForTimeout(1200); await scan(name); }
  await c.close();
}
await mk.close(); console.log(bad ? 'OVERFLOW ISSUES: ' + bad : 'NO OVERFLOW'); process.exitCode = bad ? 1 : 0;
