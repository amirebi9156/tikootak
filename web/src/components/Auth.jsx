import { useState } from 'react';
import { login, register, errorText, ApiError } from '../lib/api.js';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | register
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ invite: '', username: '', displayname: '', password: '' });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const username = form.username.trim().toLowerCase();
      const data =
        mode === 'register'
          ? await register({
              invite: form.invite.trim(),
              username,
              password: form.password,
              displayname: form.displayname.trim() || username,
            })
          : await login({ username, password: form.password });
      onAuth({ accessToken: data.access_token, userId: data.user_id, deviceId: data.device_id });
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'unknown'));
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <div className="breath" aria-hidden="true">
          <span className="breath-ring r3" />
          <span className="breath-ring r2" />
          <span className="breath-ring r1" />
          <span className="wordmark">همدم</span>
        </div>
        <p className="tagline">جایی برای حرف زدن با آدم‌هایی که دوستشان داری</p>
      </div>

      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="seg" role="tablist" aria-label="ورود یا ساخت حساب">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>
            ورود
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>
            ساخت حساب
          </button>
        </div>

        {mode === 'register' && (
          <label className="field">
            <span>کد دعوت</span>
            <input
              dir="ltr"
              value={form.invite}
              onChange={(e) => setForm((f) => ({ ...f, invite: e.target.value.toUpperCase() }))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck="false"
              placeholder="XXXXX-XXXXX"
              required
            />
          </label>
        )}

        <label className="field">
          <span>نام کاربری</span>
          <input
            dir="ltr"
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="ali"
            required
          />
          {mode === 'register' && <small>حروف کوچک انگلیسی، عدد، نقطه یا خط تیره. حداقل ۳ حرف.</small>}
        </label>

        {mode === 'register' && (
          <label className="field">
            <span>نامی که دیگران می‌بینند</span>
            <input value={form.displayname} onChange={set('displayname')} autoComplete="nickname" maxLength={40} placeholder="علی" />
          </label>
        )}

        <label className="field">
          <span>رمز عبور</span>
          <input
            dir="ltr"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
          />
          {mode === 'register' && <small>حداقل ۸ حرف.</small>}
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn primary wide" disabled={busy}>
          {busy ? 'کمی صبر کن…' : mode === 'register' ? 'ساخت حساب' : 'ورود'}
        </button>
      </form>
    </main>
  );
}
