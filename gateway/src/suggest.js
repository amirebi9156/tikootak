// پیشنهاد اتاق/کانال عمومی برای Q2. خودِ Synapse room directory منبع است؛
// نتیجه قبل از برگشت، prefix-first مرتب و به سقف محدود می‌شود.
import rateLimit from 'express-rate-limit';

export function mountSuggest(app, { auth, synapseUrl, fetchT, bearer }) {
  const limiter = rateLimit({
    windowMs: 60_000, limit: 45, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
  });

  app.get('/api/rooms/suggest', auth, limiter, async (req, res) => {
    const q = String(req.query.q || '').trim().replace(/^#/, '').toLowerCase().slice(0, 60);
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 8);
    const filter = q ? `&filter=${encodeURIComponent(JSON.stringify({ generic_search_term: q }))}` : '';
    const token = bearer(req);
    try {
      const r = await fetchT(
        `${synapseUrl}/_matrix/client/v3/publicRooms?limit=${Math.min(50, limit * 4)}${filter}`,
        { headers: token ? { authorization: `Bearer ${token}` } : {} },
      );
      if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: 'upstream_unavailable' });
      const data = await r.json();
      const seen = new Set();
      const norm = (v) => String(v || '').toLowerCase().replace(/^#/, '');
      const rooms = (Array.isArray(data.chunk) ? data.chunk : [])
        .filter((x) => x && x.room_id && x.visibility !== 'private' && !seen.has(x.room_id) && seen.add(x.room_id))
        .map((x) => ({
          room_id: x.room_id,
          name: x.name || x.canonical_alias || x.room_id,
          alias: x.canonical_alias || null,
          topic: String(x.topic || '').slice(0, 200),
          members: Number(x.num_joined_members) || 0,
          avatar_url: x.avatar_url || null,
          _rank: q && (norm(x.canonical_alias).startsWith(q) || String(x.name || '').toLowerCase().startsWith(q)) ? 0 : 1,
        }))
        .sort((a, b) => a._rank - b._rank || b.members - a.members)
        .slice(0, limit)
        .map(({ _rank, ...room }) => room);
      res.json({ rooms });
    } catch {
      res.status(502).json({ error: 'upstream_unavailable' });
    }
  });
}
