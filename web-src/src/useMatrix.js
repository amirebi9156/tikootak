import { useEffect, useState } from 'react';
import { sdk } from './matrix.js';
import { cryptoCallbacks, autoSetupRecovery, takeLoginPassword } from './recovery.js';
import { getItem, setItem } from './storage.js';

// کلاینت Matrix رو می‌سازه، sync رو شروع می‌کنه و با هر تغییر، `version` رو زیاد می‌کنه
// تا کامپوننت‌ها دوباره رندر بشن.

const STORE_KEY = 'tikootak.crypto.store.v1';

// آیا سرور برای همین دستگاه کلید رمزنگاری دارد؟ دستگاه تازه (یا استور خراب) ندارد.
async function serverHasDeviceKeys(uid, did, token) {
  try {
    const res = await fetch('/_matrix/client/v3/keys/query', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device_keys: { [uid]: [did] } }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return !!j?.device_keys?.[uid]?.[did];
  } catch {
    return null;
  }
}

// انتخاب استور رمزنگاری: اگر دستگاه قبلاً کلید داشته و استور قبلی سالم است، همان قبلی؛
// وگرنه یک استور مخصوص همین دستگاه تا کلیدها دوباره ساخته و آپلود شوند.
// انتخاب برای هر «کاربر + دستگاه» جدا ذخیره می‌شود تا جابه‌جایی حساب‌ها در یک مرورگر آن را خراب نکند.
function pickCryptoPrefix(uid, did, hasKeys) {
  const key = `${uid}|${did}`;
  let map = {};
  try {
    const raw = JSON.parse(getItem(STORE_KEY) || '{}') || {};
    // سازگاری با نسخه‌ی میانی که فقط یک انتخاب ذخیره می‌کرد
    if (raw && raw.user && raw.device && raw.prefix) map = { [`${raw.user}|${raw.device}`]: raw.prefix };
    else if (raw && typeof raw === 'object') map = raw;
  } catch { /* ignore */ }
  if (map[key]) return map[key];
  // دستگاه تازه: پیشوند جدید TIKOOTAK؛ دستگاه موجودی که map ندارد: پیشوند قدیمی،
  // تا کلیدهای رمزنگاری قبلی (IndexedDB) از دست نروند.
  const prefix = hasKeys === false ? `tikootak-${uid}-${did}` : `hamdam-${uid}`;
  if (hasKeys !== null) {
    map[key] = prefix;
    setItem(STORE_KEY, JSON.stringify(map));
  }
  return prefix;
}

export function useMatrix(session, onLoggedOut) {
  const [client, setClient] = useState(null);
  const [sync, setSync] = useState('INIT');
  const [version, setVersion] = useState(0);
  const [cryptoState, setCryptoState] = useState('starting'); // starting | on | off

  useEffect(() => {
    const c = sdk.createClient({
      baseUrl: window.location.origin,
      accessToken: session.access_token,
      userId: session.user_id,
      deviceId: session.device_id,
      timelineSupport: true,
      cryptoCallbacks,
    });

    let timer = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; setVersion((v) => v + 1); }, 80);
    };

    c.on(sdk.ClientEvent.Sync, (state) => { setSync(state); bump(); });
    c.on(sdk.ClientEvent.Room, bump);
    c.on(sdk.ClientEvent.DeleteRoom, bump);
    c.on(sdk.ClientEvent.AccountData, bump);
    c.on(sdk.RoomEvent.Timeline, bump);
    c.on(sdk.RoomEvent.Name, bump);
    c.on(sdk.RoomEvent.MyMembership, bump);
    c.on(sdk.RoomEvent.Receipt, bump);
    c.on(sdk.RoomEvent.UnreadNotifications, bump);
    c.on(sdk.RoomMemberEvent.Name, bump);
    c.on(sdk.RoomMemberEvent.Membership, bump);
    c.on(sdk.HttpApiEvent.SessionLoggedOut, () => onLoggedOut());

    // وقتی پیامی رمزگشایی شد، دوباره رندر کن
    c.on(sdk.MatrixEventEvent.Decrypted, bump);
    c.on("crypto.keyBackupStatus", bump);

    let dead = false;
    (async () => {
      // رمزنگاری سرتاسری: کلیدها در IndexedDB همین مرورگر می‌مانند.
      // استور هر دستگاه جداست تا تعویض دستگاه باعث از کار افتادن کلیدها نشود.
      const uid = session.user_id;
      const did = session.device_id || 'device';
      const hasKeys = await serverHasDeviceKeys(uid, did, session.access_token);
      const prefix = pickCryptoPrefix(uid, did, hasKeys);
      // جلوگیری از پاک‌شدن خودکار IndexedDB (کلیدهای رمزنگاری) توسط مرورگر هنگام کمبود فضا
      try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
      try {
        await c.initRustCrypto({ cryptoDatabasePrefix: prefix });
        if (!dead) setCryptoState('on');
      } catch (e) {
        console.warn('crypto init failed', e, prefix);
        if (!dead) setCryptoState('off');
      }
      if (dead) return;
      c.startClient({ initialSyncLimit: 30, lazyLoadMembers: true });
      setClient(c);
      // پشتیبان رمزنگاری بی‌صدا با رمز عبور همین ورود (فقط در حافظهٔ همین تب)
      const pw = takeLoginPassword();
      if (pw && !dead) {
        autoSetupRecovery(c, pw).then((r) => {
          if (!dead) setVersion((v) => v + 1);
          if (r.status === 'needs_manual' || r.status === 'failed') {
            console.warn('auto recovery:', r.status, r.error ? String(r.error).slice(0, 160) : '');
          }
        }).catch((e) => console.warn('auto recovery failed', e?.message));
      }
    })();

    return () => {
      dead = true;
      clearTimeout(timer);
      c.stopClient();
      c.removeAllListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  return { client, sync, version, cryptoState };
}
