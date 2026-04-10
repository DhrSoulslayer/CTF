/* global self, clients */

const CACHE_NAME = 'ctf-cache-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/pub/',
  '/pub/index.html',
  '/lib/leaflet.css',
  '/lib/leaflet.js',
  '/manifest.webmanifest',
  '/pub/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Never cache or intercept admin/API/websocket-related traffic.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api') || url.pathname.startsWith('/ws'))
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // Cache only successful same-origin responses.
        if (resp.ok && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', event => {
  let payload = { title: 'CTF', body: 'Nieuwe melding', url: '/' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pub/icon.svg',
      badge: '/pub/icon.svg',
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(c => c.url.includes(targetUrl));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
