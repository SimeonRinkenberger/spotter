// The contract between two halves that cannot talk to each other.
//
// LiveState, LiveSummary, WidgetSummary and LiveAction are field names agreed in
// a brief and then written twice: once in app.ts and once in Swift. A typo on
// either side is not a crash, it is a Lock Screen that quietly says nothing, so
// this runs the real functions out of app.ts against a fixture session and
// deep-equals the KEY SET — not a sample of it — against the contract, then
// checks the Swift structs for the same names once they exist.
//
// Node-only, like every other tools/ios/*-check.mjs: CI runs it on a macOS box
// with no Xcode step.

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');

// Objects built inside a vm context carry that context's Object.prototype, which
// deepStrictEqual refuses to match. What crosses the bridge is JSON anyway, so
// compare what would actually be sent.
const same = (got, want, msg) => assert.deepEqual(JSON.parse(JSON.stringify(got)), want, msg);

// check.mjs slices to the next dedented brace, which cannot see a one-line
// function; this counts braces instead so `isFree()` and `ymd()` come out whole.
// None of the functions pulled below has a brace inside a string or a regex.
function fn(name) {
  const start = src.indexOf('\n  function ' + name + '(');
  assert(start >= 0, 'app.ts has no ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1) + '\n';
  }
  throw new Error('unbalanced braces in ' + name);
}

const pull = names => names.map(fn).join('');

// ---------- the fixture session ----------
// Two blocks, three movements, one set logged, an ordinary rest running.

const START = '2026-09-18T15:00:00.000Z';
const NOW = 1789000000000;

function fixture() {
  const warm = { title: 'Warm-up', type: 'straight', exercises: [
    { name: 'Goblet Squat', sets: 3, reps: '10', rest_seconds: 60 }
  ] };
  const main = { title: 'Main', type: 'straight', exercises: [
    { name: 'Bench Press', sets: 4, reps: '8-12', rest_seconds: 90 },
    { name: 'Barbell Row', sets: 3, reps: '10' }
  ] };
  const workout = { id: 'w1', title: 'Fixture Session', blocks: [warm, main] };
  return {
    workout, i: 1, finished: false, startedAt: START, prs: {}, rounds: {}, amrap: {},
    screens: [
      { block: warm, bi: 0, ei: 0, ex: warm.exercises[0], cx: null },
      { block: main, bi: 1, ei: 0, ex: main.exercises[0], cx: null },
      { block: main, bi: 1, ei: 1, ex: main.exercises[1], cx: null }
    ],
    entries: [
      { name: 'Goblet Squat', sets: [{ reps: 10, weight: 20, unit: 'kg', done: true }] },
      { name: 'Bench Press', sets: [] },
      { name: 'Barbell Row', sets: [] }
    ]
  };
}

function workoutContext() {
  const sent = { update: [], end: [], publish: [] };
  const ctx = vm.createContext({
    wo: fixture(),
    state: { unit: 'kg', user: { id: 'u1' }, logs: null, plan: null, workouts: [], goal: null, profile: null },
    hist: { 'n:Bench Press': { weight: 60, unit: 'kg', sets: 4, reps: '8', date: '2026-09-11' } },
    histReady: true,
    restUntil: NOW + 45000, restTotal: 60000, restHeld: 0, restFace: null,
    LB_PER_KG: 2.2046226,
    native: {
      live: {
        update: s => sent.update.push(s),
        end: s => sent.end.push(s),
        publish: s => sent.publish.push(s)
      }
    },
    Math, Date, Object, String, Number, Boolean, isFinite, parseInt, JSON
  });
  vm.runInContext(pull(['askText', 'blockName', 'isTimed', 'isCircuit', 'roundsOf',
    'roundOf', 'targetOf', 'isStop', 'exKey', 'toUnit', 'setPrefill', 'plate',
    'liveState', 'liveSync', 'liveEnd']), ctx);
  return { ctx, sent };
}

// ---------- LiveState ----------

const LIVE_KEYS = ['v', 'title', 'startedAt', 'phase', 'exercise', 'block', 'set',
  'target', 'weight', 'rest', 'next', 'progress', 'dose'];

const { ctx, sent } = workoutContext();
const s = vm.runInContext('liveState()', ctx);

assert.deepEqual(Object.keys(s).sort(), LIVE_KEYS.slice().sort(),
  'LiveState key set drifted: ' + Object.keys(s).join(','));
assert.equal(s.v, 1);
assert.equal(s.title, 'Fixture Session');
assert.equal(s.startedAt, START);
assert.equal(s.phase, 'rest');
assert.equal(s.exercise, 'Bench Press');
assert.equal(s.block, 'Main');
same(s.set, { index: 1, total: 4 }, 'set.index is 1-based');
assert.equal(s.target, '8-12 reps');
assert.equal(s.weight, '60 kg');
assert.equal(typeof s.rest.until, 'number');
assert.equal(s.rest.total, 60000);
assert.equal(s.rest.held, 0);
assert(s.rest.until > 1e12, 'rest.until is epoch milliseconds, not seconds');
assert.equal(s.next, 'Barbell Row');
same(s.progress, { done: 1, total: 10 });
assert.equal(typeof s.progress.done, 'number');

// A one-block card names no block, and the last movement has no next.
const solo = workoutContext();
vm.runInContext('wo.workout.blocks = [wo.workout.blocks[1]]; wo.i = 2;', solo.ctx);
assert.equal(vm.runInContext('liveState().block', solo.ctx), null);
assert.equal(vm.runInContext('liveState().next', solo.ctx), null);

// Every phase the contract names, off the same fixture.
const phases = workoutContext();
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'rest');
vm.runInContext('restFace = "rest";', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'timed');
vm.runInContext('restFace = null; restUntil = 0;', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'work');
assert.equal(vm.runInContext('liveState().rest', phases.ctx), null);
vm.runInContext('wo.screens[wo.i].cx = { cap: 900, n: 2 };', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'complex');
assert.equal(vm.runInContext('liveState().set', phases.ctx), null, 'a complex has no set counter');
vm.runInContext('wo.finished = true;', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'done');

// A bodyweight movement with no history offers no weight.
const bare = workoutContext();
vm.runInContext('hist = {};', bare.ctx);
assert.equal(vm.runInContext('liveState().weight', bare.ctx), null);

// liveSync sends exactly what liveState built, and swallows a shell that has no
// plugin rather than taking the draft down with it.
vm.runInContext('liveSync()', ctx);
assert.equal(sent.update.length, 1);
assert.deepEqual(Object.keys(sent.update[0]).sort(), LIVE_KEYS.slice().sort());
const broken = workoutContext();
vm.runInContext('native = { live: { update: function () { throw new Error("no plugin"); } } };', broken.ctx);
vm.runInContext('liveSync()', broken.ctx);
vm.runInContext('wo = null; liveSync();', broken.ctx);

console.log('PASS LiveState key set, 1-based set index, epoch rest deadline, five phases, one-block and bodyweight cases, liveSync delivery and its failure path.');

// ---------- LiveSummary ----------

const SUMMARY_KEYS = ['v', 'title', 'startedAt', 'endedAt', 'sets', 'prs', 'completed'];

[true, false].forEach(completed => {
  const run = workoutContext();
  vm.runInContext('wo.prs = { "n:Bench Press": { name: "Bench Press" } };', run.ctx);
  vm.runInContext('liveEnd(' + completed + ')', run.ctx);
  assert.equal(run.sent.end.length, 1);
  const e = run.sent.end[0];
  assert.deepEqual(Object.keys(e).sort(), SUMMARY_KEYS.slice().sort(),
    'LiveSummary key set drifted: ' + Object.keys(e).join(','));
  assert.equal(e.v, 1);
  assert.equal(e.completed, completed);
  assert.equal(e.sets, 1);
  assert.equal(e.prs, 1);
  assert.equal(e.startedAt, START);
  assert(!isNaN(Date.parse(e.endedAt)), 'endedAt is an ISO instant');
});

// A session already sealed cannot end twice, and a summary overlay is not a session.
const once = workoutContext();
vm.runInContext('wo.finished = true; liveEnd(true);', once.ctx);
vm.runInContext('wo = null; liveEnd(false);', once.ctx);
assert.equal(once.sent.end.length, 0);

console.log('PASS LiveSummary key set for a finished and an abandoned session, and exactly-once sealing.');

// ---------- WidgetSummary ----------

const WIDGET_KEYS = ['v', 'updatedAt', 'week', 'streak', 'today', 'next', 'last', 'active'];

function widgetContext() {
  const sent = { publish: [] };
  const timers = [];
  const ctx = vm.createContext({
    wo: null, today: { rows: [] }, pubTimer: null, pubOut: false,
    state: {
      user: { id: 'u1' }, goal: 3, profile: null, logs: [], plan: [],
      workouts: [
        { id: 'w1', title: 'Push day', duration_minutes: 35 },
        { id: 'w2', title: 'Pull day', duration_minutes: 40 }
      ]
    },
    native: { live: { publish: x => sent.publish.push(x) } },
    myPlan: () => 'free',
    GOAL_FALLBACK: 3, WEEK_MS: 7 * 86400000,
    setTimeout: f => { timers.push(f); return timers.length; },
    clearTimeout: id => { if (id) timers[id - 1] = null; },
    Math, Date, Object, String, Number, Boolean, JSON
  });
  vm.runInContext(pull(['ymd', 'addDays', 'mondayOf', 'weekKey', 'planMap', 'isSession',
    'fzIn', 'isFree', 'goalSetting', 'weekStats', 'thisWeek', 'rowsFor', 'planWorkout',
    'publishSummary', 'sendSummary', 'publishSignedOut']), ctx);
  const key = vm.runInContext('ymd(new Date())', ctx);
  const soon = vm.runInContext('ymd(addDays(new Date(), 2))', ctx);
  const was = vm.runInContext('ymd(addDays(new Date(), -1))', ctx);
  ctx.state.plan = [{ id: 'p1', day: key, workout_id: 'w1' }, { id: 'p2', day: soon, workout_id: 'w2' }];
  ctx.state.logs = [{
    id: 'l1', workout_title: 'Leg day', started_at: was + 'T17:00:00.000Z',
    completed_at: was + 'T18:00:00.000Z', entries: [{ sets: [{ reps: 10, done: true }] }]
  }];
  return { ctx, sent, timers, key, soon, was };
}

const wid = widgetContext();
// Two calls in one burst leave ONE pending send.
vm.runInContext('publishSummary(); publishSummary();', wid.ctx);
assert.equal(wid.timers.filter(Boolean).length, 1, 'publishSummary is debounced');
wid.timers.filter(Boolean)[0]();
assert.equal(wid.sent.publish.length, 1);

const g = wid.sent.publish[0];
assert.deepEqual(Object.keys(g).sort(), WIDGET_KEYS.slice().sort(),
  'WidgetSummary key set drifted: ' + Object.keys(g).join(','));
assert.equal(g.v, 1);
assert(!isNaN(Date.parse(g.updatedAt)));
// `planned` joined the week on the widgets branch: the small widget draws a ring
// on days the plan still asks for, and `days` only says which ones were answered.
assert.deepEqual(Object.keys(g.week).sort(), ['atRisk', 'days', 'planned', 'done', 'goal', 'key'].sort());
assert.match(g.week.key, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(g.week.days.length, 7);
assert(g.week.days.every(d => typeof d === 'boolean'), 'week.days is Mon..Sun booleans');
assert.equal(typeof g.week.goal, 'number');
assert.equal(typeof g.week.atRisk, 'boolean');
assert.equal(typeof g.streak, 'number');
same(g.today, { id: 'w1', title: 'Push day', minutes: 35 });
same(g.next, { id: 'w2', title: 'Pull day', day: wid.soon });
assert.equal(g.last.title, 'Leg day');
assert(!isNaN(Date.parse(g.last.at)));
assert.equal(g.active, false);

// A plan with nothing on it today, and a library that never logged anything.
const empty = widgetContext();
empty.ctx.state.plan = [];
empty.ctx.state.logs = [];
vm.runInContext('sendSummary()', empty.ctx);
const e0 = empty.sent.publish[0];
assert.equal(e0.today, null);
assert.equal(e0.next, null);
assert.equal(e0.last, null);

// Signed out publishes the clearing message and nothing else, once.
const out = widgetContext();
vm.runInContext('publishSignedOut(); publishSignedOut();', out.ctx);
assert.equal(out.sent.publish.length, 1);
assert.deepEqual(Object.keys(out.sent.publish[0]).sort(), ['signedOut', 'updatedAt', 'v']);
assert.equal(out.sent.publish[0].signedOut, true);
// Nothing is published for a signed-out account by the ordinary path.
const none = widgetContext();
none.ctx.state.user = null;
vm.runInContext('publishSummary(); sendSummary();', none.ctx);
assert.equal(none.sent.publish.length, 0);

console.log('PASS WidgetSummary key set, Mon..Sun week, today/next/last shapes, debounce, and the sign-out clear.');

// ---------- deep links ----------

function overlay(calls) {
  return { classList: { remove: () => {}, add: c => { if (c === 'open') calls.forward++; } } };
}

function linkContext() {
  const calls = { detail: [], start: [], view: [], toast: [], forward: 0 };
  const ctx = vm.createContext({
    wo: null, $: () => overlay(calls),
    state: { user: { id: 'u1' }, workouts: [{ id: 'w1', title: 'Push day' }] },
    planWorkout: id => ctx.state.workouts.filter(w => w.id === id)[0],
    openDetail: w => calls.detail.push(w.id),
    startWorkout: w => calls.start.push(w.id),
    setView: v => calls.view.push(v),
    toast: t => calls.toast.push(t),
    String, decodeURIComponent, Object
  });
  vm.runInContext(pull(['woForward', 'openDeepLink']), ctx);
  return { ctx, calls };
}

let link = linkContext();
vm.runInContext('openDeepLink("spotter://open")', link.ctx);
assert.deepEqual(link.calls, { detail: [], start: [], view: [], toast: [], forward: 0 },
  'spotter://open does nothing on its own — the shell already brought the app up');

link = linkContext();
link.ctx.wo = { finished: false };
vm.runInContext('openDeepLink("spotter://resume")', link.ctx);
assert.equal(link.calls.forward, 1);
// Nothing to resume is not an error, it is nothing.
link = linkContext();
vm.runInContext('openDeepLink("spotter://resume")', link.ctx);
assert.equal(link.calls.forward, 0);

link = linkContext();
vm.runInContext('openDeepLink("spotter://workout/w1")', link.ctx);
assert.deepEqual(link.calls.detail, ['w1']);
assert.deepEqual(link.calls.start, []);

link = linkContext();
vm.runInContext('openDeepLink("spotter://start/w1")', link.ctx);
assert.deepEqual(link.calls.detail, ['w1']);
assert.deepEqual(link.calls.start, ['w1']);

link = linkContext();
link.ctx.wo = { finished: false };
vm.runInContext('openDeepLink("spotter://start/w1")', link.ctx);
assert.deepEqual(link.calls.start, [], 'a running session is never restarted');
assert.equal(link.calls.forward, 1);
assert.equal(link.calls.toast.length, 1);

link = linkContext();
['library', 'plan', 'progress', 'pumpy'].forEach(t => vm.runInContext('openDeepLink("spotter://tab/' + t + '")', link.ctx));
assert.deepEqual(link.calls.view, ['library', 'plan', 'progress', 'pumpy']);

link = linkContext();
['', 'spotter://', 'spotter://tab/settings', 'spotter://nonsense/1', 'https://example.com/x',
  'spotter://workout/', 'javascript:alert(1)', 'spotter:/open'].forEach(u =>
  vm.runInContext('openDeepLink(' + JSON.stringify(u) + ')', link.ctx));
assert.deepEqual(link.calls.detail, []);
assert.deepEqual(link.calls.start, []);
assert.deepEqual(link.calls.view, []);
assert.equal(link.calls.forward, 0);
assert.equal(link.calls.toast.length, 0, 'garbage is ignored silently, not announced');

// A card that has since left the library says so rather than opening nothing.
link = linkContext();
vm.runInContext('openDeepLink("spotter://workout/gone")', link.ctx);
assert.equal(link.calls.toast.length, 1);
assert.deepEqual(link.calls.detail, []);
// Signed out, every route is dropped.
link = linkContext();
link.ctx.state.user = null;
vm.runInContext('openDeepLink("spotter://tab/plan")', link.ctx);
assert.deepEqual(link.calls.view, []);

console.log('PASS five deep-link routes, the already-running guard, a deleted card, garbage and signed-out.');

// ---------- actions arriving from outside the page ----------

function actionContext() {
  const calls = { reps: [], weight: [], save: 0, done: 0, pause: 0, finish: 0, deep: [], toast: [], forward: 0 };
  const ctx = vm.createContext({
    wo: fixture(), restUntil: 1, setCtx: { idx: 0, reps: 0, weight: 0 },
    $: () => overlay(calls),
    state: { unit: 'kg' }, hist: {}, LB_PER_KG: 2.2046226,
    setReps: n => calls.reps.push(n),
    setWeight: n => calls.weight.push(n),
    saveSet: () => { calls.save++; },
    doneRest: () => { calls.done++; },
    pauseRest: () => { calls.pause++; },
    finishWorkout: () => { calls.finish++; },
    openDeepLink: u => calls.deep.push(u),
    toast: t => calls.toast.push(t),
    Math, Object, String, Number, isFinite, parseInt
  });
  vm.runInContext(pull(['isTimed', 'exKey', 'toUnit', 'setPrefill', 'woForward', 'liveAction']), ctx);
  return { ctx, calls };
}

let act = actionContext();
vm.runInContext('liveAction({ kind: "set", source: "activity", id: null })', act.ctx);
assert.deepEqual(act.calls.reps, [8], 'the prefilled dose is the card target, read once');
assert.deepEqual(act.calls.weight, [0]);
assert.equal(act.calls.save, 1);

act = actionContext();
vm.runInContext('liveAction({ kind: "set", source: "watch", reps: 12, weight: 62.5 })', act.ctx);
assert.deepEqual(act.calls.reps, [12], 'a dose sent from the wrist wins');
assert.deepEqual(act.calls.weight, [62.5]);
assert.equal(act.calls.save, 1);

act = actionContext();
vm.runInContext('liveAction({ kind: "set", reps: "12", weight: NaN })', act.ctx);
assert.deepEqual(act.calls.reps, [8], 'a string is not a number');
assert.deepEqual(act.calls.weight, [0]);

act = actionContext();
vm.runInContext('wo.screens[wo.i].ex.duration_seconds = 40; liveAction({ kind: "set" })', act.ctx);
assert.equal(act.calls.save, 0, 'a hold cannot be saved with reps and a weight');
assert.equal(act.calls.toast.length, 1);

act = actionContext();
vm.runInContext('liveAction({ kind: "skipRest" }); liveAction({ kind: "toggleRest" }); liveAction({ kind: "finish" });', act.ctx);
assert.equal(act.calls.done, 1);
assert.equal(act.calls.pause, 1);
assert.equal(act.calls.finish, 1);

act = actionContext();
vm.runInContext('liveAction({ kind: "notification", source: "notification", id: "spotter://tab/plan" })', act.ctx);
assert.deepEqual(act.calls.deep, ['spotter://tab/plan'], 'a reminder carries its destination as the id');
assert.equal(act.calls.forward, 0);

act = actionContext();
vm.runInContext('restUntil = 0; liveAction({ kind: "notification", id: "rest-end" })', act.ctx);
assert.equal(act.calls.forward, 0, 'the rest it announced is already over');
vm.runInContext('restUntil = 5; liveAction({ kind: "notification", id: "rest-end" })', act.ctx);
assert.equal(act.calls.forward, 1, 'a rest still running brings the session forward');
vm.runInContext('liveAction({ kind: "open" })', act.ctx);
assert.equal(act.calls.forward, 2);

// Every branch guards the session.
act = actionContext();
vm.runInContext('wo = null;', act.ctx);
['set', 'skipRest', 'toggleRest', 'finish', 'open', 'notification', 'nonsense'].forEach(k =>
  vm.runInContext('liveAction({ kind: "' + k + '" })', act.ctx));
assert.equal(act.calls.save + act.calls.done + act.calls.pause + act.calls.finish + act.calls.forward, 0);

console.log('PASS remote set with and without an adjusted dose, rest and finish actions, a deep-linked notification, and every branch guarding wo.');

// ---------- the bundle the shell actually loads ----------

const bundle = fs.readFileSync('native-dist/native.js', 'utf8');
['LiveState', 'SpotterPush', 'appUrlOpen', 'spotter:open-url', 'spotter:live-action',
  'spotter_open_pending', 'notifyStatus', 'notifyRequest'].forEach(needle =>
  assert(bundle.includes(needle), 'native-dist/native.js is missing ' + needle));
assert(src.includes('spotter:live-action'), 'app.ts never listens for an action');
assert(src.includes('spotter:open-url'), 'app.ts never listens for a URL');
assert(src.includes('if (native && native.live) liveSync();'), 'saveDraft no longer syncs the session');

// The two listeners are one line each and delegate to the functions tested above;
// what is worth pinning is that they still delegate, and that a cold launch is
// spent inside boot rather than left in sessionStorage for the next sign-in.
assert(/addEventListener\("spotter:live-action", function \(e\) \{ liveAction\(/.test(src),
  'the live-action listener no longer calls liveAction');
const openListener = src.slice(src.indexOf('addEventListener("spotter:open-url"'));
assert(openListener.slice(0, 400).includes('openDeepLink(u)'), 'the open-url listener no longer routes');
assert(openListener.slice(0, 400).includes('OPEN_KEY'), 'a URL arriving signed-out is no longer parked');
assert(src.includes('consumeOpen()'), 'boot never spends a parked launch URL');

// stopRest() saves the draft and a draft save syncs the mirrors, so a teardown
// that seals the activity before it revives the activity one line later. This is
// invisible at runtime on a machine with no simulator, so it is pinned here.
[['exitWorkout', 'liveEnd(false)'], ['clearAccount', 'liveEnd(false)'], ['finishWorkout', 'liveEnd(true)']]
  .forEach(([name, seal]) => {
    const body = fn(name);
    assert(body.includes(seal), name + ' no longer ends the Live Activity');
    assert(body.indexOf('stopRest()') < body.indexOf(seal),
      name + ' seals the activity before its last saveDraft — stopRest would revive it');
  });

console.log('PASS the packaged bridge registers both plugins and both events, and saveDraft still drives the sync.');

// ---------- the Swift half, once it is merged ----------

const swift = 'ios/App/Shared/LiveState.swift';
const widget = 'ios/App/Shared/WidgetSummary.swift';
const fixtureJson = 'tools/ios/contract-fixture.json';

if (!fs.existsSync(swift) || !fs.existsSync(widget)) {
  console.log('SKIP (Swift half not merged yet): ' + swift + ' / ' + widget);
} else {
  const live = fs.readFileSync(swift, 'utf8');
  LIVE_KEYS.concat(['until', 'total', 'held', 'index', 'done'])
    .forEach(k => assert(live.includes(k), swift + ' has no ' + k));
  SUMMARY_KEYS.forEach(k => assert(live.includes(k) || fs.readFileSync(widget, 'utf8').includes(k),
    'LiveSummary field ' + k + ' is in neither Swift struct'));
  const wSrc = fs.readFileSync(widget, 'utf8');
  WIDGET_KEYS.concat(['days', 'atRisk', 'minutes', 'signedOut'])
    .forEach(k => assert(wSrc.includes(k), widget + ' has no ' + k));
  console.log('PASS the Swift structs carry every contract field.');
}

if (!fs.existsSync(fixtureJson)) {
  console.log('SKIP (Swift half not merged yet): ' + fixtureJson);
} else {
  const f = JSON.parse(fs.readFileSync(fixtureJson, 'utf8'));
  if (f.liveState) assert.deepEqual(Object.keys(f.liveState).sort(), LIVE_KEYS.slice().sort(),
    'contract-fixture.json disagrees with the LiveState this page emits');
  if (f.liveSummary) assert.deepEqual(Object.keys(f.liveSummary).sort(), SUMMARY_KEYS.slice().sort());
  if (f.widgetSummary) assert.deepEqual(
    Object.keys(f.widgetSummary).filter(k => k !== 'signedOut').sort(), WIDGET_KEYS.slice().sort());
  console.log('PASS the shared fixture decodes to the same shape.');
}
