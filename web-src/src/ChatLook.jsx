import { useRef, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';
import { useLook, PRESETS, WALLS, fileToWall, buildVars } from './look.js';
import { fa } from './util.js';

const NAMES = { navy: 'سرمه‌ای', green: 'سبز تیکوتک', blue: 'آبی تلگرام', purple: 'بنفش', orange: 'نارنجی', rose: 'گل‌رز', teal: 'فیروزه‌ای' };
const WALL_NAMES = { dusk: 'غروب', aurora: 'شفق', peaks: 'قله‌ها', dots: 'نقطه‌ای', lines: 'راه‌راه', grad: 'گرادیانت', plain: 'ساده', img: 'عکس من' };
const swOf = (p, mode) => {
  if (p.sw) return p.sw;
  const v = buildVars(p.hex, mode === 'light' ? 'dark' : mode);
  return [v['--bg'], v['--mine'], v['--accent']];
};

// صفحهٔ شخصی‌سازی چت (الهام از تلگرام): پیش‌نمایش زنده + رنگ + اندازهٔ متن + گوشهٔ حباب + والپیپر
export default function ChatLook({ theme, onTheme }) {
  const [look, set, reset] = useLook();
  const fileRef = useRef(null);
  const [err, setErr] = useState('');
  const customSw = swOf({ hex: look.custom }, theme);
  async function pickImg(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setErr('');
    try { set({ wall: 'img', img: await fileToWall(f) }); } catch { setErr(tr('این تصویر خوانده نشد.')); }
  }
  return (
    <section className="set-sec look-page" data-testid="chatlook-page">
      <div className="lp-wall" data-testid="look-preview" aria-label={tr('پیش‌نمایش')}>
        <div className="msg theirs tail grouped"><div className="bubble"><span className="text" dir="auto">{tr('صبح بخیر! 👋')}</span><span className="msg-time">۸:۱۴</span></div></div>
        <div className="msg mine tail grouped"><div className="bubble"><span className="text" dir="auto">{tr('الان تو توکیو صبحه 😎')}</span><span className="msg-time">۸:۲۹ <span className="tick read">✓✓</span></span></div></div>
      </div>

      <div className="look-card">
        <h4>{tr('اندازهٔ متن پیام')} <b className="num">{fa(look.fs)}</b></h4>
        <input type="range" min="12" max="22" step="1" value={look.fs} onChange={e => set({ fs: +e.target.value })} aria-label={tr('اندازهٔ متن پیام')} data-testid="look-fs" />
      </div>
      <div className="look-card">
        <h4>{tr('گردی گوشهٔ حباب')} <b className="num">{fa(look.radius)}</b></h4>
        <input type="range" min="4" max="24" step="1" value={look.radius} onChange={e => set({ radius: +e.target.value })} aria-label={tr('گردی گوشهٔ حباب')} data-testid="look-radius" />
      </div>

      <div className="look-card">
        <h4>{tr('تم رنگی')}</h4>
        <div className="look-scroll" role="group" aria-label={tr('تم رنگی')}>
          {PRESETS.map(p => {
            const [a, b, c] = swOf(p, theme);
            return (
              <button type="button" key={p.id} className={'look-pal' + (look.palette === p.id ? ' on' : '')} onClick={() => set({ palette: p.id })} aria-pressed={look.palette === p.id} data-testid={`pal-${p.id}`}>
                <span className="lp-mini" style={{ background: a }}><i style={{ background: c }} /><i className="o" style={{ background: b }} /></span>
                {tr(NAMES[p.id])}
              </button>
            );
          })}
          <button type="button" className={'look-pal' + (look.palette === 'custom' ? ' on' : '')} onClick={() => set({ palette: 'custom' })} aria-pressed={look.palette === 'custom'} data-testid="pal-custom">
            <span className="lp-mini" style={{ background: customSw[0] }}><i style={{ background: customSw[2] }} /><i className="o" style={{ background: customSw[1] }} /></span>
            {tr('رنگ دلخواه')}
          </button>
        </div>
        {look.palette === 'custom' && <label className="look-custom">
          <span>{tr('رنگ اصلی را انتخاب کن')}</span>
          <input type="color" value={look.custom} onChange={e => set({ custom: e.target.value })} data-testid="look-color" aria-label={tr('رنگ اصلی')} />
        </label>}
        <div className="look-modes" role="group" aria-label={tr('تم')}>
          {[['dark', 'شب'], ['light', 'روز'], ['oled', 'مشکی']].map(([m, n]) => (
            <button type="button" key={m} className={'look-mode' + (theme === m ? ' on' : '')} onClick={() => onTheme(m)} aria-pressed={theme === m} data-testid={`mode-${m}`}>
              <span className={'lm-prev lm-' + m}><i /><i /></span>{tr(n)}
            </button>
          ))}
        </div>
        <label className="sw-row"><span className="sw-text"><b>{tr('حباب دورنگ')}</b><small>{tr('رنگ حباب پیام‌های تو از پررنگ به کم‌رنگ می‌رود.')}</small></span>
          <input type="checkbox" role="switch" className="sw" checked={look.grad !== false} onChange={e => set({ grad: e.target.checked })} data-testid="look-grad" /></label>
      </div>

      <div className="look-card">
        <h4>{tr('والپیپر چت')}</h4>
        <div className="look-scroll">
          {WALLS.map(w => (
            <button type="button" key={w} className={'look-wall w-' + w + (look.wall === w ? ' on' : '')} data-testid={`wall-${w}`} aria-pressed={look.wall === w}
              onClick={() => (w === 'img' && !look.img ? fileRef.current?.click() : set({ wall: w }))}
              style={w === 'img' && look.img ? { backgroundImage: `url("${look.img}")`, backgroundSize: 'cover' } : undefined}>
              <span>{w === 'img' && !look.img ? '＋ ' : ''}{tr(WALL_NAMES[w])}</span>
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImg} data-testid="wall-file" />
        {look.wall === 'img' && <button type="button" className="look-row" onClick={() => fileRef.current?.click()}><Icon n="image" size={20} /><span>{tr('تغییر عکس والپیپر')}</span></button>}
        {err && <p className="err" role="alert">{err}</p>}
        <p className="muted small-note">{tr('این تنظیمات فقط روی همین دستگاه ذخیره می‌شوند.')}</p>
      </div>
      <button type="button" className="outline" onClick={reset} data-testid="look-reset">{tr('بازگشت به پیش‌فرض')}</button>
    </section>
  );
}
