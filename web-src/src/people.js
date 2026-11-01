import { useEffect, useState } from 'react';
import { profilesLite } from './api.js';

// حافظه نام و عکس کاربران. هر جا آیدی کاربر (@ali:...) دیده شود، یک‌جا و دسته‌ای از gateway گرفته می‌شود.
const cache = new Map();
const subs = new Set();
let token = null;
let queue = new Set();
let timer = null;

export const setPeopleToken = (t) => { token = t; };
export const setPerson = (p) => { cache.set(p.user_id, p); subs.forEach((f) => f()); };
// با خروج از حساب، نام و عکس کاربران قبلی نباید به حساب بعدی نشت کند
export function resetPeople() {
  cache.clear();
  queue.clear();
  subs.clear();
  if (timer) { clearTimeout(timer); timer = null; }
  token = null;
}

async function flush() {
  timer = null;
  const ids = [...queue]; queue = new Set();
  if (!token || !ids.length) return;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const d = await profilesLite(token, ids.slice(i, i + 50));
      d.profiles.forEach((p) => cache.set(p.user_id, p));
    }
    subs.forEach((f) => f());
  } catch { /* بعداً دوباره */ }
}

export function usePerson(id) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id || !id.startsWith('@')) return undefined;
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (!cache.has(id)) { queue.add(id); if (!timer) timer = setTimeout(flush, 30); }
    return () => subs.delete(f);
  }, [id]);
  return id ? cache.get(id) || null : null;
}
