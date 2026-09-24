// Offline checks for the speed cycle (GTM hardening, brief SPEED). Run against the
// real source:
//
//   node tools/speed-harness.mjs
//
// The functions under test are lifted out of app.ts the way the other harnesses
// lift theirs and run in a vm over a fake DOM just big enough for them. The SDK's
// auth answer, storage, timers and PostgREST are all driven by hand, so "the token
// came back after the paint" is a step in a test, not a race.
//
//   C2  the cached Library paints before the token refresh, for the stored user
//       only: a revoked or deleted account lands on the sign-in card with nothing
//       left behind, and a switch of account paints nothing of the previous one.
//   C3  /api/limits is asked once a minute, not once per Basic card opened; a write
//       retires the copy; two asks at once are one call.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');

// A top-level function, one-liners included.
function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'not found in app.ts: ' + name);
  const eol = APP.indexOf('\n', a), line = APP.slice(a, eol);
  if (line.trimEnd().endsWith('}')) return line;
  const b = APP.indexOf('\n  }\n', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return APP.slice(a, b + 4);
}

// A statement that starts at `head` and ends at the first line that is exactly `tail`.
function stmt(head, tail) {
  const a = APP.indexOf(head);
  assert(a >= 0, 'not found in app.ts: ' + head);
  const b = APP.indexOf('\n' + tail + '\n', a);
  assert(b > a, 'unterminated in app.ts: ' + head);
  return APP.slice(a, b + tail.length + 2);
}

// ---------- the fake page ----------
class El {
  constructor(id) { this.id = id; this.cls = new Set(); this.cards = []; this.textContent = ''; this.value = ''; }
  get classList() {
    const c = this.cls;
    return { add: (...x) => x.forEach((k) => c.add(k)), remove: (...x) => x.forEach((k) => c.delete(k)),
      contains: (x) => c.has(x), toggle: (x, on) => (on === undefined ? (c.has(x) ? c.delete(x) : c.add(x)) : on ? c.add(x) : c.delete(x)) };
  }
  set innerHTML(v) { this.cards = []; }
}

const STUBS = `
var log = [], timers = [], store = {}, nets = [];
var nodes = {};
function $(id) { return nodes[id] || (nodes[id] = new El(id)); }
var localStorage = {
  getItem: function (k) { return k in store ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var location = { hash: "", search: "", pathname: "/spotter/" };
var document = { querySelectorAll: function () { return []; }, body: $("body") };
var window = {};
function setTimeout(f) { timers.push(f); return timers.length; }
function clearTimeout() {}
function clearInterval() {}
function requestAnimationFrame(f) { timers.push(f); }
function flush() { while (timers.length) { var q = timers; timers = []; q.forEach(function (f) { f(); }); } }
var native = null;
var state = { user: null, profile: null, workouts: [], logs: null, plan: null, collections: [], colItems: [],
  filter: "All", q: "", view: "library", unit: "lb", sounds: true, haptics: true, goal: null, awards: null };
var accountEpoch = 0, reads = {}, inFlight = {}, libraryRev = 0, logsRev = 0, planRev = 0;
var undoTimer = null, undoFn = null, detailCloseTimer = null, woCloseTimer = null, pendTimer = null, pendPolls = 0, pendBusy = false;
var wkChannel = null, heroPct = 0, trainSeg = null, seenCards = {}, gridCards = {}, expCache = {}, expWaiting = {}, vidCache = {}, expKey = "";
var today = { day: null, rows: [], done: false, at: 0, busy: false, shown: false };
var current = null, sc = null, wo = null, woTimer = null, hist = {}, histReady = false, strava = null, pumpy = null, billing = null;
var toastTimer = null, pendingMotion = null;
var sb = { removeChannel: function () {} };
var CACHE_KEY = "spotter-lib-v1";
function dismissAiConsent() {} function cancelPumpyReset() {} function scForget() {} function saveDraft() {}
function stopRest() {} function liveEnd() {} function releaseWake() {} function guideClear() {} function guideStill() {}
function guideUser() {} function publishSignedOut() { log.push("signed-out"); } function openRecovery() {}
function resetPager() {} function measureChrome() {} function mailClose() {} function capOn() { return false; }
function maybeInstallHint() {} function watchWorkouts() {} function welcomeMaybe() {} function restoreSession() {}
function consumeShare() {} function consumeOpen() {} function consumeBilling() {} function consumeCreator() {}
function warmPages() {} function sharePending() { return false; } function toast() {}
function accountNow(epoch, uid) { return epoch === accountEpoch && state.user && state.user.id === uid; }
function loadProfile() { nets.push("profiles"); return Promise.resolve(); }
function load() { nets.push("workouts"); return Promise.resolve(); }
// What the grid shows is what render() last drew; clearAccount's innerHTML = "" empties it.
function render() { $("grid").cards = state.workouts.map(function (w) { return w.id; }); log.push("render:" + $("grid").cards.join(",")); }
var authCb = null;
sb.auth = { onAuthStateChange: function (cb) { authCb = cb; } };
`;

const LIFT = ['readCache', 'paintCache', 'paintRows', 'dropCache', 'paintBeforeAuth', 'settleEarly',
  'clearAccount', 'showApp', 'showLanding', 'boot'].map(fn).join('\n');
const DECLS = ['  var SESSION_KEY', '  var earlyUid', '  var booting'].map((h) => {
  const a = APP.indexOf(h); assert(a >= 0, 'not found: ' + h); return APP.slice(a, APP.indexOf('\n', a));
}).join('\n');
const LISTENER = stmt('  sb.auth.onAuthStateChange(function (event, session) {', '  });');
// From paintBeforeAuth() to the end of getSession's answer: the foot of the script.
const FOOT = stmt('\n  paintBeforeAuth();\n', '  });')
  .replace('sb.auth.getSession()', 'answerSession');
assert(FOOT.includes('answerSession.then'), 'the foot is paintBeforeAuth then getSession');

function page() {
  const ctx = vm.createContext({ El, Promise, JSON, Object, Array, String, Number, Math, console, Date });
  vm.runInContext(STUBS + LIFT + '\n' + DECLS + '\n' + LISTENER, ctx);
  // The foot of the script: paintBeforeAuth, then getSession's answer, which the
  // test hands in as a promise it resolves when it likes.
  ctx.foot = (answer) => vm.runInContext('var answerSession = __answer;\n' + FOOT, Object.assign(ctx, { __answer: answer }));
  return ctx;
}

const A = { id: 'aaaaaaaa-0000-0000-0000-00000000000a', email: 'a@example.com' };
const B = { id: 'bbbbbbbb-0000-0000-0000-00000000000b', email: 'b@example.com' };
const SESSION = 'sb-mtzevoxxpsktmrbbuxva-auth-token';
function seed(ctx, who, cacheFor) {
  // An expired session, as supabase-js leaves it after an hour away.
  ctx.store[SESSION] = JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: 1, user: who });
  if (cacheFor) ctx.store['spotter-lib-v1'] = JSON.stringify({ v: 1, uid: cacheFor.id, at: 1,
    workouts: [{ id: cacheFor.id.slice(0, 1) + '-card-1' }, { id: cacheFor.id.slice(0, 1) + '-card-2' }], collections: [], colItems: [] });
}
const shown = (ctx) => !ctx.$('app').cls.has('hide');
const grid = (ctx) => ctx.$('grid').cards.join(',');
let n = 0;
function ok(name) { n++; console.log('PASS ' + name); }
const tick = () => new Promise((r) => setImmediate(r));

// ---------- C2 ----------

// 1. Stale token, same person: the cache is up before the SDK answers, and the
//    answer does not paint it a second time.
{
  const c = page(); seed(c, A, A); c.$('app').cls.add('hide');
  c.paintBeforeAuth();
  assert.equal(grid(c), 'a-card-1,a-card-2', 'the stored user\'s cache paints before the token');
  assert(shown(c), 'the app is shown with it');
  assert.equal(c.state.user, null, 'state.user stays empty until the SDK answers');
  assert.equal(c.nets.length, 0, 'nothing goes out on the stored name');
  c.authCb('SIGNED_IN', { user: A }); c.flush();
  const renders = c.log.filter((l) => l.startsWith('render:'));
  assert.equal(renders.length, 1, 'boot does not paint the same cache twice: ' + renders.join(' | '));
  assert.equal(grid(c), 'a-card-1,a-card-2');
  assert.deepEqual([...c.nets].sort(), ['profiles', 'workouts'], 'boot reads as it always did');
  assert.equal(c.earlyUid, null);
  ok('C2 stale token: cached library painted before the refresh, once');
}

// 2. Revoked or deleted account: the refresh fails, the SDK answers nobody.
for (const order of ['callback-first', 'getSession-first']) {
  const c = page(); seed(c, A, A); c.$('app').cls.add('hide');
  let answer; c.foot(new Promise((r) => { answer = r; }));
  assert.equal(grid(c), 'a-card-1,a-card-2', 'painted while the refresh is out');
  if (order === 'callback-first') { c.authCb('SIGNED_OUT', null); answer({ data: { session: null } }); }
  else { answer({ data: { session: null } }); await tick(); c.authCb('SIGNED_OUT', null); }
  await tick(); c.flush();
  assert.equal(grid(c), '', 'nothing of the library is left on the page');
  assert.equal(c.state.workouts.length, 0, 'nothing of the library is left in memory');
  assert.equal(c.store['spotter-lib-v1'], undefined, 'the cache is gone from storage');
  assert(!shown(c) && c.$('landing').cls.has('open'), 'the sign-in card is what shows');
  assert.equal(c.state.user, null);
  assert.equal(c.nets.length, 0, 'no read went out');
  ok('C2 revoked account (' + order + '): landing, nothing left behind');
}

// 3. Account switch. (a) The stored session and the cache disagree: nothing paints.
{
  const c = page(); seed(c, B, A); c.$('app').cls.add('hide');
  c.paintBeforeAuth();
  assert.equal(grid(c), '', 'a cache written for A never paints under B\'s session');
  assert(!shown(c));
  assert.equal(c.earlyUid, null);
  ok('C2 switch: cache for A, session for B paints nothing');
}
// (b) The SDK answers somebody other than the stored user (a sign-in that
//     replaced the session while the paint was up): A's cards come down before B boots.
for (const door of ['callback', 'getSession']) {
  const c = page(); seed(c, A, A); c.$('app').cls.add('hide');
  let answer; c.foot(new Promise((r) => { answer = r; }));
  assert.equal(grid(c), 'a-card-1,a-card-2');
  if (door === 'callback') c.authCb('SIGNED_IN', { user: B });
  else { answer({ data: { session: { user: B } } }); await tick(); }
  const cleared = c.log.indexOf('render:a-card-1,a-card-2');
  assert(cleared >= 0);
  assert.equal(grid(c), '', 'A\'s cards are off the page before B\'s boot');
  assert.equal(c.state.workouts.length, 0);
  assert.equal(c.store['spotter-lib-v1'], undefined, 'A\'s cache is dropped');
  c.flush(); await tick();
  assert(!c.log.some((l, i) => i > cleared && l.startsWith('render:a-')), 'nothing of A paints again');
  assert.equal(c.state.user.id, B.id);
  ok('C2 switch through the ' + door + ': the previous account\'s cards come down first');
}
// (c) A link that is itself a sign-in (implicit grant, PKCE code, an error): no paint.
for (const [hash, search] of [['#access_token=t&refresh_token=r&type=magiclink', ''], ['', '?code=abc'], ['#error=access_denied&error_code=otp_expired', '']]) {
  const c = page(); seed(c, A, A); c.location.hash = hash; c.location.search = search; c.$('app').cls.add('hide');
  c.paintBeforeAuth();
  assert.equal(grid(c), '', 'no paint under a sign-in link ' + (hash || search));
  ok('C2 sign-in link ' + (hash || search).slice(0, 14) + '…: nothing painted ahead of it');
}

// 4. Native: the Keychain read is async. Answered after the SDK: nothing to do.
{
  const c = page(); seed(c, A, A); c.$('app').cls.add('hide');
  let give; c.native = { configureSharing: () => Promise.resolve(), authStorage: { getItem: () => new Promise((r) => { give = r; }) } };
  c.paintBeforeAuth();
  c.authCb('SIGNED_IN', { user: A }); c.flush();
  const before = c.log.length;
  give(c.store[SESSION]); await tick();
  assert.equal(c.log.length, before, 'a late Keychain answer paints nothing over a booted library');
  assert.equal(c.earlyUid, null);
  ok('C2 native: a Keychain read that loses the race paints nothing');
}
{
  const c = page(); seed(c, A, A); c.$('app').cls.add('hide');
  c.native = { configureSharing: () => Promise.resolve(), authStorage: { getItem: () => Promise.resolve(c.store[SESSION]) } };
  c.paintBeforeAuth(); await tick();
  assert.equal(grid(c), 'a-card-1,a-card-2', 'native paints from the Keychain session');
  c.authCb('SIGNED_OUT', null); c.flush();
  assert.equal(grid(c), '');
  assert.equal(c.store['spotter-lib-v1'], undefined);
  ok('C2 native: painted from the Keychain, revoked answer clears it');
}

// ---------- C3 (client) ----------
{
  const billingDecl = (() => { const a = APP.indexOf('  var billing = {'); return APP.slice(a, APP.indexOf('\n  };\n', a) + 5); })();
  const LIMITS = ['api', 'deadline', 'readLimits', 'recentLimits', 'retireLimits'].map(fn).join('\n');
  const decl = (h) => { const a = APP.indexOf(h); assert(a >= 0, h); return APP.slice(a, APP.indexOf('\n', a)); };
  const ctx = vm.createContext({ Promise, JSON, Object, Array, String, Number, Math, console, Date, AbortController, setTimeout, clearTimeout });
  vm.runInContext(`
    var state = { user: { id: "u1" } }, accountEpoch = 0, inFlight = {}, asked = [], clock = 1000000;
    Date.now = function () { return clock; };
    function accountNow(e, u) { return e === accountEpoch && state.user && state.user.id === u; }
    function needsAiConsent() { return false; } function consentAt() { return 1; } function toast() {}
    var SHARED = {}, API = "https://x/api/";
    var sb = { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: "t" } } }); } } };
    var used = 0;
    function fetch(url, o) {
      asked.push((o.method || "GET") + " " + url.replace(API, ""));
      var body = /limits$/.test(url) ? { status: "ok", video_previews: { cap: 4, used: used } } : { status: "ok" };
      if (/read-video/.test(url)) used++;
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve(body); } });
    }
  ` + billingDecl + '\n' + decl('  var LIMITS_FRESH') + '\n' + LIMITS, ctx);
  const run = (js) => vm.runInContext(js, ctx);
  const limitsAsks = () => run('asked').filter((a) => /limits$/.test(a)).length;
  await run('recentLimits()');
  await run('recentLimits()'); await run('recentLimits()');
  assert.equal(limitsAsks(), 1, 'three card opens inside a minute ask once');
  run('clock += 61000'); await run('recentLimits()');
  assert.equal(limitsAsks(), 2, 'past a minute it asks again');
  await run('api("workouts/w1/read-video", { method: "POST", body: "{}" })');
  const left = await run('recentLimits()');
  assert.equal(limitsAsks(), 3, 'a write retires the copy');
  assert.equal(left.video_previews.used, 1, 'and the count that follows is the spent one');
  await Promise.all([run('readLimits()'), run('readLimits()')]);
  assert.equal(limitsAsks(), 4, 'two asks at once are one call');
  // Spent while a read was out: the answer is drawn but not called fresh.
  run('clock += 61000');
  const out = run('recentLimits()'); run('retireLimits()'); await out;
  assert.equal(run('billing.limitsAt'), 0, 'an answer that raced a write is not trusted for the minute');
  ok('C3 client: one /api/limits a minute, retired by writes, shared in flight');
}

console.log('All ' + n + ' speed checks passed.');
