// بستن حساب Matrix از داخل gateway (بدون psql): با یک حساب ادمین اختصاصی که با shared-secret ساخته می‌شود.
import crypto from 'node:crypto';

export function makeSynapseAdmin({ url, secret, settings, fetchT }) {
  const NAME = 'gw-admin';
  async function registerAdmin(password) {
    const { nonce } = await (await fetchT(`${url}/_synapse/admin/v1/register`)).json();
    const mac = crypto.createHmac('sha1', secret)
      .update(Buffer.from(nonce)).update(Buffer.from([0])).update(Buffer.from(NAME)).update(Buffer.from([0]))
      .update(Buffer.from(password)).update(Buffer.from([0])).update(Buffer.from('admin')).digest('hex');
    const r = await fetchT(`${url}/_synapse/admin/v1/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce, username: NAME, password, admin: true, mac }),
    });
    return r.ok ? (await r.json()).access_token : null;
  }
  async function login(password) {
    const r = await fetchT(`${url}/_matrix/client/v3/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user: NAME }, password, initial_device_display_name: 'gateway-admin' }),
    });
    return r.ok ? (await r.json()).access_token : null;
  }
  async function token(force = false) {
    if (!force && settings.get('syn_admin_tok')) return settings.get('syn_admin_tok');
    let pw = settings.get('syn_admin_pw');
    let tok = null;
    if (!pw) { pw = crypto.randomBytes(24).toString('base64url'); tok = await registerAdmin(pw); if (tok) settings.set('syn_admin_pw', pw); }
    else tok = await login(pw);
    if (tok) settings.set('syn_admin_tok', tok);
    return tok;
  }
  async function call(path, method, body) {
    for (let i = 0; i < 2; i++) {
      const tok = await token(i === 1);
      if (!tok) return { ok: false, status: 0 };
      const r = await fetchT(`${url}${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, 30_000);
      if (r.status !== 401) return { ok: r.ok, status: r.status };
    }
    return { ok: false, status: 401 };
  }
  // حساب را می‌بندد: نشست‌ها قطع، از اتاق‌ها خارج
  const deactivate = async (userId) => {
    try { return (await call(`/_synapse/admin/v1/deactivate/${encodeURIComponent(userId)}`, 'POST', { erase: false })).ok; } catch { return false; }
  };
  return { deactivate };
}
