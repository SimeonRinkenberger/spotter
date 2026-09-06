// Service worker for the installed app. Still deliberately not an offline cache of
// everything: only the shell and first-party mascot art are kept, and a
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
var CACHE = "spotter-shell-v5";
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
  // Only the app itself is served off the shelf. The other pages here — privacy,
  // terms, the billing return — are small, rarely opened and never the thing
  // somebody is waiting on in a lift; on a slow link a timeout would hand them
  // the app instead of the page they asked for.
  if (e.request.mode === "navigate") {
    if (/\/$|\/index\.html$/.test(url.pathname)) e.respondWith(page(e.request));
    return;
  }
  // Small first-party drawings are cached only after use. Installing the shell
  // never waits on mascot art, and no unused animation is downloaded up front.
  if (/\/assets\/pumpy\/(coach|plan|proud|avatar|hello|hello-motion|proud-wing)\.webp$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (r) {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        });
      });
    }));
    return;
  }
  if (SHELL.some(function (p) { return url.pathname.endsWith(p); })) {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});

// ---------- the two reminders ----------
//
// Spotter sends exactly two notifications, both opt-in, both switchable off in
// Settings: the plan-day reminder and the one that says the week is still
// reachable. The server decides whether to send; this decides how it looks.
//
// The payload is JSON — { title, body, tag, url } — but a push service is
// allowed to wake a worker with no data at all (a Safari "budget" ping, a
// mangled body), and userVisibleOnly means a push that shows nothing costs the
// site its permission. So the parse is wrapped and there is always a fallback
// notification. `tag` is one fixed string per KIND, so tomorrow's plan-day
// reminder replaces today's on the lock screen instead of stacking under it.
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = d.title || "Spotter";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || undefined,
    tag: d.tag || "spotter",
    icon: "icon.png",
    badge: "icon.png",
    // Replace quietly: a second buzz for a notification that only updated the
    // first one is the thing that gets an app switched off.
    renotify: false,
    data: { url: d.url || "./" }
  }));
});

// Tapping it should land in the app that is already open, on the phone it is
// open on, rather than starting a second copy of it. Only if nothing is running
// do we open a window.
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var want = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) return c.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(want) : undefined;
    }));
});
