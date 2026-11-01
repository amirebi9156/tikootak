// Service worker ساده: فایل‌های اپ رو کش می‌کنه تا اپ سریع‌تر باز بشه و روی نت ضعیف هم بالا بیاد.
// درخواست‌های API و Matrix و LiveKit هرگز کش نمی‌شن.
const V = 'tikootak-shell-v6';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(api|_matrix|_synapse|livekit)/.test(url.pathname) || url.pathname === '/admin.html' || url.pathname === '/admin.js') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(V).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(V).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Q5: کلیک روی اعلان → فوکوس پنجرهٔ باز و باز کردن همان گفتگو (بدون ارسال متن به جایی)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const roomId = e.notification.data && e.notification.data.roomId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all[0];
    if (c) {
      await c.focus().catch(() => {});
      c.postMessage({ type: 'tikootak-open-room', roomId });
    } else {
      await self.clients.openWindow('./');
    }
  })());
});
