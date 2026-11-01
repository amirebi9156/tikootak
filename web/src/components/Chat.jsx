import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Direction } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { timeFa, sameDay, dayHeading, localpart } from '../lib/format.js';
import { visibleMessages } from '../lib/matrix.js';

export default function Chat({ client, room, inCall, onBack, onCall, onInvite }) {
  const me = client.getUserId();
  const events = visibleMessages(room);
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const [text, setText] = useState('');
  const [loadingOld, setLoadingOld] = useState(false);
  const taRef = useRef(null);

  const canLoadMore = !!room.getLiveTimeline().getPaginationToken(Direction.Backward);
  const lastId = events.length ? events[events.length - 1].getId() : null;

  // اگر کاربر پایین لیست است با پیام تازه پایین بماند
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lastId, room.roomId]);

  useEffect(() => {
    stickRef.current = true;
  }, [room.roomId]);

  // رسید خواندن: پیام آخر را «خوانده» علامت می‌زنیم تا شمارنده صفر شود
  useEffect(() => {
    const evs = room.getLiveTimeline().getEvents();
    const last = [...evs].reverse().find((e) => e.getId() && !e.status);
    if (last && document.visibilityState === 'visible') {
      client.sendReadReceipt(last).catch(() => {});
    }
  }, [client, room, lastId]);

  function onScroll() {
    const el = listRef.current;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    const el = listRef.current;
    const before = el.scrollHeight;
    setLoadingOld(true);
    try {
      await client.scrollback(room, 40);
    } finally {
      setLoadingOld(false);
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - before;
      });
    }
  }

  function grow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    stickRef.current = true;
    requestAnimationFrame(grow);
    try {
      await client.sendMessage(room.roomId, { msgtype: 'm.text', body });
    } catch {
      /* پیام با وضعیت «ارسال نشد» در لیست می‌ماند */
    }
  }

  function onKeyDown(e) {
    const desktop = window.matchMedia('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && desktop && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const nameOf = (userId) => room.getMember(userId)?.name || localpart(userId);

  const rows = [];
  let prev = null;
  for (const ev of events) {
    const ts = ev.getTs();
    if (!prev || !sameDay(prev.getTs(), ts)) rows.push({ kind: 'day', key: `d${ts}`, label: dayHeading(ts) });
    const c = ev.getContent();
    if (c.msgtype === 'm.notice') {
      rows.push({ kind: 'notice', key: ev.getId() || ev.getTxnId(), ev });
    } else {
      const first = !prev || prev.getSender() !== ev.getSender() || prev.getContent().msgtype === 'm.notice' || !sameDay(prev.getTs(), ts);
      rows.push({ kind: 'msg', key: ev.getId() || ev.getTxnId(), ev, first });
    }
    prev = ev;
  }

  const members = room.getJoinedMemberCount();

  return (
    <section className="chat" aria-label={room.name}>
      <header className="chat-head">
        <button className="icon-btn only-mobile" onClick={onBack} aria-label="بازگشت به گروه‌ها">
          <Icon name="back" />
        </button>
        <Avatar id={room.roomId} name={room.name} size={40} />
        <div className="chat-title">
          <h1>{room.name}</h1>
          <span>{members.toLocaleString('fa-IR')} عضو</span>
        </div>
        <button className="icon-btn" onClick={onInvite} aria-label="افزودن عضو" title="افزودن عضو">
          <Icon name="users" />
        </button>
        {!inCall && (
          <button className="btn call-btn" onClick={onCall}>
            <Icon name="headset" size={20} />
            تماس گروهی
          </button>
        )}
      </header>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {canLoadMore && (
          <button className="btn quiet more" onClick={loadOlder} disabled={loadingOld}>
            {loadingOld ? 'در حال بارگذاری…' : 'پیام‌های قدیمی‌تر'}
          </button>
        )}

        {events.length === 0 && (
          <p className="chat-empty">اینجا هنوز ساکته. اولین پیام را بفرست.</p>
        )}

        {rows.map((r) => {
          if (r.kind === 'day') return <div key={r.key} className="day"><span>{r.label}</span></div>;
          const { ev } = r;
          const c = ev.getContent();
          if (r.kind === 'notice') {
            return <div key={r.key} className="notice" dir="auto">{c.body}</div>;
          }
          const mine = ev.getSender() === me;
          const encrypted = ev.getType() === 'm.room.encrypted';
          const plain = c.msgtype === 'm.text' || c.msgtype === 'm.emote';
          const pending = !!ev.status;
          return (
            <div key={r.key} className={`msg ${mine ? 'out' : 'in'}${r.first ? ' first' : ''}`}>
              <div className={`bubble${pending ? ' pending' : ''}`}>
                {!mine && r.first && <span className="sender">{nameOf(ev.getSender())}</span>}
                {encrypted ? (
                  <span className="muted">پیام رمزگذاری‌شده. این نسخه از همدم هنوز آن را نمی‌خواند.</span>
                ) : plain ? (
                  <span className="text" dir="auto">{c.body}</span>
                ) : (
                  <span className="muted">پیوست‌ها هنوز پشتیبانی نمی‌شوند.</span>
                )}
                <time>{ev.status === 'not_sent' ? 'ارسال نشد' : timeFa(ev.getTs())}</time>
              </div>
            </div>
          );
        })}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={taRef}
          rows={1}
          dir="auto"
          value={text}
          onChange={(e) => { setText(e.target.value); grow(); }}
          onKeyDown={onKeyDown}
          placeholder="یک پیام بنویس"
          aria-label="متن پیام"
        />
        <button className="send" disabled={!text.trim()} aria-label="ارسال">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}
