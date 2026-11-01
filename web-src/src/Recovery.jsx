import { tr, locale } from './i18n.js';
import { useState } from 'react';
import { Dialog } from './ui.jsx';
import { createRecovery, restoreWithKey, migrateLegacyRecovery, hasPendingMigration } from './recovery.js';
export function RecoverySetup({
  client,
  onClose,
  onDone
}) {
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  async function make() {
    setBusy(true);
    setErr('');
    try {
      setKey(await createRecovery(client));
    } catch (e) {
      setErr(e?.message || tr("ساخت کلید انجام نشد."));
    }
    setBusy(false);
  }
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tr("کلید بازیابی TIKOOTAK\n\n{0}\n", [key])], {
      type: 'text/plain'
    }));
    a.download = 'tikootak-recovery-key.txt';
    a.click();
  }
  return <Dialog title={tr("کلید بازیابی پیام‌ها")} onClose={key && !saved ? () => {} : onClose}>
      {!key ? <div className="form">
          <p>{tr("پیام‌ها رمزنگاری سرتاسری‌اند و کلیدشان فقط روی همین مرورگر است. اگر مرورگر را پاک کنی یا با دستگاه دیگری وارد شوی، بدون کلید بازیابی پیام‌های قبلی را نمی‌بینی.")}</p>
          <p>{tr("یک کلید بازیابی می‌سازیم. آن را جایی امن نگه دار (مثلاً یادداشت گوشی). ما نمی‌توانیم آن را برایت بازیابی کنیم.")}</p>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={onClose}>{tr("بعداً")}</button>
            <button className="primary" disabled={busy} onClick={make}>{busy ? tr("صبر کن…") : tr("ساخت کلید")}</button>
          </div>
        </div> : <div className="form">
          <p>{tr("این کلید فقط همین یک بار نشان داده می‌شود:")}</p>
          <code className="rkey" dir="ltr" data-testid="rkey">{key}</code>
          <div className="row">
            <button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(key)}>{tr("کپی")}</button>
            <button type="button" className="ghost" onClick={download}>{tr("ذخیره فایل")}</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> {tr("کلید را جای امنی ذخیره کردم")}
          </label>
          <div className="row">
            <button className="primary" disabled={!saved} onClick={onDone}>{tr("تمام")}</button>
          </div>
        </div>}
    </Dialog>;
}
export function RecoveryRestore({
  client,
  onClose,
  onDone
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [n, setN] = useState(null);
  async function go(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const cnt = await restoreWithKey(client, text);
      if (cnt > 0) await migrateLegacyRecovery(client);
      setN(cnt);
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  }
  return <Dialog title={tr("بازیابی پیام‌های قبلی")} onClose={onClose}>
      {n === null ? <form className="form" onSubmit={go}>
          <p>{tr("کلید بازیابی‌ات را وارد کن تا پیام‌های قبلی روی این دستگاه باز شوند.")}</p>
          {hasPendingMigration() && <p className="muted small-note">{tr("ساخت حساب‌ات با روش قدیمی بوده؛ کلید ۱۲ بخشی را یک‌بار وارد کن تا از این به بعد خودکار شود.")}</p>}
          <label>{tr("کلید بازیابی")}
            <textarea value={text} onChange={e => setText(e.target.value)} dir="ltr" rows={3} spellCheck="false" required />
          </label>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={onClose}>{tr("بعداً")}</button>
            <button className="primary" disabled={busy}>{busy ? tr("صبر کن…") : tr("بازیابی")}</button>
          </div>
        </form> : <div className="form">
          {n > 0 ? <p className="ok">{tr("بازیابی شد ({0} کلید).", [n.toLocaleString(locale)])}<br /><span className="muted small-note">{tr("فقط یک‌بار لازم است: بعد از بازیابی، پیام‌هایت از این به بعد در هر دستگاه فقط با رمز عبور باز می‌شوند.")}</span></p>
            : <p className="warn" role="status">{tr("هنوز کلیدی روی سرور پیدا نشد. اگر تازه پیام فرستاده‌ای، پشتیبان‌گیری چند ثانیه تا چند دقیقه طول می‌کشد؛ کمی صبر کن و دوباره امتحان کن.")}</p>}
          <div className="row">
            {n === 0 && <button className="ghost" onClick={() => setN(null)}>{tr("تلاش دوباره")}</button>}
            <button className="primary" onClick={onDone}>{tr("تمام")}</button>
          </div>
        </div>}
    </Dialog>;
}