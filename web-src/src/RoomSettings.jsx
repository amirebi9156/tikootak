import { useState } from 'react';
import { tr } from './i18n.js';
import { Dialog, Avatar, Switch } from './ui.jsx';
import { Icon } from './icons.jsx';
import CropDialog from './Crop.jsx';
import { kindIcon, kindLabel, myPower, canModerate, roomAlias, muteUntil, disappearAfter, DISAPPEAR_EVENT, channelSigning, CHANNEL_SIGNING_EVENT } from './roomtype.js';
import { fa } from './util.js';
import RoomAvatar from './RoomAvatar.jsx';
import { locale } from './i18n.js';

// تنظیمات گفتگو: نام/توضیح، اعضا و نقش‌ها، لینک دعوت، بی‌صدا، ترک
export default function RoomSettings({ client, room, me, kind, muted, onMute, onClose, onInvite, onProfile, onLeft }) {
  const [name, setName] = useState(room.name || '');
  const [topic, setTopic] = useState(room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [, setV] = useState(0);
  const power = myPower(room, me);
  const mod = canModerate(room, me);
  const signed = kind === 'channel' && channelSigning(room);
  const showMemberList = kind !== 'channel' || mod;
  const inviterName = (m) => {
    try {
      const ev = room.currentState.getStateEvents('m.room.member', m.userId);
      const inviter = ev?.getSender?.();
      if (!inviter || inviter === m.userId) return '';
      return room.getMember(inviter)?.name || inviter;
    } catch { return ''; }
  };
  const alias = roomAlias(room);
  const link = alias ? `${window.location.origin}/#/join/${encodeURIComponent(alias)}` : '';
  const pl = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent() || {};
  const createEv = room.currentState.getStateEvents('m.room.create', '');
  const creator = createEv?.getSender?.() || createEv?.getContent?.()?.creator;
  const powerOf = (m) => {
    const n = pl.users?.[m.userId];
    if (Number.isFinite(n)) return n;
    if (creator && m.userId === creator) return 100;
    return Number(pl.users_default || 0);
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    try {
      if (name.trim() && name.trim() !== room.name) await client.setRoomName(room.roomId, name.trim());
      if ((topic.trim() || '') !== (room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '')) {
        await client.setRoomTopic(room.roomId, topic.trim());
      }
      setMsg(tr('ذخیره شد.'));
    } catch {
      setErr(tr('ذخیره نشد؛ دسترسی مدیر لازم است.'));
    }
    setBusy(false);
  }

  const [cropFile, setCropFile] = useState(null);
  function setPhoto(file) { if (file) setCropFile(file); }
  async function uploadPhoto(blob) {
    setCropFile(null);
    setErr(''); setMsg(''); setBusy(true);
    try {
      const up = await client.uploadContent(blob, { type: 'image/jpeg', name: 'avatar.jpg', includeFilename: false });
      await client.sendStateEvent(room.roomId, 'm.room.avatar', { url: up.content_uri, info: { mimetype: 'image/jpeg', w: 512, h: 512 } }, '');
      setV(v => v + 1);
    } catch { setErr(tr('تغییر عکس انجام نشد؛ دسترسی مدیر لازم است.')); }
    setBusy(false);
  }
  async function removePhoto() {
    setErr(''); setBusy(true);
    try { await client.sendStateEvent(room.roomId, 'm.room.avatar', {}, ''); setV(v => v + 1); } catch { setErr(tr('تغییر عکس انجام نشد؛ دسترسی مدیر لازم است.')); }
    setBusy(false);
  }
  async function role(m, level) {
    setErr('');
    try {
      await client.setPowerLevel(room.roomId, m.userId, level);
      setV(v => v + 1);
    } catch { setErr(tr('تغییر نقش انجام نشد.')); }
  }
  async function kick(m) {
    if (!window.confirm(tr('«{0}» از گفتگو حذف شود؟', [m.name]))) return;
    try { await client.kick(room.roomId, m.userId); setV(v => v + 1); } catch { setErr(tr('حذف عضو انجام نشد.')); }
  }
  async function leave() {
    if (!window.confirm(tr('از این گفتگو خارج شوی؟'))) return;
    try { await client.leave(room.roomId); onClose(); onLeft?.(); } catch { setErr(tr('خروج انجام نشد.')); }
  }

  return <Dialog title={tr('تنظیمات گفتگو')} onClose={onClose}>
      <div className="conv-info">
        <span className="room-kind">{kindIcon(kind)}</span> {kindLabel(kind)}
        {client.isRoomEncrypted(room.roomId) ? ` · ${tr('رمزنگاری‌شده')}` : ''}
        {kind === 'channel' && ` · ${tr('فقط مدیران پست می‌گذارند')}`}
      </div>
      {kind !== 'dm' && <div className="room-photo">
          <RoomAvatar client={client} room={room} name={room.name} id={room.roomId} size={72} />
          {mod && <div className="room-photo-acts">
              <label className="btnlike outline small">{tr('تغییر عکس')}<input type="file" accept="image/*" hidden onChange={e => { setPhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {room.currentState.getStateEvents('m.room.avatar', '')?.getContent()?.url && <button type="button" className="small ghost danger-text" onClick={removePhoto}>{tr('حذف عکس')}</button>}
            </div>}
        </div>}
      {mod ? <form className="form" onSubmit={save}>
          <label>{tr('نام')}<input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
          <label>{tr('توضیح کوتاه')}<textarea value={topic} onChange={e => setTopic(e.target.value)} maxLength={200} rows={2} dir="auto" /></label>
          {msg && <p className="ok" role="status">{msg}</p>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row"><button className="primary" disabled={busy}>{busy ? '…' : tr('ذخیره')}</button></div>
        </form> : <p className="muted small-note">{tr('فقط مدیران می‌توانند نام و توضیح را عوض کنند.')}</p>}

      {alias && <div className="set-line">
          <span>{tr('لینک دعوت')}</span>
          <button type="button" className="small outline" onClick={() => {
            navigator.clipboard?.writeText(link);
            setMsg(tr('لینک کپی شد.'));
          }}>{tr('کپی لینک')}</button>
        </div>}
      {alias && <p className="muted small-note" dir="ltr">{link}</p>}

      <div className="set-sub">
        <span className="set-label"><Icon n="timer" size={16} /> {tr('پیام‌های ناپدیدشونده')}</span>
        <div className="chips" role="radiogroup" aria-label={tr('پیام‌های ناپدیدشونده')}>
          {[[0, tr('خاموش')], [3600, tr('۱ ساعت')], [86400, tr('۲۴ ساعت')], [604800, tr('۷ روز')], [2592000, tr('۳۰ روز')]].map(([sec, label]) => {
            const cur = disappearAfter(room);
            return <button type="button" key={sec} role="radio" aria-checked={cur === sec} disabled={!mod} className={'seg-b' + (cur === sec ? ' on' : '')} data-testid={`disappear-${sec}`} onClick={async () => { try { await client.sendStateEvent(room.roomId, DISAPPEAR_EVENT, { seconds: sec }, ''); setV(x => x + 1); } catch { setErr(tr('دسترسی مدیر لازم است.')); } }}>{label}</button>;
          })}
        </div>
        <p className="muted small-note">{mod ? tr('پیام‌های قدیمی‌تر از این زمان برای همه پنهان می‌شوند و فرستنده‌شان آن‌ها را از سرور پاک می‌کند.') : tr('فقط مدیر گفتگو می‌تواند این را تغییر بدهد.')}</p>
      </div>

      {kind === 'channel' && <div className="set-sub">
        <Switch
          title={tr('امضای پیام‌ها')}
          desc={tr('نام ادمین فرستنده، کوچک زیر هر پست نمایش داده می‌شود. پست‌های قبلی هم با تنظیم فعلی دیده می‌شوند.')}
          checked={signed}
          disabled={!mod}
          testid="channel-signing"
          onChange={async v => {
            setErr(''); setMsg('');
            try {
              await client.sendStateEvent(room.roomId, CHANNEL_SIGNING_EVENT, { enabled: !!v }, '');
              setV(x => x + 1); setMsg(tr('ذخیره شد.'));
            } catch { setErr(tr('تغییر امضای پیام‌ها انجام نشد؛ دسترسی مدیر لازم است.')); }
          }}
        />
      </div>}

      <div className="set-sub mute-box">
        <span className="set-label">{muted ? '🔕' : '🔔'} {tr('بی‌صدا کردن')}{muted && muteUntil(room) > Date.now() ? ' · ' + tr('بی‌صدا تا {0}', [new Date(muteUntil(room)).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })]) : ''}</span>
        <div className="chips" role="radiogroup" aria-label={tr('بی‌صدا کردن')}>
          {[['off', tr('باصدا'), 0], ['1h', tr('۱ ساعت'), 3600000], ['8h', tr('۸ ساعت'), 28800000], ['1w', tr('۱ هفته'), 604800000], ['on', tr('همیشه'), true]].map(([k, label, v]) => {
            const until = muteUntil(room);
            const active = !muted ? 'off' : (!until || until - Date.now() > 30 * 864e5) ? 'on' : null;
            return <button type="button" key={k} role="radio" aria-checked={active === k} className={'seg-b' + (active === k ? ' on' : '')} onClick={() => onMute?.(v)}>{label}</button>;
          })}
        </div>
      </div>

      {showMemberList ? <div className="set-sub">
        <h4>{tr('اعضا')} · {fa(room.getMembersWithMembership('join').length)}</h4>
        <ul className="plain members">
          {room.getMembersWithMembership('join').map(m => {
            const p = powerOf(m);
            const inv = mod ? inviterName(m) : '';
            return <li key={m.userId} className="member-row">
                <button className="room" onClick={() => { onClose(); onProfile(m.userId); }}>
                  <Avatar name={m.name} id={m.userId} size={38} />
                  <div className="room-main"><strong dir="auto">{m.name}</strong><span className="muted" dir="ltr">{m.userId}</span>{inv && <span className="muted member-inviter">{tr('دعوت‌شده توسط {0}', [inv])}</span>}</div>
                  <span className="role-tag">{p >= 50 ? tr('مدیر') : tr('عضو')}</span>
                </button>
                {mod && m.userId !== me && power > p && <span className="member-acts">
                    {p < 50 && <button className="small ghost" onClick={() => role(m, 50)}>{tr('مدیر کن')}</button>}
                    {p >= 50 && <button className="small ghost" onClick={() => role(m, 0)}>{tr('عضو کن')}</button>}
                    <button className="small ghost danger-text" onClick={() => kick(m)}>{tr('حذف')}</button>
                  </span>}
              </li>;
          })}
          {room.getMembersWithMembership('invite').map(m => <li key={m.userId} className="muted pad-s">{tr('دعوت‌شده:')} {m.name}</li>)}
        </ul>
      </div> : <p className="muted small-note" data-testid="members-hidden">{tr('لیست اعضای کانال فقط برای مدیران است.')}</p>}

      <div className="dlg-actions">
        <button type="button" className="outline wide" onClick={() => { onClose(); onInvite(); }}><Icon n="userplus" size={18} /> {tr('دعوت نفر جدید')}</button>
        <button type="button" className="outline danger-out wide" onClick={leave}>{tr('ترک گفتگو')}</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {cropFile && <CropDialog file={cropFile} shape="square" out={512} title={tr('برش عکس گفتگو')} onCancel={() => setCropFile(null)} onDone={uploadPhoto} />}
    </Dialog>;
}
