import { useBackLayer } from './backstack.js';
import { Icon } from './icons.jsx';
import { isFa, setLang } from './i18n.js';
import { getItem, setItem } from './storage.js';
import { createContext, useEffect, useRef, useState } from 'react';
import { hue } from './util.js';
import { usePerson } from './people.js';
import { applyLook } from './look.js';

// Shell این را فراهم می‌کند تا هر جای برنامه بتواند پست را در چت بفرستد یا باز کند
export const ShareCtx = createContext(null);

// دکمه‌ی تغییر زبان: همیشه نام زبانِ مقابل را نشان می‌دهد
export function LangSwitch({ className = '' }) {
  return (
    <button type="button" className={`lang-btn ${className}`} onClick={() => setLang(isFa ? 'en' : 'fa')}
      aria-label="Language / زبان" title="Language / زبان" data-testid="lang-switch">
      {isFa ? 'EN' : 'فا'}
    </button>
  );
}

// سوییچ استاندارد (به‌جای checkbox خام): عنوان + توضیح کوتاه؛ در RTL/LTR درست کار می‌کند
export function Switch({ checked, onChange, disabled, title, desc, testid }) {
  return (
    <label className={'sw-row' + (disabled ? ' dis' : '')}>
      <span className="sw-text"><b>{title}</b>{desc ? <small>{desc}</small> : null}</span>
      <input type="checkbox" role="switch" className="sw" checked={!!checked} disabled={disabled} data-testid={testid}
        onChange={(e) => onChange?.(e.target.checked)} />
    </label>
  );
}

export function Avatar({ name, id, size = 44 }) {
  const person = usePerson(id);
  const ch = (name || person?.name || '?').trim().charAt(0).toUpperCase();
  const h = hue(id || name || '');
  return (
    <span className="avatar" aria-hidden="true"
      style={{ '--av-h': h % 360, width: size, height: size, fontSize: size * 0.42 }}>
      {person?.avatar ? <img src={person.avatar} alt="" /> : ch}
    </span>
  );
}

export function Dialog({ title, onClose, children }) {
  useBackLayer(true, onClose);
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dlg-head"><h2>{title}</h2><button type="button" className="icon dlg-x" onClick={onClose} aria-label="Close"><Icon n="close" size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

// لوگوی برند TIKOOTAK (SVG در public/brand)
export function LogoMark({ size = 32, className = '' }) {
  return (
    <img className={`logo-mark ${className}`} src="/brand/logo-mark.svg" alt="" aria-hidden="true"
      width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} />
  );
}

export function LogoWordmark({ size = 120, className = '' }) {
  return (
    <img className={`logo-wordmark ${className}`} src="/brand/logo-wordmark.png" alt="TIKOOTAK"
      style={{ width: size, height: 'auto', objectFit: 'contain' }} />
  );
}

export function Logo({ size = 28, text = true }) {
  return (
    <span className="logo" dir="ltr">
      <LogoMark size={size} />
      {text && <b style={{ fontSize: size * 0.72 }}>TIKOOTAK</b>}
    </span>
  );
}

const THEME_KEY = 'tikootak.theme';
export function applyTheme(t) {
  const mode = ['light', 'oled'].includes(t) ? t : 'dark';
  document.documentElement.dataset.theme = mode;
  applyLook();
}
export function initTheme() {
  let t = 'dark';
  try { t = getItem(THEME_KEY) || 'dark'; } catch { /* ignore */ }
  applyTheme(t);
}
export function useTheme() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || 'dark');
  const setTheme = (mode) => {
    const n = ['light', 'oled'].includes(mode) ? mode : 'dark';
    setT(n); applyTheme(n);
    setItem(THEME_KEY, n);
  };
  return [t, setTheme];
}
