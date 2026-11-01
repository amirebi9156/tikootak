'use strict';
const $ = (s) => document.querySelector(s);
for (const m of ['replaceChildren', 'append']) { const o = Element.prototype[m]; Element.prototype[m] = function (...a) { return o.apply(this, a.filter((x) => x != null && x !== false)); }; }
let KEY = '';
try { KEY = sessionStorage.getItem('adm') || ''; } catch { /* خالی */ }
const el = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(2)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/admin' + path, { method, headers: { 'x-admin-key': KEY, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 || r.status === 403) throw new Error('کلید اشتباه است');
  if (r.status === 404) throw new Error('IP شما برای پنل ادمین مجاز نیست (ADMIN_ALLOW_IPS در فایل .env) / Your IP is not allowed (ADMIN_ALLOW_IPS)');
  if (r.status === 429) throw new Error('تلاش زیاد؛ کمی صبر کن');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}
const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
const bytes = (n) => { n = Number(n) || 0; if (n >= 1073741824) return fa(+(n / 1073741824).toFixed(1)) + ' GB'; if (n >= 1048576) return fa(Math.round(n / 1048576)) + ' MB'; return fa(Math.round(n / 1024)) + ' KB'; };
const when = (t) => (t ? new Date(t * 1000).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ago = (t) => { if (!t) return '—'; const s = Date.now() / 1000 - t; if (s < 90) return 'همین الان'; if (s < 3600) return fa(Math.floor(s / 60)) + ' دقیقه پیش'; if (s < 86400) return fa(Math.floor(s / 3600)) + ' ساعت پیش'; return fa(Math.floor(s / 86400)) + ' روز پیش'; };
const short = (u) => String(u || '').replace(/^@/, '').split(':')[0];
const U = (u) => el('bdi', { dir: 'ltr' }, short(u));
const REASON = { spam: 'اسپم', abuse: 'توهین/آزار', nudity: 'محتوای نامناسب', violence: 'خشونت', other: 'سایر' };
const KIND = { post: 'پست', comment: 'نظر', user: 'کاربر', story: 'استوری', track: 'آهنگ' };
const ALERT = {
  disk: (a) => `دیسک سرور ${fa(a.value)}٪ پر است؛ بزودی فضا کم می‌شود. سرور بزرگ‌تر بگیر یا ثبت‌نام را ببند.`,
  mem: (a) => `حافظهٔ سرور ${fa(a.value)}٪ مصرف شده است.`,
  user_cap: (a) => `تعداد کاربران به ${fa(a.value)} رسید و به سقفی که تنظیم کرده‌ای نزدیک است.`,
  signup_burst: (a) => `${fa(a.value)} ثبت‌نام در یک ساعت گذشته؛ اگر عادی نیست ثبت‌نام را ببند.`,
  reports: (a) => `${fa(a.value)} گزارش باز منتظر رسیدگی است.`,
};
function toast(msg) { const t = el('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
function ask(title, body, { ok = 'تأیید', danger = false, boxes = [] } = {}) {
  return new Promise((res) => {
    const checks = boxes.map((b) => ({ ...b, input: el('input', { type: 'checkbox', checked: b.on }) }));
    const done = (v) => { m.remove(); res(v); };
    const m = el('div', { class: 'modal', onclick: (e) => { if (e.target === m) done(null); } },
      el('div', { class: 'p' }, el('h3', {}, title), el('div', { class: 'mut', style: 'white-space:pre-line' }, body),
        checks.map((c) => el('label', { class: 'row', style: 'margin-top:10px;cursor:pointer' }, c.input, c.label)),
        el('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end' },
          el('button', { onclick: () => done(null) }, 'انصراف'),
          el('button', { class: danger ? 'red solid' : 'pri', onclick: () => done(Object.fromEntries(checks.map((c) => [c.key, c.input.checked]))) }, ok))));
    document.body.append(m);
  });
}
function lightbox(p) {
  const l = el('div', { class: 'light', onclick: () => l.remove() },
    p.kind === 'video' ? el('video', { src: p.url, controls: true, autoplay: true, playsinline: true, onclick: (e) => e.stopPropagation() }) : el('img', { src: p.url }));
  document.body.append(l);
}
const meter = (v, max, cls) => { const p = max ? Math.min(100, (v / max) * 100) : 0; return el('div', { class: 'meter ' + (cls || (p > 90 ? 'crit' : p > 70 ? 'warn' : '')) }, el('i', { style: `width:${p}%` })); };

/* ---------- قفل ثبت‌نام ---------- */
let REG = null;
function drawPill() {
  const p = $('#regpill'); p.replaceChildren();
  if (!REG) return;
  const why = { manual: 'بسته (دستی)', user_cap: 'بسته (سقف کاربر)', daily_cap: 'بسته (سقف روزانه)' }[REG.reason];
  p.append(el('span', { class: 'pill ' + (REG.open ? 'ok' : 'off') }, el('span', { class: 'dot' }), REG.open ? 'ثبت‌نام باز' : why),
    ' ', el('button', { class: 'sm ' + (REG.open ? 'red' : 'pri'), onclick: toggleReg }, REG.open ? 'توقف ثبت‌نام' : 'باز کردن ثبت‌نام'));
}
async function toggleReg() {
  const opening = !REG.open;
  if (!opening) { const r = await ask('ثبت‌نام بسته شود؟', 'تا وقتی دوباره باز نکنی هیچ‌کس با هیچ کد دعوتی نمی‌تواند حساب بسازد. کاربران فعلی تحت تأثیر نیستند و کدهای دعوت شخصی هم کار نمی‌کنند.', { ok: 'بستن ثبت‌نام', danger: true }); if (!r) return; }
  else if (REG.reason !== 'manual') { toast('این بسته‌شدن به‌خاطر سقف خودکار است؛ سقف را در تب تنظیمات بالا ببر.'); return; }
  await api('/settings', 'POST', { registration_open: opening });
  toast(opening ? 'ثبت‌نام باز شد' : 'ثبت‌نام بسته شد'); refreshReg(); show();
}
async function refreshReg() { try { const s = await api('/settings'); REG = s.status; drawPill(); } catch { /* مهم نیست */ } }

/* ---------- تب‌ها ---------- */
const TABS = [['overview', 'نمای کلی'], ['users', 'کاربران'], ['content', 'محتوا'], ['reports', 'گزارش‌ها'], ['tree', 'دعوت‌ها'], ['settings', 'تنظیمات'], ['uploads', 'ارسال فایل'], ['audit', 'لاگ']];
let tab = 'overview'; let openReports = 0;
function drawTabs() {
  const t = $('#tabs'); t.replaceChildren();
  for (const [id, label] of TABS) t.append(el('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; show(); } }, label, id === 'reports' && openReports ? el('span', { class: 'n' }, fa(openReports)) : null));
}
async function show() {
  const v = $('#view'); v.replaceChildren(el('p', { class: 'mut' }, 'در حال بارگذاری…'));
  drawTabs();
  try { const node = await VIEWS[tab](); v.replaceChildren(node); } catch (e) { v.replaceChildren(el('div', { class: 'card' }, 'خطا: ' + e.message)); }
}

const VIEWS = {
  /* ===== نمای کلی ===== */
  async overview() {
    const o = await api('/overview'); REG = o.registration; drawPill(); openReports = o.open_reports; drawTabs();
    const w = el('div');
    for (const a of o.alerts) w.append(el('div', { class: 'alert ' + a.level }, el('span', {}, a.level === 'crit' ? '🔴' : a.level === 'warn' ? '🟠' : 'ℹ️'), el('span', {}, (ALERT[a.code] || (() => a.code))(a))));
    const diskPct = o.disk ? Math.round((o.disk.used / o.disk.total) * 100) : 0;
    const cap = o.registration.settings.user_cap;
    w.append(el('div', { class: 'grid' },
      stat('کاربران', fa(o.users), cap ? `از سقف ${fa(cap)}` : o.banned ? `${fa(o.banned)} مسدود` : ''),
      stat('فعال در ۲۴ ساعت', fa(o.active_24h)),
      stat('ثبت‌نام جدید', fa(o.signups_24h), `${fa(o.signups_1h)} در ساعت گذشته`),
      stat('پست', fa(o.posts), `${fa(o.comments)} نظر · ${fa(o.stories)} استوری`),
      stat('آهنگ', fa(o.tracks)),
      stat('گزارش باز', fa(o.open_reports), o.open_reports ? 'نیاز به رسیدگی' : 'تمیز'),
    ));
    const sys = o.system;
    const mediaTot = Object.values(o.media).reduce((a, b) => a + b, 0);
    const cols = [['feed', 'فید', 'var(--ink)'], ['music', 'موزیک', 'var(--blue)'], ['stories', 'استوری', 'var(--amber)'], ['avatars', 'آواتار', 'var(--ok)']];
    w.append(el('div', { class: 'cols' },
      el('div', {},
        el('div', { class: 'card' }, el('h3', {}, 'ظرفیت سرور'),
          o.disk ? el('div', {}, el('div', { class: 'row' }, el('span', {}, `دیسک: ${bytes(o.disk.used)} از ${bytes(o.disk.total)}`), el('span', { class: 'sp' }), el('b', {}, fa(diskPct) + '٪')), meter(o.disk.used, o.disk.total), el('p', { class: 'dim' }, `فضای آزاد: ${bytes(o.disk.free)}`)) : el('p', { class: 'dim' }, 'اطلاعات دیسک در دسترس نیست'),
          el('div', { class: 'row' }, el('span', {}, `حافظه: ${bytes(sys.mem_total - sys.mem_free)} از ${bytes(sys.mem_total)}`)), meter(sys.mem_total - sys.mem_free, sys.mem_total),
          el('p', { class: 'dim' }, `بار CPU: ${sys.load1.toFixed(2)} روی ${fa(sys.cpus)} هسته · روشن از ${fa(Math.floor(sys.uptime / 86400))} روز پیش`)),
        el('div', { class: 'card' }, el('h3', {}, 'فضای رسانه'),
          el('div', { class: 'stack' }, cols.map(([k, , c]) => el('i', { style: `width:${mediaTot ? (o.media[k] / mediaTot) * 100 : 0}%;background:${c}` }))),
          el('div', { class: 'legend' }, cols.map(([k, l, c]) => el('span', {}, el('b', { style: 'background:' + c }), `${l} ${bytes(o.media[k])}`)), el('span', {}, `پایگاه‌داده ${bytes(o.db_bytes)}`)),
          el('p', { class: 'dim' }, `سقف هر کاربر: ${bytes(o.quota_bytes)}`)),
        el('div', { class: 'card' }, el('h3', {}, 'ثبت‌نام ۱۴ روز اخیر'),
          el('div', { class: 'spark' }, ((m) => o.days.map((d) => el('div', {}, el('span', { class: 'dim' }, d.signups ? fa(d.signups) : ''), el('i', { style: `height:${m ? (d.signups / m) * 70 : 0}%` }), el('small', {}, new Date(d.day * 1000).toLocaleDateString('fa-IR', { day: 'numeric' })))))(Math.max(1, ...o.days.map((d) => d.signups)))))),
      el('div', {},
        el('div', { class: 'card' }, el('h3', {}, 'بیشترین مصرف'),
          o.top_users.map((u) => el('div', { style: 'margin-bottom:10px;cursor:pointer', onclick: () => openUser(u.user_id) }, el('div', { class: 'row' }, el('span', { class: 'u' }, U(u.user_id)), el('span', { class: 'sp' }), el('span', { class: 'mut' }, bytes(u.bytes))), meter(u.bytes, o.quota_bytes)))),
        quick(o))));
    return w;
  },
  /* ===== کاربران ===== */
  async users() {
    const d = await api('/users'); const quota = d.quota_bytes;
    let q = ''; let sort = 'new'; let flt = '';
    const wrap = el('div'); const tb = el('tbody'); const count = el('span', { class: 'dim' });
    const search = el('input', { placeholder: 'جستجوی نام کاربری…', dir: 'ltr', oninput: () => { q = search.value.trim().toLowerCase(); draw(); }, style: 'flex:1;min-width:160px' });
    const sel = el('select', { onchange: () => { sort = sel.value; draw(); } }, ...[['new', 'جدیدترین'], ['bytes', 'بیشترین حجم'], ['active', 'آخرین فعالیت'], ['invited', 'بیشترین دعوت'], ['reports', 'بیشترین گزارش']].map(([v, l]) => el('option', { value: v }, l)));
    const fs = el('select', { onchange: () => { flt = fs.value; draw(); } }, ...[['', 'همه'], ['banned', 'مسدودها'], ['new', 'جدید (۳ روز)'], ['near', 'نزدیک سهمیه'], ['reported', 'گزارش‌دار'], ['inactive', 'غیرفعال ۱۸۰ روز']].map(([v, l]) => el('option', { value: v }, l)));
    const draw = () => {
      const t = Date.now() / 1000;
      let r = d.users.filter((u) => (!q || short(u.user_id).includes(q) || (u.name || '').includes(q)));
      if (flt === 'banned') r = r.filter((u) => u.banned); if (flt === 'new') r = r.filter((u) => t - u.created_at < 3 * 86400);
      if (flt === 'near') r = r.filter((u) => u.bytes > quota * 0.7); if (flt === 'reported') r = r.filter((u) => u.open_reports);
      if (flt === 'inactive') r = r.filter((u) => t - (u.last_active || u.created_at) > 180 * 86400);
      const key = { new: (u) => u.created_at, bytes: (u) => u.bytes, active: (u) => u.last_active, invited: (u) => u.invited, reports: (u) => u.open_reports }[sort];
      r = r.slice().sort((a, b) => key(b) - key(a));
      count.textContent = `${fa(r.length)} از ${fa(d.users.length)}`;
      tb.replaceChildren(...r.slice(0, 400).map((u) => el('tr', { onclick: () => openUser(u.user_id) },
        el('td', {}, el('span', { class: 'u' }, U(u.user_id)), u.banned ? el('span', { class: 'tag hot', style: 'margin-inline-start:6px' }, 'مسدود') : null, t - u.created_at < 86400 ? el('span', { class: 'tag warn', style: 'margin-inline-start:6px' }, 'تازه') : null),
        el('td', { class: 'mut' }, u.inviter ? U(u.inviter) : el('span', { class: 'dim' }, u.invite_code ? 'ادمین' : '—')),
        el('td', {}, u.invited ? fa(u.invited) : '·'),
        el('td', { style: 'min-width:130px' }, el('div', { class: 'row', style: 'flex-wrap:nowrap' }, el('div', { style: 'flex:1' }, meter(u.bytes, quota)), el('span', { class: 'dim' }, bytes(u.bytes)))),
        el('td', {}, fa(u.posts)), el('td', {}, fa(u.comments)),
        el('td', { class: 'mut' }, ago(u.last_active)), el('td', {}, u.open_reports ? el('span', { class: 'tag hot' }, fa(u.open_reports)) : ''))));
    };
    draw();
    wrap.append(el('div', { class: 'card row' }, search, sel, fs, count),
      el('div', { class: 'card scroll', style: 'padding:0' }, el('table', {}, el('thead', {}, el('tr', {}, ...['کاربر', 'دعوت از', 'دعوت‌شده', 'مصرف', 'پست', 'نظر', 'فعالیت', 'گزارش'].map((h) => el('th', {}, h)))), tb)));
    return wrap;
  },
  /* ===== محتوا ===== */
  async content() {
    const wrap = el('div'); const grid = el('div', { class: 'pgrid' }); const more = el('button', { hidden: true }, 'بیشتر…');
    const f = { kind: '', sort: 'new', fresh: false, reported: false, q: '', user: '' };
    const sel = new Set(); const bulk = el('button', { class: 'red solid', hidden: true });
    let next = null; let sub = 'posts';
    const mk = (opts) => el('select', { onchange: opts.on }, ...opts.o.map(([v, l]) => el('option', { value: v }, l)));
    const kind = mk({ o: [['', 'همه'], ['image', 'عکس'], ['video', 'ویدیو']], on: (e) => { f.kind = e.target.value; reset(); } });
    const sort = mk({ o: [['new', 'جدیدترین'], ['popular', 'پربازدیدترین (اکسپلور)']], on: (e) => { f.sort = e.target.value; reset(); } });
    const fresh = el('label', { class: 'row' }, el('input', { type: 'checkbox', onchange: (e) => { f.fresh = e.target.checked; reset(); } }), 'فقط حساب‌های تازه (۳ روز)');
    const rep = el('label', { class: 'row' }, el('input', { type: 'checkbox', onchange: (e) => { f.reported = e.target.checked; reset(); } }), 'گزارش‌دار');
    const qi = el('input', { placeholder: 'جستجو در کپشن…', onchange: () => { f.q = qi.value.trim(); reset(); } });
    const ui = el('input', { placeholder: 'کاربر مشخص (نام کاربری)', dir: 'ltr', onchange: () => { f.user = ui.value.trim().replace(/^@/, '').split(':')[0]; reset(); } });
    function qs(before) {
      const p = new URLSearchParams(); if (f.kind) p.set('kind', f.kind); if (f.sort === 'popular') p.set('sort', 'popular');
      if (f.fresh) p.set('new', '1'); if (f.reported) p.set('reported', '1'); if (f.q) p.set('q', f.q); if (before) p.set('before', before); if (f.user) p.set('user', f.user);
      return p.toString();
    }
    function card(p) {
      const c = el('div', { class: 'post' });
      const media = p.kind === 'video' && !p.thumb ? el('video', { class: 'm', src: p.url, preload: 'metadata', muted: true }) : el('img', { class: 'm', src: p.thumb || p.url, loading: 'lazy', alt: '' });
      media.addEventListener('click', () => lightbox(p));
      const ck = el('input', { type: 'checkbox', class: 'ck', onchange: (e) => { e.target.checked ? sel.add(p.id) : sel.delete(p.id); c.classList.toggle('sel', e.target.checked); upBulk(); } });
      c.append(media, ck, el('div', { class: 'pv' }, p.kind === 'video' ? el('span', { class: 'tag' }, '▶') : null, p.reports ? el('span', { class: 'tag hot' }, fa(p.reports) + ' گزارش') : null, p.owner_banned ? el('span', { class: 'tag hot' }, 'مسدود') : null, Date.now() / 1000 - p.owner_joined < 3 * 86400 ? el('span', { class: 'tag' }, 'حساب تازه') : null),
        el('div', { class: 'b' }, el('div', { class: 'row' }, el('b', { class: 'u', style: 'cursor:pointer', onclick: () => openUser(p.user_id) }, U(p.user_id)), el('span', { class: 'sp' }), el('span', { class: 'dim' }, ago(p.created_at))),
          p.caption ? el('div', { class: 'cap' }, p.caption) : null,
          el('div', { class: 'dim' }, `♥ ${fa(p.likes)} · 💬 ${fa(p.comments)} · ${bytes(p.size)}`),
          el('div', { class: 'acts' }, el('button', { class: 'red', onclick: async () => { await api('/posts/' + p.id, 'DELETE'); c.remove(); toast('پست حذف شد'); } }, 'حذف'),
            el('button', { class: 'red', onclick: () => openUser(p.user_id, true) }, 'بن کامل'))));
      return c;
    }
    function upBulk() { bulk.hidden = !sel.size; bulk.textContent = `حذف ${fa(sel.size)} پست انتخاب‌شده`; }
    bulk.onclick = async () => { const ok = await ask('حذف گروهی', `${fa(sel.size)} پست حذف شود؟`, { danger: true, ok: 'حذف' }); if (!ok) return; const r = await api('/posts/bulk-delete', 'POST', { ids: [...sel] }); toast(`${fa(r.deleted)} پست حذف شد`); sel.clear(); reset(); };
    async function load(before) {
      const d = await api('/moderation/posts?' + qs(before));
      if (!before) grid.replaceChildren(); d.posts.forEach((p) => grid.append(card(p)));
      next = d.next; more.hidden = !next;
      if (!grid.children.length) grid.append(el('p', { class: 'mut' }, 'موردی پیدا نشد.'));
    }
    function reset() { sel.clear(); upBulk(); load(); }
    more.onclick = () => load(next);
    const postsBox = el('div', {}, el('div', { class: 'card row' }, kind, sort, fresh, rep, qi, ui, el('span', { class: 'sp' }), bulk), grid, el('div', { class: 'row', style: 'justify-content:center;margin:14px' }, more));
    const comBox = el('div', { hidden: true });
    async function loadComments() {
      const d = await api('/moderation/comments?limit=120'); comBox.replaceChildren(el('div', { class: 'card', style: 'padding:0' }, el('div', { class: 'scroll' }, el('table', {}, el('tbody', {}, d.comments.map((c) => el('tr', { style: 'cursor:default' },
        el('td', {}, el('b', { class: 'u', style: 'cursor:pointer', onclick: () => openUser(c.user_id) }, U(c.user_id)), c.owner_banned ? el('span', { class: 'tag hot', style: 'margin-inline-start:6px' }, 'مسدود') : null),
        el('td', { style: 'white-space:normal;min-width:200px' }, c.text), el('td', { class: 'dim' }, ago(c.created_at)),
        el('td', {}, el('button', { class: 'sm red', onclick: async (e) => { await api('/comments/' + c.id, 'DELETE'); e.target.closest('tr').remove(); } }, 'حذف')))))))));
    }
    const tabs = el('div', { class: 'row', style: 'margin-bottom:12px' },
      ...[['posts', 'پست‌ها و اکسپلور'], ['comments', 'نظرها']].map(([id, l]) => el('button', { class: id === sub ? 'pri' : '', onclick: (e) => { sub = id; postsBox.hidden = id !== 'posts'; comBox.hidden = id !== 'comments'; [...tabs.children].forEach((b) => b.classList.remove('pri')); e.target.classList.add('pri'); if (id === 'comments') loadComments(); } }, l)));
    wrap.append(tabs, postsBox, comBox); await load();
    return wrap;
  },
  /* ===== گزارش‌ها ===== */
  async reports() {
    const wrap = el('div'); let status = 'open'; const body = el('div');
    const load = async () => {
      body.replaceChildren(el('p', { class: 'mut' }, '…'));
      const d = await api('/reports?status=' + status); openReports = d.open_total; drawTabs(); body.replaceChildren();
      if (!d.reports.length) body.append(el('div', { class: 'card mut' }, status === 'open' ? 'گزارش بازی نیست 🎉' : 'گزارش بسته‌ای نیست.'));
      for (const r of d.reports) body.append(reportCard(r, load));
    };
    wrap.append(el('div', { class: 'row', style: 'margin-bottom:12px' }, el('button', { onclick: () => { status = 'open'; load(); } }, 'باز'), el('button', { onclick: () => { status = 'closed'; load(); } }, 'بسته‌شده')), body);
    await load(); return wrap;
  },
  /* ===== دعوت‌ها و درخت ===== */
  async tree() {
    const [t, inv] = await Promise.all([api('/invites/tree'), api('/invites')]);
    const kids = new Map(); const byId = new Map();
    for (const n of t.nodes) { byId.set(n.user_id, n); const k = n.inviter || '__root'; (kids.get(k) || kids.set(k, []).get(k)).push(n); }
    const count = (u) => (kids.get(u) || []).reduce((a, c) => a + 1 + count(c.user_id), 0);
    const open = new Set();
    const box = el('div', { class: 'tree' });
    const nodeEl = (n) => {
      const ch = kids.get(n.user_id) || []; const li = el('li');
      const tg = el('span', { class: 'tg', onclick: () => { open.has(n.user_id) ? open.delete(n.user_id) : open.add(n.user_id); draw(); } }, ch.length ? (open.has(n.user_id) ? '▾' : '◂') : '·');
      li.append(tg, el('span', { class: 'n', onclick: () => openUser(n.user_id) }, el('b', { class: 'u' }, U(n.user_id)), n.banned ? el('span', { class: 'tag hot' }, 'مسدود') : null, ch.length ? el('span', { class: 'dim' }, `${fa(ch.length)} نفر مستقیم · ${fa(count(n.user_id))} در کل`) : null));
      if (ch.length && open.has(n.user_id)) li.append(el('ul', {}, ch.map(nodeEl)));
      return li;
    };
    const draw = () => {
      const roots = (kids.get('__root') || []);
      const owners = roots.filter((r) => kids.get(r.user_id));
      box.replaceChildren(el('ul', {}, el('li', {}, el('span', { class: 'dim' }, `دعوت مستقیم ادمین (${fa(roots.length)} نفر) — فقط کسانی که خودشان کسی را آورده‌اند:`)),
        ...owners.map(nodeEl), owners.length ? null : el('li', { class: 'dim' }, 'هنوز کسی با کد شخصی کسی را دعوت نکرده است.')));
    };
    draw();
    const wrap = el('div'); const out = el('p', { class: 'mut', dir: 'ltr', style: 'font-weight:600' });
    const uses = el('input', { type: 'number', value: '1', min: '1', max: '1000', style: 'width:80px' }); const days = el('input', { type: 'number', value: '7', min: '0', max: '365', style: 'width:80px' }); const note = el('input', { placeholder: 'یادداشت' });
    const list = el('tbody');
    for (const i of inv) {
      const exp = i.expires_at && i.expires_at < Date.now() / 1000;
      list.append(el('tr', { style: 'cursor:default' }, el('td', { dir: 'ltr', style: 'font-family:monospace' }, i.code), el('td', {}, i.owner ? U(i.owner) : el('span', { class: 'dim' }, 'ادمین')),
        el('td', {}, `${fa(i.uses)}/${fa(i.max_uses)}`), el('td', {}, (i.used_by || '').split(',').filter(Boolean).map((u) => el('span', { class: 'chip', onclick: () => openUser(u), style: 'margin-inline-end:4px' }, U(u)))),
        el('td', {}, i.revoked ? el('span', { class: 'tag hot' }, 'باطل') : exp ? el('span', { class: 'tag' }, 'منقضی') : i.uses >= i.max_uses ? el('span', { class: 'tag' }, 'پر') : el('span', { class: 'tag ok' }, 'فعال')),
        el('td', {}, !i.revoked && !exp ? el('button', { class: 'sm red', onclick: async () => { await api('/invites/' + i.code, 'DELETE'); show(); } }, 'ابطال') : '')));
    }
    wrap.append(el('div', { class: 'card' }, el('h3', {}, 'درخت دعوت (چه کسی چه کسی را آورد)'), box),
      el('div', { class: 'card' }, el('h3', {}, 'ساخت کد دعوت'), el('div', { class: 'row' }, 'تعداد استفاده', uses, 'روز اعتبار (۰ = بدون انقضا)', days, note,
        el('button', { class: 'pri', onclick: async () => { const d = await api('/invites', 'POST', { max_uses: Number(uses.value) || 1, expires_days: Number(days.value) || 0, note: note.value }); out.textContent = d.code; try { await navigator.clipboard.writeText(d.code); toast('کد ساخته و کپی شد'); } catch { toast('کد ساخته شد'); } } }, 'ساخت')), out),
      el('div', { class: 'card', style: 'padding:0' }, el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...['کد', 'صاحب', 'مصرف', 'استفاده‌کننده', 'وضعیت', ''].map((h) => el('th', {}, h)))), list))));
    return wrap;
  },
  /* ===== تنظیمات ===== */
  async settings() {
    const s = await api('/settings'); REG = s.status; drawPill();
    const f = (label, hint, input) => el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('span', { class: 'dim' }, hint) : null);
    const cap = el('input', { type: 'number', min: '0', value: s.user_cap }); const day = el('input', { type: 'number', min: '0', value: s.daily_cap });
    const q = el('input', { type: 'number', min: '0', max: '50', value: s.user_invite_quota }); const msg = el('input', { maxlength: '200', value: s.closed_message, placeholder: 'مثلاً: ظرفیت فعلاً پر است' });
    return el('div', { class: 'card', style: 'max-width:620px' }, el('h3', {}, 'کنترل ثبت‌نام و ظرفیت'),
      el('p', { class: 'mut', style: 'margin-top:0' }, 'وضعیت فعلی: ', el('b', {}, s.status.open ? 'باز' : 'بسته'), '. برای بستن فوری از دکمهٔ بالای صفحه استفاده کن.'),
      f('سقف کل کاربران (۰ = بدون سقف)', 'وقتی تعداد کاربران به این عدد برسد ثبت‌نام خودکار بسته می‌شود؛ مثلاً به اندازهٔ ظرفیت سرورت.', cap),
      f('سقف ثبت‌نام در ۲۴ ساعت (۰ = بدون سقف)', 'اگر یک‌دفعه هجوم آمد، ثبت‌نام خودکار متوقف می‌شود.', day),
      f('تعداد کد دعوت فعال هر کاربر (۰ = کاربران نتوانند کد بسازند)', 'کاربران بعد از ۲۴ ساعت از ثبت‌نام می‌توانند کد یک‌بارمصرف بسازند؛ همه در درخت دعوت ثبت می‌شود.', q),
      f('پیام نمایش‌داده‌شده هنگام بسته بودن ثبت‌نام', '', msg),
      el('button', { class: 'pri', onclick: async () => { await api('/settings', 'POST', { user_cap: cap.value, daily_cap: day.value, user_invite_quota: q.value, closed_message: msg.value }); toast('ذخیره شد'); refreshReg(); } }, 'ذخیره'));
  },
  /* ===== کنترل ارسال فایل/موزیک/... ===== */
  async uploads() {
    const p = await api('/upload-policy');
    const NAMES = { image: 'تصویر', video: 'ویدیو', voice: 'پیام صوتی', music: 'موزیک', file: 'فایل و سایر' };
    const MODES = [['all', 'همه'], ['none', 'هیچ‌کس'], ['users', 'فقط کاربران خاص']];
    const rows = {};
    const card = el('div', { class: 'card', style: 'max-width:720px' }, el('h3', {}, 'کنترل ارسال فایل'),
      el('p', { class: 'mut', style: 'margin-top:0' }, 'برای کم‌کردن مصرف دیسک و پهنای باند هر نوع ارسال را کامل ببند یا فقط برای چند کاربر باز بگذار. اعمال در سرور است؛ دکمه‌های مربوط در برنامهٔ کاربر هم خاموش می‌شوند.'));
    for (const k of Object.keys(NAMES)) {
      const sel = el('select', {}, MODES.map(([v, l]) => el('option', { value: v, selected: p.kinds[k].mode === v }, l)));
      const users = el('textarea', { rows: '2', dir: 'ltr', placeholder: 'نام کاربری‌ها با ویرگول یا خط جدید، مثلاً ali, sara', style: 'width:100%' });
      users.value = p.kinds[k].users.map((u) => u.replace(/^@/, '').split(':')[0]).join(', ');
      const box = el('div', { style: 'margin-top:6px' }, users);
      const sync = () => { box.hidden = sel.value !== 'users'; };
      sel.onchange = sync; sync();
      rows[k] = { sel, users };
      card.append(el('div', { class: 'field', style: 'border-top:1px solid var(--line);padding-top:10px;margin-top:10px' }, el('div', { class: 'row' }, el('b', {}, NAMES[k]), el('span', { class: 'sp' }), sel), box));
    }
    const small = el('input', { type: 'number', min: '0', max: '100000', value: p.small_kb });
    card.append(el('div', { class: 'field', style: 'border-top:1px solid var(--line);padding-top:10px;margin-top:10px' }, el('label', {}, 'فایل‌های کوچک‌تر از این اندازه (کیلوبایت) همیشه مجازند'),
      small, el('span', { class: 'dim' }, 'برای عکس پروفایل، کاور، بندانگشتی و استیکر لازم است. ۰ = هیچ استثنایی.')));
    card.append(el('button', { class: 'pri', style: 'margin-top:14px', onclick: async () => {
      const kinds = {};
      for (const [k, r] of Object.entries(rows)) kinds[k] = { mode: r.sel.value, users: r.users.value.split(/[\s,،;]+/).filter(Boolean) };
      await api('/upload-policy', 'POST', { small_kb: small.value, kinds }); toast('ذخیره شد'); show();
    } }, 'ذخیره'));
    card.append(el('p', { class: 'dim' }, 'یادداشت: دستهٔ هر فایل را برنامهٔ کاربر هنگام آپلود اعلام می‌کند؛ این کنترل برای صرفه‌جویی مصرف است و جایگزین امنیت نیست.'));
    return card;
  },
  /* ===== لاگ ===== */
  async audit() {
    const d = await api('/audit?limit=200');
    return el('div', { class: 'card scroll', style: 'padding:0' }, el('table', {}, el('thead', {}, el('tr', {}, ...['زمان', 'رویداد', 'جزئیات'].map((h) => el('th', {}, h)))), el('tbody', {}, d.events.map((e) => el('tr', { style: 'cursor:default' }, el('td', { class: 'dim' }, when(e.at)), el('td', { dir: 'ltr' }, e.method + ' ' + e.status), el('td', { dir: 'ltr', class: 'dim', style: 'white-space:normal;max-width:480px' }, [e.path, e.ip, e.note].filter(Boolean).join(' · ')))))));
  },
};
const stat = (k, v, sub) => el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, k), sub ? el('small', {}, sub) : null);
function quick(o) {
  const mk = (t, cmd) => el('div', { class: 'row', style: 'margin-bottom:8px' }, el('button', { onclick: () => { tab = cmd; show(); } }, t));
  return el('div', { class: 'card' }, el('h3', {}, 'میان‌بُر'), el('div', { class: 'row' },
    el('button', { onclick: () => { tab = 'content'; show(); } }, 'مرور پست‌ها'), el('button', { onclick: () => { tab = 'reports'; show(); } }, 'گزارش‌ها'), el('button', { onclick: () => { tab = 'users'; show(); } }, 'کاربران'), el('button', { onclick: () => { tab = 'settings'; show(); } }, 'سقف‌ها')));
}

/* ---------- جزئیات کاربر ---------- */
async function openUser(uid, focusPurge) {
  const sheet = el('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) sheet.remove(); } }); const p = el('div', { class: 'p' }, el('p', { class: 'mut' }, '…'));
  sheet.append(p); document.body.append(sheet);
  try {
    const d = await api('/users/' + encodeURIComponent(uid));
    const close = () => sheet.remove();
    const again = () => { close(); openUser(uid); };
    const go = (u) => { close(); openUser(u); };
    const chainEl = el('div', { class: 'chain' }, ...[...d.inviter_chain].reverse().flatMap((u) => [el('span', { class: 'chip', onclick: () => go(u) }, U(u)), el('span', { class: 'arrow' }, '←')]), el('span', { class: 'chip me' }, U(uid)));
    const ban = d.ban;
    p.replaceChildren(
      el('div', { class: 'row' }, el('h2', { style: 'margin:0' }, d.name || short(uid)), ban ? el('span', { class: 'tag hot' }, ban.deactivated ? 'مسدود و حساب بسته' : 'مسدود') : null, el('span', { class: 'sp' }), el('button', { class: 'sm', onclick: close }, 'بستن')),
      el('div', { class: 'dim' }, el('bdi', { dir: 'ltr' }, uid), ' · عضو از ', when(d.joined)), d.bio ? el('p', { class: 'mut' }, d.bio) : null,
      el('div', { class: 'grid', style: 'margin-top:12px;grid-template-columns:repeat(4,1fr)' }, stat('پست', fa(d.counts.posts)), stat('نظر', fa(d.counts.comments)), stat('آهنگ', fa(d.counts.tracks)), stat('دنبال‌کننده', fa(d.counts.followers))),
      el('div', { class: 'card' }, el('div', { class: 'row' }, el('b', {}, 'حجم مصرفی'), el('span', { class: 'sp' }), el('span', { class: 'mut' }, `${bytes(d.bytes)} از ${bytes(d.quota_bytes)}`)), meter(d.bytes, d.quota_bytes)),
      el('div', { class: 'card' }, el('h3', {}, 'چه کسی او را آورد'), chainEl,
        el('p', { class: 'dim' }, d.inviter_chain.length ? '' : 'با کدی که ادمین ساخته (ریشهٔ درخت).'), el('div', { class: 'dim' }, 'کد: ', el('bdi', { dir: 'ltr' }, d.invite_code))),
      el('div', { class: 'card' }, el('h3', {}, `کسانی که آورده (${fa(d.invitees.length)}، در کل ${fa(d.descendants)} نفر در شاخه)`),
        d.invitees.length ? el('div', { class: 'row' }, d.invitees.map((i) => el('span', { class: 'chip', onclick: () => go(i.user_id) }, U(i.user_id), i.banned ? ' ⛔' : ''))) : el('span', { class: 'dim' }, 'کسی را دعوت نکرده است.'),
        d.codes.length ? el('p', { class: 'dim' }, `کدها: ${d.codes.map((c) => `${c.code}${c.revoked ? ' (باطل)' : ` (${c.uses}/${c.max_uses})`}`).join(' · ')}`) : null),
      d.reports.length ? el('div', { class: 'card' }, el('h3', {}, `گزارش‌ها (${fa(d.reports.length)})`), d.reports.map((r) => el('div', { class: 'dim' }, `${KIND[r.kind] || r.kind} · ${REASON[r.reason] || r.reason} · ${r.status === 'open' ? 'باز' : 'بسته'}${r.note ? ' · ' + r.note : ''}`))) : null,
      d.posts.length ? el('div', { class: 'card' }, el('h3', {}, 'آخرین پست‌ها'), el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px' },
        d.posts.map((x) => el('img', { src: x.thumb || x.url, alt: '', style: 'width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;cursor:zoom-in', onclick: () => lightbox(x) })))) : null,
      el('div', { class: 'card', id: 'danger', style: 'border-color:color-mix(in srgb,var(--red) 40%,var(--line))' }, el('h3', {}, 'اقدام'),
        el('div', { class: 'row' },
          el('button', { class: 'red solid', onclick: async () => {
            const r = await ask('بن کامل و پاک‌سازی؟', `حساب ${short(uid)} در چت و پلتفرم بسته می‌شود، همهٔ نشست‌هایش قطع می‌شود، همهٔ پست‌ها، آهنگ‌ها، نظرها و استوری‌هایش پاک می‌شود و کدهای دعوتش باطل می‌شود. برگشت ندارد.`,
              { danger: true, ok: 'بن کامل', boxes: d.descendants ? [{ key: 'cascade', on: false, label: `همهٔ ${fa(d.descendants)} نفری که او (و دعوت‌شده‌هایش) آورده‌اند هم بن شوند` }] : [] });
            if (!r) return;
            const o = await api(`/users/${encodeURIComponent(uid)}/purge`, 'POST', { cascade: !!r.cascade });
            toast(`انجام شد: ${fa(o.users.length)} حساب، ${fa(o.posts)} پست، ${fa(o.comments)} نظر پاک شد` + (o.matrix_failed ? ` (بستن ${fa(o.matrix_failed)} حساب Matrix ناموفق بود)` : '')); again(); if (tab !== 'overview') show();
          } }, 'بن کامل + پاک‌کردن همه‌چیز'),
          ban ? el('button', { onclick: async () => { const o = await api(`/users/${encodeURIComponent(uid)}/ban`, 'DELETE'); toast(o.matrix_still_closed ? 'مسدودی برداشته شد (حساب چت بسته مانده)' : 'مسدودی برداشته شد'); again(); } }, 'رفع مسدودی')
            : el('button', { class: 'red', onclick: async () => { const r = await ask('فقط مسدود شود؟', 'از فید/موزیک/استوری محروم می‌شود و محتوایش پنهان می‌ماند ولی پاک نمی‌شود. با «بستن حساب چت» دیگر نمی‌تواند وارد شود.', { ok: 'مسدود', danger: true, boxes: [{ key: 'deactivate', on: true, label: 'حساب چت (Matrix) هم بسته شود' }] }); if (!r) return; await api(`/users/${encodeURIComponent(uid)}/ban`, 'POST', { reason: 'admin', deactivate: r.deactivate }); toast('مسدود شد'); again(); } }, 'فقط مسدود'))));
    if (focusPurge) p.querySelector('#danger')?.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { p.replaceChildren(el('p', {}, 'خطا: ' + e.message), el('button', { onclick: () => sheet.remove() }, 'بستن')); }
}

/* ---------- کارت گزارش ---------- */
function reportCard(r, reload) {
  const c = el('div', { class: 'card' });
  c.append(el('div', { class: 'row' }, el('span', { class: 'tag' }, KIND[r.kind] || r.kind), el('span', { class: 'tag hot' }, REASON[r.reason] || r.reason),
    r.reports_for_target > 1 ? el('span', { class: 'tag hot' }, fa(r.reports_for_target) + ' گزارش‌دهنده') : null, r.banned ? el('span', { class: 'tag hot' }, 'صاحبش مسدود است') : null, el('span', { class: 'sp' }), el('span', { class: 'dim' }, ago(r.created_at))));
  c.append(el('p', { class: 'mut' }, 'هدف: ', el('b', { style: 'cursor:pointer', onclick: () => openUser(r.target_user) }, U(r.target_user)), ' · گزارش‌دهنده: ', U(r.reporter)));
  if (r.note) c.append(el('p', {}, '«', r.note, '»'));
  const pv = r.preview;
  if (r.gone) c.append(el('p', { class: 'dim' }, 'این محتوا دیگر وجود ندارد.'));
  else if (pv) {
    if (pv.caption) c.append(el('p', {}, pv.caption)); if (pv.text) c.append(el('p', {}, pv.text)); if (pv.title) c.append(el('p', {}, pv.title + (pv.artist ? ' — ' + pv.artist : '')));
    if (pv.url) c.append(pv.kind === 'video' ? el('video', { src: pv.url, poster: pv.thumb || '', controls: true, preload: 'none', style: 'max-height:300px;border-radius:10px' }) : el('img', { src: pv.url, loading: 'lazy', style: 'max-height:300px;border-radius:10px', onclick: () => lightbox(pv) }));
  }
  if (r.status === 'open') {
    const run = (action, q) => async () => { if (q && !(await ask('تأیید', q, { danger: true }))) return; await api(`/reports/${r.id}/resolve`, 'POST', { action }); reload(); };
    c.append(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { onclick: run('dismiss') }, 'ردِ گزارش'),
      r.kind === 'user' ? null : el('button', { class: 'red', onclick: run('remove', 'محتوا حذف شود؟') }, 'حذف محتوا'),
      el('button', { class: 'red', onclick: run('ban', 'محتوا حذف و صاحبش مسدود (و حساب چتش بسته) شود؟') }, r.kind === 'user' ? 'مسدود‌کردن کاربر' : 'حذف و مسدودسازی'),
      el('button', { class: 'red solid', onclick: () => openUser(r.target_user, true) }, 'بن کامل…')));
  } else c.append(el('p', { class: 'dim' }, 'نتیجه: ' + ({ dismiss: 'رد شد', remove: 'محتوا حذف شد', ban: 'حذف و مسدود' }[r.action] || r.action)));
  return c;
}

/* ---------- شروع ---------- */
async function enter() { $('#login').hidden = true; $('#app').hidden = false; await refreshReg(); await show(); }
$('#go').onclick = async () => {
  KEY = $('#key').value.trim();
  try { await api('/stats'); try { sessionStorage.setItem('adm', KEY); } catch { /* مهم نیست */ } enter(); } catch (e) { $('#lerr').textContent = e.message; }
};
$('#key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#go').click(); });
$('#out').onclick = () => { try { sessionStorage.removeItem('adm'); } catch { /* */ } location.reload(); };
$('#reload').onclick = show;
$('#theme').onclick = () => { const l = document.documentElement.dataset.theme === 'light'; document.documentElement.dataset.theme = l ? 'dark' : 'light'; try { localStorage.setItem('admtheme', l ? 'dark' : 'light'); } catch { /* */ } };
try { const t = localStorage.getItem('admtheme'); if (t) document.documentElement.dataset.theme = t; } catch { /* */ }
if (KEY) api('/stats').then(enter).catch(() => {});
