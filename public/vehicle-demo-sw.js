/* Presentation-only offline cache. No API response or POST is cached. */
const CACHE = 'bricklab-structure-demo-v4';
const allowed = url => url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/vehicle-demos/') || url.pathname.startsWith('/vehicle-structures/') || ['/', '/vehicle-generator'].includes(url.pathname));
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_PRESENTATION' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE); let ok = true;
    for (const raw of [...new Set(event.data.urls)]) {
      const url = new URL(raw, self.location.origin);
      if (!allowed(url)) { ok = false; continue; }
      try { const response = await fetch(url.href); if (!response.ok) throw Error('UNAVAILABLE'); await cache.put(url.href, response); } catch { if (!await cache.match(url.href)) ok = false; }
    }
    event.ports[0]?.postMessage({ ok });
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !allowed(new URL(event.request.url))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }
    catch { return await cache.match(event.request) || (event.request.mode === 'navigate' ? await cache.match('/vehicle-generator') : undefined) || Response.error(); }
  })());
});
