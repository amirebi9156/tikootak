import { useEffect, useMemo, useState } from 'react';
import { tr } from './i18n.js';
import { Icon } from './icons.jsx';
import { Avatar } from './ui.jsx';
import { profileGet } from './api.js';
import { isMusic } from './chatMusic.js';
import { fa } from './util.js';
import { useBackLayer } from './backstack.js';
import { useReport } from './Report.jsx';
import { Thumb } from './ChatInfo.jsx';

// برگهٔ شیشه‌ایِ پروفایل کاربر داخل چت (مثل تلگرام): بدون خروج از گفتگو باز می‌شود.
export default function UserSheet({ client, room, me, userId, token, blocked, onClose, onMessage, onProfile, onBlock, onOpenMedia }) {
  useBackLayer(true, onClose);
  const [prof, setProf] = useState(null);
  const [report, reportDialog] = useReport(token);
  const member = room.getMember(userId);
  const name = prof?.name || member?.name || userId.split(':')[0].replace(/^@/, '');
  const isMe = userId === me;
  useEffect(() => {
    let dead = false;
    profileGet(token, userId).then(p => { if (!dead) setProf(p); }).catch(() => {});
    return () => { dead = true; };
  }, [token, userId]);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const power = member?.powerLevel ?? 0;
  const role = power >= 100 ? tr('مالک') : power >= 50 ? tr('مدیر') : tr('عضو');
  const shared = useMemo(() => {
    const out = { media: [], files: 0, links: 0, music: 0 };
    const evs = room.getLiveTimeline().getEvents();
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.getSender() !== userId || ev.getType() !== 'm.room.message' || ev.isRedacted?.()) continue;
      const c = ev.getContent();
      if (!c?.msgtype) continue;
      if (c.msgtype === 'm.image' || c.msgtype === 'm.video') { if (!c['ir.tikootak.sticker'] && out.media.length < 6) out.media.push({ id: ev.getId(), c }); }
      else if (isMusic(c)) out.music++;
      else if (c.msgtype === 'm.file') out.files++;
      else if (/https?:\/\//.test(c.body || '')) out.links++;
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, userId, room.getLiveTimeline().getEvents().length]);

  const act = (icon, label, fn, danger) => <button type="button" className={`ci-act ${danger ? 'danger' : ''}`} onClick={fn}><Icon n={icon} size={22} /><span>{label}</span></button>;
  return <div className="usheet-wrap" data-testid="user-sheet">
    <button type="button" className="usheet-scrim" aria-label={tr('بستن')} onClick={onClose} />
    <div className="usheet" role="dialog" aria-label={tr('پروفایل کاربر')}>
      <span className="usheet-grab" aria-hidden="true" />
      <div className="usheet-hero">
        <Avatar name={name} id={userId} size={96} />
        <h3 dir="auto">{name}</h3>
        <p className="ci-sub" dir="ltr">@{userId.split(':')[0].replace(/^@/, '')}</p>
        {member && <span className="role-tag">{role}</span>}
      </div>
      <div className="ci-acts">
        {!isMe && act('chat', tr('پیام'), () => { onClose(); onMessage(userId); })}
        {act('user', tr('پروفایل'), () => { onClose(); onProfile(userId); })}
        {!isMe && act('flag', tr('گزارش'), () => report('user', userId))}
        {!isMe && !blocked && act('block', tr('مسدود'), () => { onClose(); onBlock(userId); }, true)}
      </div>
      {prof?.bio && <div className="ci-card"><div className="ci-line"><strong dir="auto">{prof.bio}</strong><span>{tr('درباره')}</span></div></div>}
      {(shared.media.length > 0 || shared.files + shared.links + shared.music > 0) && <div className="usheet-shared">
        <h4>{tr('اشتراک‌گذاشته در این گفتگو')}</h4>
        {shared.media.length > 0 && <div className="ci-grid usheet-grid">{shared.media.map(m => <Thumb key={m.id} client={client} content={m.c} onOpen={onOpenMedia} />)}</div>}
        <p className="muted">{[shared.files && `${fa(shared.files)} ${tr('فایل')}`, shared.links && `${fa(shared.links)} ${tr('لینک')}`, shared.music && `${fa(shared.music)} ${tr('موزیک')}`].filter(Boolean).join(' · ')}</p>
      </div>}
    </div>
    {reportDialog}
  </div>;
}
