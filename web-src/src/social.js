import { blockUser as apiBlock, blocksList } from './api.js';

// بلاک‌کردن + خارج‌شدن از همهٔ گفتگوی خصوصی و دعوت‌های همان شخص
// فهرست نادیده‌گرفتن Matrix: خود Synapse دعوت و پیام‌های این کاربر را برای ما نمی‌فرستد
export async function setIgnored(client, target, on) {
  if (!client?.setIgnoredUsers) return;
  try {
    const cur = new Set(client.getIgnoredUsers?.() || []);
    if (on) cur.add(target); else cur.delete(target);
    await client.setIgnoredUsers([...cur]);
  } catch { /* بلاک گیت‌وی انجام شده؛ این لایه اضافه است */ }
}

export async function blockPerson(token, client, target) {
  await apiBlock(token, target);
  if (!client) return;
  await setIgnored(client, target, true);
  const direct = client.getAccountData('m.direct')?.getContent() || {};
  const roomIds = new Set(direct[target] || []);
  for (const r of client.getRooms()) {
    if (r.getDMInviter?.() === target) roomIds.add(r.roomId);
  }
  for (const roomId of roomIds) {
    try { await client.leave(roomId); } catch { /* ignore */ }
    try { await client.forget(roomId); } catch { /* ignore */ }
  }
  if (direct[target]) {
    const next = { ...direct };
    delete next[target];
    try { await client.setAccountData('m.direct', next); } catch { /* ignore */ }
  }
}

export async function loadBlocked(token) {
  const d = await blocksList(token);
  return new Set((d.blocks || []).map(b => b.user_id));
}
