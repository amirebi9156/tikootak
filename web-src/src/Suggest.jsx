// Q2 — پیشنهاد کاربر/کانال هنگام تایپ. داده از gateway و مرتب‌شده prefix-first.
import { useEffect, useState } from 'react';
import { tr } from './i18n.js';
import { peopleSuggest } from './api.js';
import { Avatar } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fa } from './util.js';

const local = (id) => String(id || '').replace(/^@/, '').split(':')[0];

export function usePeopleSuggest(token, q, { min = 1, debounce = 200 } = {}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const query = String(q || '').trim().replace(/^@/, '');
    if (!token || query.length < min) {
      setUsers([]);
      setLoading(false);
      return undefined;
    }
    let dead = false;
    setLoading(true);
    const t = setTimeout(() => {
      peopleSuggest(token, query).then((d) => {
        if (!dead) { setUsers(d.users || []); setLoading(false); }
      }).catch(() => {
        if (!dead) { setUsers([]); setLoading(false); }
      });
    }, debounce);
    return () => { dead = true; clearTimeout(t); };
  }, [token, q, min, debounce]);
  return { users, loading };
}

export function PeopleSuggest({ users, active = -1, onPick, testid = 'people-suggest' }) {
  if (!users?.length) return null;
  return (
    <ul className="suggest-pop" role="listbox" aria-label={tr('پیشنهاد افراد')} data-testid={testid}>
      {users.map((u, i) => (
        <li key={u.user_id} role="option" aria-selected={i === active}>
          <button type="button" className={`suggest-row ${i === active ? 'on' : ''}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onPick?.(u)}>
            <Avatar name={u.name} id={u.user_id} size={32} />
            <span className="suggest-main">
              <strong dir="auto">{u.name}{u.verified && <span className="verified-badge" title={tr('تأییدشده')} data-testid="verified"><Icon n="check" size={11} /></span>}</strong>
              <span className="muted" dir="ltr">@{local(u.user_id)}</span>
            </span>
            {u.is_private && <Icon n="lock" size={13} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoomSuggestList({ rooms, busy, onJoin, testid = 'room-suggest' }) {
  if (!rooms?.length) return null;
  return (
    <ul className="plain pub-list" data-testid={testid}>
      {rooms.map((room) => (
        <li key={room.room_id} className="room pub-room">
          <Avatar name={room.name} id={room.room_id} size={40} />
          <div className="room-main">
            <strong dir="auto">{room.name}</strong>
            <span className="muted" dir="ltr">{room.alias || ''} · {tr('{0} عضو', [fa(room.members || 0)])}</span>
            {room.topic && <span className="muted small-note" dir="auto">{room.topic}</span>}
          </div>
          <button className="small primary" disabled={busy} onClick={() => onJoin?.(room)}>{tr('بپیوند')}</button>
        </li>
      ))}
    </ul>
  );
}
