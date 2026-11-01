// لاگ حسابرسی ادمین + فهرست سفید IP برای مسیرهای ادمین
import crypto from 'node:crypto';

export function createAudit(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ip TEXT, method TEXT, path TEXT, status INTEGER, note TEXT
  ); CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);`);
  const ins = db.prepare('INSERT INTO audit_log (at,ip,method,path,status,note) VALUES (?,?,?,?,?,?)');
  const now = () => Math.floor(Date.now() / 1000);
  const log = (ip, method, path, status, note = '') => {
    try { ins.run(now(), String(ip || ''), method, String(path).slice(0, 200), status, String(note).slice(0, 200)); } catch { /* لاگ نباید API را بشکند */ }
    // نگه‌داشتن ۹۰ روز
    if (Math.random() < 0.01) try { db.prepare('DELETE FROM audit_log WHERE at < ?').run(now() - 90 * 86400); } catch { /* */ }
  };
  return { log };
}

const norm = (ip) => String(ip || '').replace(/^::ffff:/, '');
const v4 = (s) => { const p = s.split('.').map(Number); return p.length === 4 && p.every((n) => n >= 0 && n < 256) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; };
export function ipAllowed(ip, rules) {
  if (!rules.length) return true;
  const a = norm(ip);
  if (a === '127.0.0.1' || a === '::1') return true; // اسکریپت admin.sh از داخل کانتینر
  for (const r of rules) {
    const [base, bits] = r.split('/');
    if (bits === undefined) { if (norm(base) === a) return true; continue; }
    const x = v4(a); const y = v4(base); const n = Number(bits);
    if (x === null || y === null || !(n >= 0 && n <= 32)) continue;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    if (((x & mask) >>> 0) === ((y & mask) >>> 0)) return true;
  }
  return false;
}

export const keyStrength = (k) => (String(k).length >= 32 ? 'ok' : 'weak');
export const randomKey = () => crypto.randomBytes(32).toString('hex');
