// Spotter's web app is retired; native is the product. This is a kill switch.
//
// It must stay at this address for good. Every browser tab and home-screen install
// that ever ran the web app holds a registration pointing at /spotter/sw.js, and the
// next time that browser checks for an update (on the next visit, or when the old
// page calls register() as it boots) this file is what it downloads. A 404 here
// would leave the old worker, and the old app in its cache, in place.
//
// The pattern is the standard self-destroying worker (github.com/NekR/self-destroying-sw;
// vite-plugin-pwa generates the same), with one change for this origin: it is shared
// with another app (Simmer), and CacheStorage belongs to the whole origin, not to a
// path, so only Spotter's caches ("spotter-shell-v1" to "v7") are deleted, never all.
//
//   install   take over straight away (skipWaiting) instead of waiting for every tab
//             running the old app to close;
//   activate  delete Spotter's caches, unregister, then reload each window this worker
//             controls, so a tab or a home-screen app still showing the old shell
//             comes back as the landing page, straight from the network.
//
// No fetch handler, so while it lives every request goes to the network; and no push
// handler, because unregistering ends the push subscription along with the worker.
// The landing page (index.html) does the same clean-up from the page side, which is
// what covers a browser that never gets as far as running this.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("spotter") === 0; })
      .map(function (k) { return caches.delete(k); }));
  }).catch(function () { /* nothing to clear */ }).then(function () {
    return self.registration.unregister();
  }).then(function () {
    return self.clients.matchAll({ type: "window" });
  }).then(function (tabs) {
    tabs.forEach(function (tab) {
      // WindowClient.navigate is in every Chromium and in Safari from 16.4. Where it
      // is missing the tab keeps what it shows until it is next opened, and then the
      // network (no worker in the way) hands it the landing page.
      try { if (tab.navigate) tab.navigate(tab.url).catch(function () { /* tab went away */ }); }
      catch (err) { /* not navigable */ }
    });
  }).catch(function () { /* nothing more this worker can do */ }));
});
