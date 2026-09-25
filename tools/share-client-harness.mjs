// The save flow's client half: what a card promises, what a pending card says,
// "Add the video" through the upload sheet, and a link parked while signed out.
//
//   node tools/share-client-harness.mjs
//
// Functions are lifted out of app.ts the way tools/each-harness.mjs lifts its
// own, and run in a vm over a small fake DOM and stubbed network. No browser, no
// server, no production writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
function fn(name) {
  const head = '  function ' + name + '(';
  const a = APP.indexOf(head);
  assert(a >= 0, 'app.ts no longer declares ' + name);
  const b = APP.indexOf('\n  }\n', a);
  return APP.slice(a, b + 4);
}
function block(from, to) {
  const a = APP.indexOf(from), b = APP.indexOf(to, a);
  assert(a >= 0 && b > a, 'app.ts section moved: ' + from);
  return APP.slice(a, b);
}

// A DOM with only what the lifted code touches: text, a class list, attributes.
function node(text) {
  const classes = new Set();
  return {
    textContent: text || '', value: '', hidden: false, disabled: false, attrs: {}, style: {},
    classList: {
      toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}
const dom = {
  addsheet: node(), addtitle: node('Add a workout'), addlede: node('Paste a link…'),
  uptitle: node('Upload a video from your phone'), upsub: node('Spotter watches and listens…'),
  addfile: node(), uperr: node(), upprog: node(), upfill: node(), upnote: node(), uploadrow: node(), addurl: node(),
};

const ctx = vm.createContext({ console, Date, Math, String, Number, JSON, Object, Array, isFinite, Promise, Error });
const STUBS = `
var state = { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" }, workouts: [] };
var free = true; function isFree() { return free; }
var native = null, accountEpoch = 1, current = null;
var DOM = {}; function $(id) { return DOM[id]; }
function accountNow() { return true; }
var calls = [], toasts = [], opened = [], closed = [], rendered = 0, pendingWatched = 0, plans = [];
function toast(m) { toasts.push(m); }
function openSheet(id) { opened.push(id); }
function closeSheet(id) { closed.push(id); }
function render() { rendered++; }
function watchPending() { pendingWatched++; }
function openDetail() {}
function limitHit(r) { if (r && r.status === "limit" && r.upgrade) { plans.push(r); return true; } return false; }
function exerciseNames(w) { var n = []; (w.blocks || []).forEach(function (b) { (b.exercises || []).forEach(function (e) { n.push(e.name); }); }); return n; }
function readFrom() { return { video: false, speech: false }; }
function uuid() { return "11111111-2222-4333-8444-555555555555"; }
function mb(b) { return Math.round(b / 1048576); }
var API = {}; function api(path, opts) { calls.push([path, opts && opts.body ? JSON.parse(opts.body) : null]); return Promise.resolve(API[path.replace(/workouts\\/[^/]+\\//, "workouts/:id/")]); }
function putObject(file, path) { calls.push(["put", path]); return Promise.resolve(); }
function deviceFrames() { return Promise.resolve(null); }
function placePending() {}
function withShelf(m) { return m; }
function load() {}
var consumed = []; var SHARE_KEY = "k"; var sharing = false;
var sessionStorage = { v: {}, setItem: function (k, v) { this.v[k] = v; }, getItem: function (k) { return this.v[k] || null; }, removeItem: function (k) { delete this.v[k]; } };
function consumeShare() { var u = sessionStorage.getItem(SHARE_KEY); sessionStorage.removeItem(SHARE_KEY); if (u) consumed.push(u); }
var saveOk = true; function handleSharedUrl(u) { consumed.push(u); return Promise.resolve(saveOk); }
function firstUrlIn(s) { var m = String(s || "").match(/https?:\\/\\/[^\\s"'<>]+/); return m ? m[0] : ""; }
var UPLOAD_MAX = 25 * 1024 * 1024;
var UPLOAD_TYPES = { mp4: "video/mp4", mov: "video/quicktime", m4a: "audio/mp4" };
var UPLOAD_KINDS = "MP4, MOV"; var UPLOAD_WATCHED = { mp4: 1, mov: 1 };
var uploading = false;
var attachTo = null, addWords = null;
`;
vm.runInContext(STUBS, ctx);
ctx.DOM = dom;
vm.runInContext([
  fn('isPending'), fn('isFailed'), fn('isUpload'),
  block('  var STAGES = {', '  // What this card was actually read out of.'),
  fn('canReadVideo'),
  block('  function canAddVideo(w) {', '  // ---------- collections: lookups ----------'),
  fn('cardMeta').replace('function cardMeta', 'function cardMeta'),
  fn('upError'), fn('upProgress'), fn('addMode'), fn('openAddVideo'), fn('attached'), fn('resetUpload'), fn('doUpload'),
  block('  var PARKED_MAX_MS = ', '  // ---------- upload a video from your phone ----------'),
].join('\n'), ctx);
// cardMeta reaches for fmtDur and citedSources only on a ready card; the checks
// below ask it about pending and failed ones.
const run = (code) => vm.runInContext(code, ctx);
const settle = () => new Promise((r) => setTimeout(r, 0));

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

// ---- S2: what a card promises ----
const ig = { id: 'w1', platform: 'instagram', kind: 'reel', ingest_status: 'ready', read_quality: 'basic', has_full_workout: false, blocks: [], title: 'Core day' };
ctx.W = ig;
ok(run('canAddVideo(W)'), 'a thin Instagram reel offers Add the video');
ok(!run('canReadVideo(W)'), 'and never "read the video" — Plus cannot read a reel');
ctx.W = { ...ig, has_full_workout: true, blocks: [{ exercises: [{ name: 'Squat' }] }] };
ok(!run('canAddVideo(W)'), 'a complete Instagram card is not asked for its video');
ctx.W = { ...ig, ingest_status: 'failed' };
ok(!run('canAddVideo(W)'), 'nor is a failed one');
ctx.W = { ...ig, platform: 'tiktok', kind: 'video' };
ok(!run('canAddVideo(W)') && run('canReadVideo(W)'), 'a TikTok video keeps "read the video"');
ctx.W = { ...ig, platform: 'tiktok', kind: 'photo' };
ok(!run('canAddVideo(W)'), 'a TikTok photo post is offered neither');
// The offer box's own rule, read off the source: the Plus line is drawn only where
// Plus reads more. A person's own file is read the same on either plan (V-1), so
// a Basic upload card is not told Plus would have watched it.
ok(/var plusCan = w\.platform === "tiktok" && w\.kind !== "photo";/.test(APP) &&
  /read_quality !== "premium" && plusCan\) \{\s*\n\s*var quality = el\("div", "reader-offer"\);/.test(APP),
  '"Plus reads the video" is drawn only for a TikTok video, not under an upload Spotter already watched');

// ---- S16: what a pending card says ----
ctx.W = { ...ig, platform: 'instagram', kind: 'p', ingest_status: 'processing' };
run('free = false');
ok(run('stageOf(W).line') === 'Reading the post…', 'a Plus carousel is "reading the post", not the video');
run('free = true');
ok(run('stageOf(W).line') === 'Reading available text…' && !/Plus can also read/.test(run('stageOf(W).body')),
  'a Basic Instagram post promises nothing Plus cannot do');
ctx.W = { ...ig, platform: 'tiktok', kind: 'video', ingest_status: 'processing' };
ok(/Plus can also read/.test(run('stageOf(W).body')), 'a Basic TikTok video keeps its Plus line');
ctx.W = { ...ig, ingest_status: 'processing', media_stage: 'watching' };
ok(run('stageOf(W)') === run('STAGES.upwatch'), 'an Instagram card reading an added video says watching and listening');
ctx.W = { ...ig, ingest_status: 'failed', ingest_error: 'This post is private, deleted or unavailable to Spotter.' };
ok(run('isUnavailable(W)') && run('cardMeta(W)') === 'Private, deleted or unavailable', 'an unavailable post is not "tap to retry"');
ctx.W = { ...ig, ingest_status: 'failed', ingest_error: 'Spotter could not read this video. Tap ↻ to try again.' };
ok(!run('isUnavailable(W)') && /tap to retry/.test(run('cardMeta(W)')), 'an ordinary failure still offers a retry');
ok(/if \(!isUp && !gone\) \{\s*\n\s*var rb = el\("button", "retrybtn", "Try reading it again"\);/.test(APP),
  'the detail view hides "Try reading it again" for an unavailable post');

// ---- V-4: a final "unavailable" card is not labelled as something to retry ----
ctx.W = { ...ig, ingest_status: 'failed', ingest_error: 'This post is private, deleted or unavailable to Spotter.' };
ok(run('failedKick(W, true)') === 'Unavailable' && run('failedKick(W, false)') === 'Unavailable' && run('failedGlyph(W)') === 'eye-off',
  'V-4: an unavailable post\'s tile and overline say "Unavailable", with no ↻');
ctx.W = { ...ig, ingest_status: 'failed', ingest_error: 'Spotter could not read this video. Tap ↻ to try again.' };
ok(run('failedKick(W, true)') === 'Retry' && run('failedKick(W, false)') === 'Needs another try' && run('failedGlyph(W)') === 'refresh',
  'V-4: an ordinary failure keeps "Retry", "Needs another try" and ↻');
ctx.W = { ...ig, platform: 'upload', kind: 'upload', ingest_status: 'failed', ingest_error: 'Spotter read that file and could not make out a workout in it.' };
ok(run('failedKick(W, true)') === 'Failed' && run('failedKick(W, false)') === 'Failed' && run('failedGlyph(W)') === 'ear',
  'V-4: a failed upload (its file is gone) says "Failed" on the tile and above the title alike');
ok(/tw\.appendChild\(icon\(el\("div", "noimg"\), pending \? stage\.glyph : failedGlyph\(w\)\)\);/.test(APP) &&
  /pending \? stage\.kick : failedKick\(w, true\)\)\);/.test(APP) &&
  /isFailed\(w\) \? failedKick\(w, false\)\s*: \[w\.category \|\| "Other"/.test(APP) &&
  !/"Needs another try" : \(w\.category/.test(APP),
  'V-4: the library tile and the detail overline both ask failedKick / failedGlyph');

// ---- Add the video, through the upload sheet ----
run('openAddVideo(W)');
ok(dom.addsheet.classList.contains('attach') && dom.addtitle.textContent === 'Add the video' &&
  /Share → Download/.test(dom.addlede.textContent) && dom.addfile.attrs.accept === 'video/*',
  'the sheet opens as the picker, with the instruction and video-only');
run('addMode(null)');
ok(!dom.addsheet.classList.contains('attach') && dom.addtitle.textContent === 'Add a workout' &&
  dom.upsub.textContent === 'Spotter watches and listens…', 'the ordinary sheet comes back word for word');

ctx.W = ig; run('state.workouts = [W]; openAddVideo(W)');
ctx.API = { 'uploads/authorize': { status: 'ok' }, 'workouts/:id/media': { status: 'processing', id: 'w1', message: 'Watching your video…' } };
run('calls = []; toasts = []; doUpload({ name: "reel.mp4", size: 1000 })');
await settle(); await settle(); await settle();
const calls = JSON.parse(JSON.stringify(ctx.calls));
ok(calls[0][0] === 'uploads/authorize' && calls[0][1].attach === 'w1', 'authorize names the card (a read, not an upload)');
ok(calls[1][0] === 'put' && calls[2][0] === 'workouts/w1/media' && calls[2][1].upload_path === calls[1][1] &&
  calls[2][1].filename === 'reel.mp4', 'the file goes to the bucket, then its path to THAT card');
ok(!calls.some((c) => c[0] === 'ingest'), 'no new card is made');
ok(ig.ingest_status === 'processing' && ig.media_stage === 'watching' && ctx.toasts.includes('Watching your video…'),
  'the card goes pending, watching, and says so');

run('openAddVideo(W)');
ctx.API = { 'uploads/authorize': { status: 'limit', kind: 'media', upgrade: true, message: 'You have used all four Plus video reads this month.' } };
run('calls = []; plans = []; doUpload({ name: "reel.mp4", size: 1000 })');
await settle(); await settle();
ok(ctx.plans.length === 1 && !JSON.parse(JSON.stringify(ctx.calls)).some((c) => c[0] === 'put'),
  'out of video reads: the Plus answer, and nothing uploaded');

// ---- S14 / CR-4: links parked while signed out, in SHARE-IOS's shape ----
// The native side (gtm-share-ios native/share-access.js takeParked) hands over
// one {url, at} per call, at in ms, removing it, and null when none is left.
const parked = (items) => {
  const q = items.slice();
  return { takeParkedShare: () => Promise.resolve(q.length ? q.shift() : null), left: q };
};
const now = Date.now();
ctx.native = parked([
  { url: 'https://www.tiktok.com/@a/video/1', at: now - 60_000 },
  { url: 'https://www.instagram.com/reel/DcHDuEFzBSf/', at: now - 3 * 86400_000 },
  { url: 'https://www.tiktok.com/@a/video/3', at: 0 },
]);
run('consumed = []; saveOk = true'); await run('takeParkedShare()');
ok(JSON.stringify(ctx.consumed) === JSON.stringify(['https://www.tiktok.com/@a/video/1',
  'https://www.instagram.com/reel/DcHDuEFzBSf/', 'https://www.tiktok.com/@a/video/3']) && !ctx.native.left.length,
  'every parked link is saved once, oldest first, one after another (three days old is inside the week; at 0 is unknown, kept)');
ctx.native = parked([
  { url: 'https://www.tiktok.com/@a/video/old', at: now - 8 * 86400_000 },
  { url: 'https://www.tiktok.com/@a/video/new', at: now - 1000 },
]);
run('consumed = []'); await run('takeParkedShare()');
ok(JSON.stringify(ctx.consumed) === '["https://www.tiktok.com/@a/video/new"]', 'a link parked over a week ago is dropped and the next one still saved');
ctx.native = parked([{ url: 'https://www.tiktok.com/@a/video/1', at: now }, { url: 'https://www.tiktok.com/@a/video/2', at: now }]);
run('consumed = []; saveOk = false'); await run('takeParkedShare()');
ok(ctx.consumed.length === 1 && ctx.native.left.length === 1,
  'a save that fails stops the queue: that link stays in the add sheet, the rest stay parked for the next resume');
run('saveOk = true');
ctx.native = parked([{ url: 'https://www.tiktok.com/@a/video/1', at: now }, { url: 'https://www.tiktok.com/@a/video/2', at: now }]);
run('consumed = []'); await Promise.all([run('takeParkedShare()'), run('takeParkedShare()')]);
ok(JSON.stringify(ctx.consumed) === '["https://www.tiktok.com/@a/video/1","https://www.tiktok.com/@a/video/2"]',
  'two callers at once (sign-in and resume) take each link once, in order');
ctx.native = { takeParkedShare: () => Promise.resolve({ url: 'https://www.tiktok.com/@a/video/1', at: now }) };
run('consumed = []'); await run('takeParkedShare()');
ok(ctx.consumed.length === 10, 'a shell that never empties is asked at most ten times a pass');
ctx.native = parked([]);
run('consumed = []'); await run('takeParkedShare()');
ok(!ctx.consumed.length, 'nothing parked, nothing saved');
ctx.native = { takeParkedShare: () => Promise.resolve({}) };
run('consumed = []'); await run('takeParkedShare()');
ok(!ctx.consumed.length, 'an empty answer is nothing parked');
ctx.native = { takeParkedShare: () => { throw new Error('no such method'); } };
ok(await run('takeParkedShare()') === undefined, 'a shell whose method throws is a no-op, never a rejected boot');
ctx.native = {};
ok(await run('takeParkedShare()') === undefined, 'a shell without the method (Android, builds 5–7) is a no-op');
// R-5: the native store hands a link only to the account it was parked under,
// so the page asks once the native side has been told who is signed in.
{
  let release;
  ctx.native = parked([{ url: 'https://www.tiktok.com/@a/video/after-configure', at: now }]);
  ctx.gate = new Promise((r) => { release = r; });
  run('consumed = []; sharingSet = gate');
  const taking = run('takeParkedShare()');
  await settle(); await settle();
  ok(!ctx.consumed.length, 'R-5: nothing is taken before the sharing key is configured');
  release(); await taking;
  ok(JSON.stringify(ctx.consumed) === '["https://www.tiktok.com/@a/video/after-configure"]', 'R-5: and it is taken once it is');
  run('sharingSet = Promise.resolve()');
}
ok(/configured = native\.configureSharing\(r\.data\.ingest_key, \{ plan: r\.data\.plan \}\)[\s\S]{0,2500}sharingSet = loaded\.then\(function \(\) \{ return configured; \}, function \(\) \{\}\);\s*return loaded;/.test(APP),
  'R-5: the profile load is what settles it: the configure call with this account\'s key');
ctx.native = null;
ok(/(?:load\(\)|library)\.then\(function \(\) \{ if \(accountNow\(epoch, uid\)\) return consumeShare\(\); \}\)[\s\S]{0,200}\.then\(function \(\) \{ if \(accountNow\(epoch, uid\)\) takeParkedShare\(\); \}\)/.test(APP),
  'boot takes parked links right after the pending share, without holding the rest of the start');
ok(/return doAdd\(true\)\.then\(function \(saved\) \{[\s\S]{0,200}if \(saved\) takeParkedShare\(\);/.test(APP),
  'a link share that lands while links are parked is followed by them');

// doAdd resolves whether the link is on the shelf; the queue waits on it.
{
  const c2 = vm.createContext({ console, Date, Math, String, Number, JSON, Object, Array, isFinite, Promise, Error });
  vm.runInContext(STUBS.replace(/var saveOk = true; function handleSharedUrl[^\n]*\n/, ''), c2);
  c2.DOM = { ...dom, addgo: node('Save workout'), addurl: node() };
  // aiDeclined is a one-liner: the "Not now" test doAdd's catch asks first (OU-6).
  const declined = APP.slice(APP.indexOf('  function aiDeclined('), APP.indexOf('\n', APP.indexOf('  function aiDeclined(')));
  vm.runInContext([declined, fn('cuttingFrames'), fn('doAdd'), fn('handleSharedUrl'),
    block('  var PARKED_MAX_MS = ', '  // ---------- upload a video from your phone ----------'),
    'function resetUpload() {} function addMode() {} function load() { return Promise.resolve(); }'].join('\n'), c2);
  const r2 = (code) => vm.runInContext(code, c2);
  for (const [answer, want, label] of [
    [{ status: 'processing', id: 'w1' }, true, 'a queued save'],
    [{ status: 'saved', id: 'w1', cached: true }, true, 'a cache hit'],
    [{ status: 'exists', id: 'w1' }, true, 'a card already there'],
    [{ status: 'error', message: 'nope' }, false, 'a refused link'],
    [undefined, false, 'no answer at all'],
  ]) {
    c2.API = { ingest: answer };
    r2('sharing = false; DOM.addurl.value = "https://www.tiktok.com/@a/video/9"');
    ok(await r2('doAdd(true)') === want && r2('sharing') === false, 'doAdd resolves ' + want + ' for ' + label + ', and the share flag is down');
  }
  c2.API = { ingest: { status: 'processing', id: 'w1' } };
  c2.native = parked([{ url: 'https://www.tiktok.com/@a/video/parked', at: now }]);
  r2('calls = []; sharing = false');
  await r2('handleSharedUrl("https://www.tiktok.com/@a/video/shared")');
  await settle(); await settle(); await settle(); await settle();
  const saves = JSON.parse(JSON.stringify(c2.calls)).filter((x) => x[0] === 'ingest').map((x) => x[1].url);
  ok(JSON.stringify(saves) === '["https://www.tiktok.com/@a/video/shared","https://www.tiktok.com/@a/video/parked"]',
    'through the real share path: the shared link, then the parked one, each saved once');
}

// ---- CR-3: the plan rides beside the key in SHARE-IOS's shape ----
ok(APP.includes('native.configureSharing(r.data.ingest_key, { plan: r.data.plan })'), 'profile load (and so sign-in) hands the plan over');
ok(APP.includes('native.configureSharing(r.ingest_key, { plan: myPlan() })'), 'a new sharing key keeps the plan beside it');
ok(!/configureSharing\([^)]*,\s*(r\.data\.plan|state\.profile && state\.profile\.plan)\)/.test(APP) && !/planHint/.test(APP),
  'no call passes the plan bare (the old shape SHARE-IOS does not read)');
{
  const c3 = vm.createContext({ console, Object, Promise });
  vm.runInContext('var billing = {}; var state = { profile: { plan: "free", ingest_key: "k" } }; var hints = [];' +
    'var native = { configureSharing: function (k, h) { hints.push([k, h]); return Promise.resolve(); } };' +
    'function renderLibCount() {} function paintPlanGroup() {} function renderPumpy() {} function paintPlans() {} function refreshDetail() {}' +
    'var current = null; function $() { return { classList: { contains: function () { return false; } } }; }\n' + fn('adoptPlan'), c3);
  vm.runInContext('adoptPlan("plus"); adoptPlan("plus"); adoptPlan("free")', c3);
  ok(JSON.stringify(c3.hints) === '[["k",{"plan":"plus"}],["k",{"plan":"free"}]]',
    'a plan change tells the extension at once, only when it changes');
  vm.runInContext('native = null; adoptPlan("plus")', c3);
  ok(c3.state.profile.plan === 'plus', 'the web app (no native) is unaffected');
}
// When SHARE-IOS's native module is present (the integration branch), the calls
// above are run through it: the plan must reach the plugin as `plan`.
{
  const mod = await import('../native/share-access.js');
  if (typeof mod.takeParked === 'function') {
    const seen = [];
    const configure = mod.shareAccess({ configure: (o) => { seen.push(o); return Promise.resolve(); } });
    await configure('k'.repeat(32), { plan: 'plus' });
    await configure(null);
    ok(seen[0].plan === 'plus' && seen[1].key === null && !('plan' in seen[1]), 'SHARE-IOS shareAccess receives the plan as the app sends it');
    const take = mod.takeParked({ takeParked: () => Promise.resolve({ url: 'https://x.test/1', at: 5 }) });
    const got = await take();
    ok(got.url === 'https://x.test/1' && got.at === 5, 'SHARE-IOS takeParked answers the {url, at} the app reads');
  } else {
    console.log('note: native/share-access.js has no takeParked here (SHARE-IOS not merged); its shape is checked on the integration branch');
  }
}

// ---- S15 and the share flag ----
ok(/if \(state\.user && !wo\) \{ pendPolls = 0; watchPending\(\); load\(\); takeParkedShare\(\); \}/.test(APP),
  'native resume reloads under an open card or sheet, and restarts the pending poll');
ok(/if \(wo\) \{ acquireWake\(\); return; \}\s*\n\s*watchBilling\(\);\s*\n\s*load\(\);/.test(APP),
  'a visible page reloads under an overlay too');
ok((APP.match(/if \(fromShare\) sharing = false;/g) || []).length === 2,
  'a second shared link in an open app is saved, not held for the next launch');

console.log('PASS ' + checks + ' save-flow client checks; no browser, no production writes.');
