// The rules Option B ("Train is home", 25 Sept 2026) cannot get wrong, run against
// the real functions in app.ts rather than copies of them:
//
//   1. Up next: the S1–S6 truth table (paused, planned, done, rest day, try next,
//      empty) and the other-day card (past, future, the logs' horizon).
//   2. Ready to try: who is on the shelf, and that the shelf and the chip are one list.
//   3. One status per Workouts card: planned beats done beats new, and its words.
//   4. The Plan sheet's fortnight across a month end and a daylight-saving change.
//   5. The ready sheet on launch: once per card, newest first, never over a workout.
//   6. logNextSet: one door for the button, the Lock Screen and the wrist; an event
//      id makes a replay harmless.
//   7. trainSeg: the old "calendar" reads as Progress.
//   8. The wording scan: no retired label in anything a person can read.
//
// No browser and no playwright — node:vm over lifted functions. Run from the repo
// root: node tools/simplify-b-harness.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const MARKUP = fs.readFileSync('supabase/functions/spotter/markup.ts', 'utf8');
const INDEX = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');

// A top-level function of the IIFE, found by its two-space indent and cut at the
// brace that closes it — counted, skipping strings and comments, so a one-liner
// and a function with a "}" inside a string both come out whole.
function fn(name) {
  const a = APP.indexOf('\n  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  let i = APP.indexOf('{', a), depth = 0;
  for (; i < APP.length; i++) {
    const c = APP[i], d = APP[i + 1];
    if (c === '"' || c === "'") { const q = c; for (i++; APP[i] !== q; i++) if (APP[i] === '\\') i++; continue; }
    if (c === '/' && d === '/') { i = APP.indexOf('\n', i); continue; }
    if (c === '/' && d === '*') { i = APP.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return APP.slice(a + 1, i + 1) + '\n';
  }
  throw new Error('unterminated: ' + name);
}
function decl(head) {
  const a = APP.indexOf('\n  var ' + head);
  assert(a >= 0, 'not found in app.ts: var ' + head);
  return APP.slice(a + 1, APP.indexOf('\n', a + 1)) + '\n';
}

let checks = 0, failed = 0;
function check(name, body) {
  try { body(); checks++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").slice(0, 8).join("\n       ")); }
}

// ---------- the world the lifted rules run in ----------
const LIFT = ['ymd', 'addDays', 'mondayOf', 'dayDate', 'isSession', 'isPending', 'isFailed', 'upNextOf', 'dayOf',
  'setsIn', 'daySessions', 'dayRows', 'sessionFor', 'nextPlanned', 'tryNext', 'readyList', 'workoutStatus',
  'statusLabel', 'aheadWord', 'planDays', 'readyPick', 'readTrainSeg',
  // B.2: S2 carries the planned row's prescription, worked out by the seam's one rule.
  'prescriptionFor', 'rxText', 'rxWeekStart', 'rxBasis', 'liftMax', 'e1rm', 'unitTo', 'plateOf', 'toPlate', 'clamp'];
function world() {
  const c = vm.createContext({ Date, JSON, Math, String, Number, Object, Array, console, isFinite,
    state: { profile: null },
    localStorage: { store: {}, getItem(k) { return k in this.store ? this.store[k] : null; }, setItem(k, v) { this.store[k] = String(v); } } });
  vm.runInContext(decl('AHEAD_DAYS') + decl('SEGS') + decl('LB_PER_KG') + decl('MAX_WINDOW') + LIFT.map(fn).join(''), c);
  return (js) => {
    const v = vm.runInContext(js, c);
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  };
}
const run = world();

// Friday 25 September 2026, noon, local. The week is Mon 21 – Sun 27.
const NOW = 'new Date(2026, 8, 25, 12, 0, 0)';
const W = (id, extra) => Object.assign({ id, title: id.toUpperCase(), ingest_status: 'ready', created_at: '2026-09-01T00:00:00Z' }, extra);
const LOG = (wid, day, sets, extra) => Object.assign({ id: 'l-' + wid + '-' + day, workout_id: wid, started_at: day + 'T17:00:00',
  completed_at: day + 'T18:00:00', duration_seconds: 2700, entries: [{ name: 'x', sets: sets === 0 ? [] : Array(sets || 3).fill({ reps: 8 }) }] }, extra);
const P = (day, wid) => ({ id: 'p-' + day + '-' + wid, day, workout_id: wid });
function up(d) {
  const o = Object.assign({ workouts: [W('a'), W('b'), W('c')], logs: [], plan: [], libReady: true, planReady: true, draft: null, running: null }, d);
  return run('upNextOf(Object.assign(' + JSON.stringify(o) + ', { now: ' + NOW + ' }))');
}

console.log('1. Up next');
check('S1: a paused draft wins over everything, with its sets and when it stopped', () => {
  const r = up({ draft: { workoutId: 'b', paused: true, startedAt: '2026-09-25T09:00:00', pausedAt: '2026-09-25T09:20:00',
    entries: [{ sets: [{ reps: 5 }, null, { reps: 5 }] }] }, plan: [P('2026-09-25', 'a')], logs: [LOG('c', '2026-09-25')] });
  assert.equal(r.s, 1); assert.equal(r.kind, 'paused'); assert.equal(r.w.id, 'b');
  assert.equal(r.sets, 2, 'a hole is not a set'); assert.equal(r.running, false);
  assert.equal(r.pausedAt, '2026-09-25T09:20:00');
});
check('S1: a session running (Workout Mode up) is S1 too, and says so', () => {
  const r = up({ running: { workout: W('c'), startedAt: '2026-09-25T11:00:00', entries: [{ sets: [{ reps: 1 }] }] } });
  assert.equal(r.s, 1); assert.equal(r.running, true); assert.equal(r.sets, 1);
});
check('S1 needs its workout: a draft for a card no longer on the shelf falls through', () => {
  const r = up({ draft: { workoutId: 'gone', paused: true, startedAt: 'x' }, plan: [P('2026-09-25', 'a')] });
  assert.equal(r.s, 2);
});
check('S0: nothing is guessed before the library, the plan and the logs are in', () => {
  assert.equal(up({ libReady: false }).s, 0);
  assert.equal(up({ planReady: false }).s, 0);
  assert.equal(up({ logs: null }).s, 0);
  // …except a paused session, which is on the phone and needs no read.
  assert.equal(up({ libReady: true, planReady: false, draft: { workoutId: 'a', paused: true, startedAt: 'x' } }).s, 1);
});
check('S2: planned today and not done — Start, with "+N more" when several are planned', () => {
  const r = up({ plan: [P('2026-09-25', 'a'), P('2026-09-25', 'b'), P('2026-09-26', 'c')] });
  assert.equal(r.s, 2); assert.equal(r.w.id, 'a'); assert.equal(r.more, 1); assert.equal(r.row.day, '2026-09-25');
});
check('S2: one of two planned done — the other is up next, and today\'s session rides along', () => {
  const r = up({ plan: [P('2026-09-25', 'a'), P('2026-09-25', 'b')], logs: [LOG('a', '2026-09-25')] });
  assert.equal(r.s, 2); assert.equal(r.w.id, 'b'); assert.equal(r.more, 0); assert.equal(r.done.length, 1);
});
check('S2: a different workout trained instead leaves the plan standing', () => {
  const r = up({ plan: [P('2026-09-25', 'a')], logs: [LOG('c', '2026-09-25')] });
  assert.equal(r.s, 2); assert.equal(r.w.id, 'a'); assert.equal(r.done[0].workout_id, 'c');
});
check('S2 (B.2): a program day carries its prescription, in this week\'s numbers; any other day carries none', () => {
  const G = { id: 'g1', kind: 'lift', exercise: 'bench-press', baseline: 287, target: 295, unit: 'lb', start_day: '2026-09-18' };
  const rx = { v: 1, goal_id: 'g1', week: 2, label: 'Build', exercise: 'bench-press', sets: 5, reps: '5', pct: 0.775, weight: 220, unit: 'lb' };
  const row = Object.assign(P('2026-09-25', 'a'), { prescription: rx });
  const bench = (w, reps, day) => LOG('b', day, 1, { entries: [{ canonical_id: 'bench-press', sets: [{ reps, weight: w, unit: 'lb' }] }] });
  let r = up({ plan: [row], goals: [G], unit: 'lb' });
  assert.equal(r.s, 2); assert.equal(r.rx.text, 'W2 · Build · 5×5 @ 220 lb', 'week 2 from the baseline, to a plate');
  // A heavier week 1 moves week 2's load; logs from today on do not.
  r = up({ plan: [row], goals: [G], unit: 'lb', logs: [bench(265, 5, '2026-09-20'), bench(300, 5, '2026-09-25')] });
  assert.equal(r.rx.weight, 240, '0.775 × est. 309 from the set before the week began');
  assert.equal(up({ plan: [row], goals: [G], unit: 'kg' }).rx.text, 'W2 · Build · 5×5 @ 100 kg', 'read in the account\'s unit');
  assert.equal(up({ plan: [P('2026-09-25', 'a')], goals: [G] }).rx, null);
});
check('S3: done today as planned — the recap, the day\'s totals, and what is next', () => {
  const r = up({ plan: [P('2026-09-25', 'a'), P('2026-09-29', 'b'), P('2026-09-27', 'c')],
    logs: [LOG('a', '2026-09-25', 4), LOG('b', '2026-09-24')] });
  assert.equal(r.s, 3); assert.equal(r.session.workout_id, 'a'); assert.equal(r.sets, 4); assert.equal(r.secs, 2700);
  assert.equal(r.next.day, '2026-09-27', 'the nearest planned day, not the first row'); assert.equal(r.next.w.id, 'c');
});
check('S3: done today with nothing planned today; two sessions add up', () => {
  const r = up({ logs: [LOG('a', '2026-09-25', 2, { started_at: '2026-09-25T07:00:00' }), LOG('b', '2026-09-25', 3)] });
  assert.equal(r.s, 3); assert.equal(r.sets, 5); assert.equal(r.sessions.length, 2);
  assert.equal(r.session.workout_id, 'b', 'newest first'); assert.equal(r.next, null);
});
check('S3 ignores an abandoned session (no sets): that is not done', () => {
  const r = up({ plan: [P('2026-09-25', 'a')], logs: [LOG('a', '2026-09-25', 0)] });
  assert.equal(r.s, 2);
});
check('S4: a rest day in a planned week — what is next, and a pick to train anyway', () => {
  const r = up({ plan: [P('2026-09-22', 'a'), P('2026-09-27', 'b')], logs: [LOG('a', '2026-09-22')] });
  assert.equal(r.s, 4); assert.equal(r.next.day, '2026-09-27'); assert.equal(r.next.w.id, 'b');
  assert.equal(r.pick.id, 'b', 'the newest never done'); assert.equal(r.again, false);
});
check('S4: the week\'s plan all behind today, nothing ahead — rest, no next, still a pick', () => {
  const r = up({ plan: [P('2026-09-21', 'a')] });
  assert.equal(r.s, 4); assert.equal(r.next, null); assert.equal(r.pick.id, 'a');
});
check('S5: nothing planned this week — the newest save never done', () => {
  const r = up({ workouts: [W('new1'), W('old')], logs: [LOG('old', '2026-09-10')], plan: [P('2026-10-01', 'old')] });
  assert.equal(r.s, 5); assert.equal(r.w.id, 'new1'); assert.equal(r.again, false);
  assert.equal(r.next.day, '2026-10-01', 'next week\'s plan is still named');
});
check('S5: everything done before — do it again, the most recent', () => {
  const r = up({ workouts: [W('a'), W('b')], logs: [LOG('b', '2026-09-20'), LOG('a', '2026-09-12')] });
  assert.equal(r.s, 5); assert.equal(r.w.id, 'b'); assert.equal(r.again, true); assert.equal(r.session.workout_id, 'b');
});
check('S5 skips a card still being read or one that failed', () => {
  const r = up({ workouts: [W('p', { ingest_status: 'processing' }), W('f', { ingest_status: 'failed' }), W('ok')] });
  assert.equal(r.w.id, 'ok');
});
check('S6: an empty library — how to save the first video', () => {
  const r = up({ workouts: [] });
  assert.equal(r.s, 6); assert.equal(r.pending, 0);
});
check('S6: nothing ready yet — says how many are still being read', () => {
  const r = up({ workouts: [W('p', { ingest_status: 'processing' }), W('f', { ingest_status: 'failed' })] });
  assert.equal(r.s, 6); assert.equal(r.pending, 1);
});
check('a plan row for a workout no longer on the shelf is not a plan', () => {
  const r = up({ plan: [P('2026-09-25', 'gone')], workouts: [W('a')] });
  assert.equal(r.s, 5);
});

console.log('   the other days');
const day = (key, d) => run('dayOf(' + JSON.stringify(key) + ', Object.assign(' + JSON.stringify(Object.assign(
  { workouts: [W('a'), W('b'), W('c')], logs: [], plan: [] }, d)) + ', { now: ' + NOW + ' }))');
check('a past day: its sessions, and what was planned and not done is missed', () => {
  const r = day('2026-09-22', { plan: [P('2026-09-22', 'a'), P('2026-09-22', 'b')], logs: [LOG('a', '2026-09-22'), LOG('c', '2026-09-22')] });
  assert.equal(r.when, 'past'); assert.equal(r.sessions.length, 2);
  assert.deepEqual(r.missed.map((m) => m.w.id), ['b']); assert.equal(r.planned.length, 0);
});
check('a future day: what is planned; an empty one says empty', () => {
  const r = day('2026-09-28', { plan: [P('2026-09-28', 'c')] });
  assert.equal(r.when, 'future'); assert.deepEqual(r.planned.map((m) => m.w.id), ['c']); assert.equal(r.empty, false);
  assert.equal(day('2026-09-30', {}).empty, true);
});
check('past the newest 400 logs a planned day is not called missed', () => {
  const logs = Array.from({ length: 400 }, (_, i) => LOG('a', '2026-09-01', 1, { id: 'h' + i }));
  const r = day('2026-08-03', { plan: [P('2026-08-03', 'b')], logs });
  assert.equal(r.missed.length, 0); assert.equal(r.planned.length, 1);
});

console.log('2. Ready to try');
check('never part of a finished session, not reading, not failed, newest first', () => {
  const r = run('readyList(' + JSON.stringify([W('n1'), W('done'), W('p', { ingest_status: 'processing' }), W('f', { ingest_status: 'failed' }),
    W('half'), W('n2')]) + ', ' + JSON.stringify([LOG('done', '2026-09-01'), LOG('half', '2026-09-02', 0)]) + ')');
  assert.deepEqual(r.map((w) => w.id), ['n1', 'half', 'n2'], 'an abandoned session does not take a card off the shelf');
});
check('the shelf, the chip, the picker and Up next read one list (readyToTry)', () => {
  assert(/function readyToTry\(\) \{ return readyList\(state\.workouts, state\.logs\); \}/.test(APP));
});

console.log('3. One status per card');
const st = (w, logs, plan) => run('(function () { var s = workoutStatus(' + JSON.stringify(w) + ', ' + JSON.stringify(logs) + ', ' +
  JSON.stringify(plan) + ', ' + NOW + '); return [s.kind, statusLabel(s, ' + NOW + ')]; })()');
check('new, planned and done, with planned beating done', () => {
  assert.deepEqual(st(W('a'), [], []), ['new', 'New']);
  assert.deepEqual(st(W('a'), [LOG('a', '2026-09-21'), LOG('a', '2026-09-14')], []), ['done', 'Done 2× · Sep 21']);
  assert.deepEqual(st(W('a'), [LOG('a', '2026-09-21')], []), ['done', 'Done · Sep 21']);
  // Six days out is still this side of a week, so it is named by its weekday.
  assert.deepEqual(st(W('a'), [LOG('a', '2026-09-21')], [P('2026-10-01', 'a')]), ['planned', 'Planned Thu']);
});
check('planned days in words: today, tomorrow, a weekday, then a date', () => {
  assert.deepEqual(st(W('a'), [], [P('2026-09-25', 'a')]), ['planned', 'Planned today']);
  assert.deepEqual(st(W('a'), [], [P('2026-09-26', 'a')]), ['planned', 'Planned tomorrow']);
  assert.equal(st(W('a'), [], [P('2026-09-29', 'a')])[1], 'Planned ' + new Date(2026, 8, 29).toLocaleDateString(undefined, { weekday: 'short' }));
  assert.deepEqual(st(W('a'), [], [P('2026-10-08', 'a'), P('2026-10-02', 'a')]), ['planned', 'Planned Oct 2'], 'the nearest');
});
check('a fortnight ahead and no further; today\'s row stops counting once today trained it', () => {
  assert.equal(st(W('a'), [], [P('2026-10-08', 'a')])[0], 'planned', 'today + 13');
  assert.equal(st(W('a'), [], [P('2026-10-09', 'a')])[0], 'new', 'today + 14 is past the read');
  assert.equal(st(W('a'), [], [P('2026-09-24', 'a')])[0], 'new', 'yesterday\'s row is not ahead');
  assert.deepEqual(st(W('a'), [LOG('a', '2026-09-25')], [P('2026-09-25', 'a')]), ['done', 'Done · today']);
});

console.log('4. The Plan sheet\'s fortnight');
check('fourteen days from today, across the end of a month', () => {
  const d = run('planDays(new Date(2026, 8, 25, 12))');
  assert.equal(d.length, 14); assert.equal(d[0], '2026-09-25'); assert.equal(d[5], '2026-09-30'); assert.equal(d[6], '2026-10-01');
  assert.equal(d[13], '2026-10-08');
});
check('across a daylight-saving change, every day once and in order', () => {
  // US clocks go back on 1 Nov 2026 and forward on 8 Mar 2027; late-night starts are the risky ones.
  for (const start of ['new Date(2026, 9, 25, 23, 30)', 'new Date(2027, 2, 1, 0, 15)', 'new Date(2026, 11, 28, 23, 59)']) {
    const d = run('planDays(' + start + ')');
    assert.equal(new Set(d).size, 14, start);
    for (let i = 1; i < 14; i++) {
      const gap = (new Date(d[i] + 'T12:00:00') - new Date(d[i - 1] + 'T12:00:00')) / 86400000;
      assert.equal(Math.round(gap), 1, start + ': ' + d[i - 1] + ' → ' + d[i]);
    }
  }
});

console.log('5. The ready sheet on launch');
const pick = (ws, logs, draft, seen, busy) => run('(function () { var w = readyPick(' + JSON.stringify(ws) + ', ' + JSON.stringify(logs) + ', ' +
  JSON.stringify(draft) + ', ' + JSON.stringify(seen) + ', ' + NOW + ', ' + !!busy + '); return w && w.id; })()');
const R = (id, at, extra) => W(id, Object.assign({ created_at: at }, extra));
check('the newest card saved in the last day, ready, never started, never shown', () => {
  assert.equal(pick([R('old', '2026-09-23T10:00:00'), R('a', '2026-09-25T08:00:00'), R('b', '2026-09-25T09:00:00')], [], null, {}), 'b');
});
check('once per card; not a started one; not one still reading; nothing over a workout', () => {
  const ws = [R('a', '2026-09-25T08:00:00'), R('b', '2026-09-25T09:00:00')];
  assert.equal(pick(ws, [], null, { b: 1 }), 'a', 'b has had its sheet');
  assert.equal(pick(ws, [LOG('b', '2026-09-25', 0)], null, {}), 'a', 'b was started');
  assert.equal(pick(ws, [], { workoutId: 'b' }, {}), 'a', 'b is paused');
  assert.equal(pick([R('p', '2026-09-25T09:00:00', { ingest_status: 'processing' })], [], null, {}), null);
  assert.equal(pick(ws, [], null, {}, true), null, 'Workout Mode is up');
  assert.equal(pick([R('x', '2026-09-24T11:00:00')], [], null, {}), null, 'older than a day');
});

console.log('6. One door for the next set');
check('the Lock Screen and the wrist go through logNextSet, not a copy of it', () => {
  const live = fn('liveAction');
  assert(/logNextSet\(\{ reps: a\.reps, weight: a\.weight/.test(live), 'liveAction\'s set branch calls logNextSet');
  assert(!/setPrefill\(/.test(live), 'and no longer prefills on its own');
  const door = fn('logNextSet');
  assert(/saveSet\(\);/.test(door) && /setEvents\.indexOf\(opts\.id\)/.test(door), 'one saveSet, and an event id is remembered');
  assert(!/\$\(|document\.|toast\(/.test(door), 'nothing in it reaches for the screen');
});
check('an event id makes a replay harmless; a hold is answered "screen"; nothing running is "idle"', () => {
  const c = vm.createContext({ Date, Math, JSON, console, isFinite });
  vm.runInContext(`
    var wo = null, setCtx = { idx: 0, reps: 0, weight: 0 }, stepRows = null, ssHeld = null, saved = [];
    function isTimed(ex) { return !!(ex && ex.duration_seconds && !ex.reps); }
    function setPrefill(idx) { return { idx: idx, reps: 8, weight: 60 }; }
    function setReps(n) { setCtx.reps = n; } function setWeight(n) { setCtx.weight = n; }
    function saveSet() { var e = wo.entries[wo.i]; e.sets[setCtx.idx] = { reps: setCtx.reps, weight: setCtx.weight }; saved.push(setCtx.idx); }
  ` + fn('ssIdx') + fn('nextSet') + decl('setEvents') + fn('logNextSet'), c);
  const x = (js) => JSON.parse(JSON.stringify(vm.runInContext(js, c)));
  assert.equal(x('logNextSet({})').why, 'idle');
  vm.runInContext('wo = { finished: false, i: 0, screens: [{ ex: { name: "Row", reps: "8" } }, { ex: { name: "Plank", duration_seconds: 30 } }],' +
    ' entries: [{ sets: [] }, { sets: [] }] }', c);
  let r = x('logNextSet({ id: "e1" })');
  assert.deepEqual([r.ok, r.idx, r.reps, r.weight], [true, 0, 8, 60]);
  assert.equal(x('logNextSet({ id: "e1" })').why, 'seen', 'the same tap delivered twice logs once');
  r = x('logNextSet({ id: "e2", reps: 10, weight: 65 })');
  assert.deepEqual([r.idx, r.reps, r.weight], [1, 10, 65], 'a dialled figure wins; the set is the next one');
  vm.runInContext('wo.entries[0].sets = [null, { reps: 8 }]', c);
  assert.equal(x('logNextSet({})').idx, 0, 'the first set not yet done, so no hole is left behind');
  vm.runInContext('wo.i = 1', c);
  assert.equal(x('logNextSet({})').why, 'screen', 'a hold is started on the phone, not logged from afar');
});

console.log('7. The segment memory');
check('"calendar" (stored before the month moved into the strip) reads as Progress', () => {
  assert.equal(run('SEGS.map(function (s) { return s[0]; }).join()'), 'progress,records');
  assert.equal(run('(function () { state.profile = { settings: { trainSeg: "calendar" } }; return readTrainSeg(); })()'), 'progress');
  assert.equal(run('(function () { state.profile = { settings: { trainSeg: "records" } }; return readTrainSeg(); })()'), 'records');
});

console.log('8. The wording scan');
// What a person can read: markup text and its labels, and the string literals of
// app.ts and index.ts outside comments. Code words (ids, classes, view names,
// storage keys) are lower-case single words and never match these phrases.
const RETIRED = [
  [/Save workout/, 'Add video (adding) or Finish workout (ending)'],
  // A label built at runtime starts as a bare "Block " or "Week " literal.
  [/\bBlock (\d|$)/, 'Section'],
  [/Schedule/, 'Plan'],
  [/Favourite/, 'Favorite (one US spelling)'],
  // Any case, in a phrase: "library" alone is the view's code name.
  [/\blibrary\b/i, 'Workouts', 'phrase'],
  [/Review \/ Edit|Fix this exercise/, 'Edit exercise'],
  [/Watch this bit|Watch original \/ source|Open original/, 'Watch this part / Watch original'],
  [/\bWeek (\d|$)/, 'the date range, or "3-week streak"'],
];
// Allowed on purpose, each with its reason. Keep it short.
const ALLOW = [
  // Apple's own name for the phone's photo store, on the upload row.
  /Photo Library/,
  // Pumpy's snapshot and tool notes are read by the model, not by a person.
  /^LIBRARY\b/, /^The snapshot already lists the library/,
];
function literals(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, s = '';
      for (; j < src.length && src[j] !== c; j++) {
        // A quote or an apostrophe in a regex or a comment is no string: a real
        // one ends on its own line, and a line end first puts the scan back in step.
        if (c !== '`' && src[j] === '\n') break;
        if (src[j] === '\\') { s += src[j + 1]; j++; } else s += src[j];
      }
      if (src[j] !== c) continue;
      out.push({ s, at: src.slice(0, i).split('\n').length });
      i = j;
    }
  }
  return out;
}
function markupText(src) {
  const out = [];
  const body = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const re = />([^<]+)<|(?:aria-label|title|placeholder|alt)="([^"]*)"/g;
  let m;
  while ((m = re.exec(body))) {
    const s = (m[1] || m[2] || '').trim();
    if (s) out.push({ s, at: body.slice(0, m.index).split('\n').length });
  }
  return out;
}
function scan(label, items) {
  const hits = [];
  for (const { s, at } of items) {
    if (ALLOW.some((re) => re.test(s))) continue;
    for (const [re, say, phrase] of RETIRED) {
      if (phrase && !/\s/.test(s)) continue;
      if (re.test(s)) hits.push(label + ':' + at + ' "' + s.slice(0, 70) + '" → ' + say);
    }
  }
  return hits;
}
// app.ts's literals include its String.raw template's markup-in-strings; the app
// module is one template, so its body is scanned as JavaScript.
const appBody = APP.slice(APP.indexOf('String.raw`') + 11);
check('no retired label in the markup', () => {
  const hits = scan('markup.ts', markupText(MARKUP));
  assert.equal(hits.length, 0, hits.length + ' hit(s):\n' + hits.join('\n'));
});
check('no retired label in app.ts strings (toasts, tips, buttons, the Quick guide, labels)', () => {
  const hits = scan('app.ts', literals(appBody));
  assert.equal(hits.length, 0, hits.length + ' hit(s):\n' + hits.join('\n'));
});
check('no retired label in what the server says to a person (messages, Pumpy\'s status lines)', () => {
  // Server strings that reach a screen: messages, errors on cards, Pumpy's status.
  const hits = scan('index.ts', literals(INDEX).filter(({ s }) => /\s/.test(s) && /^[A-Z"“]/.test(s)));
  assert.equal(hits.length, 0, hits.length + ' hit(s):\n' + hits.join('\n'));
});

console.log('\n' + checks + ' simplify-b checks passed' + (failed ? ', ' + failed + ' FAILED' : ''));
if (failed) process.exitCode = 1;
