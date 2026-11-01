import { useEffect, useState } from 'react';
import { tr, isFa, setLang } from './i18n.js';
import { profileGet, profileSetBio, profileSetPrivate, blocksList, privacyGet, privacySet, invitesMine, inviteCreate, inviteRevoke, errText } from './api.js';
import { Avatar, LogoWordmark, Switch } from './ui.jsx';
import ChatLook from './ChatLook.jsx';
import { useBackLayer } from './backstack.js';
import { Icon } from './icons.jsx';
import { setPerson } from './people.js';
import { rotateAutoRecovery, getAutoKey } from './recovery.js';
import { ago, fmtDay, fa } from './util.js';
import { notifySupported, notifyPermission, getNotifyPrefs, setNotifyPrefs, enableNotify } from './notify.js';

const errcode = x => x?.errcode || x?.data?.errcode || '';
const localpart = id => (id || '').replace(/^@/, '').split(':')[0];


const MENU = [
  { id: 'account', icon: 'user', title: () => tr('حساب من'), sub: ({ p }) => p?.name || '' },
  { id: 'security', icon: 'lock', title: () => tr('امنیت و دستگاه‌ها'), sub: ({ devices }) => (devices ? tr('{0} دستگاه', [fa(devices.length)]) : '') },
  { id: 'privacy', icon: 'eye', title: () => tr('حریم خصوصی'), sub: ({ blockList }) => (blockList?.length ? tr('{0} کاربر بلاک‌شده', [fa(blockList.length)]) : '') },
  { id: 'notify', icon: 'bell', title: () => tr('اعلان‌ها'), sub: () => (getNotifyPrefs().on && notifyPermission() === 'granted' ? tr('روشن') : tr('خاموش')) },
  { id: 'chatlook', icon: 'brush', title: () => tr('شخصی‌سازی چت'), sub: () => tr('رنگ، حباب و والپیپر') },
  { id: 'appearance', icon: 'moon', title: () => tr('ظاهر و زبان'), sub: () => (isFa ? 'فارسی' : 'English') },
  { id: 'invite', icon: 'userplus', title: () => tr('دعوت دوستان'), sub: ({ inv }) => (inv?.invited?.length ? tr('{0} نفر دعوت‌شده', [fa(inv.invited.length)]) : '') },
  { id: 'about', icon: 'globe', title: () => tr('درباره'), sub: () => 'TIKOOTAK' },
];

// تنظیمات: زبان، نام نمایشی، امنیت (رمز و دستگاه‌ها)، کلید بازیابی، ظاهر و خروج.
export default function Settings({ client, token, session, me, theme, onTheme, onBack, onProfile, onLogout, startPage, onRecovery, blocked, onUnblock }) {
  const [page, setPage] = useState(startPage || null);
  useBackLayer(!!page, () => setPage(null));
  const [inv, setInv] = useState(null);
  const [invErr, setInvErr] = useState('');
  const [copied, setCopied] = useState('');
  const loadInv = () => invitesMine(token).then(setInv).catch(() => setInv({ codes: [], invited: [], can_create: false }));
  useEffect(() => { loadInv(); }, []);
  const [p, setP] = useState(null);
  const [name, setName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  const [devices, setDevices] = useState(null);
  const [devBusy, setDevBusy] = useState(false);
  const [devErr, setDevErr] = useState('');
  const [blockList, setBlockList] = useState(null);
  const [priv, setPriv] = useState(null);
  const [privBusy, setPrivBusy] = useState(false);
  const [privMsg, setPrivMsg] = useState('');
  const [privErr, setPrivErr] = useState('');
  const [showAutoKey, setShowAutoKey] = useState(false);

  useEffect(() => {
    let dead = false;
    profileGet(token, me).then(x => {
      if (!dead) {
        setP(x);
        setName(x.name);
      }
    }).catch(() => {
      if (!dead) setNameErr(tr('پروفایل بارگذاری نشد.'));
    });
    return () => { dead = true; };
  }, [token, me]);

  const loadDevices = async () => {
    if (!client) return;
    setDevErr('');
    try {
      const r = await client.getDevices();
      setDevices(r.devices || []);
    } catch (x) {
      setDevices([]);
      setDevErr(errcode(x) === 'M_UNRECOGNIZED' ? tr('سرور فهرست دستگاه‌ها را نمی‌دهد.') : tr('فهرست دستگاه‌ها گرفته نشد.'));
    }
  };

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    let dead = false;
    blocksList(token).then(d => {
      if (!dead) setBlockList(d.blocks || []);
    }).catch(() => {
      if (!dead) setBlockList([]);
    });
    return () => { dead = true; };
  }, [token, blocked]);

  useEffect(() => {
    let dead = false;
    privacyGet(token).then(d => { if (!dead) setPriv(d); }).catch(() => { if (!dead) setPriv({ story_audience: 'everyone', hide_follows: false, is_private: false }); });
    return () => { dead = true; };
  }, [token]);

  async function savePrivacy() {
    if (!priv) return;
    setPrivBusy(true); setPrivMsg(''); setPrivErr('');
    try {
      // PATCH /api/profile مخصوص سوییچ حساب خصوصی؛ PUT /api/privacy برای استوری و لیست‌ها.
      await profileSetPrivate(token, !!priv.is_private);
      setPriv(await privacySet(token, {
        story_audience: priv.story_audience,
        hide_follows: !!priv.hide_follows,
      }));
      setPrivMsg(tr('حریم خصوصی ذخیره شد.'));
    } catch {
      setPrivErr(tr('ذخیره حریم خصوصی انجام نشد.'));
    }
    setPrivBusy(false);
  }

  const passwordAuth = () => ({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: me },
    password: cur,
  });

  async function saveName(e) {
    e.preventDefault();
    const v = name.trim();
    if (!v || !p || v === p.name) return;
    setNameBusy(true); setNameErr(''); setNameMsg('');
    try {
      await client.setDisplayName(v);
      // با PUT /api/profile کش نام در gateway پاک می‌شود تا بقیه فوراً نام جدید را ببینند
      const np = await profileSetBio(token, p?.bio || '');
      setP(np);
      setPerson(np);
      setNameMsg(tr('نام نمایشی ذخیره شد.'));
    } catch {
      setNameErr(tr('ذخیره نشد. دوباره امتحان کن.'));
    }
    setNameBusy(false);
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwErr(''); setPwMsg('');
    if (!cur) return setPwErr(tr('رمز فعلی را وارد کن.'));
    if (next.length < 10) return setPwErr(tr('رمز جدید باید حداقل ۱۰ کاراکتر باشد.'));
    if (next !== again) return setPwErr(tr('رمز جدید و تکرارش یکی نیست.'));
    setPwBusy(true);
    try {
      await client.setPassword(passwordAuth(), next, false);
      let rotated = true;
      try {
        await rotateAutoRecovery(client, next);
      } catch {
        rotated = false;
      }
      setPwMsg(rotated
        ? tr('رمز عوض شد و پشتیبان پیام‌ها با رمز جدید بازسازی شد.')
        : tr('رمز عوض شد ولی بازسازی پشتیبان انجام نشد؛ از بخش پیشرفته بازیابی کن.'));
      setCur(''); setNext(''); setAgain('');
    } catch (x) {
      setPwErr(errcode(x) === 'M_FORBIDDEN' ? tr('رمز فعلی درست نیست.') : tr('تغییر رمز انجام نشد. دوباره امتحان کن.'));
    }
    setPwBusy(false);
  }

  async function revoke(d) {
    if (!cur) return setDevErr(tr('برای خروج از دستگاه، رمز فعلی را در بخش «تغییر رمز» وارد کن.'));
    if (!window.confirm(tr('از دستگاه «{0}» خارج شود؟', [d.display_name || d.device_id]))) return;
    setDevBusy(true); setDevErr('');
    try {
      await client.deleteDevice(d.device_id, passwordAuth());
      setCur('');
      await loadDevices();
    } catch (x) {
      setDevErr(errcode(x) === 'M_FORBIDDEN' ? tr('رمز فعلی درست نیست.') : tr('خروج از دستگاه انجام نشد.'));
    }
    setDevBusy(false);
  }

  if (!client) return <div className="feed settings"><p className="muted pad">{tr('در حال آماده‌سازی…')}</p></div>;

  return (
    <div className="feed settings">
      <header className="chat-head">
        <button className="icon back" onClick={() => (page ? setPage(null) : onBack())} aria-label={tr('بازگشت')}><Icon n="back" /></button>
        <div className="chat-title"><strong>{page ? (MENU.find(m => m.id === page)?.title() || tr('تنظیمات')) : tr('تنظیمات')}</strong></div>
      </header>

      <div className="feed-list set-list">
        {!page && <>
          <button type="button" className="set-hero" onClick={() => onProfile(me)} aria-label={tr('پروفایل من')}>
            <Avatar name={p?.name || me} id={me} size={64} />
            <span className="set-hero-txt">
              <strong dir="auto">{p?.name || '…'}</strong>
              <span className="muted" dir="ltr">@{localpart(me)}</span>
            </span>
            <Icon n="chev" size={18} />
          </button>
          <nav className="set-menu" aria-label={tr('تنظیمات')}>
            {MENU.map(m => <button type="button" key={m.id} className="set-item" onClick={() => setPage(m.id)} data-testid={`set-${m.id}`}>
                <span className={`set-ico c-${m.id}`}><Icon n={m.icon} size={18} /></span>
                <span className="set-item-txt"><strong>{m.title()}</strong><span className="muted">{m.sub?.({ p, devices, inv, blockList }) || ''}</span></span>
                <Icon n="chev" size={16} />
              </button>)}
          </nav>
        </>}
        {page === 'account' && <section className="set-sec">
          <h3>{tr('حساب')}</h3>
          <div className="set-me">
            <Avatar name={p?.name || me} id={me} size={56} />
            <div className="set-me-txt">
              <strong dir="auto">{p?.name || '…'}</strong>
              <span className="muted" dir="ltr">@{localpart(me)}</span>
            </div>
            <button className="small ghost" onClick={() => onProfile(me)}>{tr('پروفایل')}</button>
          </div>
          <form className="form" onSubmit={saveName}>
            <label>{tr('نام نمایشی')}
              <input value={name} onChange={e => setName(e.target.value)} maxLength={40} required dir="auto" />
            </label>
            <p className="muted small-note">{tr('عکس و بیو از صفحه پروفایل («ویرایش پروفایل») عوض می‌شود.')}</p>
            {nameMsg && <p className="ok" role="status">{nameMsg}</p>}
            {nameErr && <p className="error" role="alert">{nameErr}</p>}
            <div className="row"><button className="primary" disabled={nameBusy || !p || !name.trim() || name.trim() === p.name}>{nameBusy ? '…' : tr('ذخیره نام')}</button></div>
          </form>
        </section>}

        {page === 'security' && <section className="set-sec">
          <h3>{tr('امنیت')}</h3>
          <form className="form" onSubmit={changePassword}>
            <label>{tr('رمز فعلی')}
              <input type="password" value={cur} onChange={e => setCur(e.target.value)} dir="ltr" autoComplete="current-password" />
            </label>
            <label>{tr('رمز جدید')}
              <input type="password" value={next} onChange={e => setNext(e.target.value)} dir="ltr" autoComplete="new-password" minLength={8} />
            </label>
            <label>{tr('تکرار رمز جدید')}
              <input type="password" value={again} onChange={e => setAgain(e.target.value)} dir="ltr" autoComplete="new-password" />
            </label>
            <p className="muted small-note">{tr('تغییر رمز، پیام‌های رمزنگاری‌شده را پاک نمی‌کند؛ کلیدها جای دیگری هستند.')}</p>
            {pwMsg && <p className="ok" role="status">{pwMsg}</p>}
            {pwErr && <p className="error" role="alert">{pwErr}</p>}
            <div className="row"><button className="primary" disabled={pwBusy}>{pwBusy ? '…' : tr('تغییر رمز')}</button></div>
          </form>

          <div className="set-sub">
            <h4>{tr('دستگاه‌های واردشده')}</h4>
            {devErr && <p className="error" role="alert">{devErr}</p>}
            {devices === null && <p className="muted">…</p>}
            <ul className="plain dev-list">
              {(devices || []).map(d => {
                const current = d.device_id === session.device_id;
                const seen = d.last_seen_ts ? (ago(d.last_seen_ts) || fmtDay(d.last_seen_ts)) : tr('نامشخص');
                return (
                  <li key={d.device_id} className="dev">
                    <span className="dev-ico"><Icon n="screen" size={18} /></span>
                    <div className="dev-main">
                      <strong>{d.display_name || tr('دستگاه')}{current && <span className="dev-now">{tr('این دستگاه')}</span>}</strong>
                      <span className="muted" dir="auto">{seen}{d.last_seen_ip ? ` · ${d.last_seen_ip}` : ''}</span>
                    </div>
                    {!current && <button className="small ghost" disabled={devBusy} onClick={() => revoke(d)}>{tr('خروج')}</button>}
                  </li>
                );
              })}
              {devices?.length === 0 && !devErr && <li className="muted">{tr('دستگاهی نیست.')}</li>}
            </ul>
          </div>
        </section>}

        {page === 'security' && <section className="set-sec">
          <h3>{tr('پیشرفته')}</h3>
          <div className="set-sub">
            <h4>{tr('کلید بازیابی پیام‌ها')}</h4>
            <p className="muted small-note">{tr('پیام‌های خصوصی با رمز عبور تو محافظت می‌شوند؛ اگر رمز را فراموش کنی پیام‌های قدیمی بازیابی نمی‌شوند.')}</p>
            {getAutoKey() && <div className="row set-row-start">
                <button className="outline" onClick={() => setShowAutoKey(v => !v)}>{showAutoKey ? tr('پنهان‌کردن کلید') : tr('نمایش کلید این دستگاه')}</button>
              </div>}
            {showAutoKey && getAutoKey() && <code className="rkey" dir="ltr">{getAutoKey()}</code>}
            <p className="muted small-note">{tr('ساخت کلید دستی جدید، بازیابی خودکار با رمز عبور را جایگزین می‌کند و فقط برای کاربران پیشرفته است.')}</p>
            <div className="row set-row-start">
              <button className="outline" onClick={() => onRecovery('rsetup')}>{tr('ساخت کلید دستی')}</button>
              <button className="outline" onClick={() => onRecovery('rrestore')}>{tr('بازیابی با کلید')}</button>
            </div>
          </div>
        </section>}

        {page === 'notify' && <NotifySettings />}
        {page === 'chatlook' && <ChatLook theme={theme} onTheme={onTheme} />}
        {page === 'appearance' && <section className="set-sec">
          <h3>{tr('ظاهر و زبان')}</h3>
          <div className="set-line">
            <span>{tr('تم برنامه')}</span>
            <div className="seg" role="group" aria-label={tr('تم')}>
              <button className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')} aria-pressed={theme === 'dark'}>{tr('تیره')}</button>
              <button className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')} aria-pressed={theme === 'light'}>{tr('روشن')}</button>
              <button className={theme === 'oled' ? 'on' : ''} onClick={() => onTheme('oled')} aria-pressed={theme === 'oled'}>{tr('سیاه کامل (OLED)')}</button>
            </div>
          </div>
          <div className="set-line">
            <span><Icon n="globe" size={16} /> {tr('زبان برنامه')}</span>
            <div className="seg" role="group" aria-label={tr('زبان')}>
              <button className={isFa ? 'on' : ''} onClick={() => setLang('fa')} aria-pressed={isFa}>فارسی</button>
              <button className={!isFa ? 'on' : ''} onClick={() => setLang('en')} aria-pressed={!isFa}>English</button>
            </div>
          </div>
        </section>}

        {page === 'privacy' && <section className="set-sec">
          <h3>{tr('حریم خصوصی')}</h3>
          <Switch title={tr('حساب خصوصی')} desc={tr('فقط دنبال‌کننده‌های تأییدشده پست‌ها و استوری‌هایت را می‌بینند؛ بقیه فقط نام، آواتار و بیو را می‌بینند.')} checked={!!priv?.is_private} disabled={!priv} onChange={v => setPriv(x => ({ ...x, is_private: v }))} testid="private-account" />
          <div className="set-line">
            <span>{tr('استوری من را چه کسی ببیند')}</span>
            <div className="seg" role="group" aria-label={tr('مخاطب استوری')}>
              <button className={priv?.story_audience === 'everyone' ? 'on' : ''} disabled={!priv} onClick={() => setPriv(x => ({ ...x, story_audience: 'everyone' }))}>{tr('همه')}</button>
              <button className={priv?.story_audience === 'followers' ? 'on' : ''} disabled={!priv} onClick={() => setPriv(x => ({ ...x, story_audience: 'followers' }))} data-testid="story-audience-followers">{tr('فقط دنبال‌کننده‌هایم')}</button>
            </div>
          </div>
<Switch title={tr('لیست دنبال‌کننده‌ها و دنبال‌شده‌هایم را پنهان کن')} checked={!!priv?.hide_follows} disabled={!priv} onChange={v => setPriv(x => ({ ...x, hide_follows: v }))} testid="hide-follows" />
          <p className="muted small-note">{tr('اگر استوری را فقط برای دنبال‌کننده‌ها بگذاری، دیگران در نوار استوری نمی‌بینند. با پنهان‌کردن لیست، تعداد دنبال‌کننده‌ها می‌ماند ولی اسم‌ها برای دیگران دیده نمی‌شود.')}</p>
          <p className="muted small-note">{tr('با خاموش‌کردن حساب خصوصی، همهٔ درخواست‌های دنبال‌کردن در انتظار خودکار پذیرفته می‌شوند.')}</p>
          <p className="muted small-note">{tr('رسانه‌های چت قدیمی‌تر از ۶۰ روز به‌صورت خودکار از سرور پاک می‌شوند.')}</p>
          {privMsg && <p className="ok" role="status">{privMsg}</p>}
          {privErr && <p className="error" role="alert">{privErr}</p>}
          <div className="row"><button className="primary" onClick={savePrivacy} disabled={!priv || privBusy} data-testid="privacy-save">{privBusy ? '…' : tr('ذخیره حریم خصوصی')}</button></div>
        </section>}

        {page === 'invite' && <section className="set-sec">
          <h3>{tr('دعوت دوستان')}</h3>
          <p className="muted small-note">{tr('هر کد یک‌بار مصرف است و ۷ روز اعتبار دارد. فقط کسانی را دعوت کن که می‌شناسی؛ مسئولیت رفتارشان تا حدی با دعوت‌کننده است.')}</p>
          {inv && <button className="outline" disabled={!inv.can_create} onClick={async () => {
            setInvErr('');
            try { await inviteCreate(token); await loadInv(); } catch (e) { setInvErr(errText(e)); }
          }}>{tr('ساخت کد دعوت')}</button>}
          {!inv?.can_create && inv?.reason && <p className="muted small-note">{inv.reason === 'registration_closed' ? tr('ثبت‌نام فعلاً بسته است؛ فقط اعضای فعلی می‌توانند وارد شوند.') : errText({ code: 'invite_' + inv.reason })}</p>}
          {invErr && <p className="error">{invErr}</p>}
          <ul className="plain">
            {(inv?.codes || []).filter(c => !c.revoked && c.uses < c.max_uses && (!c.expires_at || c.expires_at > Date.now() / 1000)).map(c => <li key={c.code} className="dev">
                <div className="dev-main"><strong dir="ltr">{c.code}</strong></div>
                <button className="small ghost" onClick={() => { navigator.clipboard?.writeText(c.code); setCopied(c.code); setTimeout(() => setCopied(''), 1500); }}>{copied === c.code ? tr('کپی شد') : tr('کپی')}</button>
                <button className="small ghost" onClick={async () => { await inviteRevoke(token, c.code).catch(() => {}); loadInv(); }}>{tr('باطل کردن')}</button>
              </li>)}
          </ul>
          {inv?.invited?.length > 0 && <>
            <h4>{tr('کسانی که دعوت کرده‌ای')}</h4>
            <ul className="plain">{inv.invited.map(u => <li key={u.user_id} className="dev"><Avatar name={u.name} id={u.user_id} size={32} /><div className="dev-main"><strong dir="auto">{u.name}</strong></div></li>)}</ul>
          </>}
        </section>}

        {page === 'privacy' && <section className="set-sec">
          <h3>{tr('کاربران بلاک‌شده')}</h3>
          {blockList === null && <p className="muted">…</p>}
          {blockList?.length === 0 && <p className="muted small-note">{tr('کسی را بلاک نکرده‌ای.')}</p>}
          <ul className="plain block-list">
            {(blockList || []).map(b => <li key={b.user_id} className="dev">
                <Avatar name={b.name} id={b.user_id} size={36} />
                <div className="dev-main">
                  <strong dir="auto">{b.name}</strong>
                  <span className="muted" dir="ltr">{localpart(b.user_id)}</span>
                </div>
                <button className="small ghost" onClick={async () => {
                  const ok = await onUnblock?.(b.user_id);
                  if (ok) setBlockList(l => (l || []).filter(x => x.user_id !== b.user_id));
                }}>{tr('رفع بلاک')}</button>
              </li>)}
          </ul>
        </section>}

        {page === 'about' && <section className="set-sec">
          <h3>{tr('درباره')}</h3>
          <LogoWordmark size={170} className="about-wordmark" />
          <p className="muted small-note">{tr('TIKOOTAK · شبکه اجتماعی خصوصی روی سرور خودت. نسخه ۱٫۰')}</p>
          <p className="muted small-note">{tr('چت رمزنگاری سرتاسری، فید، استوری، موزیک و تماس گروهی.')}</p>
        </section>}

        {!page && <section className="set-sec">
          <button className="outline danger-out" onClick={onLogout}>{tr('خروج از حساب')}</button>
        </section>}
      </div>
    </div>
  );
}

function NotifySettings() {
  const [prefs, setPrefs] = useState(getNotifyPrefs());
  const [perm, setPerm] = useState(notifyPermission());
  const [msg, setMsg] = useState('');
  const on = prefs.on && perm === 'granted';
  async function toggle(v) {
    setMsg('');
    if (v) {
      const r = await enableNotify();
      setPerm(r);
      if (r !== 'granted') setMsg(r === 'denied' ? tr('مرورگر اعلان را مسدود کرده؛ از تنظیمات سایت در مرورگر آزادش کن.') : tr('این مرورگر اعلان را پشتیبانی نمی‌کند.'));
    } else setNotifyPrefs({ on: false });
    setPrefs(getNotifyPrefs());
  }
  const upd = (p) => setPrefs(setNotifyPrefs(p));
  if (!notifySupported()) return <section className="set-sec"><h3>{tr('اعلان‌ها')}</h3><p className="muted">{tr('این مرورگر اعلان را پشتیبانی نمی‌کند.')}</p></section>;
  return <section className="set-sec">
    <h3>{tr('اعلان‌ها')}</h3>
    <p className="muted small-note">{tr('وقتی برنامه در مرورگر یا نصب‌شده باز است و در همان گفتگو نیستی، پیام جدید را اعلان می‌دهد. متن پیام فقط روی همین دستگاه ساخته می‌شود و گفتگوهای بی‌صدا اعلان نمی‌دهند.')}</p>
    <Switch title={tr('اعلان پیام‌ها')} checked={on} onChange={toggle} testid="sw-notify" />
    <Switch title={tr('نمایش متن پیام')} desc={tr('خاموش: فقط «پیام جدید» نشان داده می‌شود.')} checked={prefs.text} disabled={!on} onChange={(v) => upd({ text: v })} testid="sw-notify-text" />
    <Switch title={tr('صدای کوتاه')} checked={prefs.sound} disabled={!on} onChange={(v) => upd({ sound: v })} testid="sw-notify-sound" />
    {msg && <p className="error" role="alert">{msg}</p>}
  </section>;
}
