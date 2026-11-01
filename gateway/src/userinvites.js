// کد دعوت شخصی: هر کاربر (بعد از ۲۴ ساعت) چند کد یک‌بارمصرف می‌سازد؛ ادمین می‌بیند چه کسی چه کسی را آورده.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

export function mountUserInvites(app, { db, auth, settings, displayName }) {
  const now = () => Math.floor(Date.now() / 1000);
  const limiter = rateLimit({ windowMs: 3600_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.userId || req.ip, message: { error: 'rate_limited' } });
  const active = (uid) => db.prepare('SELECT COUNT(*) c FROM invites WHERE owner=? AND revoked=0 AND uses<max_uses AND (expires_at IS NULL OR expires_at>?)').get(uid, now()).c;
  const canMake = (uid) => {
    const quota = settings.num('user_invite_quota');
    const joined = db.prepare('SELECT created_at c FROM registrations WHERE user_id=?').get(uid)?.c || 0;
    if (!settings.registration().open) return { ok: false, why: 'registration_closed' };
    if (quota <= 0) return { ok: false, why: 'disabled' };
    if (now() - joined < 86400) return { ok: false, why: 'too_new' };
    if (active(uid) >= quota) return { ok: false, why: 'limit' };
    return { ok: true };
  };

  app.get('/api/invites', auth, limiter, async (req, res) => {
    const codes = db.prepare('SELECT code,max_uses,uses,expires_at,revoked,created_at FROM invites WHERE owner=? ORDER BY created_at DESC LIMIT 30').all(req.userId);
    const rows = db.prepare('SELECT r.user_id,r.created_at FROM registrations r JOIN invites i ON i.code=r.invite_code WHERE i.owner=? ORDER BY r.created_at DESC LIMIT 100').all(req.userId);
    const invited = [];
    for (const r of rows) invited.push({ user_id: r.user_id, name: await displayName(r.user_id), at: r.created_at });
    const c = canMake(req.userId);
    res.json({ codes, invited, can_create: c.ok, reason: c.ok ? null : c.why, quota: settings.num('user_invite_quota'), active: active(req.userId) });
  });

  app.post('/api/invites', auth, limiter, (req, res) => {
    const c = canMake(req.userId);
    if (!c.ok) return res.status(403).json({ error: `invite_${c.why}` });
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    db.prepare('INSERT INTO invites (code,max_uses,expires_at,note,created_at,owner) VALUES (?,?,?,?,?,?)').run(code, 1, now() + 7 * 86400, 'user', now(), req.userId);
    res.status(201).json({ code, expires_at: now() + 7 * 86400 });
  });
  app.delete('/api/invites/:code', auth, limiter, (req, res) => {
    const r = db.prepare('UPDATE invites SET revoked=1 WHERE code=? AND owner=?').run(String(req.params.code).toUpperCase(), req.userId);
    res.json({ revoked: r.changes > 0 });
  });
}
