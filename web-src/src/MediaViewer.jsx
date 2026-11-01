import { useBackLayer } from './backstack.js';
import { useEffect, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';

// نمایشگر تمام‌صفحه‌ی عکس و ویدیو داخل خود چت. فایل از قبل رمزگشایی شده و با blob URL نمایش داده می‌شود.
export default function MediaViewer({ item, onClose }) {
  const [zoom, setZoom] = useState(false);
  useBackLayer(true, onClose);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom(true);
      if (e.key === '-') setZoom(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!item) return null;
  const isVideo = item.kind === 'video';

  return (
    <div className="mv" role="dialog" aria-modal="true" aria-label={tr('نمایش رسانه')}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mv-bar">
        <span className="mv-name" dir="auto">{item.name || tr('رسانه')}</span>
        <span className="grow" />
        {!isVideo && (
          <button className={`icon ${zoom ? 'on' : ''}`} onClick={() => setZoom(z => !z)}
            aria-label={tr('بزرگ‌نمایی')} title={tr('بزرگ‌نمایی')} aria-pressed={zoom}><Icon n="zoom" /></button>
        )}
        <a className="icon" href={item.url} download={item.name || 'media'}
          aria-label={tr('ذخیره')} title={tr('ذخیره')}><Icon n="download" /></a>
        <button className="icon" onClick={onClose} aria-label={tr('بستن')} title={tr('بستن')}><Icon n="close" size={18} /></button>
      </div>
      <div className={`mv-stage ${zoom ? 'zoom' : ''} ${isVideo ? 'video' : 'image'}`}>
        {isVideo
          ? <video className="mv-media" src={item.url} controls autoPlay playsInline preload="metadata" />
          : <img className="mv-media" src={item.url} alt={item.name || ''} onClick={() => setZoom(z => !z)} />}
      </div>
      <div className="mv-hint">{isVideo ? tr('برای بستن Esc را بزن') : tr('برای بزرگ‌نمایی روی عکس بزن')}</div>
    </div>
  );
}
