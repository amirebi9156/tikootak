import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { tr } from './i18n.js';
import { fmtSize } from './media.js';

// پیش‌نمایش پیش از ارسال: فایل‌ها فوراً فرستاده نمی‌شوند؛ کپشن می‌نویسی، چک می‌کنی، بعد می‌فرستی.
export default function SendPreview({ files: initial, onSend, onCancel, encrypted }) {
  const [files, setFiles] = useState(initial);
  const [caption, setCaption] = useState('');
  const ref = useRef(null);
  const urls = useMemo(() => files.map(f => (/^(image|video)\//.test(f.type) && f.type !== 'image/svg+xml' ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);
  useEffect(() => { if (!files.length) onCancel(); }, [files, onCancel]);
  const go = () => { if (files.length) onSend(files, caption.trim()); };
  const many = files.length > 1;
  return (
    <div className="sp-back" role="dialog" aria-modal="true" aria-label={tr('پیش‌نمایش ارسال')} data-testid="send-preview" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sp-card">
        <div className="sp-head">
          <button type="button" className="icon" onClick={onCancel} aria-label={tr('لغو')} data-testid="sp-cancel"><Icon n="close" size={18} /></button>
          <b>{many ? tr('ارسال {0} فایل', [files.length]) : tr('ارسال فایل')}</b>
        </div>
        <div className={'sp-grid' + (many ? ' many' : '')}>
          {files.map((f, i) => (
            <div className="sp-item" key={f.name + i + f.size}>
              {urls[i] && f.type.startsWith('image/') ? <img src={urls[i]} alt={f.name} data-testid="sp-img" />
                : urls[i] ? <video src={urls[i]} muted playsInline preload="metadata" controls={!many} />
                : <div className="sp-file"><Icon n="clip" size={22} /><span dir="auto">{f.name}</span><small className="muted">{fmtSize(f.size)}</small></div>}
              {many && <button type="button" className="sp-x" onClick={() => setFiles(a => a.filter((_, j) => j !== i))} aria-label={tr('حذف از فهرست')}><Icon n="close" size={14} /></button>}
            </div>
          ))}
        </div>
        <div className="sp-foot">
          <textarea ref={ref} rows={1} value={caption} onChange={e => setCaption(e.target.value)} dir="auto" data-testid="sp-caption"
            placeholder={many ? tr('کپشن (روی اولین فایل)…') : tr('کپشن بنویس…')} maxLength={1000}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
          <button type="button" className="send" onClick={go} aria-label={tr('ارسال')} data-testid="sp-send"><Icon n="send" /></button>
        </div>
        {encrypted && <small className="muted sp-note"><Icon n="lock" size={11} /> {tr('پیش از ارسال رمزنگاری می‌شود')}</small>}
      </div>
    </div>
  );
}
