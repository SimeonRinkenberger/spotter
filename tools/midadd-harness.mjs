// Offline checks for the mid-workout add, and for the exercise bank the same
// picker became: the filter, the replace mode, and the swap sheet's way into it.
// Run against the real source.
//
// The functions are lifted out of app.ts the way tools/complex-harness.mjs lifts
// its own — no playwright, which is not a dependency of this repo. Everything
// checked here is pure: how a query is scored against a name and its aliases, how
// the three shelves are deduplicated into one list, whether a row is inside a
// filter, where an inserted or a replacing movement lands in wo.entries/wo.screens,
// and what a complex writes into workout_logs once a sixth movement has joined it
// mid-session.
//
// The one thing a harness cannot reach is the card write, which is an edge
// function call and fails CORS from a local page. Its payload SHAPE is asserted
// here against what handleCorrection in index.ts reads, and the server's
// validation of the one field the bank added, canonical_id, is lifted out of
// index.ts (through esbuild, which build.mjs already depends on) and run against
// the real catalog.
//
//   node tools/midadd-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');

function fn(name) {
  const a = src.indexOf('  function ' + name + '(');
  assert(a >= 0, 'not found in app.ts: ' + name);
  const b = src.indexOf('\n  }', a);
  assert(b > a, 'unterminated in app.ts: ' + name);
  return src.slice(a, b + 4);
}

const LIFTED = ['woaMake', 'woaRows', 'woaHit', 'woaScore', 'woaRank', 'woaPass', 'woaFilter',
  'woaFields', 'woaEditBody', 'swapRow', 'entryAt', 'insertSessionExercise', 'replaceSessionExercise',
  'flatten', 'complexOf', 'cxCap', 'cxDosed', 'isTimed', 'cxEntry', 'cxSet', 'cxSync',
  'cxScoreOf', 'cxScore', 'doseText'];

// What the lifted code reaches for that is not in this file's scope. lastLine is
// stubbed to the one thing the picker uses it for — a subtitle — because the real
// one only formats what hist already holds. woa is the picker's state; the filter
// reads its two chip lists off it.
const STUBS = [
  'var state = { unit: "lb", workouts: [] }, hist = {}, wo = null, woaCat = null;',
  'var woa = { mode: "add", target: null, mus: [], eq: [] };',
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

ok('Recent is worth one rung: "squat" reaches the one you did, not the catalog', () => {
  // Goblet Squats has the query at a word boundary and Back Squat has it in the
  // same place, so without the bonus they would tie and the catalog's own order
  // would decide. It must not.
  const r = rank('squat');
  assert.equal(r[0], 'Goblet Squats');
  // One rung and no more: a row that IS what was typed still wins outright.
  const rows = [{ key: 'a', name: 'Squat Thing', src: 1 }, { key: 'b', name: 'Squat', src: 3 }];
  assert.deepEqual(
    run('woaRank("squat", ' + JSON.stringify(rows) + ').map(function (x) { return x.name; })'),
    ['Squat', 'Squat Thing']);
});

ok('an empty query is the shelf order itself', () => {
  const r = run('woaRank("", woaRows()).map(function (x) { return x.src; })');
  assert.deepEqual(r, r.slice().sort((a, b) => a - b), 'shelves are out of order');
});

// ---------- the filter ----------
//
// Two chip rows over one list. Muscle chips OR together, equipment chips OR
// together, the rows AND; Bodyweight is the catalog's empty equipment list. A row
// with no data cannot be inside a filter, so it goes while one is on.

console.log('the filter');

const pass = (row, mus, eq) =>
  run('woaPass(' + JSON.stringify(row) + ', ' + JSON.stringify(mus) + ', ' + JSON.stringify(eq) + ')');

ok('the shelf merge carries muscles and equipment onto a kept row, so Recent can be filtered', () => {
  const goblet = run('woaRows()').filter((r) => r.key === 'c:goblet-squat')[0];
  assert.equal(goblet.src, 1, 'the fixture stopped being a Recent row');
  assert.deepEqual(goblet.muscle_groups, ['quads', 'glutes']);
  assert.deepEqual(goblet.equipment, ['kettlebell']);
});

ok('no chips: every row passes, with data or without', () => {
  assert.equal(pass({ name: 'Sandbag Carry' }, [], []), true);
  assert.equal(pass({ muscle_groups: ['chest'], equipment: [] }, [], []), true);
});

ok('muscle chips OR together', () => {
  const row = { muscle_groups: ['quads'], equipment: ['barbell'] };
  assert.equal(pass(row, ['chest', 'quads'], []), true);
  assert.equal(pass(row, ['chest'], []), false);
});

ok('equipment chips OR together, and Bodyweight means an empty list', () => {
  const pushUp = { muscle_groups: ['chest'], equipment: [] };
  const split = { muscle_groups: ['quads'], equipment: ['dumbbells'] };
  assert.equal(pass(pushUp, [], ['bodyweight']), true);
  assert.equal(pass(pushUp, [], ['dumbbells']), false);
  assert.equal(pass(pushUp, [], ['dumbbells', 'bodyweight']), true);
  assert.equal(pass(split, [], ['bodyweight']), false);
  assert.equal(pass(split, [], ['dumbbells', 'bodyweight']), true);
});

ok('the two rows AND', () => {
  const goblet = { muscle_groups: ['quads', 'glutes'], equipment: ['kettlebell'] };
  assert.equal(pass(goblet, ['quads'], ['kettlebell']), true);
  assert.equal(pass(goblet, ['quads'], ['barbell']), false);
  assert.equal(pass(goblet, ['chest'], ['kettlebell']), false);
});

ok('a row without data is hidden while any chip is on', () => {
  assert.equal(pass({ name: 'Sandbag Carry' }, ['core'], []), false);
  assert.equal(pass({ name: 'Sandbag Carry' }, [], ['other']), false);
  assert.equal(pass({ name: 'Half data', muscle_groups: ['core'] }, ['core'], []), false);
});

ok('the filtered list keeps the Recent and library rows the catalog knows and drops the strangers', () => {
  set('woa', { mode: 'add', target: null, mus: ['quads'], eq: [] });
  const names = run('woaFilter(woaRows()).map(function (r) { return r.name; })');
  assert.deepEqual(names, ['Goblet Squats', 'Back Squat', 'Bulgarian Split Squat']);
  set('woa', { mode: 'add', target: null, mus: [], eq: ['bodyweight'] });
  assert.deepEqual(run('woaFilter(woaRows()).map(function (r) { return r.name; })'), ['Push Up']);
  set('woa', { mode: 'add', target: null, mus: [], eq: [] });
  assert.equal(run('woaFilter(woaRows()).length'), run('woaRows().length'));
});

ok('the chip rows are the twelve muscles and Bodyweight plus the twelve kinds of equipment', () => {
  const m = /var MUSCLES = \[([^\]]*)\]/.exec(src), e = /var WOA_EQUIP = \[([^\]]*)\]/.exec(src);
  assert(m && e, 'the vocabularies moved');
  assert.equal(JSON.parse('[' + m[1] + ']').length, 12);
  const eq = JSON.parse('[' + e[1] + ']');
  assert.equal(eq.length, 13);
  assert.equal(eq[0], 'bodyweight');
  assert(fn('woaChips').includes('[["woamus", MUSCLES, woa.mus], ["woaeq", WOA_EQUIP, woa.eq]]'));
});

ok('the filter starts clear every time the picker opens', () => {
  const open = fn('openBank');
  assert(open.includes('mus: [], eq: []'));
  assert(open.includes('$("woafilt").open = false;'));
});

ok('free text is always on offer in add mode and only when nothing answers in replace mode', () => {
  const render = fn('woaRender');
  assert(render.includes('rows = woaFilter(all)'), 'the list is not the filtered one');
  assert(render.includes('if (rep ? !hits.length : (!hits.length || String(hits[0].name).toLowerCase() !== q)) {'));
  assert(render.includes('(rep ? "Use “" : "Add “") + raw + "”"'));
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

// ---------- replacing one ----------
//
// The bank's replace mode in the live session. Nothing logged: the plan changes in
// place. Sets logged: the log keeps them under the name they were done as, and the
// replacement follows.

console.log('replacing in the session');

const HAMMER = '{ name: "Hammer Curl", canonical_id: "hammer-curl", sets: 3, reps: "12", duration_seconds: null }';

ok('a replacement with nothing logged takes the slot, the screen and a fresh entry', () => {
  session(TWO_BLOCKS);
  const at = run('replaceSessionExercise(1, 0, ' + HAMMER + ')');
  assert.equal(at, 2);
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ex.name; })'), ['Squat', 'Row', 'Hammer Curl']);
  assert.deepEqual(run('wo.entries.map(function (e) { return e.name; })'), ['Squat', 'Row', 'Hammer Curl']);
  assert.deepEqual(run('wo.entries[2]'), { name: 'Hammer Curl', canonical_id: 'hammer-curl', block: 1, exercise: 0, sets: [] });
  assert.equal(run('wo.workout.blocks[1].exercises[0].name'), 'Hammer Curl');
});

ok('a replacement with sets logged follows the movement it replaces, and the log keeps both', () => {
  session(TWO_BLOCKS);
  vm.runInContext('wo.entries[0].sets = [{ reps: 5 }]; wo.entries[1].sets = [{ reps: 8, done: true }, null];', ctx);
  const at = run('replaceSessionExercise(0, 1, ' + HAMMER + ')');
  assert.equal(at, 2, 'the replacement did not take the next screen');
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ex.name; })'), ['Squat', 'Row', 'Hammer Curl', 'Curl']);
  const rows = run('wo.entries.map(function (e) { return [e.name, e.sets.filter(Boolean).length]; })');
  assert.deepEqual(rows, [['Squat', 1], ['Row', 1], ['Hammer Curl', 0], ['Curl', 0]],
    'a logged set moved off the movement it was done as');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.block + ":" + e.exercise; })'),
    ['0:0', '0:1', '0:2', '1:0']);
});

ok('a slot the session does not have is refused rather than invented', () => {
  session(TWO_BLOCKS);
  assert.equal(run('replaceSessionExercise(0, 9, ' + HAMMER + ')'), -1);
  assert.equal(run('replaceSessionExercise(5, 0, ' + HAMMER + ')'), -1);
  assert.equal(run('wo.screens.length'), 3, 'a refused replacement changed the session');
});

ok('entryAt finds a movement by where it is, not by where it started', () => {
  session(TWO_BLOCKS);
  run('insertSessionExercise(0, 0, { name: "Warm", sets: 1, reps: "10" })');
  assert.equal(run('entryAt(0, 0)'), 0);
  assert.equal(run('entryAt(0, 2)'), 2);
  assert.equal(run('wo.entries[entryAt(0, 2)].name'), 'Row');
  assert.equal(run('entryAt(1, 0)'), 3);
  assert.equal(run('entryAt(3, 3)'), -1);
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

ok('a movement joining a complex arrives dosed, so the block stays one', () => {
  // complexOf reads a CIRCUIT as a complex only while every movement carries a
  // dose and no set count, so a 3 x 10 landing in one would take the round
  // counter off the screen mid-workout. woaPlace strips the set count for this.
  assert(src.includes('ex.sets = null;'), 'woaPlace no longer strips the set count');
  const block = (extra) => ({
    title: 'Fives', type: 'circuit', duration_seconds: 600,
    exercises: [{ name: 'A', reps: '5' }, { name: 'B', reps: '5' }].concat(extra || [])
  });
  const isComplex = (b) => !!run('complexOf(' + JSON.stringify(b) + ', ' +
    JSON.stringify({ blocks: [b], duration_minutes: 10 }) + ')');
  assert(isComplex(block()), 'the fixture was never a complex');
  assert(!isComplex(block([{ name: 'C', sets: 3, reps: '10' }])), 'a set count did not break it');
  assert(isComplex(block([{ name: 'C', sets: null, reps: '10' }])), 'a dosed movement broke it');
});

ok('a movement the card came with is unaffected — from_round is absent and means 0', () => {
  session(AMRAP);
  vm.runInContext('wo.amrap[0] = { cap: 900, rounds: 5, marks: [], until: 0, held: 0, cued: 4, over: 0 };', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [5, 5, 5]);
});

ok('a replacement inside a complex with no rounds credited keeps the complex whole', () => {
  session(AMRAP);
  const at = run('replaceSessionExercise(0, 1, { name: "Push Press", canonical_id: null, reps: "5", sets: null, from_round: 0 })');
  assert.equal(at, 1);
  assert.equal(run('complexOf(wo.workout.blocks[0], wo.workout).n'), 3, 'the complex grew or broke');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.name; })'),
    ['Close Grip Push Ups', 'Push Press', 'Goblet Squats']);
  assert.deepEqual(run('wo.screens.map(function (s) { return s.ei; })'), [0, 1, 2]);
});

ok('a replacement inside a complex with rounds credited leaves the old movement its rounds', () => {
  session(AMRAP);
  vm.runInContext('wo.amrap[0] = { cap: 900, until: 0, held: 0, cued: 4, over: 0, rounds: 2, marks: [] };', ctx);
  run('cxSync(0)');
  const at = run('replaceSessionExercise(0, 1, { name: "Push Press", canonical_id: null, reps: "5", sets: null, from_round: wo.amrap[0].rounds })');
  assert.equal(at, 2, 'the replacement did not follow the movement it replaces');
  assert.deepEqual(run('wo.entries.map(function (e) { return [e.name, e.sets.length]; })'),
    [['Close Grip Push Ups', 2], ['Kettlebell Swings', 2], ['Push Press', 0], ['Goblet Squats', 2]]);
  vm.runInContext('wo.amrap[0].rounds = 3;', ctx);
  run('cxSync(0)');
  assert.deepEqual(run('wo.entries.map(function (e) { return e.sets.length; })'), [3, 3, 1, 3]);
  // sessionReplace is what doses it and stamps the round; assert the source, the
  // DOM half of it cannot run here.
  const sr = fn('sessionReplace');
  assert(sr.includes('if (cx) { ex.sets = null; ex.from_round = (wo.amrap[t.bi] || {}).rounds || 0; }'));
  assert(sr.includes('if (!cx) wo.i = at;'));
});

// ---------- the card write ----------
//
// Shape only: the call itself is an edge function round trip. These assert that
// what saveWorkoutAdd/woaKeep send is what handleCorrection in index.ts reads.

console.log('the keep-on-card payload');

const idx = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
const EDIT_FIELDS = JSON.parse('[' + /const EDIT_FIELDS: EditField\[\] = \[([^\]]*)\]/.exec(idx)[1] + ']');

ok('the endpoint the picker posts to is the one the corrections handler serves', () => {
  assert(src.includes('api("workouts/" + w.id + "/exercises"'), 'woaKeep posts somewhere else');
  assert(idx.includes('if (op !== "edit" && op !== "add" && op !== "delete" && op !== "delete_block")'));
});

ok('every field sent is one the server reads, and none it would throw on', () => {
  const fields = run('woaFields({ name: "Dip", canonical_id: "dip", sets: 3, reps: "10", duration_seconds: null, rest_seconds: 90 })');
  assert.deepEqual(fields, { name: 'Dip', canonical_id: 'dip', sets: 3, reps: '10', duration_seconds: null });
  Object.keys(fields).forEach((f) => assert(EDIT_FIELDS.includes(f), 'the server does not read ' + f));
  // EDIT_FIELDS is the server's whole vocabulary for an add or an edit.
  assert.deepEqual(EDIT_FIELDS, ['name', 'sets', 'reps', 'duration_seconds', 'canonical_id']);
  // A free-text pick has no identity; it sends null, not undefined, and the
  // server resolves the name as it always did.
  assert.equal(run('woaFields({ name: "Sled Push" }).canonical_id'), null);
});

ok('the block asked for can only be one the card has, or exactly one past it', () => {
  // The client clamps to blocks.length and the server clamps again; either alone
  // is enough to stop an add punching empty blocks into the row.
  assert(src.includes('op: "add", block: bi < n ? bi : n, fields: woaFields(ex) }'));
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

// ---------- the replace payloads ----------

console.log('the replace payloads');

ok('a card replacement is one edit op, guarded by the name the sheet was opened on', () => {
  const body = run('woaEditBody({ w: { id: "w1" }, bi: 1, ei: 0, ex: { name: "Curl", sets: 3, reps: "12" } }, ' + HAMMER + ')');
  assert.deepEqual(body, {
    op: 'edit', block: 1, index: 0, expect_name: 'Curl',
    fields: { name: 'Hammer Curl', canonical_id: 'hammer-curl', sets: 3, reps: '12', duration_seconds: null }
  });
  Object.keys(body.fields).forEach((f) => assert(EDIT_FIELDS.includes(f), f));
  // The server reads exactly these three names off an edit.
  ['?.block', '?.index', '?.expect_name'].forEach((k) => assert(idx.includes('(body as any)' + k), k));
});

ok('the save branches on the picker mode: card add, card replace, session replace, session add', () => {
  const save = fn('saveWorkoutAdd');
  assert(save.includes('if (mode === "card-add") {'));
  assert(save.includes('postCorrection(t.w, { op: "add", block: t.bi, fields: woaFields(ex) }, $("woaddsave"), "Added it", "woaddsheet");'));
  assert(save.includes('if (mode === "replace" && !t.session) {'));
  assert(save.includes('postCorrection(t.w, woaEditBody(t, ex), $("woaddsave"), "Swapped it", "woaddsheet");'));
  assert(save.includes('if (!sessionReplace(t, ex)) return;'));
  // The session swap persists through the same edit op, behind the same toggle.
  assert(save.includes('if (keep) woaKeep(woaEditBody(t, ex),'));
  // The card branches come before the session guard: a card write needs no session.
  assert(save.indexOf('mode === "card-add"') < save.indexOf('if (!wo || wo.finished) return;'));
});

ok('the session toggle is offered only when the card still has what is being swapped out', () => {
  const choose = fn('woaChoose');
  assert(choose.includes('old ? !(t.session && woaCardHas(t)) : !live || woaCardBlocks() === null'));
  assert(fn('woaCardHas').includes('return !!ex && ex.name === t.ex.name;'));
});

ok('a replacement is dosed from the movement it replaces', () => {
  const choose = fn('woaChoose');
  assert(choose.includes('(old ? old.sets : r.sets) || 3'));
  assert(choose.includes('String((old ? old.reps : r.reps) || "").match(/\\d+/)'));
  assert(choose.includes('old ? (old.duration_seconds ? String(old.duration_seconds) : "")'));
  assert(choose.includes('woa.nosets = !!cx || !!(old && old.sets == null);'));
});

ok('every way in passes a target, and the editor falls back to its own slot', () => {
  assert(src.includes('openSwap(ex.name, w.title, { w: w, bi: bi, ei: ei, ex: ex })'), 'the library card');
  assert(src.includes('openSwap(name, title, swapTarget(w, ex))'), 'the explain sheet');
  assert(src.includes('openSwap(focus.name, wo.workout.title, swapTarget(wo.workout, focus))'), 'workout mode');
  assert(src.includes('openBank("card-add", { w: w, bi: bi })'), 'the card add');
  assert(src.includes('swapTarget(exEdit.w, exEdit.ex) || { w: exEdit.w, bi: exEdit.block, ei: exEdit.index, ex: exEdit.ex }'), 'the editor');
});

// ---------- the swap sheet's way in ----------

console.log('the swap sheet');

ok('a suggestion becomes a picker row with the name the model wrote and the id the server resolved', () => {
  const r = run('swapRow({ name: "Trap Bar Deadlift", canonical_id: "trap-bar-deadlift", why: "Same hinge, less spinal load", in_catalog: true })');
  assert.equal(r.key, 'c:trap-bar-deadlift');
  assert.equal(r.name, 'Trap Bar Deadlift');
  assert.equal(r.canonical_id, 'trap-bar-deadlift');
  assert.equal(r.src, 3);
  const f = run('swapRow({ name: "Sled Push", canonical_id: null, in_catalog: false })');
  assert.equal(f.key, 'n:Sled Push');
  assert.equal(f.canonical_id, null);
});

ok('"Use this" is on the alternatives and not on what to build up', () => {
  const render = fn('renderSwapResult');
  assert(render.includes('swapItem(a, true, true)'));
  assert(render.includes('swapItem(s, false)'));
  const item = fn('swapItem');
  assert(item.includes('if (usable && swapCtx && swapCtx.target) {'));
  assert(item.includes('use.onclick = function () { swapBank(it); };'));
});

ok('the bank row is offered only when the sheet has somewhere to write', () => {
  assert(fn('openSwap').includes('$("swapbank").classList.toggle("hide", !swapCtx.target);'));
  assert(fn('swapBank').includes('if (!t) return;'));
  assert(fn('swapTarget').includes('return at ? { session: live ? 1 : 0, w: w, bi: at.bi, ei: at.ei, ex: ex } : null;'));
});

ok('the bank path asks no model and posts only to the corrections endpoint', () => {
  const bank = ['swapBank', 'swapRow', 'swapTarget', 'openBank', 'woaChoose', 'woaRender', 'woaChips',
    'saveWorkoutAdd', 'sessionReplace', 'replaceSessionExercise', 'woaKeep', 'postCorrection']
    .map(fn).join('\n');
  assert(!/api\("swap"|api\("explain"|apiStream\(|api\("pumpy|api\("demo-video"/.test(bank), 'a model was asked');
  assert(bank.includes('openBank("replace", t);'));
  assert(bank.includes('if (pick) woaChoose(swapRow(pick));'));
  (bank.match(/api\("[^"]*"/g) || []).forEach((call) => assert(call.startsWith('api("workouts/'), call));
  // And the sheet's own model path is the one it always was.
  const swap = fn('runSwap');
  assert(swap.includes('api("swap", { method: "POST", body: JSON.stringify({'));
  assert(swap.includes('exercise: ctx.name, reason: ctx.reason, body_area: ctx.area || "", title: ctx.title, equipment_have: have'));
});

// ---------- canonical_id on the server ----------
//
// The one field the bank added to the corrections handler, lifted out of index.ts
// and run against the real catalog: null or an id the catalog knows, else BadEdit.

console.log('canonical_id on the server');

function tsFn(name) {
  const a = idx.indexOf('function ' + name + '(');
  assert(a >= 0, 'not found in index.ts: ' + name);
  const b = idx.indexOf('\n}', a);
  return idx.slice(a, b + 2);
}

const catalog = vm.createContext({ module: { exports: {} }, exports: {} });
vm.runInContext(transformSync(fs.readFileSync('supabase/functions/spotter/catalog.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code, catalog);
const { catalogById, CATALOG: REAL } = vm.runInContext('module.exports', catalog);
assert(REAL.length > 200 && catalogById('goblet-squat'), 'the catalog did not lift');

const srv = vm.createContext({ catalogById });
vm.runInContext(transformSync('class BadEdit extends Error {}\n' + tsFn('cleanEditField'),
  { loader: 'ts' }).code, srv);
const clean = (v) => vm.runInContext('cleanEditField("canonical_id", ' + JSON.stringify(v === undefined ? null : v) + ')', srv);

ok('null, empty and absent all mean "resolve it from the name"', () => {
  assert.equal(clean(null), null);
  assert.equal(clean(''), null);
  assert.equal(vm.runInContext('cleanEditField("canonical_id", undefined)', srv), null);
});

ok('an id the catalog knows comes back as itself', () => {
  assert.equal(clean('goblet-squat'), 'goblet-squat');
  assert.equal(clean(' hammer-curl '), 'hammer-curl');
});

ok('anything else is a BadEdit, not a silent null', () => {
  assert.throws(() => clean('sled-push-9000'), /not in the catalog/);
  assert.throws(() => clean('Goblet Squat'), /not in the catalog/);
  assert.throws(() => clean(42), /not in the catalog/);
  assert.throws(() => clean({ id: 'goblet-squat' }), /not in the catalog/);
});

ok('the other fields are untouched by the new one', () => {
  assert.equal(vm.runInContext('cleanEditField("name", "  Goblet   Squat ")', srv), 'Goblet Squat');
  assert.equal(vm.runInContext('cleanEditField("sets", "3")', srv), 3);
  assert.throws(() => vm.runInContext('cleanEditField("sets", 150)', srv), /between 1 and 99/);
});

ok('a supplied valid id wins over the name on add and on edit; none means the old behaviour', () => {
  assert(idx.includes('const canon = (cleanEditField("canonical_id", fields.canonical_id) as string | null) ?? canonId(name);'));
  assert(idx.includes('canonical_id: canon,'));
  assert(idx.includes('const canonNext = canonGiven ?? (nameNext !== nameWas ? canonId(nameNext) : canonWas);'));
  assert(idx.includes('if (nameNext !== nameWas || canonNext !== canonWas) {'));
});

ok('the ledger never learns a field the table would refuse', () => {
  // corrections.field is check-constrained; canonical_id rides on the name row,
  // as old_canonical_id / new_canonical_id, and is skipped in the field loop.
  const mig = fs.readFileSync('supabase/migrations/20260901240000_user_corrections.sql', 'utf8');
  assert(mig.includes("check (field in ('name', 'sets', 'reps', 'duration_seconds', 'exercise'))"));
  assert(idx.includes('if (f === "name" || f === "canonical_id" || !(f in fields)) continue;'));
  assert(!/field: "canonical_id"/.test(idx));
  assert(idx.includes('field: "name", old: before.name ?? null, new: nameNext, oldCanon: canonWas, newCanon: canonNext,'));
});

console.log('\n' + checks + ' checks passed.');
