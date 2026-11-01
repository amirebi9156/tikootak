import { useMemo, useState } from 'react';
import { tr } from './i18n.js';
import { Dialog, Avatar } from './ui.jsx';
import { roomKind, kindIcon, kindLabel } from './roomtype.js';
import { forwardMessage } from './forward.js';
import { fmtTime } from './util.js';

export default function ForwardDialog({ client, sourceRoom, content, senderName, items, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rooms = useMemo(() => (client?.getRooms() || [])
    .filter(r => r.getMyMembership() === 'join')
    .filter(r => r.roomId !== sourceRoom?.roomId)
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp()), [client, sourceRoom]);
  const list = rooms.filter(r => !q.trim() || (r.name || '').toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => setSel(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  async function send() {
    if (!sel.size) return;
    setBusy(true); setErr('');
    let failed = 0;
    for (const id of sel) {
      try { for (const it of (items || [{ content, senderName }])) await forwardMessage(client, sourceRoom, id, it.content, it.senderName); }
      catch { failed++; }
    }
    setBusy(false);
    if (failed) setErr(tr('{0} مورد ارسال نشد.', [failed]));
    else onClose();
  }
  return <Dialog title={tr('ارسال به…')} onClose={onClose} closeOnBackdrop={!busy}>
      <div className="searchbox"><input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('جستجوی گفتگو')} aria-label={tr('جستجوی گفتگو')} /></div>
      <ul className="plain fwd-list">
        {list.length === 0 && <li className="muted">{tr('گفتگویی پیدا نشد.')}</li>}
        {list.map(r => {
          const kind = roomKind(r, client);
          return <li key={r.roomId}>
            <label className={`fwd-row ${sel.has(r.roomId) ? 'on' : ''}`}>
              <input type="checkbox" checked={sel.has(r.roomId)} onChange={() => toggle(r.roomId)} />
              <Avatar name={r.name} id={r.roomId} size={36} />
              <span className="room-main"><strong dir="auto"><span className="room-kind">{kindIcon(kind)}</span> {r.name}</strong><span className="muted">{kindLabel(kind)} · {fmtTime(r.getLastActiveTimestamp())}</span></span>
            </label>
          </li>;
        })}
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row"><button className="ghost" onClick={onClose} disabled={busy}>{tr('انصراف')}</button><button className="primary" onClick={send} disabled={busy || !sel.size}>{busy ? '…' : tr('ارسال به {0} گفتگو', [sel.size])}</button></div>
    </Dialog>;
}
