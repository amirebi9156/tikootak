import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { dayFa } from '../lib/format.js';
import { lastMessage, previewText } from '../lib/matrix.js';
import { NotificationCountType } from 'matrix-js-sdk';

export default function Sidebar({
  client, rooms, invites, activeId, ready, myName,
  onSelect, onNew, onLogout, callRoom, onBackToCall,
}) {
  return (
    <aside className="sidebar">
      <header className="side-head">
        <span className="wordmark small">همدم</span>
        <div className="side-actions">
          <button className="icon-btn" onClick={onNew} aria-label="گروه جدید" title="گروه جدید">
            <Icon name="plus" />
          </button>
          <button className="icon-btn" onClick={onLogout} aria-label="خروج از حساب" title="خروج از حساب">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      {callRoom && (
        <button className="call-pill" onClick={onBackToCall}>
          <span className="live-dot" aria-hidden="true" />
          در تماس: {callRoom.name}
        </button>
      )}

      <div className="side-scroll">
        {invites.length > 0 && (
          <section aria-label="دعوت‌ها">
            <h2 className="side-title">دعوت‌ها</h2>
            <ul className="room-list">
              {invites.map((r) => (
                <li key={r.roomId} className="invite-row">
                  <Avatar id={r.roomId} name={r.name} />
                  <div className="room-text">
                    <strong>{r.name}</strong>
                    <span>دعوت شدی به این گروه</span>
                  </div>
                  <button className="icon-btn ok" onClick={() => client.joinRoom(r.roomId).then(() => onSelect(r.roomId))} aria-label={`پذیرفتن دعوت ${r.name}`}>
                    <Icon name="check" />
                  </button>
                  <button className="icon-btn" onClick={() => client.leave(r.roomId)} aria-label={`رد دعوت ${r.name}`}>
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!ready && <p className="side-note">در حال اتصال…</p>}

        {ready && rooms.length === 0 && invites.length === 0 && (
          <div className="side-empty">
            <p><strong>هنوز گروهی نداری.</strong></p>
            <p>یک گروه بساز و دوستانت را با نام کاربری‌شان دعوت کن.</p>
            <button className="btn primary" onClick={onNew}>ساخت اولین گروه</button>
          </div>
        )}

        <ul className="room-list">
          {rooms.map((r) => {
            const last = lastMessage(r);
            const unread = r.getUnreadNotificationCount(NotificationCountType.Total);
            return (
              <li key={r.roomId}>
                <button
                  className="room-row"
                  aria-current={r.roomId === activeId ? 'true' : undefined}
                  onClick={() => onSelect(r.roomId)}
                >
                  <Avatar id={r.roomId} name={r.name} />
                  <span className="room-text">
                    <strong>{r.name}</strong>
                    <span dir="auto">{last ? previewText(last) : 'هنوز پیامی نیست'}</span>
                  </span>
                  <span className="room-meta">
                    {last && <time>{dayFa(last.getTs())}</time>}
                    {unread > 0 && r.roomId !== activeId && <b className="badge">{unread.toLocaleString('fa-IR')}</b>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="side-foot">{myName}</footer>
    </aside>
  );
}
