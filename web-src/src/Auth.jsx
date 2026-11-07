import { tr } from './i18n.js';
import { useState, useEffect } from 'react';
import { login, register, errText, publicConfig } from './api.js';
import { setLoginPassword } from './recovery.js';
import { Logo, LogoWordmark, LangSwitch } from './ui.jsx';
import { Icon } from './icons.jsx';
export default function Auth({
  onAuthed
}) {
  const [mode, setMode] = useState('login');
  const [showPw, setShowPw] = useState(false);
  const [f, setF] = useState({
    invite: '',
    username: '',
    displayname: '',
    password: ''
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [closed, setClosed] = useState(null);
  useEffect(() => { publicConfig().then(c => setClosed(c.registration_open ? null : (c.message || tr('ثبت‌نام فعلاً بسته است. بعداً دوباره سر بزن.')))).catch(() => {}); }, []);
  const set = k => e => setF({
    ...f,
    [k]: e.target.value
  });
  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const username = f.username.trim().toLowerCase();
      const s = mode === 'login' ? await login(username, f.password) : await register(f.invite.trim(), username, f.password, f.displayname.trim() || username);
      // رمز فقط در حافظهٔ همین تب می‌ماند تا پشتیبان رمزنگاری بی‌صدا ساخته/بازیابی شود
      setLoginPassword(f.password);
      onAuthed(s);
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth">
      <section className="auth-art" aria-hidden="true">
        <LogoWordmark size={220} className="auth-wordmark" />
        <p>{tr("با هم، نزدیک‌تر.")}</p>
      </section>

      <section className="auth-panel">
        <LangSwitch className="corner" />
        <div className="auth-brand"><Logo size={30} /></div>
        <div>
          <h1 className="auth-hello">{mode === 'login' ? tr("خوش اومدی!") : tr("یه حساب بساز")}</h1>
          <p className="muted auth-sub">{mode === 'login' ? tr("نام کاربری و رمزت رو وارد کن.") : tr("با کد دعوتی که دوستت بهت داده.")}</p>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => {
          setMode('login');
          setErr('');
        }}>{tr("ورود")}</button>
          <button role="tab" aria-selected={mode === 'register'} onClick={() => {
          setMode('register');
          setErr('');
        }}>{tr("ساخت حساب")}</button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === 'register' && <label>
              {tr("کد دعوت")}
              <input value={f.invite} onChange={set('invite')} dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="XXXXX-XXXXX" required />
            </label>}
          <label>
            {tr("نام کاربری")}
            <input value={f.username} onChange={set('username')} dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder="ali" required />
          </label>
          {mode === 'register' && <label>
              {tr("نامی که دوستانت می‌بینند")}
              <input value={f.displayname} onChange={set('displayname')} autoComplete="nickname" maxLength={40} />
            </label>}
          <label>
            {tr("رمز عبور")}
            <span className="pw-wrap">
              <input type={showPw ? 'text' : 'password'} value={f.password} onChange={set('password')} dir="ltr" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} required />
              <button type="button" className="pw-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? tr("پنهان کردن رمز") : tr("نمایش رمز")} aria-pressed={showPw} data-testid="pw-eye"><Icon n={showPw ? 'eyeoff' : 'eye'} size={18} /></button>
            </span>
          </label>
          {mode === 'register' && <p className="hint">{tr("رمز حداقل ۱۰ کاراکتر باشد. اگر فراموشش کنی راه بازیابی نداریم.")}</p>}
          {mode === 'register' && closed && <p className="error" role="status">{closed}</p>}
          {err && <p className="error" role="alert">{err}</p>}
          <button className="primary" disabled={busy}>
            {busy ? tr("صبر کن…") : mode === 'login' ? tr("ورود") : tr("ساخت حساب")}
          </button>
        </form>
      </section>
    </main>;
}