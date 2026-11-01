// انواع رویداد/دادهٔ خصوصی TIKOOTAK.
// نوشتن با نام جدید انجام می‌شود، اما خواندن نام قدیمی (TIKOTAK/همدم) برای پیام‌های موجود حفظ می‌شود.
export const EV = {
  poll: 'ir.tikootak.poll',
  vote: 'ir.tikootak.vote',
  share: 'ir.tikootak.share',
  roomType: 'ir.tikootak.room_type',
  muteUntil: 'ir.tikootak.mute_until',
  savedRoom: 'ir.tikootak.saved_room',
  forwardedFrom: 'ir.tikootak.forwarded_from',
  disappear: 'ir.tikootak.disappear',
  call: 'ir.tikootak.call',
  channelSigning: 'ir.tikootak.channel_signing',
};

// نام‌های قدیمی؛ عمداً نگه داشته شده‌اند تا پیام‌های قبل از تغییر نام باز شوند.
export const EV_OLD = {
  poll: 'ir.tikotak.poll',
  vote: 'ir.tikotak.vote',
  share: 'ir.tikotak.share',
  roomType: 'ir.tikotak.room_type',
  muteUntil: 'ir.tikotak.mute_until',
  savedRoom: 'ir.tikotak.saved_room',
  forwardedFrom: 'ir.tikotak.forwarded_from',
  disappear: 'ir.tikotak.disappear',
  call: 'ir.hamdam.call',
  channelSigning: 'ir.tikotak.channel_signing',
};

export function pickEvent(content, key) {
  if (!content) return undefined;
  return content[EV[key]] ?? content[EV_OLD[key]];
}
export function hasEvent(content, key) {
  return !!content && (content[EV[key]] !== undefined || content[EV_OLD[key]] !== undefined);
}
