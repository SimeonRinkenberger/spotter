// Offline checks for the dumbbell "each" rule and the one volume helper every
// total goes through (wave 0923, brief LOG). Run against the real source:
//
//   node tools/each-harness.mjs
//
// The app functions are lifted out of app.ts the way tools/midadd-harness.mjs
// lifts its own and run in a vm with the few globals they reach for stubbed. The
// two server readers (Strava's volume line in strava.ts, Pumpy's get_logs_summary
// in index.ts) are lifted through esbuild, which build.mjs already depends on, and
// fed the SAME fixture session, so "every reader agrees" is a number compared five
// ways rather than a promise. A grep-level check then makes sure no reader has
// gone back to multiplying reps by weight on its own.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const APP = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const STRAVA = fs.readFileSync('supabase/functions/spotter/strava.ts', 'utf8');
const INDEX = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');

function fnIn(src, head, where) {
  const a = src.indexOf(head), end = head.startsWith('  ') ? '\n  }\n' : '\n}\n';
  assert(a >= 0, 'not found in ' + where + ': ' + head);
  const b = src.indexOf(end, a);
  assert(b > a, 'unterminated in ' + where + ': ' + head);
  return src.slice(a, b + end.length);
}
const fn = (name) => fnIn(APP, '  function ' + name + '(', 'app.ts');

const LIFTED = ['dbRule', 'dbOf', 'eachOf', 'wtUnit', 'setUnit', 'setLoad', 'tally', 'volumeOf', 'volLb',
  'toUnit', 'wtText', 'exKey', 'prsOfLog', 'prText', 'scSets', 'figsOf', 'sumStill', 'prCheck', 'lastWeights', 'lastLine'];
const DB = APP.slice(APP.indexOf('  var DB_PAIR'), APP.indexOf('  /**\n   * 2 for a pair'));
assert(DB.includes('DB_NOT'), 'the DB_* constants moved');

// What the lifted code reaches for. sb answers lastWeights' one read with LOGS.
const STUBS = [
  'var state = { unit: "lb", logs: null }, hist = {}, histReady = false, wo = null, accountEpoch = 0;',
  'var LB_PER_KG = 2.2046226;',
  'var LOGS = [];',
  'function accountNow() { return true; }',
  'function $() { return null; }',
  'function timeText(s) { return s + "s"; }',
  'function agoText() { return "2 days ago"; }',
  'var sb = { from: function () { var q = { select: function () { return q; }, order: function () { return q; },' +
    ' limit: function () { return { then: function (cb) { cb({ data: LOGS }); } }; } }; return q; } };'
].join('\n');

const ctx = vm.createContext({ assert, Date, Math, String, Number, JSON, Object, Array, console, isNaN });
vm.runInContext(STUBS + '\n' + DB + '\n' + LIFTED.map(fn).join('\n'), ctx);
const run = (code) => {
  const v = vm.runInContext(code, ctx);
  if (!v || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
};
const put = (name, value) => vm.runInContext(name + ' = ' + JSON.stringify(value) + ';', ctx);

let checks = 0;
function ok(what, body) { body(); checks++; console.log('  ok  ' + what); }

// ---------- the rule ----------
const X = (name, id, extra) => Object.assign({ name, canonical_id: id || null }, extra || {});
const TABLE = [
  // catalog, a pair
  ['Dumbbell Bench Press', 'dumbbell-bench-press', 2], ['Hammer Curls', 'hammer-curl', 2],
  ['Lateral Raise', 'lateral-raise', 2], ["Farmer's Carry", 'farmers-carry', 2], ['Renegade Row', 'renegade-row', 2],
  ['Arnold Press', 'arnold-press', 2], ["Devil's Press", 'devils-press', 2], ['Zottman Curl', 'zottman-curl', 2],
  // catalog, one dumbbell
  ['Goblet Squat', 'goblet-squat', 1], ['Pull-Over', 'pull-over', 1], ['Side Bend', 'side-bend', 1],
  ['Concentration Curl', 'concentration-curl', 1], ['Dumbbell Row', 'dumbbell-row', 1],
  ['Single Arm Dumbbell Row', 'dumbbell-row', 1], ['Sumo Squat', 'sumo-squat', 1],
  ['Overhead Tricep Extension', 'overhead-tricep-extension', 1],
  // barbell as well: only when the name says dumbbell
  ['Romanian Deadlift', 'romanian-deadlift', 0], ['DB RDL', 'romanian-deadlift', 2],
  ['Dumbbell Thrusters', 'thruster', 2], ['Thruster', 'thruster', 0], ['Barbell Shrug', 'shrug', 0],
  ['Dumbbell Shrugs', 'shrug', 2], ['Push Press', 'push-press', 0], ['Single-arm DB push press', 'push-press', 1],
  ['Upright Row', 'upright-row', 0], ['Wrist Curl', 'wrist-curl', 0],
  // the name alone
  ['DB Bulgarian Split Squat', 'bulgarian-split-squat', 2], ['Dumbbell Lunges', null, 2],
  ['One-Arm Dumbbell Snatch', null, 1], ['1 DB Reverse Lunge', null, 1], ['Push-up', null, 0],
  ['Sumo squat with two dumbbells', 'sumo-squat', 2],
  // another implement named wins over the id it mapped to
  ['Suitcase Carry', 'farmers-carry', 1], ['Cable Lateral Raise', 'lateral-raise', 0],
  ['Kettlebell Goblet Squat', 'goblet-squat', 0], ['Plate Front Raise', 'front-raise', 0],
];

ok('eachOf table: catalog pair/one, barbell-also ids, names (' + TABLE.length + ' rows)', () => {
  for (const [name, id, want] of TABLE) {
    assert.equal(run('dbRule(' + JSON.stringify(X(name, id)) + ', null)'), want, name);
    assert.equal(run('eachOf(' + JSON.stringify(X(name, id)) + ', null)'), want === 2, name + ' eachOf');
  }
});

ok('what the video showed in the hands counts, as a string or a list', () => {
  assert.equal(run('dbRule({ name: "Reverse Lunge", as_performed: { equipment: "two dumbbells at the sides" } })'), 2);
  assert.equal(run('dbRule({ name: "Reverse Lunge", as_performed: { equipment: ["one dumbbell", "goblet hold"] } })'), 1);
  assert.equal(run('dbRule({ name: "Reverse Lunge", as_performed: { equipment: null } })'), 0);
});

ok('a one-dumbbell workout makes every dumbbell move one, and leaves the rest alone', () => {
  const W = { title: 'Full Body One Dumbbell', equipment: ['dumbbells'] };
  for (const [name, id, want] of [['Dumbbell Bench Press', 'dumbbell-bench-press', 1], ['DB Curl', null, 1],
    ['Goblet Squat', 'goblet-squat', 1], ['Push-up', null, 0], ['Barbell Shrug', 'shrug', 0]]) {
    assert.equal(run('dbRule(' + JSON.stringify(X(name, id)) + ', ' + JSON.stringify(W) + ')'), want, name);
  }
  assert.equal(run('dbRule({ name: "Hammer Curl", canonical_id: "hammer-curl" }, { title: "Arms", equipment: ["single dumbbell"] })'), 1);
  // Through dbOf, the running session's workout is the default.
  put('wo', { workout: W, screens: [], entries: [] });
  assert.equal(run('eachOf({ name: "Hammer Curl", canonical_id: "hammer-curl" }, null)'), false);
  put('wo', null);
});

ok("a person's override wins, on the entry and remembered through hist", () => {
  const curl = X('Dumbbell Curl', 'dumbbell-curl');
  assert.equal(run('dbOf(' + JSON.stringify(curl) + ', { name: "Dumbbell Curl", canonical_id: "dumbbell-curl", each: false })'), 1);
  assert.equal(run('dbOf({ name: "Goblet Squat", canonical_id: "goblet-squat" }, { name: "Goblet Squat", canonical_id: "goblet-squat", each: true })'), 2);
  put('hist', { 'c:dumbbell-curl': { best: 0, each: false } });
  assert.equal(run('dbOf(' + JSON.stringify(curl) + ', { name: "Dumbbell Curl", canonical_id: "dumbbell-curl" })'), 1, 'memory');
  assert.equal(run('dbOf(' + JSON.stringify(curl) + ', { name: "Dumbbell Curl", canonical_id: "dumbbell-curl", each: true })'), 2, 'entry beats memory');
  put('hist', {});
});

ok('wtUnit: "lb each" on a pair, the plain unit otherwise, the entry found from the card exercise', () => {
  assert.equal(run('wtUnit({ name: "Dumbbell Curl", canonical_id: "dumbbell-curl" })'), 'lb each');
  assert.equal(run('wtUnit({ name: "Goblet Squat", canonical_id: "goblet-squat" })'), 'lb');
  vm.runInContext('var EX = { name: "Dumbbell Curl", canonical_id: "dumbbell-curl" };' +
    'wo = { workout: {}, screens: [{ ex: EX }], entries: [{ name: "Dumbbell Curl", canonical_id: "dumbbell-curl", each: false }] };', ctx);
  assert.equal(run('wtUnit(EX)'), 'lb', 'the flip on the entry is what the SS accordion will print');
  put('state', { unit: 'kg', logs: null });
  assert.equal(run('wo.entries[0].each = true, wtUnit(EX)'), 'kg each');
  put('state', { unit: 'lb', logs: null });
  put('wo', null);
});

ok('the memory: lastWeights reads the newest choice, the last top set\'s each, and the pre-session best', () => {
  put('LOGS', [
    { started_at: '2026-09-21T10:00:00Z', entries: [{ name: 'Dumbbell Curl', canonical_id: 'dumbbell-curl', sets: [{ reps: 10, weight: 30, unit: 'lb', each: true }] }] },
    { started_at: '2026-09-14T10:00:00Z', entries: [{ name: 'Dumbbell Curl', canonical_id: 'dumbbell-curl', each: true, sets: [{ reps: 8, weight: 35, unit: 'lb', each: true }] }] },
    { started_at: '2026-09-07T10:00:00Z', entries: [{ name: 'Dumbbell Curl', canonical_id: 'dumbbell-curl', each: false, sets: [{ reps: 8, weight: 60, unit: 'lb' }] }] }
  ]);
  run('lastWeights()');
  const h = run('hist["c:dumbbell-curl"]');
  assert.equal(h.each, true, 'newest explicit choice wins over an older one');
  assert.equal(h.pair, true);
  assert.equal(h.was, h.best);
  assert.equal(Math.round(h.best), 76, 'best is per dumbbell: 60 × (1 + 8/30)');
  assert.match(run('lastLine({ name: "Dumbbell Curl", canonical_id: "dumbbell-curl" })'), /at 30 lb each/);
});

// ---------- the maths ----------
const SESSION = [
  { name: 'Dumbbell Bench Press', canonical_id: 'dumbbell-bench-press', sets: [
    { reps: 10, weight: 50, unit: 'lb', each: true }, null, { reps: 8, weight: 25, unit: 'kg', each: true }] },
  { name: 'Barbell Row', canonical_id: 'barbell-row', sets: [{ reps: 5, weight: 135, unit: 'lb' }] },
  { name: 'Goblet Squat', canonical_id: 'goblet-squat', sets: [{ reps: 12, weight: 60, unit: 'lb' }] },
  { name: 'Plank', sets: [{ seconds: 45 }] },
  // An old set, logged before the flag existed: counted once, as it always was.
  { name: 'Hammer Curl', canonical_id: 'hammer-curl', sets: [{ reps: 10, weight: 20, unit: 'lb' }] }
];
// 10×50×2 + 8×(25 kg → 55.1 lb)×2 + 5×135 + 12×60 + 10×20
const WANT_LB = 1000 + 8 * 55.1 * 2 + 675 + 720 + 200;

ok('setLoad doubles a pair, leaves one and old unflagged sets alone, converts units', () => {
  assert.equal(run('setLoad({ reps: 10, weight: 50, unit: "lb", each: true })'), 1000);
  assert.equal(run('setLoad({ reps: 10, weight: 50, unit: "lb" })'), 500);
  assert.equal(run('setLoad({ seconds: 45 })'), 0);
  assert.equal(run('setLoad(null)'), 0);
  assert.equal(Math.round(run('setLoad({ reps: 8, weight: 25, unit: "kg", each: true }, 1)') * 10) / 10, Math.round(8 * 25 * 2.2046226 * 2 * 10) / 10, 'pounds for the awards');
});

// Strava and Pumpy, lifted through esbuild with their own helpers.
function tsToJs(src) { return transformSync(src, { loader: 'ts' }).code; }
const stravaJs = tsToJs(['const LB_PER_KG = 2.2046226;', 'function returnBase() { return "https://example.test/spotter/"; }',
  fnIn(STRAVA, 'function inUnit(', 'strava.ts'), fnIn(STRAVA, 'function num(', 'strava.ts'),
  fnIn(STRAVA, 'function tidy(', 'strava.ts'), fnIn(STRAVA, 'function exerciseLine(', 'strava.ts'),
  fnIn(STRAVA, 'export function activityBody(', 'strava.ts').replace('export function', 'function')].join('\n'));
const idxJs = tsToJs([
  'var LOGROWS = [];', 'async function dbSelect() { return LOGROWS; }', 'function catalogById() { return null; }',
  fnIn(INDEX, 'async function toolLogsSummary(', 'index.ts')].join('\n'));
const sctx = vm.createContext({ Math, Number, String, JSON, Date, console });
vm.runInContext(stravaJs + '\n' + idxJs, sctx);

// every volume reader agrees on one session: summary tally, volumeOf, volLb, Strava, Pumpy
{
  const tallyVol = run('tally(' + JSON.stringify(SESSION) + ').vol');
  const volOf = run('volumeOf(' + JSON.stringify({ entries: SESSION }) + ')');
  const volLb = run('volLb(' + JSON.stringify({ entries: SESSION }) + ')');
  assert.equal(Math.round(tallyVol), Math.round(WANT_LB), 'tally');
  assert.equal(volOf, tallyVol, 'volumeOf is tally');
  assert(Math.abs(volLb - WANT_LB) < 1, 'volLb ' + volLb);
  assert.equal(run('tally(' + JSON.stringify(SESSION) + ').sets'), 6, 'sets: holes skipped, holds counted');
  const body = vm.runInContext('activityBody(' + JSON.stringify({ workout_title: 'x', duration_seconds: 600, entries: SESSION }) +
    ', { startLocal: "2026-09-23T10:00:00Z", unit: "lb" })', sctx);
  const m = /Volume ([\d,]+) lb/.exec(body.description);
  assert(m, 'Strava has a volume line');
  assert.equal(Number(m[1].replace(/,/g, '')), Math.round(WANT_LB), 'Strava');
  // Pumpy's tool does not convert units (it never has), so it is fed the lb-only
  // part of the session and must match that part.
  const lbOnly = SESSION.map((e) => ({ ...e, sets: e.sets.filter((s) => !s || s.unit !== 'kg') }));
  vm.runInContext('LOGROWS = ' + JSON.stringify([{ started_at: '2026-09-23T10:00:00Z', workout_title: 'x', entries: lbOnly }]) + ';', sctx);
  const pumpy = await vm.runInContext('toolLogsSummary("u", 14)', sctx);
  assert.equal(pumpy.volume, run('tally(' + JSON.stringify(lbOnly) + ').vol'), 'get_logs_summary');
  checks++;
  console.log('  ok  every volume reader agrees: app ' + Math.round(tallyVol) + ' lb = volumeOf = volLb = Strava ' + m[1] +
    ' lb; Pumpy ' + pumpy.volume + ' lb on the lb-only part');
}

ok('no volume reader multiplies reps by weight on its own any more', () => {
  const setLoadSrc = fn('setLoad');
  const outside = APP.replace(setLoadSrc, '');
  const hits = outside.split('\n').filter((l) => /reps\s*\*|\*\s*[\w.()]*reps\b/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(hits, [], 'app.ts: ' + hits.join(' | '));
  for (const [file, src] of [['strava.ts', STRAVA], ['index.ts', INDEX]]) {
    const lines = src.split('\n').filter((l) => /reps\)?\s*\)?\s*\*\s*/.test(l) && /weight/.test(l) && !/^\s*\/\//.test(l));
    assert(lines.length >= 1, file + ' has its volume line');
    for (const l of lines) assert.match(l, /each \? 2 : 1/, file + ': ' + l.trim());
  }
});

// ---------- bests stay per dumbbell ----------
ok('a best is judged and written per dumbbell, never doubled', () => {
  put('hist', { 'c:dumbbell-curl': { best: 60, was: 60 } });
  put('histReady', true);
  put('wo', { prs: {} });
  const set = { reps: 10, weight: 50, unit: 'lb', each: true };
  assert.equal(run('prCheck({ name: "Dumbbell Curl", canonical_id: "dumbbell-curl" }, ' + JSON.stringify(set) + ', "c:dumbbell-curl")'), true);
  const pr = run('wo.prs["c:dumbbell-curl"]');
  assert.equal(pr.weight, 50, 'the number typed, not 100');
  assert.equal(pr.each, true);
  assert.equal(run('prText(wo.prs["c:dumbbell-curl"])'), 'Dumbbell Curl · 50 lb each × 10');
  // 40 × 1.33 = 53 does not beat 60, even though the pair moved 80.
  put('hist', { 'c:dumbbell-curl': { best: 60, was: 60 } });
  assert.equal(run('prCheck({ name: "Dumbbell Curl", canonical_id: "dumbbell-curl" }, { reps: 10, weight: 40, unit: "lb", each: true }, "c:dumbbell-curl")'), false);
  const bests = run('prsOfLog([{ name: "Dumbbell Curl", canonical_id: "dumbbell-curl", sets: [{ reps: 10, weight: 50, unit: "lb", each: true, pr: true }] }])');
  assert.equal(bests['c:dumbbell-curl'].weight, 50);
  put('wo', null);
});

ok('the card and the pills say each: scSets, prText, figsOf', () => {
  assert.equal(run('scSets({ sets: [{ reps: 10, weight: 30, unit: "lb", each: true }, { reps: 10, weight: 30, unit: "lb", each: true }] })'), '2 × 10 · 30 lb each');
  assert.equal(run('scSets({ sets: [{ reps: 5, weight: 135, unit: "lb" }] })'), '1 × 5 · 135 lb');
  assert.deepEqual(run('figsOf(32, 6, 1200, null)'), [['32', 'min'], ['6', 'sets'], ['1,200', 'lb']]);
  assert.deepEqual(run('figsOf(1, 1, 0, null)')[2], ['—', 'bodyweight']);
});

// ---------- honest bests after a correction ----------
ok('a corrected set keeps its best only if it still beats every EARLIER session', () => {
  const earlier = { id: 'old', started_at: '2026-09-10T10:00:00Z', entries: [{ name: 'Dumbbell Curl', canonical_id: 'dumbbell-curl', sets: [{ reps: 10, weight: 45, unit: 'lb', each: true }] }] };
  const later = { id: 'new', started_at: '2026-09-30T10:00:00Z', entries: [{ name: 'Dumbbell Curl', canonical_id: 'dumbbell-curl', sets: [{ reps: 10, weight: 90, unit: 'lb' }] }] };
  const c = { payload: { id: 'this', started_at: '2026-09-20T10:00:00Z' }, past: true };
  put('state', { unit: 'lb', logs: [later, earlier, { id: 'this', started_at: c.payload.started_at, entries: [] }] });
  put('C', c);
  const E = '{ name: "Dumbbell Curl", canonical_id: "dumbbell-curl" }';
  assert.equal(run('sumStill(C, ' + E + ', { reps: 10, weight: 50, unit: "lb" })'), true, '50 beats 45; the later 90 is not earlier');
  assert.equal(run('sumStill(C, ' + E + ', { reps: 10, weight: 40, unit: "lb" })'), false, '40 does not beat 45');
  // Nothing loaded, a past session: it cannot be known, so the claim goes.
  put('state', { unit: 'lb', logs: null });
  assert.equal(run('sumStill(C, ' + E + ', { reps: 10, weight: 999, unit: "lb" })'), false);
  // The live moment falls back to what hist had before the session began.
  put('C', { payload: { id: null, started_at: c.payload.started_at }, past: null });
  put('hist', { 'c:dumbbell-curl': { best: 90, was: 60 } });
  put('histReady', true);
  assert.equal(run('sumStill(C, ' + E + ', { reps: 10, weight: 50, unit: "lb" })'), true, 'judged against was, not today\'s raised best');
  put('histReady', false);
  assert.equal(run('sumStill(C, ' + E + ', { reps: 10, weight: 50, unit: "lb" })'), false, 'no history, no claim');
});

console.log('\n' + checks + ' checks passed');
