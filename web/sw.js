// Network first, cached copy when offline. data.bin is encrypted, so caching it is safe.
const CACHE = "garmin-shell-v3";
const SHELL = ["./", "style.css", "charts.js", "core.js", "views-a.js", "views-b.js", "manifest.webmanifest", "icon-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const key = u.pathname.endsWith("data.bin") ? new Request(u.origin + u.pathname) : e.request; // ignore ?cache-buster
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); } return r; }).catch(() => caches.match(key)));
});
