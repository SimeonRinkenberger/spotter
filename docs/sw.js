// Service worker for the installed app. Still deliberately not an offline cache of
// everything: only the icon, the manifest and the page itself are ever kept, and a
// Supabase or CDN response is never touched — a stale workout row would be a lie,
// and a stale page is only yesterday's build.
//
// The page is network-first with a short timeout rather than cache-first, because a
// deploy has to be picked up. On a normal connection the network wins every time and
// the user gets today's build; on an aeroplane, a hotel lobby or a lift the timeout
// fires, the last good copy opens instantly, and the network response — whenever it
// arrives — still refreshes the cache for next time. That is the pattern Workbox
// calls NetworkFirst with networkTimeoutSeconds, and 1.5s is the number that keeps a
// bad connection from holding a blank screen while never beating a good one.
var CACHE = "spotter-shell-v2";
var SHELL = ["icon.png", "manifest.webmanifest"];
var PAGE = "index.html";
var NET_TIMEOUT = 1500;

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

// A redirected response cannot be handed back for a navigation — the browser refuses
// it — and GitHub Pages redirects /spotter to /spotter/. Copy it into a plain one.
function unredirect(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

function page(req) {
  return caches.open(CACHE).then(function (c) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(r) { if (!settled && r) { settled = true; resolve(r); } }

      var timer = setTimeout(function () {
        c.match(PAGE).then(done);
      }, NET_TIMEOUT);

      fetch(req).then(function (res) {
        clearTimeout(timer);
        // Cached even when the timeout already answered from the shelf: this launch
        // is what makes the next one right.
        if (res && res.ok) unredirect(res.clone()).then(function (keep) { c.put(PAGE, keep); });
        unredirect(res).then(function (out) {
          done(out);
          // The network lost the race but still came back — nothing to hand over
          // now, and the put above has already taken care of next time.
        });
      }, function () {
        clearTimeout(timer);
        c.match(PAGE).then(function (hit) { done(hit || Response.error()); });
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // never touch Supabase or CDN calls
  if (e.request.mode === "navigate") { e.respondWith(page(e.request)); return; }
  if (SHELL.some(function (p) { return url.pathname.endsWith(p); })) {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});
