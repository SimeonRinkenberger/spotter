// docs/sw.js is the kill switch for the retired web app. Loads the real file into a
// fake worker global and drives install and activate. No browser, no network.
//
//   node tools/sw-harness.mjs
//
// What has to hold: it takes over at once; it deletes Spotter's caches and only
// Spotter's (the origin is shared with another app, and CacheStorage is the whole
// origin's); it unregisters; it reloads the windows it controls onto their own URL;
// and it has no fetch or push handler of its own. None of that may depend on
// navigate() existing, or on caches.keys() working.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync('docs/sw.js', 'utf8');
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS', name); }

function worker({ cacheNames = [], keysFails = false, tabs = [] } = {}) {
  const events = {}, deleted = [], log = [];
  let skipped = 0, unregistered = 0;
  const caches = {
    async keys() { if (keysFails) throw new Error('SecurityError'); return [...cacheNames]; },
    async delete(k) { deleted.push(k); log.push('delete ' + k); return true; },
  };
  const self = {
    addEventListener: (name, fn) => { events[name] = fn; },
    skipWaiting: () => { skipped++; return Promise.resolve(); },
    registration: { unregister: async () => { unregistered++; log.push('unregister'); return true; } },
    clients: {
      matchAll: async (opts) => { log.push('matchAll ' + JSON.stringify(opts)); return tabs; },
    },
  };
  vm.runInContext(code, vm.createContext({ self, caches, Promise }));
  async function dispatch(name) {
    let p = Promise.resolve();
    events[name]({ waitUntil: (q) => { p = q; } });
    await p;
  }
  return { events, deleted, log, dispatch, get skipped() { return skipped; }, get unregistered() { return unregistered; } };
}
function tab(url, how = 'ok') {
  const t = { url, went: [] };
  if (how === 'none') return t;
  t.navigate = (u) => {
    if (how === 'throws') throw new Error('not allowed');
    t.went.push(u);
    return how === 'rejects' ? Promise.reject(new Error('gone')) : Promise.resolve(t);
  };
  return t;
}

await test('it answers nothing itself: no fetch, push or notificationclick handler', async () => {
  const w = worker();
  assert.deepEqual(Object.keys(w.events).sort(), ['activate', 'install']);
});

await test('install takes over straight away (skipWaiting)', async () => {
  const w = worker();
  await w.dispatch('install');
  assert.equal(w.skipped, 1);
});

await test("activate deletes every Spotter cache and nobody else's", async () => {
  const names = ['spotter-shell-v1', 'spotter-shell-v6', 'spotter-shell-v7', 'simmer-shell-v1', 'workbox-precache-v2', 'unrelated-app'];
  const w = worker({ cacheNames: names });
  await w.dispatch('activate');
  assert.deepEqual(w.deleted.sort(), ['spotter-shell-v1', 'spotter-shell-v6', 'spotter-shell-v7']);
});

await test('then unregisters, then reloads each window it controls onto its own URL', async () => {
  const a = tab('https://simeonrinkenberger.github.io/spotter/');
  const b = tab('https://simeonrinkenberger.github.io/spotter/?share&url=x');
  const w = worker({ cacheNames: ['spotter-shell-v7'], tabs: [a, b] });
  await w.dispatch('activate');
  assert.equal(w.unregistered, 1);
  assert.deepEqual(a.went, [a.url]);
  assert.deepEqual(b.went, [b.url]);
  assert.deepEqual(w.log, ['delete spotter-shell-v7', 'unregister', 'matchAll {"type":"window"}']);
});

await test('a browser without navigate(), or one that refuses it, still ends unregistered', async () => {
  const tabs = [tab('https://x/spotter/', 'none'), tab('https://x/spotter/', 'throws'), tab('https://x/spotter/', 'rejects')];
  const w = worker({ tabs });
  await w.dispatch('activate');   // resolves: nothing escapes into waitUntil
  assert.equal(w.unregistered, 1);
  assert.equal(tabs[2].went.length, 1);
});

await test('CacheStorage refusing to list still unregisters and reloads', async () => {
  const t = tab('https://x/spotter/');
  const w = worker({ keysFails: true, tabs: [t] });
  await w.dispatch('activate');
  assert.equal(w.unregistered, 1);
  assert.equal(t.went.length, 1);
});

console.log(checks + ' kill-switch service-worker checks passed');
