// Offline checks for the mid-workout add, run against the real source.
//
// The functions are lifted out of app.ts the way tools/complex-harness.mjs lifts
// its own — no playwright, which is not a dependency of this repo. Everything
// checked here is pure: how a query is scored against a name and its aliases, how
// the three shelves are deduplicated into one list, where an inserted movement
// lands in wo.entries/wo.screens, and what a complex writes into workout_logs once
// a sixth movement has joined it mid-session.
//
// The one thing a harness cannot reach is the card write, which is an edge
// function call and fails CORS from a local page. Its payload SHAPE is asserted
// here against what handleCorrection in index.ts reads, and the round trip itself
// was run against the deployed function with tools/throwaway.py.
//
//   node tools/midadd-harness.mjs
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

const LIFTED = ['woaMake', 'woaRows', 'woaHit', 'woaScore', 'woaRank', 'insertSessionExercise',
  'flatten', 'complexOf', 'cxCap', 'cxDosed', 'isTimed', 'cxEntry', 'cxSet', 'cxSync',
  'cxScoreOf', 'cxScore', 'doseText'];

// What the lifted code reaches for that is not in this file's scope. lastLine is
// stubbed to the one thing the picker uses it for — a subtitle — because the real
// one only formats what hist already holds.
const STUBS = [
  'var state = { unit: "lb", workouts: [] }, hist = {}, wo = null, woaCat = null;',
  'function exKey(e) { return e && e.canonical_id ? "c:" + e.canonical_id : "n:" + ((e && e.name) || ""); }',
  'function toUnit(w, u) { return Number(w) || 0; }',
  'function lastLine(e) { var h = hist[exKey(e)]; return h && h.date ? "last time" : ""; }'
].join('\n');

const ctx = vm.createContext({ assert, Date, Math, String, Number, JSON, Object, Array, console });
vm.runInContext(STUBS + '\n' + LIFTED.map(fn).join('\n'), ctx);
const run = (code) => {
  const v = vm.runInContext(code, ctx);
  if (!v || typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
};
const set = (name, value) => vm.runInContext(name + ' = ' + JSON.stringify(value) + ';', ctx);

let checks = 0;
function ok(what, fn) { fn(); checks++; console.log('  ok  ' + what); }

// ---------- fixtures ----------
//
// Three shelves that overlap on purpose: the goblet squat is in the log AND on a
// card AND in the catalog, so the dedupe has something to do; the sled push is on
// none of them, so free text has something to be for.
const HIST = {
  'c:goblet-squat': { name: 'Goblet Squats', date: '2026-09-14T10:00:00Z', sets: 3, reps: 10, weight: 40, unit: 'lb', best: 53 },
  'c:kettlebell-swing': { name: 'Kettlebell Swings', date: '2026-09-15T10:00:00Z', sets: 4, reps: 15, weight: 35, unit: 'lb', best: 52 },
  'n:Sandbag Carry': { name: 'Sandbag Carry', date: '2026-09-10T10:00:00Z', sets: 2, reps: 1, weight: 0, unit: 'lb', best: 0 }
};
const WORKOUTS = [{
  id: 'w1', title: 'Kettlebell Fives', ingest_status: 'ready',
  blocks: [{ title: 'Main', type: 'straight', exercises: [
    { name: 'Goblet Squats', canonical_id: 'goblet-squat', sets: 3, reps: '10' },
    { name: 'Copenhagen Plank', canonical_id: null, sets: 2, duration_seconds: 30 }
  ] }]
}];
const CATALOG = [
  { id: 'goblet-squat', display_name: 'Goblet Squat', aliases: ['goblet squats', 'goblets', 'kb goblet squat'], muscle_groups: ['quads', 'glutes'], equipment: ['kettlebell'], pattern: 'squat' },
  { id: 'back-squat', display_name: 'Back Squat', aliases: ['squat', 'squats', 'bb squat'], muscle_groups: ['quads'], equipment: ['barbell'], pattern: 'squat' },
  { id: 'split-squat', display_name: 'Bulgarian Split Squat', aliases: ['db bulgarians', 'bulgarians'], muscle_groups: ['quads'], equipment: ['dumbbells'], pattern: 'lunge' },
  { id: 'push-up', display_name: 'Push Up', aliases: ['pushup', 'push ups'], muscle_groups: ['chest'], equipment: [], pattern: 'push' },
  { id: 'kettlebell-swing', display_name: 'Kettlebell Swing', aliases: ['kb swing', 'swings'], muscle_groups: ['glutes'], equipment: ['kettlebell'], pattern: 'hinge' }
];

set('hist', HIST);
vm.runInContext('state.workouts = ' + JSON.stringify(WORKOUTS) + ';', ctx);
set('woaCat', CATALOG);

// ---------- the shelves ----------

console.log('shelves and dedupe');

ok('recent comes first, newest first, and knows what was lifted', () => {
  const rows = run('woaRows()');
  const recent = rows.filter((r) => r.src === 1).map((r) => r.name);
  assert.deepEqual(recent, ['Kettlebell Swings', 'Goblet Squats', 'Sandbag Carry']);
  assert.equal(rows[0].sets, 4);
  assert.equal(rows[0].reps, 15);
});

ok('one row per movement across the three shelves', () => {
  const rows = run('woaRows()');
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, 'a movement appears twice');
  // The goblet squat is logged, on a card and in the catalog: Recent wins.
  const goblet = rows.filter((r) => r.key === 'c:goblet-squat');
  assert.equal(goblet.length, 1);
  assert.equal(goblet[0].src, 1);
});

ok('a kept row still takes the catalog aliases with it', () => {
  const rows = run('woaRows()');
  const goblet = rows.filter((r) => r.key === 'c:goblet-squat')[0];
  assert.deepEqual(goblet.aliases, ['goblet squats', 'goblets', 'kb goblet squat']);
});

ok('a card movement the catalog does not know is still on the list', () => {
  const rows = run('woaRows()');
  const cop = rows.filter((r) => r.name === 'Copenhagen Plank')[0];
  assert.equal(cop.src, 2);
  assert.equal(cop.canonical_id, null);
  assert.equal(cop.secs, 30);
});

// ---------- ranking ----------

console.log('ranking');

const rank = (q) => run('woaRank(' + JSON.stringify(q) + ', woaRows()).map(function (r) { return r.name; })');

ok('an exact name beats a prefix beats a word beats a substring', () => {
  assert.equal(run('woaScore("push up", { name: "Push Up" })'), 0);
  assert.equal(run('woaScore("push", { name: "Push Up" })'), 1);
  assert.equal(run('woaScore("up", { name: "Push Up" })'), 2);
  assert.equal(run('woaScore("us", { name: "Push Up" })'), 3);
  assert.equal(run('woaScore("zzz", { name: "Push Up" })'), -1);
});

ok('an alias hit sits half a step under the same shape of name hit', () => {
  const row = { name: 'Bulgarian Split Squat', aliases: ['db bulgarians'] };
  assert.equal(run('woaScore("db bulgarians", ' + JSON.stringify(row) + ')'), 0.5);
  assert.equal(run('woaScore("db", ' + JSON.stringify(row) + ')'), 1.5);
  // and never outranks a row literally called what was typed
  assert(run('woaScore("db bulgarians", ' + JSON.stringify(row) + ')') >
    run('woaScore("db bulgarians", { name: "DB Bulgarians" })'));
});

ok('"squat" puts the movements called Squat above the ones merely containing it', () => {
  const r = rank('squat');
  assert.equal(r[0], 'Goblet Squats', 'the one you did on Sunday comes first');
  assert(r.indexOf('Back Squat') < r.indexOf('Bulgarian Split Squat'),
    'a name starting with the query beats one with it in the middle');
});

ok('an alias finds a movement whose name does not contain the query', () => {
  assert.deepEqual(rank('goblets'), ['Goblet Squats']);
  assert.deepEqual(rank('bulgarians'), ['Bulgarian Split Squat']);
  assert.deepEqual(rank('pushup'), ['Push Up']);
});

ok('nothing matches a movement no shelf has', () => {
  assert.deepEqual(rank('sled push'), []);
});

ok('an equal score falls back to the shelf: recent, library, catalog', () => {
  const rows = [{ key: 'c', name: 'Squat Thing', src: 3 }, { key: 'a', name: 'Squat Thing', src: 1 },
    { key: 'b', name: 'Squat Thing', src: 2 }];
  assert.deepEqual(
    run('woaRank("squat", ' + JSON.stringify(rows) + ').map(function (x) { return x.src; })'),
    [1, 2, 3]);
});

ok('but the score outranks the shelf — the best answer is never third', () => {
  // "s" starts Sandbag Carry and only begins a WORD in the others, so it leads
  // even though two catalog rows and a newer session row also match.
  const r = rank('s');
  assert.equal(r[0], 'Sandbag Carry');
  assert(r.indexOf('Kettlebell Swings') < r.indexOf('Back Squat'),
    'two rows scoring the same did not fall back to the shelf order');
});

ok('an empty query is the shelf order itself', () => {
  const r = run('woaRank("", woaRows()).map(function (x) { return x.src; })');
  assert.deepEqual(r, r.slice().sort((a, b) => a - b), 'shelves are out of order');
});

// ---------- where it lands ----------

console.log('placement');

function session(blocks) {
  const w = { id: 'w1', title: 'Session', blocks: JSON.parse(JSON.stringify(blocks)) };
  vm.runInContext('wo = { workout: ' + JSON.stringify(w) + ', i: 0, rounds: {}, amrap: {}, prs: {} };', ctx);
  vm.runInContext(`
    wo.screens = flatten(wo.workout);
    wo.entries = wo.screens.map(function (s) {
      return { name: s.ex.name, canonical_id: s.ex.canonical_id || null, block: s.bi, exercise: s.ei, sets: [] };
    });
  `, ctx);
}

const TWO_BLOCKS = [
  { title: 'A', type: 'straight', exercises: [{ name: 'Squat', sets: 3, reps: '5' }, { name: 'Row', sets: 3, reps: '8' }] },
  { title: 'B', type: 'straight', exercises: [{ name: 'Curl', sets: 3, reps: '12' }] }
];

ok('inserting after the current movement puts it on the very next screen', () => {
  session(TWO_BLOCKS);
  const at = run('insertSessionExercise(0, 1, { name: "Dip", canonical_id: null, sets: 3, reps: "10" })');
  assert.equal(at, 1);
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ex.name; })'),
    ['Squat', 'Dip', 'Row', 'Curl']);
});

ok('entries stay index-parallel with screens, and keep the right block/exercise', () => {
  assert.deepEqual(run('wo.entries.map(function (e) { return e.name; })'),
    run('wo.screens.map(function (s) { return s.ex.name; })'));
  assert.deepEqual(run('wo.entries.map(function (e) { return e.block + ":" + e.exercise; })'),
    ['0:0', '0:1', '0:2', '1:0']);
});

ok('sets already logged follow their own movement, not their old index', () => {
  session(TWO_BLOCKS);
  vm.runInContext('wo.entries[1].sets = [{ reps: 8, done: true }];', ctx);
  run('insertSessionExercise(0, 1, { name: "Dip", sets: 3, reps: "10" })');
  const rows = run('wo.entries.map(function (e) { return [e.name, e.sets.length]; })');
  assert.deepEqual(rows, [['Squat', 0], ['Dip', 0], ['Row', 1], ['Curl', 0]]);
});

ok('a movement added to the second block lands after that block, not before it', () => {
  session(TWO_BLOCKS);
  const at = run('insertSessionExercise(1, 1, { name: "Raise", sets: 2, reps: "15" })');
  assert.equal(at, 3);
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ex.name; })'),
    ['Squat', 'Row', 'Curl', 'Raise']);
});

// ---------- inside a complex ----------

console.log('inside a complex');

const AMRAP = [{
  title: 'Complex Fives', type: 'amrap', duration_seconds: 900,
  exercises: [
    { name: 'Close Grip Push Ups', canonical_id: 'push-up', reps: '5' },
    { name: 'Kettlebell Swings', canonical_id: 'kettlebell-swing', reps: '5' },
    { name: 'Goblet Squats', canonical_id: 'goblet-squat', reps: '5' }
  ]
}];

ok('a movement added to an AMRAP joins the round list rather than the pager', () => {
  session(AMRAP);
  assert.equal(run('complexOf(wo.workout.blocks[0], wo.workout).n'), 3);
  run('insertSessionExercise(0, wo.workout.blocks[0].exercises.length, { name: "Push Press", canonical_id: null, reps: "5" })');
  assert.equal(run('complexOf(wo.workout.blocks[0], wo.workout).n'), 4, 'the complex did not grow');
  // Navigation still stops only on the first movement, so this added no screen
  // anybody has to swipe past.
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ei; })'), [0, 1, 2, 3]);
  assert.equal(run('wo.entries[3].block + ":" + wo.entries[3].exercise'), '0:3');
});

ok('three finished rounds are not written against a movement that just arrived', () => {
  session(AMRAP);
  vm.runInContext('wo.amrap[0] = { cap: 900, until: 0, held: 0, cued: 4, over: 0, rounds: 3, marks: [] };', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [3, 3, 3]);
  // A fourth movement joins at round 3, then one more round is counted.
  run('insertSessionExercise(0, 3, { name: "Push Press", reps: "5", from_round: wo.amrap[0].rounds })');
  vm.runInContext('wo.amrap[0].rounds = 4;', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [4, 4, 4, 1],
    'the new movement was credited with rounds it was not there for');
});

ok('a partial round still marks the new movement like any other', () => {
  vm.runInContext('wo.amrap[0].marks = [1, 0, 0, 1];', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [5, 4, 4, 2]);
});

ok('the score read back off the log is the rounds EVERY movement got through', () => {
  const s = run('cxScoreOf(wo.workout, wo.entries)');
  // Four whole rounds of the three it started with, two of the newcomer: the
  // honest floor is 2, and the four movements above it are the partial. A
  // complex that grew mid-session scores itself conservatively, on purpose.
  assert.equal(s.rounds, 2);
  assert.equal(s.extra, 3);
});

ok('a movement the card came with is unaffected — from_round is absent and means 0', () => {
  session(AMRAP);
  vm.runInContext('wo.amrap[0] = { cap: 900, rounds: 5, marks: [], until: 0, held: 0, cued: 4, over: 0 };', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [5, 5, 5]);
});

// ---------- the card write ----------
//
// Shape only: the call itself is an edge function round trip. These assert that
// what saveWorkoutAdd/woaKeep send is what handleCorrection in index.ts reads.

console.log('the keep-on-card payload');

const idx = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');

ok('the endpoint the picker posts to is the one the corrections handler serves', () => {
  assert(src.includes('api("workouts/" + w.id + "/exercises"'), 'woaKeep posts somewhere else');
  assert(idx.includes('if (op !== "edit" && op !== "add" && op !== "delete")'));
});

ok('every field sent is one the server reads, and none it would throw on', () => {
  const body = src.slice(src.indexOf('function woaKeep('), src.indexOf('function woaNum('));
  assert(/op: "add"/.test(body));
  assert(/fields: \{ name: ex\.name, sets: ex\.sets, reps: ex\.reps, duration_seconds: ex\.duration_seconds \}/.test(body));
  // EDIT_FIELDS is the server's whole vocabulary for an add.
  assert(idx.includes('const EDIT_FIELDS: EditField[] = ["name", "sets", "reps", "duration_seconds"];'));
});

ok('the block asked for can only be one the card has, or exactly one past it', () => {
  // The client clamps to blocks.length and the server clamps again; either alone
  // is enough to stop an add punching empty blocks into the row.
  assert(src.includes('op: "add", block: bi < n ? bi : n,'));
  assert(idx.includes('const bi = op === "add" ? Math.max(0, Math.min(asked, blocks.length)) : asked;'));
});

ok('the dose the picker sends is inside what cleanEditField accepts', () => {
  // woaNum clamps to 1..99 sets and 1..999 reps / 1..3600 seconds; the server
  // throws outside 1..99 and 1..3600. The two have to agree or a kept movement
  // fails on the server after the session already has it.
  assert(src.includes('woaNum("woaddsets", 3, 99)'));
  assert(src.includes('woaNum("woaddsecs", 30, 3600)'));
  assert(idx.includes('if (n < 1 || n > 99) throw new BadEdit("Sets has to be between 1 and 99.");'));
  assert(idx.includes('if (n < 1 || n > 3600) throw new BadEdit('));
});

console.log('\n' + checks + ' checks passed.');
