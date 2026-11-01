import { useState } from 'react';
import { tr } from './i18n.js';
import { Dialog } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fa } from './util.js';

export const VOTE_EVENT = 'ir.tikootak.vote';
const VOTE_EVENT_OLD = 'ir.tikotak.vote';

// ساخت نظرسنجی
export function PollDialog({ onSend, onClose }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const clean = opts.map(o => o.trim()).filter(Boolean);
  const ok = q.trim() && clean.length >= 2;
  async function go(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try { await onSend({ question: q.trim().slice(0, 200), options: clean.slice(0, 10).map((text, i) => ({ id: String(i), text: text.slice(0, 100) })), multi }); onClose(); }
    catch { setBusy(false); }
  }
  return <Dialog title={tr('نظرسنجی جدید')} onClose={onClose}>
    <form className="form poll-form" onSubmit={go}>
      <label>{tr('سؤال')}<input value={q} onChange={e => setQ(e.target.value)} maxLength={200} dir="auto" data-testid="poll-q" autoFocus /></label>
      <div className="poll-opts">
        {opts.map((o, i) => <div className="poll-opt-row" key={i}>
          <input value={o} onChange={e => setOpts(a => a.map((x, j) => j === i ? e.target.value : x))} maxLength={100} dir="auto" placeholder={tr('گزینهٔ {0}', [fa(i + 1)])} aria-label={tr('گزینهٔ {0}', [fa(i + 1)])} data-testid="poll-opt" />
          {opts.length > 2 && <button type="button" className="icon" onClick={() => setOpts(a => a.filter((_, j) => j !== i))} aria-label={tr('حذف گزینه')}><Icon n="close" size={16} /></button>}
        </div>)}
        {opts.length < 10 && <button type="button" className="ghost small" onClick={() => setOpts(a => [...a, ''])}>+ {tr('افزودن گزینه')}</button>}
      </div>
      <label className="poll-multi"><input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} /> {tr('چند پاسخ مجاز باشد')}</label>
      <div className="row"><button type="button" className="ghost" onClick={onClose}>{tr('انصراف')}</button><button className="primary" disabled={!ok || busy} data-testid="poll-send">{tr('ارسال نظرسنجی')}</button></div>
    </form>
  </Dialog>;
}

// آرای هر نفر = آخرین رأی او؛ رأی‌ها رویداد جدا (ir.tikootak.vote) هستند و در اتاق رمزنگاری‌شده رمز می‌شوند
export function tally(room, pollId) {
  const last = new Map();
  for (const e of room.getLiveTimeline().getEvents()) {
    const type = e.getType();
    if ((type !== VOTE_EVENT && type !== VOTE_EVENT_OLD) || e.isRedacted()) continue;
    const c = e.getContent();
    if (c?.['m.relates_to']?.event_id !== pollId || !Array.isArray(c.choices)) continue;
    const cur = last.get(e.getSender());
    if (!cur || cur.ts <= e.getTs()) last.set(e.getSender(), { ts: e.getTs(), choices: c.choices });
  }
  return last;
}

export function PollCard({ client, room, ev, poll, me }) {
  const id = ev.getId();
  const votes = tally(room, id);
  const counts = {};
  for (const { choices } of votes.values()) for (const c of choices) counts[c] = (counts[c] || 0) + 1;
  const voters = votes.size;
  const mine = votes.get(me)?.choices || [];
  const pending = !id || id.startsWith('~');
  async function vote(oid) {
    if (pending) return;
    let next;
    if (poll.multi) next = mine.includes(oid) ? mine.filter(x => x !== oid) : [...mine, oid];
    else next = mine.includes(oid) ? [] : [oid];
    try { await client.sendEvent(room.roomId, VOTE_EVENT, { 'm.relates_to': { rel_type: 'm.reference', event_id: id }, choices: next }); } catch { /* ignore */ }
  }
  return <div className="poll-card" data-testid="poll-card">
    <strong className="poll-q" dir="auto"><Icon n="poll" size={16} /> {poll.question}</strong>
    <span className="poll-sub">{poll.multi ? tr('چند پاسخ') : tr('تک‌پاسخ')} — {tr('{0} رأی', [fa(voters)])}</span>
    <div className="poll-list" role={poll.multi ? 'group' : 'radiogroup'}>
      {poll.options.map(o => {
        const n = counts[o.id] || 0;
        const pct = voters ? Math.round(n * 100 / voters) : 0;
        const on = mine.includes(o.id);
        return <button type="button" key={o.id} className={`poll-opt ${on ? 'on' : ''}`} onClick={() => vote(o.id)} role={poll.multi ? 'checkbox' : 'radio'} aria-checked={on} data-testid="poll-option">
          <span className="po-bar" style={{ width: `${pct}%` }} />
          <span className="po-mark" aria-hidden="true">{on && <Icon n="check" size={12} />}</span>
          <span className="po-text" dir="auto">{o.text}</span>
          <span className="po-pct">{fa(pct)}٪</span>
        </button>;
      })}
    </div>
  </div>;
}
