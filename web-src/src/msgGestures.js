// قواعد اشاره‌گر پیام (Q3): تست‌پذیر و بدون DOM.
export const TAP_MAX_MOVE = 8;
export const TAP_MAX_MS = 400;

export function canOpenMessageMenu({
  id = '',
  dx = 0,
  dy = 0,
  dt = 0,
  selection = '',
  multi = false,
  interactive = false,
} = {}) {
  if (!id || String(id).startsWith('~')) return false;
  if (multi || interactive || selection) return false;
  if (!Number.isFinite(dt) || dt > TAP_MAX_MS) return false;
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) <= TAP_MAX_MOVE;
}

export function canReplyOnDoubleClick({
  id = '',
  selectionBefore = '',
  selectionNow = '',
  multi = false,
  interactive = false,
} = {}) {
  if (!id || String(id).startsWith('~')) return false;
  if (multi || interactive) return false;
  // اگر قبل از دابل‌کلیک متنی انتخاب شده بود، دست نزن؛ انتخابِ خودِ دابل‌کلیک مانع پاسخ نیست.
  return !selectionBefore && !selectionNow;
}
