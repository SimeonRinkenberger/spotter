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
function handleSharedUrl(u) { consumed.push(u); }
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
  fn('takeParkedShare'),
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
// Plus can deliver.
ok(/var plusCan = \(w\.platform === "tiktok" && w\.kind !== "photo"\) \|\| isUpload\(w\);/.test(APP) &&
  /read_quality !== "premium" && plusCan\) \{\s*\n\s*var quality = el\("div", "reader-offer"\);/.test(APP),
  '"Plus reads the video" is drawn only for a TikTok video or an upload');

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

// ---- S14: a link parked while signed out ----
ctx.native = { takeParkedShare: () => Promise.resolve({ url: 'https://www.tiktok.com/@a/video/1', at: Date.now() - 60_000 }) };
run('consumed = []'); await run('takeParkedShare()');
ok(JSON.stringify(ctx.consumed) === '["https://www.tiktok.com/@a/video/1"]', 'a parked link is saved once after sign-in');
ctx.native = { takeParkedShare: () => Promise.resolve({ url: 'https://www.tiktok.com/@a/video/1', at: new Date(Date.now() - 3 * 86400_000).toISOString() }) };
run('consumed = []'); await run('takeParkedShare()');
ok(!ctx.consumed.length, 'a link parked three days ago is dropped, not saved out of the blue');
ctx.native = { takeParkedShare: () => Promise.resolve({}) };
run('consumed = []'); await run('takeParkedShare()');
ok(!ctx.consumed.length, 'nothing parked, nothing saved');
ctx.native = {};
ok(await run('takeParkedShare()') === undefined, 'a shell without the method is a no-op');
ok(/load\(\)\.then\(function \(\) \{ if \(accountNow\(epoch, uid\)\) return consumeShare\(\); \}\)\s*\n\s*\.then\(function \(\) \{ if \(accountNow\(epoch, uid\)\) return takeParkedShare\(\); \}\)/.test(APP),
  'boot takes a parked link right after the pending share');

// ---- S15 and the share flag ----
ok(/if \(state\.user && !wo\) \{ pendPolls = 0; watchPending\(\); load\(\); takeParkedShare\(\); \}/.test(APP),
  'native resume reloads under an open card or sheet, and restarts the pending poll');
ok(/if \(wo\) \{ acquireWake\(\); return; \}\s*\n\s*watchBilling\(\);\s*\n\s*load\(\);/.test(APP),
  'a visible page reloads under an overlay too');
ok((APP.match(/if \(fromShare\) sharing = false;/g) || []).length === 2,
  'a second shared link in an open app is saved, not held for the next launch');

console.log('PASS ' + checks + ' save-flow client checks; no browser, no production writes.');
