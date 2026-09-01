// Minimal service worker: enough for installability, deliberately not an offline cache.
// The page is network-first so a deploy is picked up on the next load; only the icon
// and manifest are served from cache.
var CACHE = "spotter-shell-v1";
var SHELL = ["icon.png", "manifest.webmanifest"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // never touch Supabase or CDN calls
  if (SHELL.some(function (p) { return url.pathname.endsWith(p); })) {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});
