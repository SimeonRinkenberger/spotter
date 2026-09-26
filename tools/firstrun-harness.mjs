// The first run after a deleted account, reproduced with nothing leaving the Mac.
//
//   node build.mjs && node tools/firstrun-harness.mjs
//
// Options: --only <part of a walk's name> · --timeline (every walk's timeline, not
// only a failure's) · --trace (a line per auth/boot call in app.ts) · --sdk-debug
// (supabase-js's own debug lines, every getSession) · --shots <dir> [--scheme dark] · --keep-going
// · --think <ms on the landing> · --auth-ms / --rest-ms (the fake's answer time) ·
// --kc-ms (a Keychain call's) · --page <another built page, e.g. build 10's> ·
// --fuzz <n> [--seed s] [--mode web|native] · --only slow (the minutes-long ones).
//
// Build 10 on an iPhone 16e (B.2 Phase 0): the app launched holding the Keychain
// session of an account deleted on the server; the landing showed; a fresh
// sign-up then sat on Up next's skeleton for 20 s+ with no week ring. A relaunch
// drew it at once. This runs that walk in headless Chrome against the REAL
// supabase-js 2.115.0 and the built page, with a fake Supabase on 127.0.0.1
// (tools/firstrun-fake.mjs) standing in for the project: GoTrue answering a
// deleted account's refresh the way the real one does, PostgREST, the function.
// Twice over: the web page's own path (localStorage), and the native shell's
// (native/secure-session.js over a fake Keychain, tools/firstrun-native.js).
//
// Pass, for every walk: after "Create an account with this email", Up next is
// past its skeleton (upNext().s !== 0) and the week ring is drawn within 3 s.
// The controls must pass as well: a cold launch with nothing stored, a sign-out
// → sign-up in one launch, a returning account whose session is valid (and one
// whose access token has expired). One more walk holds a returning account's
// first plan read until a local edit has moved planRev on: loadPlan used to drop
// that answer and never ask again, which leaves Up next on its skeleton too. And
// one forces the brief's leading theory — the deleted account's Keychain removal
// stalls past secure-session.js's 10 s guard with every Keychain call queued
// behind it — which only delays the landing. Every walk also fails if any
// getSession call (each PostgREST call waits on one for its token) is left
// unanswered for more than 3 s.
//
// What this could not reproduce (B.2 b2-firstrun, 26 Sept): the 16e's skeleton.
// Build 10's page and this one, both paths, phone-like latencies, an 80-walk
// seeded fuzz (--fuzz) and the minutes-long cases (--only slow) all draw Train.
//
// Credentials: the addresses and passwords here are made up for this run and
// go to 127.0.0.1 and nowhere else. Chrome is started with a resolver rule that
// sends the fake project's name to 127.0.0.1 and every other name nowhere, and
// the page is checked for any production URL before it is served.
//
// No Chrome (a CI image without one): it says so and skips, exit 0.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { startFake, REF, PROD_URL, SESSION_KEY } from './firstrun-fake.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const val = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ONLY = val('only', '');
const VERBOSE = flag('verbose');
const SHOTS = val('shots', '');
const CDP = Number(val('cdp', 9478));
const WAIT_PASS = 3000, WAIT_LOOK = Number(val('look', 12000));

// ---------- Chrome ----------
function findChrome() {
  const env = process.env.CHROME_PATH;
  const list = [env, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return list.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
const CHROME = findChrome();
if (!CHROME) {
  console.log('firstrun-harness: SKIP — no Chrome found (set CHROME_PATH to run it). Nothing was checked.');
  process.exit(0);
}
const PAGE = val('page', 'web-dist/index.html');
if (!fs.existsSync(PAGE)) { console.error('firstrun-harness: run node build.mjs first'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const files = {};
const fake = await startFake({ tree: process.cwd(), t0: T0, verbose: VERBOSE, page: pageFor, files,
  delays: { auth: Number(val('auth-ms', 40)), rest: Number(val('rest-ms', 25)), fn: Number(val('rest-ms', 25)) },
  nameOf: (email) => email.split('@')[0].replace(/^fr-/, '').toUpperCase() });

// ---------- the page, as the web build and as the native bundle ----------
const BUILT = fs.readFileSync(PAGE, 'utf8');
const SDK_TAG = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.115\.0\/dist\/umd\/supabase\.js"([^>]*)><\/script>/;
function appScript() {
  const start = BUILT.lastIndexOf('<script>'), end = BUILT.indexOf('</script>', start);
  let js = BUILT.slice(start + 8, end);
  const tail = js.lastIndexOf('})();');
  if (tail < 0) throw new Error('the app IIFE end was not found');
  // A read-only way into the app's closure (upNext(), state), as the lab's X().
  // --trace: a line for each call of the auth/boot functions, with the epoch and
  // the account at that moment. Wrapping the bindings changes nothing they do.
  const trace = 'if (window.__frTrace) ["clearAccount", "signedOut", "showLanding", "showApp", "boot", "settleEarly", "answeredNobody", ' +
    '"paintRows", "loadLogs", "loadPlan", "load", "prepareTrain"].forEach(function (n) { var f = eval(n); ' +
    'eval(n + " = function () { window.__frNote(\\"app\\", n + \\" (epoch \\" + accountEpoch + \\", user \\" + (state.user ? state.user.email : \\"none\\") + ' +
    '(earlyUid ? \\", earlyUid \\" + earlyUid.slice(0, 8) : \\"\\") + \\")\\"); return f.apply(this, arguments); }"); });\n';
  js = js.slice(0, tail) + trace + 'window.__fr = function (js) { return eval(js); };\n' + js.slice(tail);
  return { start, end, js: local(js) };
}
// Every production URL of the project becomes the fake's; any left is a bug in
// this harness and the run stops before a page could reach it.
function local(text) {
  const out = text.split(PROD_URL).join(fake.sbOrigin);
  if (out.includes(REF + '.supabase.co')) throw new Error('a production URL survived the rewrite');
  return out;
}
function pageFor(mode) {
  const a = appScript();
  let html = BUILT.slice(0, a.start) + (mode === 'native'
    ? '<script src="fr/pre.js"></script><script src="fr/native.js"></script>'
    : '<script src="fr/pre.js"></script><script>' + a.js + '</script>') + BUILT.slice(a.end + 9);
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');
  // The same SDK file the CDN serves (its SRI hash is kept and must still match),
  // from node_modules; the native bundle carries its own copy, so it drops the tag.
  html = mode === 'native' ? html.replace(SDK_TAG, '') : html.replace(SDK_TAG, (m, rest) => '<script src="fr/supabase.js"' + rest + '></script>');
  if (!html.includes(mode === 'native' ? 'fr/native.js' : 'fr/supabase.js')) throw new Error('the SDK tag moved');
  return local(html);
}
// Logging only: what the SDK says (debug), each auth event as the app hears it,
// every getSession call and whether it ever answers, and the session storage.
const PRE = String.raw`(function () {
  var t0 = window.__frT0 || Date.now(), log = window.__frLog = window.__frLog || [];
  var names = window.__frNames || {};
  function note(kind, line) { log.push([Date.now() - t0, kind, line]); }
  function who(s) {
    if (!s || !s.user) return 'nobody';
    return names[s.user.id] || (s.user.email ? s.user.email.split('@')[0].replace(/^fr-/, '').toUpperCase() : s.user.id.slice(0, 8));
  }
  window.__frNote = note;
  var gs = 0; window.__frGetSession = { open: {} };
  var QUIET = /^#(_useSession|__loadSession|getSession|_acquireLock|_onVisibilityChanged|_handleVisibilityChange|_startAutoRefresh|_stopAutoRefresh|_autoRefreshTokenTick|_removeVisibilityChangedCallback|_emitInitialSession)/;
  function instrument() {
    var ns = window.supabase, copy = {};
    for (var k in ns) copy[k] = ns[k];
    copy.createClient = function (url, key, options) {
      if (window.__frSdkDebug) options.auth.debug = function (prefix) {
        var rest = Array.prototype.slice.call(arguments, 1).map(function (x) {
          return typeof x === 'string' ? x : x && x.user ? 'session of ' + who(x) : x instanceof Error ? x.message : x === null ? 'null' : typeof x;
        }).join(' ');
        if (!QUIET.test(rest)) note('sdk', rest);
      };
      var c = ns.createClient(url, key, options), on = c.auth.onAuthStateChange, get = c.auth.getSession;
      c.auth.onAuthStateChange = function (cb) {
        return on.call(this, function (event, session) { note('event', event + ' ' + who(session)); return cb(event, session); });
      };
      c.auth.getSession = function () {
        var n = ++gs, p = get.apply(this, arguments);
        window.__frGetSession.open[n] = Date.now() - t0;
        p.then(function (r) {
          delete window.__frGetSession.open[n];
          if (window.__frGetSessionLog) note('getSession', '#' + n + ' → ' + who(r && r.data && r.data.session));
        }, function (e) { delete window.__frGetSession.open[n]; note('getSession', '#' + n + ' threw ' + (e && e.message)); });
        return p;
      };
      return c;
    };
    window.supabase = copy;
  }
  window.__frInstrument = instrument;
  // The shell's two ways of saying the app went away and came back: WebKit's
  // visibilitychange, and Capacitor's appStateChange (bridge.js re-sends it as
  // spotter:native-state). The harness plays either at chosen moments.
  var vis = window.__frStartHidden ? 'hidden' : 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function () { return vis; } });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function () { return vis !== 'visible'; } });
  window.__frVis = function (v) { vis = v; note('env', 'visibility ' + v); document.dispatchEvent(new Event('visibilitychange')); };
  window.__frActive = function (a) { note('env', 'appStateChange isActive ' + a); window.dispatchEvent(new CustomEvent('spotter:native-state', { detail: { isActive: a } })); };
  if (window.supabase) instrument();
  // The web path's session storage is localStorage itself.
  ['setItem', 'removeItem'].forEach(function (m) {
    var real = Storage.prototype[m];
    Storage.prototype[m] = function (k, v) {
      if (/^sb-.*auth-token$/.test(k)) {
        var what = 'nothing';
        try { var s = v && JSON.parse(v); what = s && s.user ? 'session of ' + who(s) : v ? String(v).length + ' chars' : 'nothing'; } catch (e) { what = 'text'; }
        note('ls', m + ' ' + k + (m === 'setItem' ? ' ← ' + what : ''));
      }
      return real.apply(this, arguments);
    };
  });
})();`;

const nativeJs = (await build({ entryPoints: ['tools/firstrun-native.js'], bundle: true, write: false, format: 'iife',
  platform: 'browser', target: 'safari15', minify: true, logLevel: 'silent' })).outputFiles[0].text;
Object.assign(files, {
  '/fr/pre.js': { type: 'text/javascript', body: PRE },
  '/fr/supabase.js': { type: 'text/javascript', body: fs.readFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js') },
  '/fr/native.js': { type: 'text/javascript', body: nativeJs },
  '/fr/app.js': { type: 'text/javascript', get body() { return appScript().js; } },
  '/fr/blank': { type: 'text/html', body: '<!doctype html><title>blank</title>' }
});

// ---------- CDP ----------
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'spotter-firstrun-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + prof,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--disable-extensions', '--hide-scrollbars', '--mute-audio',
  // The fake project's name → 127.0.0.1; every other name → nowhere.
  '--host-resolver-rules=MAP ' + REF + '.localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0;
const waiting = new Map(), listeners = [];
async function connect() {
  for (let i = 0; i < 80; i++) {
    try { const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); return v.webSocketDebuggerUrl; } catch { /* not up yet */ }
    await sleep(150);
  }
  return null;
}
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, { resolve, reject, method });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}
async function finish(code) {
  try { chrome.kill(); } catch { /* gone */ }
  await fake.close();
  await sleep(300);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* Chrome still letting go */ }
  process.exit(code);
}
const url = await connect();
if (!url) { console.log('firstrun-harness: SKIP — Chrome at ' + CHROME + ' did not start on port ' + CDP + '. Nothing was checked.'); await finish(0); }
ws = new WebSocket(url);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); if (m.error) w.reject(new Error(w.method + ': ' + m.error.message)); else w.resolve(m.result); return; }
  for (const l of listeners) l(m);
};
await new Promise((r) => (ws.onopen = r));

// One browser context per walk: its own localStorage, as a fresh install is.
async function open(name) {
  const { browserContextId } = await cdp('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp(method, params, sessionId);
  const page = { name, s, console: [], offsite: [], t: () => Date.now() - T0 };
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') page.console.push([page.t(), 'exception', (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text]);
    if (m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) {
      page.console.push([page.t(), 'console.' + m.params.type, m.params.args.map((a) => a.value !== undefined ? a.value : a.description || a.type).join(' ').slice(0, 240)]);
    }
    if (m.method === 'Network.requestWillBeSent') {
      const u = new URL(m.params.request.url);
      if (!/^(data|blob):/.test(u.protocol) && u.hostname !== '127.0.0.1' && u.hostname !== REF + '.localhost') page.offsite.push(u.origin);
    }
  });
  await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // The same page on every machine: light unless --scheme dark is asked for.
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: val('scheme', 'light') }] });
  page.eval = async (js) => {
    const r = await s('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result.value;
  };
  page.app = (js) => page.eval('window.__fr ? window.__fr(' + JSON.stringify(js) + ') : undefined');
  page.go = async (u) => { await s('Page.navigate', { url: u }); };
  page.waitFor = async (js, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await page.eval(js)) return true; } catch { /* navigating */ } await sleep(50); } return false; };
  page.close = async () => { await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {}); };
  page.shot = async (file) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await s('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file + '.png'), Buffer.from(r.data, 'base64'));
  };
  return page;
}

// ---------- the people ----------
// A: an account deleted on the server, whose session this phone still holds.
// C: a live account, for the returning and sign-out controls. B: made on the walk.
const A = { id: '0a0a0a0a-0000-4000-8000-00000000000a', email: 'fr-a@spotter.test' };
const C = fake.addUser('fr-c@spotter.test', 'fr-c-local-only-pw', '0c0c0c0c-0000-4000-8000-00000000000c');
fake.names.set(A.id, 'A'); fake.names.set(C.id, 'C');
const NAMES = { [A.id]: 'A', [C.id]: 'C' };

// What this phone holds for A, as supabase-js and app.ts wrote it: the session
// (its access token expired an hour ago, or still valid), the library cache
// (spotter-lib-v1) and Train's cache (spotter-train-v1), both in writeCache /
// writeTrainCache's formats.
function sessionFor(u, expired, expiresIn) {
  const exp = Math.floor(Date.now() / 1000) + (expiresIn !== undefined ? expiresIn : expired ? -3600 : 1800);
  const live = fake.users.get(u.id);
  if (live) return fake.session(live, exp);
  // A deleted account: a token pair the server no longer knows. The access token
  // is still correctly signed, as a real one is until it expires.
  const tmp = fake.addUser(u.email, 'gone', u.id), s = fake.session(tmp, exp);
  fake.deleteUser(u.id);
  return s;
}
function cachesFor(u) {
  const now = Date.now(), wid = 'w-' + u.id.slice(0, 8);
  return {
    'spotter-lib-v1': JSON.stringify({ v: 1, uid: u.id, at: now - 3600e3, collections: [], colItems: [],
      workouts: [{ id: wid, user_id: u.id, created_at: new Date(now - 86400e3 * 3).toISOString(), url: 'https://www.tiktok.com/@x/video/1',
        platform: 'tiktok', kind: 'video', title: 'Push Day', category: 'Push', blocks: [], ingest_status: 'ready' }] }),
    'spotter-train-v1': JSON.stringify({ v: 1, uid: u.id, at: now - 3600e3, goal: 3, plan: [], logs: [] })
  };
}

// ---------- one walk ----------
async function walk(sc) {
  const page = await open(sc.name);
  const t = () => Date.now() - T0;
  const mark = [];
  const step = (line) => { mark.push([t(), 'walk', line]); if (VERBOSE) console.log(String(t()).padStart(6) + ' walk ' + line); };
  const logFrom = fake.log.length;
  const keep = Object.assign({}, fake.delays);
  if (sc.delays) Object.assign(fake.delays, sc.delays);
  fake.faults.length = 0;
  if (sc.faults) fake.faults.push(...sc.faults);
  if (sc.faults && sc.faults.length) step('refreshes will fail first: ' + sc.faults.join(', '));
  if (sc.events && sc.events.length) step('app sent away and back: ' + sc.events.map((e) => e.what + '@' + e.phase + '+' + e.after).join(' '));
  // Seed this context's storage on its own origin, then load the app there.
  await page.go(fake.pageOrigin + '/fr/blank');
  await page.waitFor('document.readyState === "complete"', 5000);
  const seed = {};
  if (sc.stored) {
    const s = sessionFor(sc.stored.who, sc.stored.expired, sc.stored.expiresIn);
    if (sc.mode === 'native') {
      await page.eval('localStorage.setItem("__fr.SecureSession", ' + JSON.stringify(JSON.stringify({ [SESSION_KEY]: JSON.stringify(s) })) + ')');
    } else seed[SESSION_KEY] = JSON.stringify(s);
    if (sc.stored.caches) Object.assign(seed, cachesFor(sc.stored.who));
  }
  // The shell has booted before (Preferences keeps the install marker), so
  // secure-session.js's prepare() keeps the Keychain rather than clearing it.
  if (sc.mode === 'native') await page.eval('localStorage.setItem("__fr.Preferences", ' + JSON.stringify(JSON.stringify({ spotter_install: '1' })) + ')');
  for (const [k, v] of Object.entries(seed)) await page.eval('localStorage.setItem(' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ')');
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__frT0 = ' + T0 + '; window.__frNames = ' + JSON.stringify(NAMES) +
    '; window.__frTrace = ' + !!flag('trace') + '; window.__frSdkDebug = ' + !!flag('sdk-debug') + '; window.__frGetSessionLog = ' + !!flag('sdk-debug') +
    '; window.__frNativeCfg = ' + JSON.stringify(Object.assign({ latency: Number(val('kc-ms', 3)) }, sc.native || {})) + ';' });
  step('launch (' + sc.mode + ')' + (sc.stored ? ' holding ' + NAMES[sc.stored.who.id] + "'s session, access token " + (sc.stored.expired ? 'expired' : 'valid') + (sc.stored.caches ? ', with its caches' : '') : ' with nothing stored'));
  const play = (phase) => (sc.events || []).filter((e) => e.phase === phase).forEach((e) => {
    setTimeout(() => page.eval(e.what === 'hidden' || e.what === 'visible' ? 'window.__frVis && __frVis("' + e.what + '")'
      : 'window.__frActive && __frActive(' + (e.what === 'active') + ')').catch(() => {}), e.after);
  });
  if (sc.startHidden) await page.s('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__frStartHidden = true;' });
  // A plan read overtaken before it lands: the first answer is held at the fake
  // until the page has moved planRev on (what a local plan edit does), then let go.
  const release = sc.overtakePlan ? fake.hold('/rest/v1/plan') : null;
  // Phase 0's cause, from the project's logs: the new account's first history read refused once.
  if (sc.refuseLogs) fake.refuseOnce('/rest/v1/workout_logs');
  await page.go(fake.pageOrigin + '/?mode=' + sc.mode);
  play('launch');
  if (sc.releaseAfter) setTimeout(() => page.eval('window.__frRelease && __frRelease("SecureSession.remove")').catch(() => {}), sc.releaseAfter);
  const result = { name: sc.name, ok: false };
  let firstLog = [];
  try {
    if (!(await page.waitFor('!!window.__fr', 8000))) throw new Error('the app did not start');
    if (sc.before) await sc.before(page, step);
    if (release) {
      const asked = () => fake.log.slice(logFrom).some((l) => /GET \/rest\/v1\/plan/.test(l[2]));
      for (let i = 0; i < 100 && !asked(); i++) await sleep(50);
      await page.app('planRev++');
      step('the first plan read is in flight; a local edit moves planRev on; the answer is let go');
      release();
    }
    const snap = async () => page.app('JSON.stringify({ user: state.user && state.user.email, s: upNext().s, lib: !!state.libReady, plan: !!state.plan, logs: !!state.logs, ring: $("trainstat").textContent, epoch: accountEpoch, earlyUid: earlyUid, landing: $("landing").classList.contains("open") })');
    if (sc.expect === 'train') {
      const t1 = t();
      const drawn = await page.waitFor('window.__fr("upNext().s !== 0 && !!$(\\"trainstat\\").querySelector(\\".ringwrap\\")")', WAIT_PASS);
      result.ms = t() - t1;
      step((drawn ? 'Train drawn ' : 'Train NOT drawn in ') + result.ms + ' ms: ' + (await snap()));
      if (!drawn) {
        const late = await page.waitFor('window.__fr("upNext().s !== 0")', WAIT_LOOK);
        step((late ? 'drawn late, ' : 'still not drawn ') + (t() - t1) + ' ms: ' + (await snap()));
      }
      result.ok = drawn;
      await page.shot(sc.name + '-train');
    } else {
      if (!(await page.waitFor('document.getElementById("landing").classList.contains("open")', sc.landingWait || 8000))) throw new Error('the landing never showed');
      step('landing');
      play('landing');
      // A person takes seconds to reach the card; every answer the launch was
      // waiting for has landed by then (each one re-shows the landing).
      await sleep(sc.think !== undefined ? sc.think : Number(val('think', 1500)));
      await page.shot(sc.name + '-1-landing');
      // Build 10's card (the page QA ran) had the two fields and "Create account"
      // on its face; B.2's asks for the address first, and offers the account
      // after a password that signed nobody in.
      const b10 = !(await page.eval('!!document.getElementById("oamail")'));
      const b = sc.newEmail;
      const fill = '(function(){var e=document.getElementById("email"),p=document.getElementById("pw");e.value=' + JSON.stringify(b) +
        ';e.dispatchEvent(new Event("input"));p.value="fr-local-only-pw-1";p.dispatchEvent(new Event("input"));})()';
      if (b10) {
        await page.eval(fill);
      } else {
        await page.eval('document.getElementById("oamail").click()');
        await page.eval('document.getElementById("pwswap").click()');
        await page.eval(fill);
        await page.eval('document.getElementById("authgo").click()');
        step('Continue (' + b + ', password)');
        if (!(await page.waitFor('document.getElementById("authgo").textContent === "Create an account with this email"', 8000))) throw new Error('no "Create an account" offer: ' + (await page.eval('document.getElementById("autherr").textContent')));
        step('offered "Create an account with this email"');
      }
      await page.eval('document.getElementById("authgo").click()');
      const t1 = t();
      step('Create an account');
      play('tap');
      const drawn = await page.waitFor('window.__fr("upNext().s !== 0 && !!$(\\"trainstat\\").querySelector(\\".ringwrap\\")")', sc.window || WAIT_PASS);
      result.ms = t() - t1;
      if (drawn) {
        step('Train drawn ' + result.ms + ' ms after the tap: ' + (await snap()));
        result.ok = true;
        await page.shot(sc.name + '-2-train');
      } else {
        step('after ' + (sc.window || WAIT_PASS) + ' ms: ' + (await snap()));
        await page.shot(sc.name + '-2-after-' + ((sc.window || WAIT_PASS) / 1000) + 's');
        // Keep looking a while, for the record: does it ever arrive by itself?
        const late = await page.waitFor('window.__fr("upNext().s !== 0 && !!$(\\"trainstat\\").querySelector(\\".ringwrap\\")")', WAIT_LOOK);
        step((late ? 'drawn late, ' : 'still not drawn ') + (t() - t1) + ' ms after the tap: ' + (await snap()));
        const open = await page.eval('JSON.stringify(window.__frGetSession.open)');
        if (open !== '{}') step('getSession calls never answered (started at ms): ' + open);
        await page.shot(sc.name + '-3-after-' + Math.round((t() - t1) / 1000) + 's');
      }
      if (sc.relaunch) {
        firstLog = await page.eval('JSON.stringify(window.__frLog || [])').then(JSON.parse).catch(() => []);
        step('relaunch');
        await page.go(fake.pageOrigin + '/?mode=' + sc.mode);
        const t2 = t();
        await page.waitFor('!!window.__fr', 8000);
        const again = await page.waitFor('window.__fr("upNext().s !== 0 && !!$(\\"trainstat\\").querySelector(\\".ringwrap\\")")', WAIT_PASS);
        step('relaunch: ' + (again ? 'Train drawn in ' + (t() - t2) + ' ms' : 'still not drawn'));
        await page.shot(sc.name + '-4-relaunch');
      }
    }
  } catch (e) {
    step('ERROR ' + e.message);
    result.ok = false;
  }
  // The brief's leading theory, checked on every walk: a getSession that never
  // answers (every PostgREST call waits on one for its token).
  const stuck = await page.eval('JSON.stringify(Object.keys(window.__frGetSession.open).filter(function (n) { return Date.now() - window.__frT0 - window.__frGetSession.open[n] > 3000; }))')
    .then(JSON.parse).catch(() => []);
  if (stuck.length) { step('getSession calls unanswered for over 3 s: ' + stuck.join(', ')); result.ok = false; }
  const pageLog = await page.eval('JSON.stringify(window.__frLog || [])').then(JSON.parse).catch(() => []);
  result.timeline = [...mark, ...firstLog, ...pageLog, ...fake.log.slice(logFrom), ...page.console].sort((x, y) => x[0] - y[0]);
  result.exceptions = page.console.filter((c) => c[1] === 'exception').length;
  result.offsite = [...new Set(page.offsite)];
  for (const k of Object.keys(fake.delays)) fake.delays[k] = keep[k];
  await page.close();
  return result;
}

// ---------- the walks ----------
let n = 0;
const email = () => 'fr-b' + (++n) + '@spotter.test';
const signOutFirst = async (page, step) => {
  const ok = await page.waitFor('window.__fr("upNext().s !== 0 && !!$(\\"trainstat\\").querySelector(\\".ringwrap\\")")', 8000);
  step(ok ? 'signed in as C, Train drawn' : 'C never drew Train');
  await page.eval('document.getElementById("signout").click()');
  step('Sign out');
};
const SCENARIOS = [];
for (const mode of ['web', 'native']) {
  SCENARIOS.push(
    { name: mode + '-deleted-expired', mode, stored: { who: A, expired: true, caches: true }, relaunch: true },
    { name: mode + '-deleted-expired-nocache', mode, stored: { who: A, expired: true, caches: false } },
    { name: mode + '-control-cold', mode },
    { name: mode + '-control-signout-signup', mode, stored: { who: C, expired: false }, before: signOutFirst },
    { name: mode + '-control-returning', mode, stored: { who: C, expired: false }, expect: 'train' },
    { name: mode + '-control-returning-expired', mode, stored: { who: C, expired: true }, expect: 'train' },
    // loadPlan used to drop an answer overtaken by planRev and never ask again.
    { name: mode + '-plan-overtaken', mode, stored: { who: C, expired: false }, expect: 'train', overtakePlan: true },
    // Phase 0's device run, as the edge logs tell it: the deleted account's session, then a sign-up whose first
    // workout_logs read is refused once (401 PGRST303). loadLogs gave up and Up next kept its skeleton.
    { name: mode + '-deleted-first-logs-refused', mode, stored: { who: A, expired: true, caches: true }, refuseLogs: true });
}
// The brief's leading theory, forced: the deleted account's Keychain removal
// does not answer for 12 s (past secure-session.js's 10 s guard), and every
// Keychain call queued behind it waits too, as on Capacitor's one bridge queue.
SCENARIOS.push({ name: 'native-deleted-keychain-stalls', mode: 'native', stored: { who: A, expired: true, caches: true },
  native: { hold: { 'SecureSession.remove': { key: 'auth-token' } } }, releaseAfter: 12000, landingWait: 30000 });

// --fuzz N: N walks of the deleted-account launch under random conditions — the
// network's and the Keychain's speed, how long the person takes, a refresh that
// fails for a while before the server's answer gets through, and the app being
// sent away and brought back at random moments. A seed gives back the same
// conditions, not the same interleaving: each answer's time is drawn as it comes.
const FUZZ = Number(val('fuzz', 0));
if (FUZZ) {
  let seed = Number(val('seed', Date.now() % 100000));
  console.log('fuzz seed ' + seed);
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const within = (a, b) => Math.round(a + rnd() * (b - a));
  SCENARIOS.length = 0;
  for (let i = 0; i < FUZZ; i++) {
    const mode = val('mode', pick(['web', 'native']));
    const events = [];
    for (let k = within(0, 3); k > 0; k--) {
      const phase = pick(['launch', 'landing', 'tap']), after = within(0, phase === 'landing' ? 1200 : 900);
      const pair = mode === 'native' && rnd() < 0.5 ? ['inactive', 'active'] : ['hidden', 'visible'];
      events.push({ phase, after, what: pair[0] }, { phase, after: after + within(50, 1500), what: pair[1] });
    }
    const auth = [within(20, 250), within(250, 900)], rest = [within(10, 150), within(150, 600)];
    SCENARIOS.push({ name: 'fuzz-' + i + '-' + mode, mode, stored: { who: A, expired: true, caches: rnd() < 0.5 },
      events, startHidden: rnd() < 0.15, think: pick([300, 800, 1500, 3000]), window: 8000,
      faults: rnd() < 0.4 ? Array.from({ length: within(1, 4) }, () => pick(['net', '503', 'net'])) : [],
      delays: { auth: () => within(auth[0], auth[1]), rest: () => within(rest[0], rest[1]), fn: () => within(rest[0], rest[1]) },
      native: { jitter: [within(1, 5), within(5, 40)] } });
  }
}

// Slow ones, run only by name (--only slow): the launch's refresh fails on the
// network for longer than supabase-js retries (it keeps the session and answers
// nobody), and the person signs up around the SDK's 30 s ticks and its 60 s
// refresh-failure cooldown; and an access token inside the 90 s expiry margin at
// launch, which boots the deleted account first and drops it a minute later.
if (ONLY.startsWith('slow')) {
  for (const mode of ['native', 'web']) for (const think of [5000, 32000, 58000, 63000, 92000]) {
    SCENARIOS.push({ name: 'slow-kept-' + mode + '-' + think, mode, stored: { who: A, expired: true, caches: false }, think,
      faults: Array(9).fill('503'), landingWait: 60000 });
  }
  for (const mode of ['native', 'web']) {
    // With the library cached, "nobody" while the session is still stored means
    // offline: the cache stays up ("Reconnecting…") until a refresh gets through.
    SCENARIOS.push({ name: 'slow-kept-cached-' + mode, mode, stored: { who: A, expired: true, caches: true }, think: 3000,
      faults: Array(9).fill('503'), landingWait: 150000 });
    for (const think of [2000, 30000]) {
      SCENARIOS.push({ name: 'slow-margin-' + mode + '-' + think, mode, stored: { who: A, expiresIn: 45, caches: true }, think, landingWait: 150000 });
    }
  }
}

const results = [];
for (const sc of SCENARIOS) {
  if (ONLY && !sc.name.includes(ONLY)) continue;
  sc.newEmail = email();
  const r = await walk(sc);
  results.push(r);
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ms !== undefined ? '  (' + r.ms + ' ms)' : '') +
    (r.exceptions ? '  [' + r.exceptions + ' page exception' + (r.exceptions > 1 ? 's' : '') + ']' : ''));
  if (!r.ok || flag('timeline')) {
    for (const [at, kind, line] of r.timeline) console.log('   ' + String(at).padStart(6) + '  ' + kind.padEnd(10) + ' ' + line);
  }
  if (!r.ok && !flag('keep-going') && !ONLY) break;
}
// What the page tried to reach off this machine — its fonts and the CDN it
// preconnects to — and the resolver rule refused. Nothing else ever appears here.
const offsite = [...new Set(results.flatMap((r) => r.offsite))];
if (offsite.length) console.log('refused off-machine (never reached): ' + offsite.join(', '));
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' walks passed' + (failed.length ? ' — failed: ' + failed.map((r) => r.name).join(', ') : ''));
await finish(failed.length ? 1 : 0);
