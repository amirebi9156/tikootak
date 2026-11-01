import { tr } from './i18n.js';
import * as sdk from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';

// لاگ‌های خیلی پرحرف SDK را خاموش می‌کنیم؛ فقط هشدار و خطا
logger.setLevel('warn');
export { sdk };
export const localpart = id => (id || '').replace(/^@/, '').split(':')[0];
export const serverName = id => (id || '').split(':').slice(1).join(':');

// "ali" یا "@ali" یا "@ali:server" → "@ali:server"
export function normalizeUserId(input, me) {
  const v = (input || '').trim().replace(/^@/, '');
  if (!v) return null;
  const [local, ...rest] = v.split(':');
  const server = rest.length ? rest.join(':') : serverName(me);
  return `@${local.toLowerCase()}:${server}`;
}
export function mxError(e) {
  const code = e?.errcode || e?.data?.errcode;
  const text = e?.data?.error || e?.message || '';
  if (code === 'M_LIMIT_EXCEEDED') return tr("درخواست‌های زیاد. چند ثانیه صبر کن.");
  if (code === 'M_FORBIDDEN') return tr("این کار مجاز نیست یا کاربر پیدا نشد.");
  if (code === 'M_NOT_FOUND') return tr("کاربر پیدا نشد.");
  return text || tr("مشکلی پیش آمد.");
}