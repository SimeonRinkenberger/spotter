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
    setCtx: { idx: 0, reps: 10, weight: 0 }, stepRows: null, ssHeld: null,
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
  vm.runInContext(pull(['askText', 'blockName', 'isTimed', 'cxDosed', 'cxCap', 'complexOf', 'supersetOf', 'isCircuit', 'roundsOf',
    'roundOf', 'targetOf', 'isStop', 'exKey', 'toUnit', 'setPrefill', 'ssIdx', 'nextSet', 'plate',
    'cxOf', 'cxCurrent', 'cxMarks', 'cxLive', 'liveState', 'liveSync', 'liveEnd']), ctx);
  return { ctx, sent };
}

// ---------- LiveState ----------

const LIVE_KEYS = ['v', 'title', 'startedAt', 'phase', 'exercise', 'block', 'set',
  'target', 'weight', 'rest', 'next', 'progress', 'complex', 'dose'];

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
assert.equal(vm.runInContext('liveState().complex', phases.ctx), null, 'a set-counted movement is not a complex');
vm.runInContext('wo.screens[wo.i].cx = { cap: 900, n: 2 }; wo.amrap = {};', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'complex');
assert.equal(vm.runInContext('liveState().set', phases.ctx), null, 'a complex has no set counter');
// The complex's own counter and clock, as the screen draws them: rounds done,
// movements ticked this round out of how many a round takes, the movement the
// round is up to, and the cap in the rest engine's units (ms; until is an epoch
// deadline, 0 until the clock is started).
same(vm.runInContext('liveState().complex', phases.ctx),
  { rounds: 0, marked: 0, moves: 2, move: 'Bench Press', cap: 900000, until: 0, held: 0, over: false },
  'a fresh complex sends its counter and its clock');
assert.equal(vm.runInContext('liveState().exercise', phases.ctx), 'Bench Press', 'the movement the round is up to');
vm.runInContext('var a = cxOf(wo.screens[wo.i].bi, wo.screens[wo.i].cx); a.rounds = 3; a.marks = [1]; a.until = ' + (NOW + 300000) + ';', phases.ctx);
same(vm.runInContext('(function () { var c = liveState().complex; return [c.rounds, c.marked, c.move, c.until]; })()', phases.ctx),
  [3, 1, 'Barbell Row', NOW + 300000], 'a round in progress names the next movement and the running cap');
vm.runInContext('wo.finished = true;', phases.ctx);
assert.equal(vm.runInContext('liveState().phase', phases.ctx), 'done');

// The set the card names is the first one not yet done — the one the phone's
// button names and a Log set logs (nextSet; superset-harness pins the tap) — so
// set 2 logged out of order off its pill no longer puts "Set 2 · 70 kg" on the
// Lock Screen over a tap that logs set 1 at last time's 60.
const hole = workoutContext();
vm.runInContext('wo.entries[1].sets = [undefined, { reps: 10, weight: 70, unit: "kg", done: true }];', hole.ctx);
same(vm.runInContext('liveState().set', hole.ctx), { index: 1, total: 4 }, 'the hole is the set the card names');
assert.equal(vm.runInContext('liveState().weight', hole.ctx), '60 kg', 'at set 1\'s dose, not the set after the hole');
assert.equal(vm.runInContext('liveState().dose.weight', hole.ctx), 60);

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

console.log('PASS LiveState key set, 1-based set index (the first set not yet done), epoch rest deadline, five phases, one-block and bodyweight cases, liveSync delivery and its failure path.');

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

function overlay(calls, id, open) {
  return {
    classList: {
      remove: () => {},
      add: c => { if (c === 'open') calls.forward++; },
      // An overlay covers the tabs, so a tab link has to get past it. The page
      // asks each one whether it is open by name.
      contains: c => c === 'open' && !!open[id]
    }
  };
}

function linkContext(open) {
  open = open || {};
  const calls = { detail: [], keep: [], start: [], view: [], toast: [], forward: 0, back: 0, closed: [], resumed: 0 };
  const sheets = (open.sheets || []).map(id => ({ id }));
  const ctx = vm.createContext({
    wo: null, $: id => overlay(calls, id, open),
    document: { querySelectorAll: sel => (sel === '.sheet.open' ? sheets : []) },
    history: { back: () => calls.back++ },
    closeSheet: id => calls.closed.push(id),
    // A paused session is a draft on disk and no wo; the card's tap resumes it.
    pausedDraft: () => open.paused || null,
    resumeWorkout: () => { calls.resumed++; },
    state: { user: { id: 'u1' }, workouts: [{ id: 'w1', title: 'Push day' }] },
    planWorkout: id => ctx.state.workouts.filter(w => w.id === id)[0],
    openDetail: (w, keep) => { calls.detail.push(w.id); calls.keep.push(!!keep); },
    startWorkout: w => calls.start.push(w.id),
    setView: v => calls.view.push(v),
    toast: t => calls.toast.push(t),
    String, decodeURIComponent, Object
  });
  vm.runInContext(pull(['woForward', 'showCard', 'openDeepLink']), ctx);
  return { ctx, calls };
}

let link = linkContext();
vm.runInContext('openDeepLink("spotter://open")', link.ctx);
assert.deepEqual(link.calls, { detail: [], keep: [], start: [], view: [], toast: [], forward: 0, back: 0, closed: [], resumed: 0 },
  'spotter://open does nothing on its own — the shell already brought the app up');

link = linkContext();
link.ctx.wo = { finished: false };
vm.runInContext('openDeepLink("spotter://resume")', link.ctx);
assert.equal(link.calls.forward, 1);
// Nothing to resume is not an error, it is nothing.
link = linkContext();
vm.runInContext('openDeepLink("spotter://resume")', link.ctx);
assert.equal(link.calls.forward, 0);
assert.equal(link.calls.resumed, 0);
// A paused session is the one thing the card's tap can bring back without an
// engine running: no wo, a paused draft, and the tap resumes it.
link = linkContext({ paused: { workoutId: 'w1', paused: true } });
vm.runInContext('openDeepLink("spotter://resume")', link.ctx);
assert.equal(link.calls.resumed, 1, 'a paused draft is not resumed by the card that promises to');

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

// Over a card already open, a card link takes its place and its history entry
// (showCard): a second {detail} entry outlived the Back that closed the overlay,
// and the next Back spent it doing nothing.
link = linkContext({ detail: true });
vm.runInContext('openDeepLink("spotter://workout/w1"); openDeepLink("spotter://start/w1")', link.ctx);
assert.deepEqual(link.calls.keep, [true, true], 'a card link over an open card pushes no second entry');
link = linkContext();
vm.runInContext('openDeepLink("spotter://workout/w1")', link.ctx);
assert.deepEqual(link.calls.keep, [false], 'with no card open it is an ordinary open');

link = linkContext();
['library', 'plan', 'progress', 'pumpy'].forEach(t => vm.runInContext('openDeepLink("spotter://tab/' + t + '")', link.ctx));
assert.deepEqual(link.calls.view, ['library', 'plan', 'progress', 'pumpy']);
assert.equal(link.calls.back, 0, 'nothing is over the tabs, so nothing is closed');

// A tab switched underneath an overlay is a tab nobody can see change.
link = linkContext({ detail: true });
vm.runInContext('openDeepLink("spotter://tab/plan")', link.ctx);
assert.deepEqual(link.calls.view, ['plan']);
assert.equal(link.calls.back, 1, 'a card over the tabs is closed the way its own control closes it');

link = linkContext({ sheets: ['settingsheet'] });
vm.runInContext('openDeepLink("spotter://tab/progress")', link.ctx);
assert.deepEqual(link.calls.view, ['progress']);
assert.deepEqual(link.calls.closed, ['settingsheet']);
assert.equal(link.calls.back, 0, 'closeSheet spends the sheet entry itself');

// Workout Mode is the exception: closing it would end a session nobody ended.
link = linkContext({ detail: true, workout: true });
vm.runInContext('openDeepLink("spotter://tab/plan")', link.ctx);
assert.deepEqual(link.calls.view, ['plan']);
assert.equal(link.calls.back, 0);
assert.deepEqual(link.calls.closed, []);

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

console.log('PASS five deep-link routes, the already-running guard, a card link over an open card, a deleted card, garbage and signed-out.');

// ---------- actions arriving from outside the page ----------

function actionContext() {
  const calls = { reps: [], weight: [], save: 0, done: 0, pause: 0, finish: 0, deep: [], toast: [], forward: 0,
    parked: [], unparked: 0 };
  const ctx = vm.createContext({
    wo: fixture(), restUntil: 1, setCtx: { idx: 0, reps: 0, weight: 0 }, stepRows: null, ssHeld: null, setEvents: [],
    $: id => overlay(calls, id, {}),
    OPEN_KEY: 'spotter_open_pending',
    sessionStorage: { setItem: (k, v) => calls.parked.push(v), removeItem: () => { calls.unparked++; } },
    state: { unit: 'kg', user: { id: 'u1' } }, hist: {}, LB_PER_KG: 2.2046226,
    setReps: n => calls.reps.push(n),
    setWeight: n => calls.weight.push(n),
    pausedDraft: () => null,
    resumeWorkout: () => {},
    saveSet: () => { calls.save++; },
    doneRest: () => { calls.done++; },
    pauseRest: () => { calls.pause++; },
    finishWorkout: () => { calls.finish++; },
    openDeepLink: u => calls.deep.push(u),
    toast: t => calls.toast.push(t),
    Math, Object, String, Number, isFinite, parseInt
  });
  vm.runInContext(pull(['isTimed', 'exKey', 'toUnit', 'setPrefill', 'ssIdx', 'nextSet', 'logNextSet', 'woForward', 'openLink', 'liveAction']), ctx);
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
assert.equal(act.calls.unparked, 1, 'the copy the shell parked for a cold launch is spent, not left to replay');

// The shell hands the link over before the page has an account to open it in:
// a cold launch from a notification must park it rather than drop it.
act = actionContext();
vm.runInContext('state.user = null; liveAction({ kind: "notification", id: "spotter://tab/progress" })', act.ctx);
assert.deepEqual(act.calls.deep, [], 'a signed-out page opens nothing');
assert.deepEqual(act.calls.parked, ['spotter://tab/progress'], 'it waits for boot instead');

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

// The complex's two actions from the card land on the screen's own two
// functions, with the movement the round is up to resolved on the phone (the
// card does not pick the index; it cannot see the list). Off a complex both
// are nothing, not a set.
function complexActionContext() {
  const calls = { round: [], mark: [], save: 0, toast: [] };
  const ctx = vm.createContext({
    wo: fixture(), restUntil: 0, setCtx: { idx: 0, reps: 0, weight: 0 }, stepRows: null, ssHeld: null, setEvents: [],
    $: id => overlay(calls, id, {}), OPEN_KEY: 'spotter_open_pending',
    sessionStorage: { setItem: () => {}, removeItem: () => {} },
    state: { unit: 'kg', user: { id: 'u1' } }, hist: {}, LB_PER_KG: 2.2046226,
    setReps: () => {}, setWeight: () => {}, pausedDraft: () => null, resumeWorkout: () => {},
    saveSet: () => { calls.save++; }, doneRest: () => {}, pauseRest: () => {}, finishWorkout: () => {},
    openDeepLink: () => {}, toast: t => calls.toast.push(t),
    cxOf: () => ({ marks: [1, 0] }),
    cxCurrent: (a, cx) => { for (let k = 0; k < cx.n; k++) if (!a.marks[k]) return k; return 0; },
    cxRound: (bi, cx) => calls.round.push([bi, cx.n]),
    cxMark: (bi, cx, j) => calls.mark.push([bi, j]),
    Math, Object, String, Number, isFinite, parseInt
  });
  vm.runInContext(pull(['isTimed', 'exKey', 'toUnit', 'setPrefill', 'ssIdx', 'nextSet', 'logNextSet', 'woForward', 'openLink', 'liveAction']), ctx);
  return { ctx, calls };
}

let cxAct = complexActionContext();
vm.runInContext('wo.screens[wo.i].cx = { cap: 900, n: 2 };', cxAct.ctx);
vm.runInContext('liveAction({ kind: "round", source: "activity", id: null })', cxAct.ctx);
assert.deepEqual(cxAct.calls.round, [[1, 2]], 'round counts the complex on screen through cxRound');
vm.runInContext('liveAction({ kind: "mark", source: "activity", id: null })', cxAct.ctx);
assert.deepEqual(cxAct.calls.mark, [[1, 1]], 'mark ticks the movement the round is up to — the first unmarked one');
assert.equal(cxAct.calls.save, 0, 'neither counts as a set');
cxAct = complexActionContext();
vm.runInContext('liveAction({ kind: "round" }); liveAction({ kind: "mark" });', cxAct.ctx);
assert.deepEqual(cxAct.calls.round.concat(cxAct.calls.mark), [], 'off a complex a round or a mark is nothing');
assert.equal(cxAct.calls.toast.length, 0, 'and says nothing: a card drawn before the screen moved on is not an error');

console.log('PASS round and mark from the card reach cxRound / cxMark on the complex on screen, and do nothing off one.');

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
assert(openListener.slice(0, 400).includes('openLink(u)'), 'the open-url listener no longer routes');
// Both link doors — a URL open and a tapped notification — go through openLink,
// which is what parks one that arrives before there is an account to open it in.
assert(fn('openLink').includes('OPEN_KEY'), 'a link arriving signed-out is no longer parked');
assert(/liveAction[\s\S]{0,900}openLink\(a\.id\)/.test(src),
  'a notification no longer routes through the parking door');
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

  // ---------- the paused session ----------
  //
  // Phase "paused" + pausedAt is the one addition to LiveState v1 (20 Sept):
  // sent when the person pauses from the phone and at every boot that restores
  // a paused draft. Both keys are optional on the wire so an older shell still
  // decodes, which is why the key set here is LIVE_KEYS plus one, not a new
  // contract. The engine side of this (liveState() emitting it) lands with the
  // web work and is asserted there; this pins the shape both halves agreed to
  // and the Swift decl that reads it.
  const p = f.liveStatePaused;
  assert(p, 'contract-fixture.json has no liveStatePaused case');
  assert.deepEqual(Object.keys(p).filter(k => k !== '_').sort(), LIVE_KEYS.concat(['pausedAt']).sort(),
    'liveStatePaused must be an ordinary LiveState plus pausedAt, nothing else');
  assert.equal(p.phase, 'paused');
  assert.equal(p.rest, null, 'no rest runs while the session is paused');
  assert(!isNaN(Date.parse(p.pausedAt)) && /Z$/.test(p.pausedAt), 'pausedAt is an ISO 8601 instant');
  assert(Date.parse(p.pausedAt) > Date.parse(p.startedAt), 'a pause begins after the session started');
  assert(p.set && p.dose && p.progress, 'a paused state keeps describing where the session stopped');
  const liveSwift = fs.readFileSync(swift, 'utf8');
  assert(/\n\s*case paused\n/.test(liveSwift), swift + ' must declare Phase.paused');
  assert(/var pausedAt: String\?/.test(liveSwift), swift + ' must carry pausedAt as an optional String');
  // The dial's message is the watch's message: same kind, same source field,
  // figures only when a dial was turned.
  const d = f.liveActionDial;
  assert(d && d.kind === 'set' && d.source === 'activity' && typeof d.reps === 'number' && typeof d.weight === 'number',
    'liveActionDial must be a .set from source "activity" carrying reps and weight');
  console.log('PASS the paused fixture is LiveState plus pausedAt with no rest, the Swift enum has the case, and the dial\'s set carries figures.');

  // ---------- the complex ----------
  //
  // `complex` is the second addition to LiveState v1 (21 Sept): the round
  // counter and the cap the phone's own screen draws, null on every phase but
  // "complex". Two actions come back for it, round and mark. The engine side
  // (cxLive() emitting it, liveAction() counting them) is asserted above; this
  // pins the shape both halves agreed to and the Swift that reads it.
  const COMPLEX_KEYS = ['rounds', 'marked', 'moves', 'move', 'cap', 'until', 'held', 'over'];
  const c = f.liveStateComplex;
  assert(c, 'contract-fixture.json has no liveStateComplex case');
  assert.deepEqual(Object.keys(c).filter(k => k !== '_').sort(), LIVE_KEYS.slice().sort(),
    'liveStateComplex must be an ordinary LiveState — complex is one of its keys, not an extra');
  assert.equal(c.phase, 'complex');
  assert.equal(c.set, null, 'a complex has no set counter');
  assert.deepEqual(Object.keys(c.complex).sort(), COMPLEX_KEYS.slice().sort(),
    'liveStateComplex.complex drifted: ' + Object.keys(c.complex).join(','));
  assert.equal(c.complex.move, c.exercise, 'exercise names the movement the round is up to, and so does complex.move');
  assert(c.complex.marked < c.complex.moves, 'a round in progress has fewer movements ticked than it takes');
  assert(c.complex.cap > 0 && c.complex.until > 1e12 && c.complex.held === 0 && c.complex.over === false,
    'the fixture complex has a running cap: ms cap, epoch-ms deadline, nothing held, not over');
  assert.equal(c.dose.loggable, false, 'a complex is not logged as a set from off the phone');
  ['liveState', 'liveStateResting', 'liveStatePaused'].forEach(k =>
    assert.equal(f[k].complex === undefined ? null : f[k].complex, null, k + ' must carry complex: null or omit it'));
  const complexSwift = /struct Complex: Codable, Hashable \{([\s\S]*?)\n    \}/.exec(liveSwift);
  assert(complexSwift, swift + ' must declare Complex');
  COMPLEX_KEYS.forEach(k => assert(new RegExp('var ' + k + ':').test(complexSwift[1]), swift + ' Complex has no ' + k));
  assert(/var complex: Complex\?/.test(liveSwift), swift + ' must carry complex as an optional');
  [['liveActionRound', 'round'], ['liveActionMark', 'mark']].forEach(([name, kind]) => {
    const a = f[name];
    assert(a && a.kind === kind && a.source === 'activity' && a.id === null,
      name + ' must be kind "' + kind + '" from source "activity" with a null id');
    assert.deepEqual(Object.keys(a).filter(k => k !== '_').sort(), ['id', 'kind', 'source'],
      name + ' carries no figures: a round is counted, not dosed');
    assert(new RegExp('\\n\\s*case ' + kind + '\\n').test(liveSwift), swift + ' LiveAction.Kind must declare .' + kind);
  });
  console.log('PASS the complex fixture is LiveState with the counter and a running cap, the Swift struct has every field, and round/mark decode.');
}
