import { useState } from 'react';
import { tr } from './i18n.js';
import { Dialog } from './ui.jsx';
import { reportCreate } from './api.js';

const REASONS = [
  ['spam', "اسپم یا تبلیغ"],
  ['abuse', "توهین یا آزار"],
  ['nudity', "محتوای نامناسب"],
  ['violence', "خشونت"],
  ['other', "سایر"],
];

function ReportDialog({ token, kind, id, onClose }) {
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await reportCreate(token, kind, String(id), reason, note.trim());
      setDone(true);
    } catch (x) {
      setErr(x.code === 'rate_limited' || x.status === 429 ? tr("گزارش‌های زیادی فرستادی؛ بعداً دوباره تلاش کن.") : tr("ارسال گزارش ناموفق بود."));
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return <Dialog title={tr("گزارش")} onClose={onClose}>
        <p role="status">{tr("گزارشت ثبت شد. ممنون؛ مدیر بررسی می‌کند.")}</p>
        <button className="primary" onClick={onClose}>{tr("بستن")}</button>
      </Dialog>;
  }
  return <Dialog title={tr("گزارش")} onClose={onClose}>
      <form onSubmit={submit} className="report-form">
        <fieldset className="report-reasons">
          <legend className="muted">{tr("دلیل گزارش")}</legend>
          {REASONS.map(([k, label]) => <label key={k} className="report-opt">
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              <span>{tr(label)}</span>
            </label>)}
        </fieldset>
        <label>{tr("توضیح (اختیاری)")}
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={3} dir="auto" />
        </label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row-btns">
          <button type="button" className="ghost" onClick={onClose}>{tr("انصراف")}</button>
          <button className="primary" disabled={busy}>{tr("ارسال گزارش")}</button>
        </div>
      </form>
    </Dialog>;
}

// استفاده: const [report, reportDialog] = useReport(token); report('post', id); و {reportDialog} را رندر کن
export function useReport(token) {
  const [target, setTarget] = useState(null);
  const open = (kind, id) => setTarget({ kind, id });
  const node = target ? <ReportDialog token={token} kind={target.kind} id={target.id} onClose={() => setTarget(null)} /> : null;
  return [open, node];
}
