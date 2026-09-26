// The native shell as the app's auth and boot path sees it, for
// tools/firstrun-harness.mjs (bundled by esbuild there, as tools/ios/build.mjs
// bundles native/bridge.js). The same supabase-js the shell bundles, and the
// shell's own session storage — native/secure-session.js itself — over a fake
// SecureSession (Keychain) and a fake Preferences. Everything else on
// window.SpotterNative is an inert stand-in: only what boot and sign-in touch.
//
// The two fake plugins answer the way Capacitor does on iOS: every call crosses
// to one serial native queue and comes back in the order it was sent, a few
// milliseconds later. What the "Keychain" holds is kept in this origin's
// localStorage under __fr.* so a reload is a relaunch that finds it again, as a
// phone finds its Keychain. window.__frNativeCfg (set by the harness before the
// page loads) can slow the queue or hold one kind of call until released.
import * as supabase from '@supabase/supabase-js';
import { createSecureSession } from '../native/secure-session.js';

window.supabase = supabase;
// The harness's logging wraps createClient before app.js calls it.
if (window.__frInstrument) window.__frInstrument();
const cfg = window.__frNativeCfg || {};
const t0 = window.__frT0 || Date.now();
const note = (kind, line) => { (window.__frLog = window.__frLog || []).push([Date.now() - t0, kind, line]); };

// Which account a stored value belongs to, for the log: never the token itself.
function whose(value) {
  if (value === null || value === undefined) return 'nothing';
  try {
    const s = JSON.parse(value);
    if (s && s.user && s.user.id) return 'session of ' + ((window.__frNames || {})[s.user.id] || String(s.user.email || s.user.id).split('@')[0].replace(/^fr-/, '').toUpperCase());
  } catch (e) { /* not JSON */ }
  return String(value).length + ' chars';
}

function persisted(name) {
  let held = {};
  try { held = JSON.parse(localStorage.getItem('__fr.' + name) || '{}'); } catch (e) { held = {}; }
  const map = new Map(Object.entries(held));
  const save = () => localStorage.setItem('__fr.' + name, JSON.stringify(Object.fromEntries(map)));
  return { map, save };
}

// One serial queue for both plugins, as Capacitor's bridge queue is.
let tail = Promise.resolve();
const holds = {};
window.__frRelease = (kind) => { const h = holds[kind]; delete holds[kind]; if (h) h(); };
function call(plugin, method, key, work) {
  const kind = plugin + '.' + method;
  const run = tail.then(async () => {
    const ms = cfg.jitter ? cfg.jitter[0] + Math.random() * (cfg.jitter[1] - cfg.jitter[0]) : cfg.latency === undefined ? 3 : cfg.latency;
    await new Promise((r) => setTimeout(r, ms));
    if (cfg.hold && cfg.hold[kind] && (!cfg.hold[kind].key || String(key).includes(cfg.hold[kind].key)) && !cfg.hold[kind].spent) {
      cfg.hold[kind].spent = true;
      note('kc', kind + ' ' + key + ' HELD');
      await new Promise((r) => (holds[kind] = r));
    }
    return work();
  });
  tail = run.catch(() => {});
  return run;
}

function fakePlugin(name) {
  const { map, save } = persisted(name);
  return {
    get: ({ key }) => call(name, 'get', key, () => {
      const out = map.has(key) ? { value: map.get(key) } : {};
      if (/auth-token$/.test(key)) note('kc', name + '.get ' + key + ' → ' + whose(out.value));
      return out;
    }),
    set: ({ key, value }) => call(name, 'set', key, () => {
      map.set(key, value); save();
      if (/auth-token$/.test(key)) note('kc', name + '.set ' + key + ' ← ' + whose(value));
    }),
    remove: ({ key }) => call(name, 'remove', key, () => {
      const had = map.has(key); map.delete(key); save();
      if (/auth-token$/.test(key)) note('kc', name + '.remove ' + key + (had ? '' : ' (absent)'));
    }),
    keys: () => call(name, 'keys', '', () => ({ keys: [...map.keys()] }))
  };
}

const session = createSecureSession(fakePlugin('SecureSession'), fakePlugin('Preferences'));
const ok = () => Promise.resolve();
window.SpotterNative = {
  platform: 'ios',
  authStorage: session.storage,
  configureSharing: ok,
  takeParkedShare: () => Promise.resolve(null),
  purchases: { clear: ok, prices: () => Promise.resolve({ configured: false, nativeStore: true }),
    restore: ok, purchase: ok, redeemOfferCode: ok, managementUrl: () => Promise.resolve(null) },
  live: { update() {}, end() {}, publish() {},
    notifications: { status: () => Promise.resolve({ display: 'prompt' }), request: () => Promise.resolve({ display: 'denied' }) } },
  push: { status: () => Promise.resolve({ permission: 'prompt' }), register: () => Promise.resolve(null), unregister() {} },
  contactSheet: () => Promise.reject(new Error('not in the harness')),
  signInWithApple: () => Promise.reject(Object.assign(new Error('cancelled'), { code: 'AUTH_CANCELLED' })),
  signInWithGoogle: () => Promise.reject(Object.assign(new Error('cancelled'), { code: 'AUTH_CANCELLED' })),
  saveDraft() {}, haptic() {}, open: ok
};

// bridge.js's boot: the session is moved or cleared first, then app.js runs.
session.prepare().then((r) => {
  note('kc', 'prepare → ' + r);
  const s = document.createElement('script'); s.src = 'fr/app.js'; document.body.appendChild(s);
}, (e) => { document.body.textContent = 'prepare failed: ' + e.message; });
