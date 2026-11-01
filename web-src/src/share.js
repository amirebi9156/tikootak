// پیام اشتراک‌گذاری (آهنگ، پلی‌لیست، پست) داخل چت.
// متن ساده‌ی body برای کلاینت‌های دیگر است؛ کارت از فیلد ir.tikootak.share ساخته می‌شود (در اتاق رمزنگاری‌شده، رمز است).
export function sendShare(client, roomId, share) {
  const icon = share.kind === 'post' ? '🎬' : '🎵';
  return client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `${icon} ${share.title || ''}`.trim(),
    'ir.tikootak.share': share,
  });
}
