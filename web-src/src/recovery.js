import { tr } from './i18n.js';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key';
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase';

// کلید بازیابی فقط موقع ساخت/بازیابی، چند لحظه در حافظه می‌ماند و بعد پاک می‌شود.
let held = null; // { keyId?, key: Uint8Array }
// رمز عبور فقط در حافظهٔ همین تب (برای ساخت/بازیابی بی‌صدا)؛ هرگز در localStorage/لاگ نوشته نمی‌شود.
let loginPassword = null;
// کلید رمز خودکارِ همین نشست؛ فقط برای نمایش اختیاری در «پیشرفته» و نه ذخیره روی دیسک.
let autoKey = null;
// فقط وقتی پشتیبان قدیمی (بدون passphrase) دارد: رمز تا پایان همین تب در حافظه می‌ماند تا بعد از وارد کردن کلید قدیمی، به روش خودکار مهاجرت کند.
let pendingPw = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function setLoginPassword(p) {
  loginPassword = typeof p === 'string' && p ? p : null;
}
export function takeLoginPassword() {
  const p = loginPassword;
  loginPassword = null;
  return p;
}
export function getAutoKey() {
  return autoKey;
}

export const cryptoCallbacks = {
  getSecretStorageKey: async ({
    keys
  }) => {
    if (!held) return null;
    const ids = Object.keys(keys);
    if (!ids.length) return null;
    return [held.keyId && keys[held.keyId] ? held.keyId : ids[0], held.key];
  },
  cacheSecretStorageKey: keyId => {
    if (held) held.keyId = keyId;
  }
};

// وضعیت: 'unknown' | 'setup' (هنوز کلیدی ساخته نشده) | 'restore' (روی سرور هست ولی روی این دستگاه فعال نیست) | 'ok'
export async function recoveryStatus(client) {
  const crypto = client.getCrypto();
  if (!crypto) return 'unknown';
  const info = await crypto.getKeyBackupInfo();
  if (!info) return 'setup';
  const active = await crypto.getActiveSessionBackupVersion();
  return active ? 'ok' : 'restore';
}

// ساخت کلید بازیابی جدید و فعال‌کردن پشتیبان‌گیری خودکار کلیدهای پیام. رشته کلید را برمی‌گرداند.
export async function createRecovery(client) {
  const crypto = client.getCrypto();
  let encoded = null;
  try {
    await crypto.bootstrapSecretStorage({
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
      createSecretStorageKey: async () => {
        const k = await crypto.createRecoveryKeyFromPassphrase();
        held = {
          key: k.privateKey
        };
        encoded = k.encodedPrivateKey;
        return k;
      }
    });
  } finally {
    held = null;
  }
  return encoded;
}

// وارد کردن کلید بازیابی روی دستگاه جدید. تعداد کلیدهای بازیابی‌شده را برمی‌گرداند.
export async function restoreWithKey(client, text) {
  const crypto = client.getCrypto();
  let key;
  try {
    key = decodeRecoveryKey(text.trim());
  } catch {
    throw new Error(tr("کلید بازیابی درست نیست. دوباره با دقت وارد کن."));
  }
  held = {
    key
  };
  try {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    const res = await crypto.restoreKeyBackup();
    return res?.imported ?? 0;
  } catch (e) {
    throw new Error(tr("این کلید با کلید بازیابی حساب نمی‌خواند."));
  } finally {
    held = null;
  }
}

// بازیابی بی‌صدا با همان رمز عبور (روش اصلی دستگاه جدید)
// رمز، کلید Secret Storage را می‌سازد و از آن کلید پشتیبان پیام‌ها بازیابی می‌شود.
export async function restoreWithPassphrase(client, passphrase) {
  const crypto = client.getCrypto();
  if (!crypto || !passphrase) throw new Error('no_crypto');
  // ممکن است account data تازه رسیده باشد؛ کمی صبر می‌کنیم
  let def = null;
  for (let i = 0; i < 5 && !def; i++) {
    def = client.getAccountData('m.secret_storage.default_key')?.getContent() || null;
    if (!def) await sleep(700);
  }
  const keyId = def?.key;
  if (!keyId) throw new Error('no_secret_storage');
  let info = null;
  for (let i = 0; i < 5 && !info; i++) {
    info = client.getAccountData(`m.secret_storage.key.${keyId}`)?.getContent() || null;
    if (!info) await sleep(700);
  }
  const pass = info?.passphrase;
  if (!pass?.salt || !pass?.iterations) throw new Error('passphrase_not_available');
  const key = await deriveRecoveryKeyFromPassphrase(passphrase, pass.salt, Number(pass.iterations));
  held = { key, keyId };
  try {
    let best = 0;
    let last = null;
    for (let i = 0; i < 4; i++) {
      try {
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        const res = await crypto.restoreKeyBackup();
        best = Math.max(best, res?.imported || 0);
        if (best > 0) return best;
      } catch (e) {
        last = e;
      }
      await sleep(900 + i * 700);
    }
    if (best === 0 && last) throw last;
    return best;
  } finally {
    held = null;
  }
}

// منتظر اولین sync می‌مانیم تا info پشتیبان از سرور برسد و اشتباهاً پشتیبان جدید نسازیم
async function waitForSync(client, ms = 12000) {
  const st = client.getSyncState?.();
  if (st === 'PREPARED' || st === 'SYNCING') return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      client.off('sync', on);
      resolve();
    };
    const on = (s) => { if (s === 'PREPARED' || s === 'SYNCING') finish(); };
    client.on('sync', on);
    const t = setTimeout(finish, ms);
  });
}

// اگر پشتیبان روی سرور هست با رمز بازیابی می‌شود؛ اگر نیست، پشتیبان‌گیری با همان رمز ساخته می‌شود.
// هیچ‌گاه رمز را ذخیره یا لاگ نمی‌کند.
export async function autoSetupRecovery(client, passphrase) {
  if (!passphrase) return { status: 'skipped' };
  const crypto = client.getCrypto();
  if (!crypto) return { status: 'no_crypto' };
  await waitForSync(client, 12000);
  // ممکن است info در اولین لحظه‌های sync هنوز نرسیده باشد؛ چند بار صبر می‌کنیم
  let info = null;
  let errored = false;
  for (let i = 0; i < 6; i++) {
    try { info = await crypto.getKeyBackupInfo(); } catch { errored = true; }
    if (info) break;
    await sleep(700);
  }
  // حتی اگر backup روی این دستگاه «فعال» به نظر برسد، بازیابی را امتحان می‌کنیم؛
  // ممکن است کلید خصوصی روی دستگاه جدید هنوز بارگذاری نشده باشد.
  if (info) {
    try {
      const imported = await restoreWithPassphrase(client, passphrase);
      console.info('[recovery] passphrase restore imported', imported);
      return { status: 'restored', imported };
    } catch (e) {
      // رمز اشتباه یا پشتیبان ناسازگار؛ پشتیبان جدید نساز (ممکن است دادهٔ قبلی را از دست بدهیم)
      console.warn('[recovery] passphrase restore failed', e?.message || 'restore_failed');
      pendingPw = passphrase;
      return { status: 'needs_manual', error: e?.message || 'restore_failed' };
    }
  }
  // خطای شبکه در گرفتن نسخهٔ پشتیبان: نساز، شاید پشتیبان روی سرور باشد
  if (errored) return { status: 'failed', error: 'backup_info_unavailable' };
  let generated = null;
  try {
    await crypto.bootstrapSecretStorage({
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
      createSecretStorageKey: async () => {
        generated = await crypto.createRecoveryKeyFromPassphrase(passphrase);
        held = { key: generated.privateKey };
        autoKey = generated.encodedPrivateKey || null;
        return generated;
      },
    });
    return { status: 'created' };
  } catch (e) {
    return { status: 'failed', error: e?.message || 'bootstrap_failed' };
  } finally {
    held = null;
  }
}

// بعد از تغییر رمز یا مهاجرت حساب قدیمی: فقط «قفل» Secret Storage با رمز جدید ساخته می‌شود.
// خودِ پشتیبان پیام‌ها (و کلیدهایی که قبلاً در آن هست) نگه داشته می‌شود؛ اگر پشتیبان تازه می‌ساختیم،
// کلیدهای بازیابی‌شده دوباره آپلود نمی‌شدند و دستگاه بعدی چیزی پیدا نمی‌کرد.
export async function rotateAutoRecovery(client, passphrase) {
  const crypto = client.getCrypto();
  if (!crypto || !passphrase) throw new Error('no_crypto');
  let keepBackup = false;
  try {
    const info = await crypto.getKeyBackupInfo();
    const local = await crypto.getSessionBackupPrivateKey?.();
    keepBackup = !!(info && local);
  } catch { keepBackup = false; }
  let generated = null;
  try {
    await crypto.bootstrapSecretStorage({
      setupNewSecretStorage: true,
      setupNewKeyBackup: !keepBackup,
      createSecretStorageKey: async () => {
        generated = await crypto.createRecoveryKeyFromPassphrase(passphrase);
        held = { key: generated.privateKey };
        autoKey = generated.encodedPrivateKey || null;
        return generated;
      },
    });
    return true;
  } finally {
    held = null;
  }
}

export function hasPendingMigration() {
  return !!pendingPw;
}
export function clearPending() {
  pendingPw = null;
}
// بعد از وارد کردن موفق کلید قدیمی ۱۲ بخشی: پشتیبان را با رمز عبور بازسازی می‌کند تا دفعهٔ بعد خودکار باشد.
export async function migrateLegacyRecovery(client) {
  const pw = pendingPw;
  if (!pw) return false;
  try {
    await rotateAutoRecovery(client, pw);
    pendingPw = null;
    return true;
  } catch (e) {
    console.warn('[recovery] migration failed', e?.message || 'failed');
    return false;
  }
}
