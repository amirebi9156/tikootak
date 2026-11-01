// Q7 live security test. Run on a test server with the Q7 filter enabled:
//   BASE=https://test.example ADMIN=... node tests/security/sec06.mjs
// Creates an admin, a member and a stranger; never run on production data.
const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN = process.env.ADMIN || 'adminkey';
const J = { 'content-type': 'application/json' };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sfx = Math.random().toString(36).slice(2, 6);
const H = (token) => ({ authorization: `Bearer ${token}`, ...J });
const j = async (r) => r.json().catch(() => ({}));

async function invite() {
  const r = await fetch(BASE + '/api/admin/invites', { method: 'POST', headers: { ...J, 'x-admin-key': ADMIN }, body: JSON.stringify({ max_uses: 1, expires_days: 1 }) });
  return (await j(r)).code;
}
async function register(tag) {
  const code = await invite();
  const username = tag + sfx;
  const r = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: J, body: JSON.stringify({ invite: code, username, password: 'Zx9!kLm2pQ7w', displayname: username }) });
  return { ...(await j(r)), username };
}
async function matrix(token, method, path, body) {
  const r = await fetch(BASE + '/_matrix/client/v3' + path, { method, headers: H(token), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await j(r) };
}
async function createRoom(token, body) {
  return matrix(token, 'POST', '/createRoom', body);
}
async function send(token, roomId, type, content) {
  return matrix(token, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/${type}/${Date.now()}${Math.random().toString(36).slice(2, 5)}`, content);
}

const health = await j(await fetch(BASE + '/api/health'));
ok(health.channel_privacy?.enabled === true && health.channel_privacy?.ok === true, 'Q7 filter enabled + self-test');

const admin = await register('q7a');
const member = await register('q7m');
const stranger = await register('q7s');
ok(admin.access_token && member.access_token && stranger.access_token, 'three users registered');

const channel = await createRoom(admin.access_token, {
  name: 'q7 channel ' + sfx,
  preset: 'public_chat',
  visibility: 'public',
  initial_state: [{ type: 'ir.tikootak.room_type', state_key: '', content: { type: 'channel' } }],
  power_level_content_override: {
    users_default: 0, events_default: 50, state_default: 50, invite: 0,
    events: { 'm.room.message': 50, 'm.reaction': 0 },
  },
});
const roomId = channel.body.room_id; if (!roomId) console.log('createRoom', channel.status, JSON.stringify(channel.body).slice(0,300));
ok(channel.status === 200 && !!roomId, 'channel created');
const joined = await matrix(member.access_token, 'POST', `/join/${encodeURIComponent(roomId)}`, {});
ok(joined.status === 200, 'member joined public channel');

const sent = await send(admin.access_token, roomId, 'm.room.message', { msgtype: 'm.text', body: 'q7 hello' });
const eventId = sent.body.event_id;
ok(sent.status === 200 && !!eventId, 'admin posted');

const adminMember = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/members`);
ok(adminMember.status === 200 && Array.isArray(adminMember.body.chunk), 'members endpoint reachable');
ok(!adminMember.body.chunk.some((e) => e.state_key === admin.user_id || e.state_key === stranger.user_id), 'member does not see other member events');
ok(adminMember.body.chunk.some((e) => e.state_key === member.user_id), 'member sees own membership');

const jm = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/joined_members`);
ok(jm.status === 200 && !jm.body.joined?.[admin.user_id] && !jm.body.joined?.[stranger.user_id] && !!jm.body.joined?.[member.user_id], 'joined_members hides others');

const state = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/state`);
ok(state.status === 200 && !state.body.some((e) => e.type === 'm.room.member' && e.state_key !== member.user_id), 'state hides other member events');

const otherMember = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(admin.user_id)}`);
ok(otherMember.status === 404, 'direct member state of admin is 404');

const messages = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`);
ok(messages.status === 200 && !messages.body.chunk?.some((e) => e.type === 'm.room.member' && e.state_key !== member.user_id), 'messages hides other member events');

const ctx = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}?limit=5`);
ok(ctx.status === 200 && ![...(ctx.body.state || []), ...(ctx.body.events_before || []), ...(ctx.body.events_after || [])].some((e) => e.type === 'm.room.member' && e.state_key !== member.user_id), 'context hides other member events');

const ud = await fetch(BASE + '/_matrix/client/v3/user_directory/search', { method: 'POST', headers: H(admin.access_token), body: JSON.stringify({ search_term: member.username }) });
ok(ud.status === 404, 'user_directory is closed');

// Receipts: admin reads the message; member's sync must not reveal admin.
await matrix(admin.access_token, 'POST', `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`, {});
const sync1 = await matrix(member.access_token, 'GET', '/sync?timeout=0');
const ch = sync1.body.rooms?.join?.[roomId];
ok(!!ch, 'member sync includes channel');
const syncMemberEvents = [...(ch?.state?.events || []), ...(ch?.timeline?.events || [])].filter((e) => e.type === 'm.room.member');
ok(!syncMemberEvents.some((e) => e.state_key === admin.user_id || e.state_key === stranger.user_id), 'sync hides other member events');
ok(!ch?.summary?.['m.heroes']?.includes(admin.user_id), 'sync summary hides hero ids');
const receiptUsers = Object.values(ch?.ephemeral?.events?.find((e) => e.type === 'm.receipt')?.content || {}).flatMap((byType) => Object.values(byType || {}).flatMap((users) => Object.keys(users || {})));
ok(!receiptUsers.includes(admin.user_id), 'sync receipt hides other users');

// Reactions: admin + member react; count must remain 2, admin sender must be anon.
await send(admin.access_token, roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: '👍' } });
await send(member.access_token, roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: '❤️' } });
const relR = await fetch(BASE + `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(eventId)}/m.annotation/m.reaction`, { headers: H(member.access_token) });
const rel = { status: relR.status, body: await j(relR) };
const reactions = rel.body.chunk || [];
ok(reactions.length === 2, 'reaction count preserved');
ok(reactions.some((e) => e.sender === member.user_id), 'own reaction sender preserved');
ok(!reactions.some((e) => e.sender === admin.user_id) && reactions.some((e) => String(e.sender).startsWith('@anon-')), 'other reaction sender anonymized');

// Admin sees all; group is untouched.
const adminJm = await matrix(admin.access_token, 'GET', `/rooms/${encodeURIComponent(roomId)}/joined_members`);
ok(!!adminJm.body.joined?.[admin.user_id] && !!adminJm.body.joined?.[member.user_id], 'admin sees channel members');

const group = await createRoom(admin.access_token, {
  name: 'q7 group ' + sfx, preset: 'private_chat',
  initial_state: [{ type: 'ir.tikootak.room_type', state_key: '', content: { type: 'group' } }],
  invite: [member.user_id],
});
const gid = group.body.room_id;
await matrix(member.access_token, 'POST', `/join/${encodeURIComponent(gid)}`, {});
const gjm = await matrix(member.access_token, 'GET', `/rooms/${encodeURIComponent(gid)}/joined_members`);
ok(!!gjm.body.joined?.[admin.user_id] && !!gjm.body.joined?.[member.user_id], 'normal group is untouched');

const t0 = Date.now();
await matrix(member.access_token, 'GET', '/sync?timeout=0');
console.log('INFO member sync round-trip ms:', Date.now() - t0);
