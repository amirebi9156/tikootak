// تست واحد فیلتر Q7 (بدون Synapse زنده). امنیت واقعی باید با tests/security/sec06.mjs روی سرور تست شود.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { metaFromEvents, powerOf, createChannelPrivacy } from '../../gateway/src/channel-privacy.js';

const ADMIN = '@admin:test';
const MEMBER = '@member:test';
const OTHER = '@other:test';

function cp() {
  return createChannelPrivacy({
    synapseUrl: 'http://synapse.test',
    fetchT: async () => ({ ok: false }),
    whoami: async () => ({ user_id: MEMBER }),
    secret: 'test-secret',
    serverName: 'test',
    enabled: true,
    log: { warn() {}, error() {} },
  });
}

const state = [
  { type: 'ir.tikootak.room_type', state_key: '', content: { type: 'channel' }, sender: ADMIN },
  { type: 'm.room.create', state_key: '', content: { creator: ADMIN }, sender: ADMIN },
  { type: 'm.room.power_levels', state_key: '', content: { users_default: 0, users: { [ADMIN]: 100 } }, sender: ADMIN },
  { type: 'm.room.member', state_key: ADMIN, sender: ADMIN, content: { membership: 'join' } },
  { type: 'm.room.member', state_key: MEMBER, sender: ADMIN, content: { membership: 'join' } },
];

test('meta/power detect channel and group', () => {
  const meta = metaFromEvents(state);
  assert.equal(meta.kind, 'channel');
  assert.equal(powerOf(meta, ADMIN), 100);
  assert.equal(powerOf(meta, MEMBER), 0);
  const group = metaFromEvents([{ type: 'ir.tikootak.room_type', state_key: '', content: { type: 'group' } }]);
  assert.equal(group.kind, 'group');
});

test('channel member events, reactions, receipts and typing are filtered', () => {
  const c = cp();
  const out = c.filterEvents([
    { type: 'm.room.member', state_key: OTHER, sender: OTHER, content: { membership: 'join' } },
    { type: 'm.room.member', state_key: MEMBER, sender: ADMIN, content: { membership: 'join' } },
    { type: 'm.reaction', sender: OTHER, content: { 'm.relates_to': { event_id: '$e', key: '👍' } } },
    { type: 'm.reaction', sender: MEMBER, content: { 'm.relates_to': { event_id: '$e', key: '❤️' } } },
    { type: 'm.receipt', content: { '$e': { 'm.read': { [OTHER]: { ts: 1 }, [MEMBER]: { ts: 2 } } } } },
    { type: 'm.typing', content: { user_ids: [OTHER, MEMBER] } },
    { type: 'm.room.message', sender: ADMIN, content: { msgtype: 'm.text', body: 'hello' } },
  ], { roomId: '!c:test', viewer: MEMBER });
  assert.equal(out.length, 6);
  assert.equal(out[0].state_key, MEMBER);
  assert.notEqual(out[0].sender, ADMIN);
  assert.match(out[0].sender, /^@anon-/);
  assert.match(out[1].sender, /^@anon-/);
  assert.equal(out[2].sender, MEMBER);
  assert.deepEqual(out[3].content['$e']['m.read'], { [MEMBER]: { ts: 2 } });
  assert.deepEqual(out[4].content.user_ids, [MEMBER]);
  assert.equal(out[5].content.body, 'hello');
});

test('sync filters channel only; group and admin stay untouched; unknown joined room refuses sync; invites pass', async () => {
  const c = cp();
  const meta = metaFromEvents(state);
  assert.ok(powerOf(meta, ADMIN) >= 50);
  assert.ok(powerOf(meta, MEMBER) < 50);
  const data = {
    presence: { events: [{ type: 'm.presence', sender: OTHER }, { type: 'm.presence', sender: MEMBER }] },
    rooms: {
      join: {
        '!c:test': {
          state: { events: state },
          timeline: { events: [{ type: 'm.room.member', state_key: OTHER, sender: OTHER, content: { membership: 'join' } }] },
          summary: { 'm.joined_member_count': 3, 'm.heroes': [ADMIN, MEMBER] },
        },
        '!g:test': {
          state: { events: [{ type: 'ir.tikootak.room_type', state_key: '', content: { type: 'group' } }] },
          timeline: { events: [{ type: 'm.room.member', state_key: OTHER, sender: OTHER, content: { membership: 'join' } }] },
        },
      },
      invite: { '!i:test': { invite_state: { events: [{ type: 'm.room.member', state_key: MEMBER, sender: OTHER, content: { membership: 'invite' } }] } } },
    },
  };
  await c.filterSync(data, 'tok', MEMBER);
  assert.equal(data.rooms.join['!c:test'].timeline.events.length, 0);
  assert.equal(data.rooms.join['!c:test'].summary['m.joined_member_count'], 3);
  assert.equal(data.rooms.join['!c:test'].summary['m.heroes'], undefined, 'hero ids removed');
  assert.equal(data.rooms.join['!g:test'].timeline.events.length, 1);
  assert.equal(data.rooms.invite['!i:test'].invite_state.events[0].sender, OTHER, 'invites are kept with inviter');
  assert.deepEqual(data.presence.events.map((e) => e.sender), [MEMBER], 'global presence hides other ids when a restricted channel is present');
});

test('admin/owner is above the restricted power threshold; anon ids are stable per room and differ across rooms', () => {
  const c = cp();
  const a1 = c.anonFor('!c:test', OTHER);
  const a2 = c.anonFor('!c:test', OTHER);
  const a3 = c.anonFor('!d:test', OTHER);
  assert.equal(a1, a2);
  assert.notEqual(a1, a3);
  const meta = metaFromEvents(state);
  assert.ok(powerOf(meta, ADMIN) >= 50);
  assert.ok(powerOf(meta, MEMBER) < 50);
});

test('middleware filters room and sync responses (member) and passes admin/group', async () => {
  const groupState = [
    { type: 'ir.tikootak.room_type', state_key: '', content: { type: 'group' } },
    { type: 'm.room.power_levels', state_key: '', content: { users_default: 0, users: { [ADMIN]: 100 } } },
  ];
  const members = [
    { type: 'm.room.member', state_key: ADMIN, sender: ADMIN, content: { membership: 'join' } },
    { type: 'm.room.member', state_key: MEMBER, sender: ADMIN, content: { membership: 'join' } },
    { type: 'm.room.member', state_key: OTHER, sender: OTHER, content: { membership: 'join' } },
  ];
  const syncData = {
    rooms: { join: {
      '!c:test': { state: { events: state }, timeline: { events: members }, summary: { 'm.joined_member_count': 3 } },
      '!g:test': { state: { events: groupState }, timeline: { events: members } },
    } },
  };
  const fake = express();
  fake.use(express.json());
  fake.post('/_matrix/client/v3/createRoom', (req, res) => res.json({ got: req.body }));
  fake.get('/_matrix/client/v3/rooms/:id/state', (req, res) => res.json(req.params.id === '!c:test' ? state : groupState));
  fake.get('/_matrix/client/v3/rooms/:id/members', (req, res) => res.json({ chunk: members }));
  fake.get('/_matrix/client/v3/rooms/:id/joined_members', (_req, res) => res.json({ joined: {
    [ADMIN]: { display_name: 'Admin' }, [MEMBER]: { display_name: 'Member' }, [OTHER]: { display_name: 'Other' },
  } }));
  fake.get('/_matrix/client/v3/rooms/:id/state/m.room.member/:target', (req, res) => {
    const ev = members.find((m) => m.state_key === req.params.target);
    return ev ? res.json(ev) : res.status(404).json({ errcode: 'M_NOT_FOUND' });
  });
  fake.get('/_matrix/client/v3/sync', (_req, res) => res.json(JSON.parse(JSON.stringify(syncData))));
  const fakeServer = fake.listen(0);
  await new Promise((resolve) => fakeServer.once('listening', resolve));
  const base = `http://127.0.0.1:${fakeServer.address().port}`;

  const c = createChannelPrivacy({
    synapseUrl: base,
    fetchT: (url, opts, ms) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }),
    whoami: async (token) => ({ user_id: token === 'admin' ? ADMIN : MEMBER }),
    secret: 'test-secret',
    serverName: 'test',
    enabled: true,
    log: { warn() {}, error() {} },
  });
  const app = express();
  app.use(express.json());
  app.use('/_matrix/client', c.middleware);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const appBase = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, token = 'member') => {
    const r = await fetch(appBase + p, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (p, token, body) => {
    const r = await fetch(appBase + p, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  try {
    let r = await get('/_matrix/client/v3/rooms/%21c%3Atest/members');
    assert.equal(r.status, 200);
    assert.equal(r.body.chunk.length, 1);
    assert.equal(r.body.chunk[0].state_key, MEMBER);
    assert.match(r.body.chunk[0].sender, /^@anon-/);

    r = await get('/_matrix/client/v3/rooms/%21c%3Atest/members/');
    assert.equal(r.status, 200);
    assert.equal(r.body.chunk.length, 1, 'trailing slash is still filtered');

    r = await get('/_matrix/client/v3/rooms/%21c%3Atest/joined_members');
    assert.deepEqual(Object.keys(r.body.joined), [MEMBER]);

    r = await get('/_matrix/client/v3/rooms/%21c%3Atest/members', 'admin');
    assert.equal(r.body.chunk.length, 3, 'admin sees all members');

    r = await get('/_matrix/client/v3/rooms/%21g%3Atest/members');
    assert.equal(r.body.chunk.length, 3, 'group is untouched');

    r = await get('/_matrix/client/v3/rooms/%21c%3Atest/state/m.room.member/' + encodeURIComponent(OTHER));
    assert.equal(r.status, 404);

    r = await get('/_matrix/client/v3/sync');
    assert.equal(r.status, 200);
    assert.equal(r.body.rooms.join['!c:test'].timeline.events.length, 1);
    assert.equal(r.body.rooms.join['!c:test'].summary['m.joined_member_count'], 3);
    assert.equal(r.body.rooms.join['!g:test'].timeline.events.length, 3);

    r = await get('/_matrix/client/v3/sync', 'admin');
    assert.equal(r.body.rooms.join['!c:test'].timeline.events.length, 3);

    assert.equal((await get('/_matrix/client/v3/user_directory/search')).status, 404);
    r = await post('/_matrix/client/v3/createRoom', 'member', { name: 'body test' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.got, { name: 'body test' }, 'non-GET body is forwarded');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeServer.close(resolve));
  }
});

test('health self-test is green', () => {
  const c = cp();
  assert.equal(c.selfTest(), true);
  assert.equal(c.status().ok, true);
});
