// Offline checks for the complex / AMRAP rules, run against the real source.
//
// The functions are lifted out of app.ts the way tools/progress-harness.mjs lifts
// its own — but without playwright, which is not a dependency of this repo. There
// is no DOM in anything checked here: detection, the score arithmetic, the shape
// of the sets a round writes into workout_logs and the clock's remaining time are
// all pure, which is exactly why they were written as pure functions.
//
//   node tools/complex-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');

function fn(name) {
  const a = src.indexOf('  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  const b = src.indexOf('\n  }', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return src.slice(a, b + 4);
}

const LIFTED = ['isTimed', 'cxDosed', 'cxCap', 'complexOf', 'isStop', 'endStop', 'stopDone',
  'cxOf', 'cxLeft', 'cxMarks', 'cxCurrent', 'cxEntry', 'cxSet', 'cxSync', 'cxScore',
  'cxDelta', 'cxScoreOf', 'cxLogged', 'flatten'];

// The three things the lifted code reaches for that are not in this file's scope.
const STUBS = [
  'var state = { unit: "lb" }, hist = {}, wo = null;',
  'function exKey(e) { return e && e.canonical_id ? "c:" + e.canonical_id : "n:" + ((e && e.name) || ""); }',
  'function toUnit(w, u) { return Number(w) || 0; }'
].join('\n');

const ctx = vm.createContext({ assert, Date, Math, String, Number, JSON, console });
vm.runInContext(STUBS + '\n' + LIFTED.map(fn).join('\n'), ctx);

// Objects that come back out of the sandbox belong to its realm, and deepEqual
// compares prototypes. A round trip through JSON hands them over as plain ones.
function run(code) {
  const v = vm.runInContext(code, ctx);
  if (!v || typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

// ---------- fixtures ----------
//
// The shape of @thewodfather's "Complex Fives" as the card carries it after the
// Video Context Pack: an amrap block, five movements dosed in reps with no set
// count, the cap living on the card's duration_minutes.
const MOVES = [
  ['Close Grip Push Ups', 'diamond-push-up',
    'hands on the kettlebell handle instead of the floor, which narrows the grip and adds a balance demand'],
  ['Deadlift With A High Pull', 'sumo-deadlift-high-pull',
    'single kettlebell between the feet rather than a barbell; the pull finishes at the upper chest'],
  ['Kettlebell Swings', 'kettlebell-swing', null],
  ['Goblet Squats', 'goblet-squat', null],
  ['Push Press', 'push-press', null]
];

const complex = (over) => Object.assign({
  title: 'Complex', type: 'amrap', rounds: null, rest_seconds: null,
  exercises: MOVES.map(([name, id, delta]) => ({
    name, canonical_id: id, sets: null, reps: '5', duration_seconds: null, delta
  }))
}, over || {});

const card = (over) => Object.assign({
  title: 'Complex Fives', duration_minutes: 15, blocks: [complex()]
}, over || {});

const straight = {
  title: 'Main', type: 'straight', rounds: null, rest_seconds: 90,
  exercises: [{ name: 'Back Squat', sets: 3, reps: '8' }, { name: 'Bench Press', sets: 3, reps: '8' }]
};

ctx.F = { complex, card, straight, MOVES };

// ---------- 1. detection ----------

// Named apart from the sandbox's own cxOf, which allocates a complex's state.
const detect = (block, w) => run('complexOf(' + JSON.stringify(block) + ', ' + JSON.stringify(w) + ')');

assert.deepEqual(detect(complex(), card()), { cap: 900, n: 5 },
  'the owner\'s card: an AMRAP of five, capped by the card\'s own fifteen minutes');

assert.deepEqual(detect(complex(), card({ blocks: [straight, complex()] })), { cap: 0, n: 5 },
  'still a complex with a warm-up beside it, but the card\'s duration is no longer only this block\'s');

assert.equal(detect({ type: 'emom', exercises: complex().exercises }, card()), null,
  'EMOM is a different clock and waits for its own wave');

assert.equal(detect(complex({ type: 'circuit', rounds: 3 }), card()), null,
  'a circuit that says how many rounds is not an AMRAP; today\'s lap flow walks it');

assert.equal(detect(straight, card({ blocks: [straight] })), null,
  'straight sets keep the behaviour they had');

assert.deepEqual(detect(complex({ type: 'circuit', title: null }), card({ duration_minutes: 20 })),
  { cap: 1200, n: 5 }, 'a circuit dosed like a complex, with the card saying how long');

assert.equal(detect(complex({ type: 'circuit' }), card({ duration_minutes: null })), null,
  'a circuit with no clock anywhere is left alone');

assert.equal(detect({
  type: 'circuit', exercises: [{ name: 'Row', duration_seconds: 45 }, { name: 'Bike', duration_seconds: 45 }]
}, card({ duration_minutes: 10, blocks: [] })), null,
  'an all-timed circuit is an interval workout: its per-station countdown says more');

assert.deepEqual(detect(complex({ rest_seconds: 900 }), card({ duration_minutes: null, blocks: [straight, complex()] })),
  { cap: 900, n: 5 }, 'a fifteen-minute "rest" on an AMRAP block can only have been the cap');

assert.deepEqual(detect(complex({ rest_seconds: 60 }), card({ duration_minutes: null, blocks: [straight, complex()] })),
  { cap: 0, n: 5 }, 'a sixty-second rest is a rest, not a cap');

assert.equal(detect(complex({ exercises: [complex().exercises[0]] }), card()), null,
  'one movement is not a complex');

assert.deepEqual(detect(complex(), card({ duration_minutes: 120 })), { cap: 0, n: 5 },
  'two hours is not a time cap, it is a number in the wrong field');

assert.deepEqual(detect(complex(), card({ duration_minutes: 0.5 })), { cap: 0, n: 5 },
  'nor is thirty seconds');

// ---------- 2. one stop per complex ----------

run('wo = { workout: F.card({ blocks: [F.straight, F.complex()] }) };' +
  'wo.screens = flatten(wo.workout);' +
  'wo.entries = wo.screens.map(function (s) { return { name: s.ex.name, canonical_id: s.ex.canonical_id || null, block: s.bi, exercise: s.ei, sets: [] }; });');

assert.equal(run('wo.screens.length'), 7, 'seven exercises, so seven entries');
assert.deepEqual(run('wo.screens.map(function (s, i) { return isStop(i); })'),
  [true, true, true, false, false, false, false],
  'the two straight movements stop, the complex stops once at its first movement');
assert.equal(run('endStop()'), 2, 'the last thing to navigate to is the complex, not its fifth movement');
assert.equal(run('stopDone(2)'), false, 'nothing logged yet');
run('wo.entries[5].sets = [{ reps: 5, done: true }];');
assert.equal(run('stopDone(2)'), true, 'one movement of a complex lights the whole block\'s dot');
assert.equal(run('stopDone(0)'), false, 'and lights nothing else');
run('wo.entries[5].sets = [];');

// ---------- 3. what a round writes ----------

run('wo = { workout: F.card(), amrap: {} };' +
  'wo.screens = flatten(wo.workout);' +
  'wo.entries = wo.screens.map(function (s) { return { name: s.ex.name, canonical_id: s.ex.canonical_id || null, block: s.bi, exercise: s.ei, sets: [] }; });' +
  'var A = cxOf(0, complexOf(wo.workout.blocks[0], wo.workout));');

assert.deepEqual(run('[A.cap, A.rounds, A.marks, A.until, A.held, A.over]'), [900, 0, [], 0, 0, 0],
  'a complex starts at zero rounds with the clock untouched');

// Three rounds, then two movements of the fourth.
run('A.rounds = 3; A.marks = [1, 1]; cxSync(0);');
assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [4, 4, 3, 3, 3],
  'one set per movement per completed round, plus the two marked in the partial one');
assert.deepEqual(run('wo.entries[0].sets[0]'),
  { reps: 5, unit: 'lb', done: true, weight: null },
  'the dose comes off the card and the weight is left alone when nothing was lifted before');

let score = run('cxScoreOf(wo.workout, wo.entries)');
assert.deepEqual(score, { rounds: 3, extra: 2, reps: 85, cap: 900, text: '3 rounds + 2 movements' },
  'the WOD score: rounds every movement got through, plus the movements that got one more');

// Undo the partial round.
run('A.marks = []; cxSync(0);');
assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [3, 3, 3, 3, 3],
  'undo is a subtraction, not a second set of books');
assert.deepEqual(run('cxScoreOf(wo.workout, wo.entries).text'), '3 rounds',
  'and the score follows it back down');

// Undo a whole round.
run('A.rounds = 2; cxSync(0);');
assert.equal(run('cxScoreOf(wo.workout, wo.entries).reps'), 50, 'two rounds of five fives');

// A fourth round, counted from the movements rather than the button.
run('A.rounds = 3; A.marks = [1, 1, 1, 1, 1]; cxSync(0);');
assert.equal(run('cxMarks(A, { n: 5 })'), 5, 'every movement marked');
assert.equal(run('cxCurrent(A, { n: 5 })'), 0, 'and the list points back at the first');
run('A.rounds = 4; A.marks = []; cxSync(0);');
assert.deepEqual(run('cxScoreOf(wo.workout, wo.entries).text'), '4 rounds',
  'a full set of marks is the same as a round, however it was counted');

// The current movement is the first one this round has not had.
run('A.marks = [1, 0, 1];');
assert.equal(run('cxCurrent(A, { n: 5 })'), 1, 'the first unmarked movement is the one you are on');

// Nothing logged is no score at all, rather than a score of zero.
run('wo.entries.forEach(function (e) { e.sets = []; });');
assert.equal(run('cxScoreOf(wo.workout, wo.entries)'), null,
  'a complex nobody started does not get a line on the summary');
assert.equal(run('cxScoreOf(F.card({ blocks: [F.straight] }), [{ block: 0, exercise: 0, sets: [{ reps: 8 }] }])'), null,
  'and neither does a card with no complex on it');

// The load the set sheet would have opened on, when there is one.
run('hist["c:goblet-squat"] = { weight: 35, unit: "lb" }; A.rounds = 1; A.marks = []; cxSync(0);');
assert.equal(run('wo.entries[3].sets[0].weight'), 35,
  'a movement done before is logged at the weight it was last done at');
assert.equal(run('wo.entries[0].sets[0].weight'), null, 'one that was not, is not');

// A timed movement inside a complex logs as a hold, the way logHold writes one.
run('wo.workout.blocks[0].exercises[2].duration_seconds = 40;' +
  'wo.workout.blocks[0].exercises[2].reps = null;' +
  'wo.entries[2].sets = []; cxSync(0);');
assert.deepEqual(run('wo.entries[2].sets[0]'), { seconds: 40, done: true },
  'a held second is not a rep, here as everywhere else');

// ---------- 4. the score, in words ----------

assert.equal(run('cxScore(1, 0)'), '1 round');
assert.equal(run('cxScore(0, 1)'), '0 rounds + 1 movement');
assert.equal(run('cxScore(12, 4)'), '12 rounds + 4 movements');
assert.equal(run('cxScore(3, 2, 1)'), 'rounds + 2 movements', 'bare, for the screen that draws the 3 itself');

// ---------- 5. the clock ----------

const NOW = run('Date.now()');
assert.equal(run('cxLeft({ cap: 900, until: 0, held: 0, over: 0 })'), 900000,
  'never started reads as the whole cap');
assert.ok(Math.abs(run('cxLeft({ cap: 900, until: ' + (NOW + 61000) + ', held: 0, over: 0 })') - 61000) < 400,
  'running reads off the deadline, so a throttled tab cannot drift it');
assert.equal(run('cxLeft({ cap: 900, until: 0, held: 12345, over: 0 })'), 12345, 'paused holds what was left');
assert.equal(run('cxLeft({ cap: 900, until: ' + (NOW + 5000) + ', held: 0, over: 1 })'), 0,
  'spent is spent, whatever the deadline says');
assert.equal(run('cxLeft({ cap: 900, until: ' + (NOW - 90000) + ', held: 0, over: 0 })'), 0,
  'a deadline in the past never reads as negative time');

// ---------- 6. the delta, cut to a row ----------

assert.equal(run('cxDelta(' + JSON.stringify({ delta: MOVES[0][2] }) + ')'), 'hands on the kettlebell handle');
assert.equal(run('cxDelta(' + JSON.stringify({ delta: MOVES[1][2] }) + ')'), 'single kettlebell between the feet');
assert.equal(run('cxDelta({ delta: null })'), '');
assert.equal(run('cxDelta({ delta: "held in the goblet position at the chest throughout every single repetition" })'), '',
  'a first clause too long for a row is dropped whole: half a claim about form is worse than none');

console.log('complex-harness: all checks passed');
