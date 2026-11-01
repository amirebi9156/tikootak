import { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';
import { loadStickers, addSticker, removeSticker } from './stickers.js';
import StickerImg from './StickerImg.jsx';

// پنل ایموجی/استیکر شیشه‌ای مثل تلگرام. داده‌های ایموجی تنبل بارگذاری می‌شود.
const GROUPS = [
  { g: 0, icon: '😀', name: 'لبخندها' },
  { g: 1, icon: '🧑', name: 'آدم‌ها' },
  { g: 3, icon: '🐱', name: 'حیوانات و طبیعت' },
  { g: 4, icon: '🍎', name: 'خوراکی' },
  { g: 6, icon: '⚽', name: 'فعالیت‌ها' },
  { g: 5, icon: '🚗', name: 'سفر و مکان' },
  { g: 7, icon: '💡', name: 'اشیا' },
  { g: 8, icon: '🔣', name: 'نمادها' },
  { g: 9, icon: '🏳️', name: 'پرچم‌ها' },
];
const RECENT_KEY = 'tikootak.emoji.recent';
const DEFAULT_RECENT = ['😂', '❤️', '👍', '😭', '🔥', '🙏', '😊', '😍', '🥺', '😘', '🤣', '😎', '🎉', '👏', '😢', '🤔'];
const BIG = ['😂', '❤️', '😍', '😭', '🔥', '👍', '🙏', '😎', '🥰', '😘', '🤣', '😢', '😡', '🤯', '🥳', '😴', '🤝', '💔', '🎉', '👏', '🙌', '💪', '🤷', '🫶', '😱', '🤡', '💀', '👀', '✨', '💯', '🤩', '😅'];

let dataPromise = null;
const loadData = () => (dataPromise ||= import('emojibase-data/en/compact.json').then((m) => m.default || m));

function getRecent() {
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || 'null'); if (Array.isArray(r) && r.length) return r; } catch { /* خالی */ }
  return DEFAULT_RECENT;
}
function pushRecent(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...getRecent().filter((x) => x !== e)].slice(0, 32))); } catch { /* مهم نیست */ }
}

export default function EmojiPanel({ client, onEmoji, onBig, onSticker, onToast, docked = false }) {
  const [tab, setTab] = useState('emoji'); // emoji | stickers
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('recent');
  const [recent, setRecent] = useState(getRecent);
  const [mine, setMine] = useState(() => loadStickers(client));
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { let on = true; loadData().then((d) => on && setData(d)).catch(() => {}); return () => { on = false; }; }, []);
  useEffect(() => {
    const h = () => setMine(loadStickers(client));
    client.on?.('accountData', h);
    return () => client.off?.('accountData', h);
  }, [client]);

  const byGroup = useMemo(() => {
    const m = new Map();
    for (const e of data || []) {
      if (e.group === undefined || e.group === 2) continue;
      if (!m.has(e.group)) m.set(e.group, []);
      m.get(e.group).push(e);
    }
    return m;
  }, [data]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return null;
    const out = [];
    const rank = (e) => {
      if (e.unicode === q.trim()) return 0;
      if (e.label.split(/[\s:]+/).includes(s)) return 1;
      if (e.label.includes(s)) return 2;
      if ((e.tags || []).includes(s)) return 3;
      if ((e.tags || []).some((t) => t.startsWith(s))) return 4;
      return 9;
    };
    for (const e of data) {
      if (e.group === undefined || e.group === 2) continue;
      const k = rank(e);
      if (k < 9) out.push([k, e]);
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, 160).map((x) => x[1]);
  }, [q, data]);

  const pick = (e) => { pushRecent(e); setRecent(getRecent()); onEmoji(e); };

  // اسکرول‌اسپای ساده
  const onScroll = () => {
    const sc = scroller.current;
    if (!sc || q) return;
    let cur = 'recent';
    for (const sec of sc.querySelectorAll('[data-sec]')) { if (sec.offsetTop - sc.scrollTop <= 24) cur = sec.dataset.sec; }
    setActive(cur);
  };
  const jump = (id) => {
    const sc = scroller.current;
    const el = sc?.querySelector(`[data-sec="${id}"]`);
    if (el) sc.scrollTo({ top: el.offsetTop - 2, behavior: 'smooth' });
    setActive(id);
  };

  const onFiles = async (files) => {
    setBusy(true);
    try { for (const f of files) await addSticker(client, f); } catch (e) { onToast?.(e.message || tr('افزودن استیکر ناموفق بود')); }
    setBusy(false);
  };

  return (
    <div className={`emoji-panel ${docked ? 'docked' : ''}`} role="dialog" aria-label={tr('ایموجی و استیکر')} data-testid="emoji-panel">
      <div className="ep-top">
        {tab === 'emoji' ? (
          <div className="ep-tabs" role="tablist">
            <button type="button" className={active === 'recent' && !q ? 'on' : ''} onClick={() => { setQ(''); jump('recent'); }} aria-label={tr('اخیر')}><Icon n="clock" size={20} /></button>
            {GROUPS.map((g) => <button key={g.g} type="button" className={active === `g${g.g}` && !q ? 'on' : ''} onClick={() => { setQ(''); jump(`g${g.g}`); }} aria-label={tr(g.name)}>{g.icon}</button>)}
          </div>
        ) : (
          <div className="ep-tabs"><span className="ep-title">{tr('استیکرها')}</span></div>
        )}
        {tab === 'emoji' && <label className="ep-search"><Icon n="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('جستجوی ایموجی (انگلیسی)')} aria-label={tr('جستجوی ایموجی')} dir="auto" /></label>}
      </div>

      {tab === 'emoji' ? (
        <div className="ep-grid" key="emoji" ref={scroller} onScroll={onScroll}>
          {!data && <p className="ep-empty">{tr('در حال بارگذاری…')}</p>}
          {results ? (
            results.length ? <div className="ep-cells">{results.map((e) => <button key={e.hexcode} type="button" title={e.label} onClick={() => pick(e.unicode)}>{e.unicode}</button>)}</div>
              : <p className="ep-empty">{tr('چیزی پیدا نشد')}</p>
          ) : (
            <>
              <section data-sec="recent"><h4>{tr('اخیر')}</h4><div className="ep-cells">{recent.map((e) => <button key={e} type="button" onClick={() => pick(e)}>{e}</button>)}</div></section>
              {GROUPS.map((g) => <section key={g.g} data-sec={`g${g.g}`}><h4>{tr(g.name)}</h4>
                <div className="ep-cells">{(byGroup.get(g.g) || []).map((e) => <button key={e.hexcode} type="button" title={e.label} onClick={() => pick(e.unicode)}>{e.unicode}</button>)}</div></section>)}
            </>
          )}
        </div>
      ) : (
        <div className="ep-grid ep-st" key="stickers" ref={scroller}>
          <section>
            <h4>{tr('استیکرهای من')}<span className="sp" />
              {mine.length > 0 && <button type="button" className="ep-link" onClick={() => setEdit((v) => !v)}>{edit ? tr('تمام') : tr('ویرایش')}</button>}</h4>
            <div className="ep-stk">
              <button type="button" className="ep-add" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={tr('افزودن استیکر')} data-testid="sticker-add">{busy ? '…' : <Icon n="plus" size={26} />}</button>
              {mine.map((s) => <div key={s.id} className="ep-stk-item">
                <button type="button" onClick={() => !edit && onSticker(s)} aria-label={tr('استیکر')}><StickerImg client={client} st={s} /></button>
                {edit && <button type="button" className="ep-del" onClick={() => removeSticker(client, s.id)} aria-label={tr('حذف')}><Icon n="close" size={12} /></button>}
              </div>)}
            </div>
            {!mine.length && <p className="ep-empty">{tr('با دکمهٔ + عکس‌هایت را به استیکر تبدیل کن؛ روی هر عکسی در چت هم می‌توانی «افزودن به استیکرها» را بزنی.')}</p>}
          </section>
          <section>
            <h4>{tr('ایموجی بزرگ')}</h4>
            <div className="ep-big">{BIG.map((e) => <button key={e} type="button" onClick={() => onBig(e)}>{e}</button>)}</div>
          </section>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }} />
        </div>
      )}

      <div className="ep-bottom" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>{tr('ایموجی')}</button>
        <button type="button" role="tab" aria-selected={tab === 'stickers'} className={tab === 'stickers' ? 'on' : ''} onClick={() => setTab('stickers')} data-testid="tab-stickers">{tr('استیکر')}</button>
      </div>
    </div>
  );
}
