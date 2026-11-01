import { useEffect, useState } from 'react';
import { tr } from './i18n.js';
import { notificationsList, notificationsRead, notificationsClear, followRequests, followAccept, followDecline } from './api.js';
import { Avatar, Dialog } from './ui.jsx';
import { usePerson } from './people.js';
import { ago, fmtDay, fa } from './util.js';

const LINE = {
  like: 'پستت را پسندید',
  comment: 'برای پستت نظر داد',
  comment_like: 'نظرت را پسندید',
  follow: 'تو را دنبال کرد',
  follow_request: 'درخواست دنبال‌کردن داد',
  follow_accept: 'درخواست دنبال‌کردنت را پذیرفت',
};

function FollowReqRow({ r, onAccept, onDecline, onProfile, busy }) {
  return <li className="msgreq" data-testid="follow-req">
      <Avatar name={r.name} id={r.user_id} size={44} />
      <div className="msgreq-main">
        <button className="plainbtn req-name" onClick={() => onProfile?.(r.user_id)} disabled={!onProfile}>
          <strong>{r.name}</strong>
        </button>
        <span className="muted">{tr("می‌خواهد دنبالت کند.")}</span>
      </div>
      <div className="msgreq-actions">
        <button className="small primary" disabled={busy} onClick={() => onAccept(r.user_id)}>{tr("قبول")}</button>
        <button className="small ghost" disabled={busy} onClick={() => onDecline(r.user_id)}>{tr("رد")}</button>
      </div>
    </li>;
}

function ReqRow({ r, onAccept, onDecline, onProfile }) {
  const p = usePerson(r.inviter);
  const name = p?.name || String(r.inviter || '').replace(/^@/, '').split(':')[0];
  return <li className="msgreq" data-testid="msgreq">
      <Avatar name={name} id={r.inviter} size={44} />
      <div className="msgreq-main">
        <button className="plainbtn req-name" onClick={() => onProfile?.(r.inviter)} disabled={!onProfile}>
          <strong>{name}</strong>
        </button>
        <span className="muted">{tr("می‌خواهد به تو پیام خصوصی بدهد.")}</span>
      </div>
      <div className="msgreq-actions">
        <button className="small primary" onClick={() => onAccept(r.roomId)}>{tr("قبول")}</button>
        <button className="small ghost" onClick={() => onDecline(r.roomId)}>{tr("رد")}</button>
      </div>
    </li>;
}

// زنگوله: اعلان‌ها (لایک/نظر/فالو) و درخواست‌های پیام، هر دو در یک پنل.
export default function Notifications({
  token, requests = [], onClose, onOpenPost, onProfile, onRead, onAccept, onDecline,
}) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [freqs, setFreqs] = useState(null);
  const [freqBusy, setFreqBusy] = useState(false);
  const [tab, setTab] = useState(requests.length ? 'requests' : 'notif');

  useEffect(() => {
    let dead = false;
    followRequests(token).then(d => {
      if (!dead) setFreqs(d.requests || []);
    }).catch(() => {
      if (!dead) setFreqs([]);
    });
    return () => { dead = true; };
  }, [token]);

  useEffect(() => {
    let dead = false;
    notificationsList(token).then(d => {
      if (dead) return;
      setItems(d.notifications);
      setMore(d.notifications.length >= 30);
      if (d.unread > 0) {
        notificationsRead(token).then(r => {
          if (!dead) onRead?.(r.unread);
        }).catch(() => {});
      }
    }).catch(() => {
      if (!dead) {
        setErr(tr('اعلان‌ها بارگذاری نشد.'));
        setItems([]);
      }
    });
    return () => { dead = true; };
    // onRead عمداً در وابستگی‌ها نیست تا هر رندر Shell باعث بارگذاری دوباره نشود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadMore() {
    if (!items?.length || busy) return;
    setBusy(true);
    try {
      const d = await notificationsList(token, items[items.length - 1].id);
      setItems(cur => [...(cur || []), ...d.notifications]);
      setMore(d.notifications.length >= 30);
    } catch {/* ignore */}
    setBusy(false);
  }

  async function clearAll() {
    if (!window.confirm(tr('همه اعلان‌ها پاک شود؟'))) return;
    try {
      await notificationsClear(token);
      setItems([]);
      setMore(false);
      onRead?.(0);
    } catch {/* ignore */}
  }

  async function answerFollow(r, accept) {
    if (freqBusy) return;
    setFreqBusy(true);
    try {
      if (accept) await followAccept(token, r.user_id); else await followDecline(token, r.user_id);
      setFreqs(list => (list || []).filter(x => x.user_id !== r.user_id));
    } catch {/* ignore */}
    setFreqBusy(false);
  }

  function open(n) {
    if (n.kind === 'follow' || n.kind === 'follow_request' || n.kind === 'follow_accept') {
      onClose();
      onProfile(n.actor);
      return;
    }
    if (n.ref_id) {
      onClose();
      onOpenPost(n.ref_id);
    }
  }

  return (
    <Dialog title={tr('اعلان‌ها')} onClose={onClose}>
      <div className="seg notif-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'notif'} className={tab === 'notif' ? 'on' : ''} onClick={() => setTab('notif')}>
          {tr('اعلان‌ها')}{items?.length ? <span className="notif-count">{fa(items.length)}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'follows'} className={tab === 'follows' ? 'on' : ''} onClick={() => setTab('follows')} data-testid="follow-req-tab">
          {tr('درخواست فالو')}{freqs?.length ? <span className="notif-count hot">{fa(freqs.length)}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>
          {tr('درخواست‌ها')}{requests.length ? <span className="notif-count hot">{fa(requests.length)}</span> : null}
        </button>
      </div>

      {tab === 'follows' ? (
        freqs === null
          ? <p className="muted notif-empty">…</p>
          : freqs.length === 0
            ? <p className="muted notif-empty">{tr('درخواست دنبال‌کردن جدیدی نداری.')}</p>
            : <ul className="plain req-list">
                {freqs.map(r => <FollowReqRow key={r.user_id} r={r} busy={freqBusy} onAccept={() => answerFollow(r, true)} onDecline={() => answerFollow(r, false)} onProfile={id => { onProfile(id); onClose(); }} />)}
              </ul>
      ) : tab === 'requests' ? (
        requests.length === 0
          ? <p className="muted notif-empty">{tr('درخواست جدیدی نداری. پیام کسانی که دنبالشان نمی‌کنی اینجا می‌آید.')}</p>
          : <ul className="plain req-list">
              {requests.map(r => <ReqRow key={r.roomId} r={r} onAccept={onAccept} onDecline={onDecline} onProfile={id => { onProfile(id); onClose(); }} />)}
            </ul>
      ) : (
        <>
          {items?.length > 0 && (
            <div className="notif-top">
              <span className="muted">{tr('{0} اعلان', [fa(items.length)])}</span>
              <button className="small ghost" onClick={clearAll}>{tr('پاک کردن همه')}</button>
            </div>
          )}
          {err && <p className="error" role="alert">{err}</p>}
          <ul className="plain notif-list">
            {items === null && <li className="muted notif-empty">…</li>}
            {items?.length === 0 && <li className="muted notif-empty">{tr('اعلان جدیدی نداری. وقتی کسی پستت را لایک کند یا دنبالت کند، اینجا خبردار می‌شوی.')}</li>}
            {items?.map(n => {
              const preview = n.extra?.text || n.extra?.preview || '';
              const when = ago(n.created_at * 1000) || fmtDay(n.created_at * 1000);
              return (
                <li key={n.id}>
                  <button className={`notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)} data-testid="notif">
                    <Avatar name={n.actor_name} id={n.actor} size={42} />
                    <span className="notif-main">
                      <span className="notif-text"><strong><bdi>{n.actor_name}</bdi></strong> {tr(LINE[n.kind] || 'برای تو اعلان فرستاد')}</span>
                      {preview && <span className="notif-preview">{preview}</span>}
                      <span className="notif-time">{when}</span>
                    </span>
                    {!n.read && <span className="notif-dot" aria-label={tr('خوانده‌نشده')} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {more && <button className="older" disabled={busy} onClick={loadMore}>{busy ? tr('صبر کن…') : tr('اعلان‌های قدیمی‌تر')}</button>}
        </>
      )}
      <div className="row"><button className="primary" onClick={onClose}>{tr('بستن')}</button></div>
    </Dialog>
  );
}
