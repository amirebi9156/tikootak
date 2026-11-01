// Q7 — فیلتر حریم خصوصی اعضای کانال در سطح سرور.
// فقط پاسخ‌های Matrix مربوط به اتاق‌های «کانال» را برای بینندهٔ با power < 50 فیلتر می‌کند.
// اتاق گروه/پیوی و بینندهٔ admin/owner بدون تغییر عبور می‌کنند.
import crypto from 'node:crypto';

const MEMBER = 'm.room.member';
const REACTION = 'm.reaction';
const RECEIPT = 'm.receipt';
const TYPING = 'm.typing';
const TYPE_EVENTS = ['ir.tikootak.room_type', 'ir.tikotak.room_type'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function metaFromEvents(events = []) {
  let type = null;
  let powerLevels = null;
  let creator = null;
  for (const ev of events || []) {
    if (!ev || typeof ev !== 'object') continue;
    if (TYPE_EVENTS.includes(ev.type) && ev.content?.type) type = ev.content.type;
    if (ev.type === 'm.room.power_levels' && ev.content) powerLevels = ev.content;
    if (ev.type === 'm.room.create') creator = ev.content?.creator || ev.sender || null;
  }
  if (!type && powerLevels && Number(powerLevels.events_default || 0) >= 50) type = 'channel';
  const kind = type === 'channel' || type === 'group' || type === 'dm' || type === 'saved'
    ? type
    : (powerLevels ? 'group' : null);
  return { kind, type, powerLevels, creator };
}

export function powerOf(meta, userId) {
  const pl = meta?.powerLevels || {};
  const direct = pl.users?.[userId];
  if (Number.isFinite(Number(direct))) return Number(direct);
  if (meta?.creator && meta.creator === userId) return 100;
  return Number(pl.users_default || 0);
}

export function createChannelPrivacy({
  synapseUrl,
  fetchT,
  whoami,
  secret,
  serverName,
  enabled = true,
  log = console,
}) {
  const roomCache = new Map(); // roomId -> { exp, meta }
  const authCache = new Map(); // token -> { user, exp }
  const ROOM_TTL = 20_000;
  const UNKNOWN_TTL = 2_000;
  const AUTH_TTL = 20_000;
  const MAX_CACHE = 5000;

  function anonFor(roomId, userId) {
    const sig = crypto.createHmac('sha256', String(secret || 'tikootak-channel-privacy'))
      .update(`${roomId}|${userId}`).digest('hex').slice(0, 12);
    return `@anon-${sig}:${serverName || 'localhost'}`;
  }

  async function userFor(token) {
    if (!token) return null;
    const hit = authCache.get(token);
    if (hit && hit.exp > Date.now()) return hit.user;
    try {
      const me = await whoami(token);
      if (!me?.user_id) return null;
      authCache.set(token, { user: me.user_id, exp: Date.now() + AUTH_TTL });
      if (authCache.size > 2000) authCache.delete(authCache.keys().next().value);
      return me.user_id;
    } catch {
      return null;
    }
  }

  async function fetchMeta(roomId, token) {
    const hit = roomCache.get(roomId);
    if (hit && hit.exp > Date.now()) return hit.meta;
    let meta = null;
    try {
      const r = await fetchT(`${synapseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`, {
        headers: { authorization: `Bearer ${token}` },
      }, 8000);
      if (r.ok) {
        const events = await r.json();
        meta = metaFromEvents(events);
        if (!meta?.kind && Array.isArray(events) && events.some((e) => e?.type === 'm.room.create')) {
          // A room still being created (create + creator join, no power levels yet) is visible only to its creator.
          meta = { ...meta, kind: 'group', partial: true };
        }
      } else {
        log.warn?.(`[channel-privacy] state fetch ${roomId} -> HTTP ${r.status}`);
      }
    } catch (e) { log.warn?.(`[channel-privacy] state fetch ${roomId} failed: ${e?.message || e}`); }
    const ttl = meta?.kind && !meta.partial ? ROOM_TTL : UNKNOWN_TTL;
    roomCache.set(roomId, { meta, exp: Date.now() + ttl });
    if (roomCache.size > MAX_CACHE) roomCache.delete(roomCache.keys().next().value);
    return meta;
  }

  async function metaForRoom(roomId, token, roomData = null) {
    const events = [
      ...(roomData?.state?.events || []),
      ...(roomData?.timeline?.events || []),
      ...(roomData?.invite_state?.events || []),
      ...(roomData?.knock_state?.events || []),
    ];
    const hinted = events.length ? metaFromEvents(events) : null;
    if (hinted?.kind) {
      roomCache.set(roomId, { meta: hinted, exp: Date.now() + ROOM_TTL });
      return hinted;
    }
    return fetchMeta(roomId, token);
  }

  function filterReceipt(content, viewer) {
    const out = {};
    for (const [eventId, byType] of Object.entries(content || {})) {
      const keepTypes = {};
      for (const [type, users] of Object.entries(byType || {})) {
        const keep = Object.fromEntries(Object.entries(users || {}).filter(([uid]) => uid === viewer));
        if (Object.keys(keep).length) keepTypes[type] = keep;
      }
      if (Object.keys(keepTypes).length) out[eventId] = keepTypes;
    }
    return out;
  }

  function filterEvent(ev, { roomId, viewer }) {
    if (!ev || typeof ev !== 'object') return ev;
    if (ev.type === MEMBER) {
      if (ev.state_key !== viewer) return null;
      if (ev.sender && ev.sender !== viewer) ev.sender = anonFor(roomId, ev.sender);
      return ev;
    }
    if (ev.type === REACTION) {
      if (ev.sender && ev.sender !== viewer) ev.sender = anonFor(roomId, ev.sender);
      return ev;
    }
    if (ev.type === RECEIPT) {
      if (ev.sender && ev.sender !== viewer) ev.sender = anonFor(roomId, ev.sender);
      const content = filterReceipt(ev.content, viewer);
      if (!Object.keys(content).length) return null;
      ev.content = content;
      return ev;
    }
    if (ev.type === TYPING) {
      if (ev.sender && ev.sender !== viewer) ev.sender = anonFor(roomId, ev.sender);
      ev.content = { ...(ev.content || {}), user_ids: (ev.content?.user_ids || []).filter((u) => u === viewer) };
      return ev.content.user_ids.length ? ev : null;
    }
    if (ev.type === 'm.presence') return null;
    // Optional bundled aggregations (reaction senders) must be filtered too.
    const relations = ev.unsigned?.['m.relations'];
    if (relations && typeof relations === 'object') {
      for (const rel of Object.values(relations)) {
        if (rel && Array.isArray(rel.chunk)) rel.chunk = filterEvents(rel.chunk, { roomId, viewer });
      }
    }
    return ev;
  }

  function filterEvents(events, ctx) {
    if (!Array.isArray(events)) return events;
    return events.map((ev) => filterEvent(ev, ctx)).filter(Boolean);
  }

  function isRestrictedChannel(meta, viewer) {
    return !!meta && meta.kind === 'channel' && powerOf(meta, viewer) < 50;
  }

  async function filterSync(data, token, viewer) {
    let restrictedAny = false;
    let unknownAny = false;
    for (const section of ['join', 'leave', 'invite', 'knock']) {
      const map = data?.rooms?.[section];
      if (!map || typeof map !== 'object') continue;
      for (const roomId of Object.keys(map)) {
        const room = map[roomId];
        const meta = await metaForRoom(roomId, token, room);
        let effective = meta;
        if (!meta?.kind) {
          if (section === 'invite' || section === 'knock') {
            // Invitees only get stripped state (their own invite + inviter); no member list to leak,
            // and the room type is not readable before joining. Dropping these would hide every invite.
            continue;
          }
          if (section === 'leave') {
            // Cannot read state of a left room: fail closed by applying the strictest filter.
            effective = { kind: 'channel', powerLevels: null, creator: null };
          } else {
            // Joined room whose type cannot be determined: fail the whole sync (client retries)
            // instead of silently dropping the room or leaking members.
            unknownAny = true;
            log.warn?.(`[channel-privacy] unknown room metadata for ${roomId}; sync refused`);
            throw new Error('unknown room metadata');
          }
        }
        if (!isRestrictedChannel(effective, viewer)) continue;
        restrictedAny = true;
        if (room.summary && typeof room.summary === 'object') {
          // Counts stay; hero ids would leak member identities.
          delete room.summary['m.heroes'];
        }
        if (room.state?.events) room.state.events = filterEvents(room.state.events, { roomId, viewer });
        if (room.timeline?.events) room.timeline.events = filterEvents(room.timeline.events, { roomId, viewer });
        if (room.ephemeral?.events) room.ephemeral.events = filterEvents(room.ephemeral.events, { roomId, viewer });
        if (room.invite_state?.events) room.invite_state.events = filterEvents(room.invite_state.events, { roomId, viewer });
        if (room.knock_state?.events) room.knock_state.events = filterEvents(room.knock_state.events, { roomId, viewer });
      }
    }
    // Presence is global in Matrix; once the viewer is in a restricted channel,
    // keep only the viewer's own presence so other member ids cannot leak through sync.
    if ((restrictedAny || unknownAny) && Array.isArray(data?.presence?.events)) {
      data.presence.events = data.presence.events.filter((ev) => ev?.sender === viewer);
    }
    return data;
  }

  function filterInitialSync(data, token, viewer) {
    if (data?.rooms && !Array.isArray(data.rooms)) return filterSync(data, token, viewer);
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    let restricted = false;
    let unknown = false;
    return Promise.all(rooms.map(async (room) => {
      const roomId = room.room_id || room.roomId;
      if (!roomId) return room;
      const meta = await metaForRoom(roomId, token, room);
      if (!meta?.kind) { unknown = true; return null; }
      if (!isRestrictedChannel(meta, viewer)) return room;
      restricted = true;
      if (room.summary && typeof room.summary === 'object') delete room.summary['m.heroes'];
      if (room.state?.events) room.state.events = filterEvents(room.state.events, { roomId, viewer });
      if (room.messages?.chunk) room.messages.chunk = filterEvents(room.messages.chunk, { roomId, viewer });
      if (room.timeline?.events) room.timeline.events = filterEvents(room.timeline.events, { roomId, viewer });
      return room;
    })).then((out) => {
      if (Array.isArray(data?.rooms)) data.rooms = out.filter(Boolean);
      if ((restricted || unknown) && Array.isArray(data?.presence)) data.presence = data.presence.filter((ev) => ev?.sender === viewer);
      return data;
    });
  }

  function filterMembers(data, ctx) {
    if (!Array.isArray(data?.chunk)) return { ...(data || {}), chunk: [] };
    data.chunk = filterEvents(data.chunk, ctx);
    return data;
  }

  function filterJoinedMembers(data, viewer) {
    if (data?.joined && typeof data.joined === 'object') {
      data.joined = Object.fromEntries(Object.entries(data.joined).filter(([uid]) => uid === viewer));
    }
    return data;
  }

  function filterEventPayload(data, ctx, isMemberLookup = false) {
    if (isMemberLookup) {
      if (data?.state_key !== ctx.viewer) return null;
      return filterEvent(data, ctx);
    }
    if (!data || data.type !== MEMBER) return filterEvent(data, ctx);
    if (data.state_key !== ctx.viewer) return null;
    return filterEvent(data, ctx);
  }

  function filterMessages(data, ctx) {
    if (Array.isArray(data?.chunk)) data.chunk = filterEvents(data.chunk, ctx);
    if (Array.isArray(data?.state)) data.state = filterEvents(data.state, ctx);
    return data;
  }

  function filterContext(data, ctx) {
    if (Array.isArray(data?.state)) data.state = filterEvents(data.state, ctx);
    if (Array.isArray(data?.events_before)) data.events_before = filterEvents(data.events_before, ctx);
    if (Array.isArray(data?.events_after)) data.events_after = filterEvents(data.events_after, ctx);
    if (data?.event) data.event = filterEvent(data.event, ctx);
    return data;
  }

  function filterRelations(data, ctx) {
    if (Array.isArray(data?.chunk)) data.chunk = filterEvents(data.chunk, ctx);
    if (data?.original_event) {
      data.original_event = filterEvent(data.original_event, ctx);
      if (!data.original_event) return null;
    }
    return data;
  }

  function selfTest() {
    try {
      const roomId = '!selftest:local';
      const viewer = '@member:local';
      const other = '@other:local';
      const meta = { kind: 'channel', powerLevels: { users_default: 0, users: { '@admin:local': 100 } }, creator: '@admin:local' };
      if (!isRestrictedChannel(meta, viewer)) return false;
      const events = [
        { type: MEMBER, state_key: other, sender: other, content: { membership: 'join' } },
        { type: MEMBER, state_key: viewer, sender: '@admin:local', content: { membership: 'join' } },
        { type: REACTION, sender: other, content: {} },
        { type: RECEIPT, content: { '$e': { 'm.read': { [other]: { ts: 1 }, [viewer]: { ts: 2 } } } } },
        { type: TYPING, content: { user_ids: [other, viewer] } },
      ];
      const out = filterEvents(events, { roomId, viewer });
      if (out.length !== 4) return false;
      if (out[0].type !== MEMBER || out[0].state_key !== viewer) return false;
      if (!String(out[0].sender).startsWith('@anon-')) return false;
      if (out[1].type !== REACTION || !String(out[1].sender).startsWith('@anon-')) return false;
      const receipt = out[2];
      if (receipt.type !== RECEIPT) return false;
      const users = receipt.content?.['$e']?.['m.read'] || {};
      if (!(Object.keys(users).length === 1 && users[viewer])) return false;
      const typing = out[3];
      return typing.type === TYPING && typing.content.user_ids.length === 1 && typing.content.user_ids[0] === viewer;
    } catch {
      return false;
    }
  }

  function status() {
    return { enabled, ok: selfTest(), mode: 'proxy' };
  }

  function bearer(req) {
    return (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  }

  function sendRaw(res, r, buf) {
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.set('cache-control', 'no-store');
    res.end(buf);
  }

  function sendJson(res, status, data) {
    res.status(status).set('content-type', 'application/json; charset=utf-8').set('cache-control', 'no-store').send(JSON.stringify(data));
  }

  async function upstream(req, res, { timeout = 60_000 } = {}) {
    const headers = { accept: 'application/json' };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const opts = { method: req.method, headers };
    // The global express.json() has already consumed JSON request bodies. Re-serialize
    // them for non-GET Matrix calls (createRoom/state) when this route is hit directly.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      opts.body = JSON.stringify(req.body);
    }
    const r = await fetchT(`${synapseUrl}${req.originalUrl}`, opts, timeout);
    const buf = Buffer.from(await r.arrayBuffer());
    return { r, buf };
  }

  function routeOf(rawPath) {
    const p = String(rawPath || '').split('?')[0].replace(/\/+$/, '');
    const base = /^\/_matrix\/client\/[^/]+\/(.+)$/.exec(p);
    if (!base) return null;
    const rest = base[1];
    if (rest === 'sync' || rest === 'initialSync') return { type: rest === 'sync' ? 'sync' : 'initial' };
    if (rest.startsWith('user_directory/')) return { type: 'user_directory' };
    if (rest.startsWith('events/')) return { type: 'event', eventId: decodeURIComponent(rest.slice(7)) };
    const room = /^rooms\/([^/]+)\/(.+)$/.exec(rest);
    if (!room) return null;
    const roomId = decodeURIComponent(room[1]);
    const sub = room[2];
    if (sub === 'members') return { type: 'members', roomId };
    if (sub === 'joined_members') return { type: 'joined_members', roomId };
    if (sub === 'state' || sub.startsWith('state/')) {
      const target = sub.startsWith('state/m.room.member/') ? decodeURIComponent(sub.slice('state/m.room.member/'.length)) : null;
      return { type: 'state', roomId, target };
    }
    if (sub === 'messages') return { type: 'messages', roomId };
    if (sub.startsWith('context/')) return { type: 'context', roomId };
    if (sub.startsWith('event/')) return { type: 'room_event', roomId };
    if (sub.startsWith('relations/')) return { type: 'relations', roomId };
    return null;
  }

  async function middleware(req, res) {
    try {
      const route = routeOf(req.originalUrl);
      if (route?.type === 'user_directory') return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      if (!enabled) {
        const { r, buf } = await upstream(req, res);
        return sendRaw(res, r, buf);
      }
      if (req.method !== 'GET') {
        const { r, buf } = await upstream(req, res);
        return sendRaw(res, r, buf);
      }
      const token = bearer(req);
      const viewer = await userFor(token);
      if (!viewer) return res.status(401).json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token' });
      if (!route) {
        const { r, buf } = await upstream(req, res);
        return sendRaw(res, r, buf);
      }

      if (route.type === 'sync' || route.type === 'initial') {
        const { r, buf } = await upstream(req, res);
        if (!r.ok) return sendRaw(res, r, buf);
        let data;
        try { data = JSON.parse(buf.toString('utf8')); } catch { return res.status(502).json({ errcode: 'M_UNKNOWN', error: 'channel privacy filter failed' }); }
        data = route.type === 'sync'
          ? await filterSync(data, token, viewer)
          : await filterInitialSync(data, token, viewer);
        return sendJson(res, 200, data);
      }

      if (route.type === 'event') {
        const { r, buf } = await upstream(req, res);
        if (!r.ok) return sendRaw(res, r, buf);
        let data;
        try { data = JSON.parse(buf.toString('utf8')); } catch { return res.status(502).json({ errcode: 'M_UNKNOWN', error: 'channel privacy filter failed' }); }
        const roomId = data.room_id;
        if (!roomId) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
        const meta = await fetchMeta(roomId, token);
        if (!isRestrictedChannel(meta, viewer)) return sendRaw(res, r, buf);
        const out = filterEvent(data, { roomId, viewer });
        if (!out) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
        return sendJson(res, 200, out);
      }

      const roomId = route.roomId;
      const meta = await fetchMeta(roomId, token);
      if (!meta?.kind) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      if (!isRestrictedChannel(meta, viewer)) {
        const { r, buf } = await upstream(req, res);
        return sendRaw(res, r, buf);
      }
      if (route.type === 'state' && route.target && route.target !== viewer) {
        return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      }
      const { r, buf } = await upstream(req, res);
      if (!r.ok) return sendRaw(res, r, buf);
      let data;
      try { data = JSON.parse(buf.toString('utf8')); } catch { return res.status(502).json({ errcode: 'M_UNKNOWN', error: 'channel privacy filter failed' }); }
      const ctx = { roomId, viewer };
      if (route.type === 'members') data = filterMembers(data, ctx);
      else if (route.type === 'joined_members') data = filterJoinedMembers(data, viewer);
      else if (route.type === 'state' && route.target) {
        data = filterEventPayload(data, ctx, true);
        if (!data) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      } else if (route.type === 'state') data = Array.isArray(data) ? filterEvents(data, ctx) : data;
      else if (route.type === 'messages') data = filterMessages(data, ctx);
      else if (route.type === 'context') data = filterContext(data, ctx);
      else if (route.type === 'room_event') {
        data = filterEventPayload(data, ctx);
        if (!data) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      } else if (route.type === 'relations') {
        data = filterRelations(data, ctx);
        if (!data) return res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
      }
      return sendJson(res, 200, data);
    } catch (e) {
      log.error?.('[channel-privacy]', e?.message || e);
      return res.status(502).json({ errcode: 'M_UNKNOWN', error: 'channel privacy filter failed' });
    }
  }

  return { middleware, status, selfTest, anonFor, filterEvents, filterSync, metaFromEvents, powerOf };
}
