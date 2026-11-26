/* Service Worker — Vanilla Word Camp (香草单词营)
 * - /api/*: ALWAYS Network-Only (never cache auth or FSRS server truth)
 * - HTML navigations: Network-First (never trap users on an old index.html shell)
 * - Hashed JS/CSS (/assets/*), fonts (/fonts/*), icons: Cache-First / SWR per release cache
 * - Web Push: R3 reminder notifications & click-through to /student/task
 */

const CACHE_NAME = 'vanilla-camp-v2.5.0';
const STATIC_PRECACHES = ['/manifest.webmanifest', '/apple-touch-icon.png', '/favicon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PRECACHES)).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  let payload = {
    title: '香草单词营 · 记忆小站',
    body: '今天有词快到复习点了，花 3 分钟巩固一下吧～',
    url: '/student/task',
    reminderLogId: null,
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon-192.png',
      badge: '/favicon-192.png',
      data: { url: payload.url || '/student/task', reminderLogId: payload.reminderLogId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/student/task';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML / navigations so hot-updated app shell always loads fresh
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Cache-first for fingerprinted bundles, fonts, and static icons
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        });
      }),
    );
  }
});
