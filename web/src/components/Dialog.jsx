import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { toUserId } from '../lib/matrix.js';

// پنجره ساخت گروه یا افزودن عضو. از <dialog> خود مرورگر استفاده می‌کنه
// (Esc، فوکوس و تیرگی پس‌زمینه رایگان است).
export default function Dialog({ client, mode, room, onClose, onCreated }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const domain = client.getDomain();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const ids = members
      .split(/[\s,،]+/)
      .map((m) => toUserId(m, domain))
      .filter(Boolean);
    if (mode === 'create' && !name.trim()) {
      setError('برای گروه یک اسم بنویس.');
      return;
    }
    if (mode === 'invite' && ids.length === 0) {
      setError('نام کاربری حداقل یک نفر را بنویس.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        const res = await client.createRoom({
          name: name.trim(),
          preset: 'private_chat',
          visibility: 'private',
          invite: ids,
        });
        onCreated(res.room_id);
      } else {
        for (const id of ids) await client.invite(room.roomId, id);
        onClose();
      }
    } catch (err) {
      const text = err?.data?.error || '';
      setError(
        /not found|does not exist|profile/i.test(text)
          ? 'یکی از نام‌های کاربری پیدا نشد. اسم را دوباره بررسی کن.'
          : 'انجام نشد. نام‌های کاربری را بررسی کن و دوباره تلاش کن.',
      );
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <form onSubmit={submit} className="dialog-body">
        <header>
          <h2>{mode === 'create' ? 'گروه جدید' : `افزودن عضو به «${room.name}»`}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </header>

        {mode === 'create' && (
          <label className="field">
            <span>اسم گروه</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="مثلاً: شنبه‌شب‌ها" />
          </label>
        )}

        <label className="field">
          <span>{mode === 'create' ? 'اعضا (اختیاری)' : 'اعضا'}</span>
          <input
            dir="ltr"
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            placeholder="ali, sara"
            autoFocus={mode === 'invite'}
            autoCapitalize="none"
            spellCheck="false"
          />
          <small>نام کاربری‌ها را با ویرگول یا فاصله جدا کن. بعد از پذیرفتن دعوت، وارد گروه می‌شوند.</small>
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>انصراف</button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'کمی صبر کن…' : mode === 'create' ? 'ساخت گروه' : 'ارسال دعوت'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
