// Offline checks for supersets in Workout Mode, run against the real source.
//
// The functions are lifted out of app.ts the way tools/complex-harness.mjs lifts
// its own and run in a vm with the DOM stubbed out: detection, the ping-pong
// order, the rest chosen at each hand-over, the round read back off the log, a
// set arriving from the Lock Screen, and a paused session coming back on the same
// member. What is stubbed is only what draws — renderWorkout, the sheets, the
// rest strip — and each stub records what it was asked to do.
//
//   node tools/superset-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');

// A top-level function by its first declaration: a one-liner is its own line,
// anything else runs to the closing brace at the IIFE's indent.
function fn(name) {
  const a = src.indexOf('\n  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  const line = src.slice(a + 1, src.indexOf('\n', a + 1));
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  const b = src.indexOf('\n  }\n', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return src.slice(a + 1, b + 4);
}

const LIFTED = ['isTimed', 'supersetOf', 'cxDosed', 'cxCap', 'complexOf', 'isCircuit', 'roundsOf', 'roundOf',
  'targetOf', 'restOf', 'restWord', 'clock', 'kindName', 'blockMetaText', 'flatten', 'isStop', 'endStop',
  'stopDone', 'stopOf', 'setUnit', 'ssMembers', 'ssDone', 'ssTurn', 'ssName', 'ssIdx', 'ssSum', 'askText',
  'setText', 'wtText', 'doseText', 'timeText', 'ssLogged', 'saveSet', 'setPrefill', 'setNum', 'setReps',
  'setWeight', 'plate', 'clamp', 'liveAction', 'logNextSet', 'liveState', 'blockName', 'draftOf', 'woGo', 'logHold', 'workDone',
  'nextSet', 'goState', 'stopFull', 'wtUnit'];

// Everything the lifted code reaches for that draws or talks to the device.
// Each records what it was asked, which is what the checks below read.
const STUBS = `
var state = { unit: "lb", haptics: true }, hist = {}, wo = null, REST_FALLBACK = 90, native = null;
var setCtx = { idx: 0, reps: 10, weight: 0 }, justSet = -1, woPhase = "idle";
var restUntil = 0, restTotal = 0, restHeld = 0, restFace = null, restThen = null, ssHand = false;
var stepRows = null, ssHeld = null, setEvents = [];
var log = [];
function capWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function exKey(e) { return e && e.canonical_id ? "c:" + e.canonical_id : "n:" + ((e && e.name) || ""); }
function toUnit(w) { return Number(w) || 0; }
function guideLearn() {} function endEdit() {} function unlockAudio() {} function drawStepper() {}
function prCheck() { return false; }
// The dumbbell rule is each-harness's to check; here every movement is a barbell.
function eachOf() { return false; }
function haptic(k) { log.push("haptic:" + k); }
function toast(t) { log.push("toast:" + t); }
function closeSheet(id) { log.push("close:" + id); }
function renderWorkout() { log.push("render:" + wo.i); }
function saveDraft() { log.push("draft:" + wo.i); }
function startRest(secs) { restUntil = Date.now() + secs * 1000; restTotal = secs * 1000; log.push("rest:" + secs); }
function stopRest() { restUntil = 0; log.push("stoprest"); }
function stopWork() { woPhase = "idle"; }
function nextMove() { log.push("next"); woGo(1); }
function setTimeout(f) { log.push("later"); }
function cxLive() { return null; }
function openLink() {} function woForward() {}
`;

const ctx = vm.createContext({ assert, Date, console });
vm.runInContext(STUBS + '\n' + LIFTED.map(fn).join('\n'), ctx);
function run(code) {
  const v = vm.runInContext(code, ctx);
  if (!v || typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

let checks = 0;
function ok(what, f) { f(); checks++; console.log('  ok  ' + what); }

// ---------- fixtures ----------

const reps = (name, over) => Object.assign({ name, sets: null, reps: '10', duration_seconds: null, rest_seconds: null }, over || {});
const held = (name, secs) => ({ name, sets: null, reps: null, duration_seconds: secs, rest_seconds: null });
const superset = (members, over) => Object.assign({ title: null, type: 'superset', rounds: 3, rest_seconds: null, exercises: members }, over || {});
const straight = { title: 'Finisher', type: 'straight', rounds: null, rest_seconds: null, exercises: [reps('Push Up', { sets: 2 })] };

// A session on a card, entries parallel to the screens as startWorkout builds them.
function session(blocks) {
  run('wo = { workout: { id: "w1", title: "Fixture", blocks: ' + JSON.stringify(blocks) + ' }, i: 0, rounds: {}, amrap: {}, prs: {}, finished: false, startedAt: "2026-09-23T10:00:00Z" };' +
    'wo.screens = flatten(wo.workout);' +
    'wo.entries = wo.screens.map(function (s) { return { name: s.ex.name, canonical_id: null, block: s.bi, exercise: s.ei, sets: [] }; });' +
    'log = []; restUntil = 0; restFace = null; setCtx = { idx: 0, reps: 10, weight: 0 }; justSet = -1;');
}

// Workout Mode's big button: setCtx is what the open panel's docked steppers hold
// for its member's next set (stepDock), and the button logs through logNextSet,
// which reads that dock rather than the prefill.
function tap(r, w) {
  run('setCtx.idx = ssIdx(wo.entries[wo.i]); setCtx.reps = ' + (r || 10) + '; setCtx.weight = ' + (w || 0) + ';' +
    ' stepRows = [{ parentNode: { _wo: wo, _k: wo.i, _idx: setCtx.idx } }]; logNextSet({ source: "app" }); stepRows = null;');
  return run('wo.i');
}

const letters = (i) => run('wo.screens[' + i + '] ? wo.screens[' + i + '].ex.name : null');

// ---------- 1. detection ----------

console.log('detection');

ok('a superset is found by its type or its title, with two movements or more', () => {
  const d = (b) => run('supersetOf(' + JSON.stringify(b) + ', {})');
  assert.deepEqual(d(superset([reps('A'), reps('B')])), { n: 2 });
  assert.deepEqual(d({ type: 'straight', title: 'Superset A', exercises: [reps('A'), reps('B')] }), { n: 2 });
  assert.deepEqual(d({ type: 'straight', title: 'Tri-set', exercises: [reps('A'), reps('B'), reps('C')] }), { n: 3 });
  assert.deepEqual(d({ type: 'circuit', title: 'Giant set', rounds: 3, exercises: [reps('A'), reps('B'), reps('C'), reps('D')] }), { n: 4 });
  assert.deepEqual(d({ type: 'straight', title: 'Upper supersets', exercises: [reps('A'), reps('B')] }), { n: 2 });
  assert.deepEqual(d({ type: 'straight', title: 'Super set', exercises: [reps('A'), reps('B')] }), { n: 2 });
  assert.deepEqual(d({ type: 'straight', title: 'Trisets', exercises: [reps('A'), reps('B'), reps('C')] }), { n: 3 });
});

ok('and is not found where something else owns the block', () => {
  const d = (b, w) => run('supersetOf(' + JSON.stringify(b) + ', ' + JSON.stringify(w || {}) + ')');
  assert.equal(d(superset([reps('A')])), null, 'one movement is not a superset');
  assert.equal(d(straight), null, 'straight sets keep the behaviour they had');
  assert.equal(d({ type: 'straight', title: 'Superman holds', exercises: [reps('A'), reps('B')] }), null, 'a word that merely starts with super');
  assert.equal(d({ type: 'amrap', title: 'Superset', exercises: [reps('A'), reps('B')] }), null, 'an AMRAP is a complex, whatever it is called');
  const capped = { type: 'circuit', title: 'Giant set', rounds: null, exercises: [reps('A'), reps('B')] };
  assert.equal(d(capped, { duration_minutes: 12, blocks: [capped] }), null,
    'a dosed circuit with a clock is a complex: complexOf wins');
  assert.equal(d(superset([held('Plank', 45), held('Hollow hold', 30)])), null, 'all timed is an interval circuit and keeps its countdown');
  assert.equal(d({ type: 'emom', title: 'Superset EMOM', exercises: [reps('A'), reps('B')] }), null, 'EMOM waits for its own clock');
  // The two things the old engine did to a superset, both gone.
  assert.equal(run('isCircuit(' + JSON.stringify(superset([reps('A'), reps('B')])) + ')'), false,
    'rounds > 1 no longer makes a superset a circuit pager');
  assert.equal(run('isCircuit(' + JSON.stringify({ type: 'circuit', rounds: 3, exercises: [reps('A'), reps('B')] }) + ')'), true,
    'a circuit is still a circuit');
  assert.equal(run('isCircuit(' + JSON.stringify(superset([held('Plank', 45), held('Hollow', 30)])) + ')'), true,
    'and an all-timed superset still runs as one');
});

ok('one stop per superset; every member a screen; targets its own sets, else rounds, else 3', () => {
  session([straight, superset([reps('A', { sets: 4 }), reps('B'), reps('C')], { rounds: null }), straight]);
  assert.deepEqual(run('wo.screens.map(function (s, i) { return isStop(i); })'), [true, true, false, false, true]);
  assert.deepEqual(run('wo.screens.map(function (s, i) { return stopOf(i); })'), [0, 1, 1, 1, 4]);
  assert.equal(run('endStop()'), 4);
  assert.deepEqual(run('wo.screens.map(targetOf)'), [2, 4, 3, 3, 2]);
  session([superset([reps('A', { sets: 5 }), reps('B')], { rounds: 4 })]);
  assert.deepEqual(run('wo.screens.map(targetOf)'), [5, 4], 'a member\'s own sets, then the block\'s rounds');
  run('wo.entries[1].sets = [{ reps: 8, done: true }];');
  assert.equal(run('stopDone(0)'), true, 'any member logged lights the superset\'s one dot');
  assert.equal(run('ssName(wo.screens[0])'), 'Superset');
  session([superset([reps('A'), reps('B'), reps('C')])]);
  assert.equal(run('ssName(wo.screens[0])'), 'Tri-set');
  session([superset([reps('A'), reps('B'), reps('C'), reps('D')], { title: 'Arms' })]);
  assert.equal(run('ssName(wo.screens[0])'), 'Arms', 'the block\'s own title first');
});

// ---------- 2. the ping-pong ----------

console.log('the ping-pong');

ok('two members: A B A B A B, then on to the next stop', () => {
  session([superset([reps('A'), reps('B')]), straight]);
  const order = [letters(0)];
  for (let n = 0; n < 6; n++) order.push(letters(tap()));
  assert.deepEqual(order, ['A', 'B', 'A', 'B', 'A', 'B', 'Push Up']);
  assert.ok(run('log').includes('next'), 'finished, it moves on exactly as straight sets do');
});

ok('three and four members go round in order', () => {
  session([superset([reps('A'), reps('B'), reps('C')], { rounds: 2 }), straight]);
  const three = [letters(0)];
  for (let n = 0; n < 6; n++) three.push(letters(tap()));
  assert.deepEqual(three, ['A', 'B', 'C', 'A', 'B', 'C', 'Push Up']);
  session([superset([reps('A'), reps('B'), reps('C'), reps('D')], { rounds: 2 }), straight]);
  const four = [letters(0)];
  for (let n = 0; n < 8; n++) four.push(letters(tap()));
  assert.deepEqual(four, ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'Push Up']);
});

ok('five and more do not break', () => {
  session([superset(['A', 'B', 'C', 'D', 'E', 'F'].map((x) => reps(x)), { rounds: 1 })]);
  const six = [letters(0)];
  for (let n = 0; n < 6; n++) six.push(letters(tap()));
  assert.deepEqual(six, ['A', 'B', 'C', 'D', 'E', 'F', 'F'], 'the last member stays open at the end of the card');
  assert.equal(run('ssTurn(wo.i, 0).done'), true);
});

ok('unequal sets: A 4, B 3 goes A B A B A B A', () => {
  session([superset([reps('A', { sets: 4 }), reps('B', { sets: 3 })], { rounds: null }), straight]);
  const order = [letters(0)];
  for (let n = 0; n < 7; n++) order.push(letters(tap()));
  assert.deepEqual(order, ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'Push Up']);
});

ok('a finished member is skipped, and one fallen behind is caught up', () => {
  session([superset([reps('A', { sets: 2 }), reps('B', { sets: 3 }), reps('C', { sets: 3 })], { rounds: null })]);
  for (let n = 0; n < 6; n++) tap(); // A B C A B C
  assert.equal(letters(run('wo.i')), 'B', 'round 3 skips A, which had two');
  assert.equal(letters(tap()), 'C');
  // The lifter taps A open (manual override) and does two in a row.
  session([superset([reps('A'), reps('B')])]);
  tap();                       // A1 -> B
  run('wo.i = 0;');            // opened A by hand
  assert.equal(letters(tap()), 'B', 'A2 hands to B, which is owed round 1');
  assert.equal(letters(tap()), 'B', 'B1 closes round 1, and B is still owed round 2 before A');
  assert.equal(run('ssTurn(wo.i, 0).round'), 2);
});

ok('the round is read off the log, not counted beside it', () => {
  session([superset([reps('A'), reps('B')])]);
  const r = () => run('[ssTurn(wo.i, 0).round, ssTurn(wo.i, 0).rounds]');
  assert.deepEqual(r(), [1, 3]);
  tap(); assert.deepEqual(r(), [1, 3], 'A done, B owed: still round 1');
  tap(); assert.deepEqual(r(), [2, 3]);
  run('wo.entries[0].sets = [{ reps: 10 }, { reps: 10 }, { reps: 10 }]; wo.entries[1].sets = [{ reps: 10 }];');
  assert.deepEqual(r(), [2, 3], 'the fewest sets any unfinished member has, plus one');
  run('wo.entries[1].sets.pop();');
  assert.deepEqual(r(), [1, 3], 'a set cleared takes the round back with it');
  assert.equal(run('ssTurn(0, 0).up'), 1, 'and the superset is entered at the member that round is owed by');
});

// ---------- 3. the rest ----------

console.log('the rest at each hand-over');

ok('between members: the member\'s own, else none; after a round: the block\'s, else the default', () => {
  const rests = (blk) => {
    session([blk]);
    const out = [];
    for (let n = 0; n < 4; n++) {
      run('log = [];');
      tap();
      const r = run('log').filter((x) => x.startsWith('rest:'))[0];
      out.push(r ? Number(r.slice(5)) : 0);
    }
    return out;
  };
  assert.deepEqual(rests(superset([reps('A'), reps('B')])), [0, 90, 0, 90], 'nothing stated: back to back, then REST_FALLBACK');
  assert.deepEqual(rests(superset([reps('A', { rest_seconds: 20 }), reps('B', { rest_seconds: 45 })], { rest_seconds: 120 })), [20, 120, 20, 120],
    'stated: the member\'s own between, the block\'s at the end of the round');
  assert.deepEqual(rests(superset([reps('A'), reps('B')], { rest_seconds: 0 })), [0, 0, 0, 0], 'zero is an answer');
  // The card's pill reads the same rule, so the two cannot disagree.
  const pill = (ex, b, end) => run('restOf(' + JSON.stringify(ex) + ', ' + JSON.stringify(b) + ', ' + end + ')');
  assert.deepEqual(pill(reps('A'), superset([reps('A'), reps('B')]), false), { secs: 0, source: 'default' });
  assert.deepEqual(pill(reps('A', { rest_seconds: 30 }), superset([reps('A'), reps('B')]), false), { secs: 30, source: 'exercise' });
  assert.deepEqual(pill(reps('A'), superset([reps('A'), reps('B')], { rest_seconds: 75 }), true), { secs: 75, source: 'block' });
  assert.equal(run('blockMetaText(' + JSON.stringify(superset([reps('A'), reps('B')], { rest_seconds: 60 })) + ')'),
    'Superset · 3 rounds · Rest 1:00 between rounds');
  assert.equal(run('blockMetaText(' + JSON.stringify(superset([reps('A', { sets: 3 }), reps('B', { sets: 3 })], { rounds: null })) + ')'),
    'Superset · Rest 1:30 between rounds · default', 'a superset without rounds still says what rests after its last member');
});

ok('a rest running when a back-to-back set is logged is over; a correction neither rests nor moves', () => {
  session([superset([reps('A'), reps('B')])]);
  tap(); tap();                           // round 1 done, 90 s running
  assert.ok(run('restUntil') > 0);
  run('log = [];');
  tap();                                  // A2, no rest between members
  assert.ok(run('log').includes('stoprest'), 'the strip stops rather than counting past a set');
  run('log = []; var was = wo.i; setCtx.idx = 0; setCtx.reps = 12; saveSet();');
  assert.equal(run('wo.i'), run('was'), 'correcting B1 through the sheet stays on B');
  assert.ok(!run('log').some((x) => x.startsWith('rest:')), 'and starts no rest');
  assert.equal(run('wo.entries[1].sets[0].reps'), 12);
  assert.equal(run('ssIdx(wo.entries[1])'), 1, 'B\'s button still offers set 2');
});

ok('a hand-over saves the draft and buzzes after the set\'s own buzz', () => {
  session([superset([reps('A'), reps('B')])]);
  run('log = [];');
  tap();
  const l = run('log');
  assert.deepEqual(l.filter((x) => x.startsWith('draft:')).slice(-1), ['draft:1'], 'the draft (and the Lock Screen with it) says B');
  assert.ok(l.indexOf('haptic:success') >= 0 && l.indexOf('later') > l.indexOf('haptic:success'), 'success now, the tap a beat later');
  assert.equal(run('justSet'), 0, 'the logged pill is the one that pops');
});

// ---------- 4. from off the phone ----------

console.log('from the Lock Screen and the wrist');

ok('liveAction({ kind: "set" }) hands over exactly like the big button on the panel\'s figures', () => {
  const byTap = [], byRemote = [];
  session([superset([reps('A'), reps('B')], { rounds: 2 }), straight]);
  for (let n = 0; n < 4; n++) byTap.push([tap(12, 50), run('log.filter(function (x) { return x.indexOf("rest:") === 0; }).length')]);
  const tapSets = run('wo.entries.map(function (e) { return e.sets.map(function (s) { return [s.reps, s.weight]; }); })');
  session([superset([reps('A'), reps('B')], { rounds: 2 }), straight]);
  for (let n = 0; n < 4; n++) {
    run('liveAction({ kind: "set", reps: 12, weight: 50 });');
    byRemote.push([run('wo.i'), run('log.filter(function (x) { return x.indexOf("rest:") === 0; }).length')]);
  }
  const remoteSets = run('wo.entries.map(function (e) { return e.sets.map(function (s) { return [s.reps, s.weight]; }); })');
  assert.deepEqual(byRemote, byTap, 'same members opened, same rests started, in the same order');
  assert.deepEqual(remoteSets, tapSets, 'and the same sets written');
  // One button for every panel: ssLive draws none of its own, the big button's
  // tap goes through logNextSet (the dialled figures above are the dock's), and
  // saveSet is where the hand-over lives.
  assert.ok(!fn('ssLive').includes('saveSet') && fn('logTap').includes('logNextSet({ source: "app" })'));
  assert.ok(/if \(ssLogged\(fresh, setCtx\.idx\)\) return;\n\s+closeSheet\("setsheet"\);/.test(fn('saveSet')));
  assert.ok(fn('workDone').includes('if (ssLogged(true, wo.entries[wo.i].sets.length - 1)) return;'), 'a hold hands over the same way');
});

ok('the island shows the member now open, and names the one after it', () => {
  session([superset([reps('A'), reps('B'), reps('C')], { title: 'Upper' }), straight]);
  let st = run('liveState()');
  assert.equal(st.exercise, 'A');
  assert.equal(st.next, 'B', 'the member this set hands to, not the next screen');
  assert.deepEqual(st.set, { index: 1, total: 3 });
  tap(); tap();
  st = run('liveState()');
  assert.equal(st.exercise, 'C');
  assert.equal(st.next, 'A', 'round two comes back to the top');
  assert.equal(st.dose.loggable, true);
  assert.equal(st.block, 'Upper');
});

// The button's label, the Lock Screen's card and a Log set from it all read
// nextSet(), so the three name one set at one dose — the review's two cases.
ok('a weight dialled on the open panel: the button says it, the Lock Screen offers it, a Log set there logs it', () => {
  session([superset([reps('A'), reps('B')]), straight]);
  // Panel A's steppers are docked and turned to 30 lb for its set 1.
  const dock = 'stepRows = [{ parentNode: { _wo: wo, _k: wo.i, _idx: 0 } }];';
  run('setCtx.idx = 0; setCtx.reps = 10; setCtx.weight = 30;' + dock);
  assert.equal(run('goState()[1]'), 'Log set 1 · 10 × 30 lb');
  const st = run('liveState()');
  assert.deepEqual([st.set, st.weight, st.dose.reps, st.dose.weight], [{ index: 1, total: 3 }, '30 lb', 10, 30],
    'the card draws the panel\'s figures, not the prefill\'s bare 10 reps');
  // Log set with the card's dial untouched sends no figures, and logs what the card showed.
  run('liveAction({ kind: "set", source: "activity", id: null }); stepRows = null;');
  assert.deepEqual(run('[wo.entries[0].sets[0].reps, wo.entries[0].sets[0].weight]'), [10, 30]);
  // A figure turned on the wrist wins; the one left alone is still the panel's.
  session([superset([reps('A'), reps('B')])]);
  run('setCtx.idx = 0; setCtx.reps = 10; setCtx.weight = 30;' + dock + ' liveAction({ kind: "set", source: "watch", reps: 8 }); stepRows = null;');
  assert.deepEqual(run('[wo.entries[0].sets[0].reps, wo.entries[0].sets[0].weight]'), [8, 30]);
  // Lent to the set sheet for a moment (a pill tapped), the panel's figures are
  // held for it, and they are still what its next set means everywhere.
  session([superset([reps('A'), reps('B')])]);
  run('ssHeld = { wo: wo, key: "0:0", reps: 12, weight: 40 }; stepRows = [{ parentNode: {} }];');
  assert.equal(run('goState()[1]'), 'Log set 1 · 12 × 40 lb');
  assert.deepEqual(run('[liveState().dose.reps, liveState().dose.weight]'), [12, 40]);
  run('ssHeld = null; stepRows = null;');
});

ok('set 2 logged before set 1: the button, the Lock Screen and a Log set there all mean set 1, at one dose', () => {
  session([{ title: null, type: 'straight', rounds: null, rest_seconds: null, exercises: [reps('Row', { sets: 4, reps: '8' })] }]);
  run('wo.entries[0].sets = [undefined, { reps: 8, weight: 95, unit: "lb", done: true }];');
  assert.equal(run('goState()[1]'), 'Log set 1 · 8 reps');
  const st = run('liveState()');
  assert.deepEqual(st.set, { index: 1, total: 4 }, 'not "Set 2 of 4"');
  assert.deepEqual([st.dose.reps, st.dose.weight, st.weight], [8, 0, null], 'not the 95 lb of the set after the hole');
  assert.deepEqual(st.progress, { done: 1, total: 4 });
  run('liveAction({ kind: "set", source: "activity", id: null });');
  assert.deepEqual(run('[wo.entries[0].sets[0].reps, wo.entries[0].sets[0].weight]'), [8, null], 'the hole is the set logged');
  assert.equal(run('liveState().set.index'), 3, 'and the card moves on to the first set still owed');
});

// ---------- 5. pausing and coming back ----------

console.log('pausing and coming back');

ok('a paused session reopens the same member on the same round', () => {
  session([straight, superset([reps('A'), reps('B'), reps('C')]), straight]);
  run('wo.i = 1;');
  tap(); tap(); tap(); tap();              // A B C A: round 2, B open
  const before = run('[wo.i, ssTurn(wo.i, 0).round]');
  const draft = run('JSON.stringify(draftOf())');
  // startWorkout's own line for where a saved index lands, run on the draft.
  const land = /\n\s+(while \(wo\.i > 0 && !isStop\(wo\.i\) && !wo\.screens\[wo\.i\]\.ss\) wo\.i--;)/.exec(fn('startWorkout'));
  assert.ok(land, 'startWorkout lands a saved index with this line');
  run('var d = JSON.parse(' + JSON.stringify(draft) + '); wo = { workout: { blocks: d.blocks }, i: d.i, entries: d.entries, rounds: d.rounds, amrap: {} };' +
    'wo.screens = flatten(wo.workout);' + land[1]);
  assert.deepEqual(run('[wo.i, ssTurn(wo.i, 0).round]'), before, 'B, round 2');
  assert.equal(letters(run('wo.i')), 'B');
  // A complex's inner movement still walks back to its first, as it did.
  assert.ok(fn('isStop').includes('!(s.cx || s.ss) || !s.ei'));
});

ok('the arrows and the swipe leave a superset from its first member and enter it where it is owed', () => {
  session([straight, superset([reps('A'), reps('B')]), straight]);
  run('wo.i = 2;');                        // B open by hand
  run('woGo(-1);');
  assert.equal(run('wo.i'), 0, 'back from B leaves the block, not onto A');
  run('wo.entries[1].sets = [{ reps: 10 }];');
  run('woGo(1);');
  assert.equal(letters(run('wo.i')), 'B', 'forward into it opens the member round 1 is owed by');
  run('woGo(1);');
  assert.equal(run('wo.i'), 3, 'and forward again leaves it');
});

console.log('\nsuperset-harness: ' + checks + ' checks passed');
