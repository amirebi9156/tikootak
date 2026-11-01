import { useMemo, useState } from 'react';
import { tr } from './i18n.js';
import { Avatar, Dialog } from './ui.jsx';
import { Icon } from './icons.jsx';
import { localpart } from './matrix.js';

// ارسال پست/ریل به چت: جستجو با نام یا شناسه، انتخاب چندتایی، پیش‌نمایش پست
export default function ShareToChat({ post, rooms, peerOf, onSend, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useMemo(() => {
    const s = q.trim().replace(/^@/, '').toLowerCase();
    return rooms.filter(r => {
      if (!s) return true;
      const peer = peerOf(r) || '';
      return (r.name || '').toLowerCase().includes(s) || localpart(peer).toLowerCase().includes(s);
    });
  }, [q, rooms, peerOf]);
  const toggle = id => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function go() {
    if (!sel.size) return;
    setBusy(true); setMsg('');
    let bad = 0;
    for (const id of sel) {
      try { await onSend(id); } catch { bad++; }
    }
    setBusy(false);
    if (bad) setMsg(tr('{0} مورد ارسال نشد.', [bad]));
    else onClose();
  }
  const thumb = post.thumb || (post.kind === 'image' ? post.url : null);
  return <Dialog title={tr('ارسال در چت')} onClose={onClose} closeOnBackdrop={!busy}>
    <div className="st-preview">
      <div className="st-thumb">
        {thumb ? <img src={thumb} alt="" /> : <Icon n="film" size={22} />}
        {post.kind === 'video' && <span className="st-play"><Icon n="play" size={14} /></span>}
      </div>
      <div className="st-meta"><strong dir="auto">{post.name}</strong><span dir="auto">{post.caption || tr('پست')}</span></div>
    </div>
    <div className="searchbox"><input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('جستجو با نام یا شناسه')} aria-label={tr('جستجو با نام یا شناسه')} data-testid="share-search" /></div>
    <ul className="plain st-list">
      {list.length === 0 && <li className="muted">{tr('گفتگویی پیدا نشد.')}</li>}
      {list.map(r => {
        const peer = peerOf(r);
        const on = sel.has(r.roomId);
        return <li key={r.roomId}>
          <button type="button" className={`st-row ${on ? 'on' : ''}`} onClick={() => toggle(r.roomId)} aria-pressed={on} data-testid="share-room">
            <Avatar name={r.name} id={peer || r.roomId} size={42} />
            <span className="st-name"><strong dir="auto">{r.name}</strong>{peer && <span className="muted" dir="ltr">@{localpart(peer)}</span>}</span>
            <span className={`st-check ${on ? 'on' : ''}`} aria-hidden="true">{on && <Icon n="check" size={14} />}</span>
          </button>
        </li>;
      })}
    </ul>
    {msg && <p className="error" role="alert">{msg}</p>}
    <div className="row">
      <button className="ghost" onClick={onClose} disabled={busy}>{tr('انصراف')}</button>
      <button className="primary" onClick={go} disabled={busy || !sel.size} data-testid="share-send">{busy ? '…' : sel.size ? tr('ارسال به {0} گفتگو', [sel.size]) : tr('ارسال')}</button>
    </div>
  </Dialog>;
}
