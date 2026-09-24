// The block guard on POST /api/workouts/:id/exercises (edit_block, delete_block),
// run through the real handleCorrection lifted out of index.ts.
//
// What broke: on the phone, Edit section answered "This block changed — reopen
// the workout and try again." every time after any earlier edit to the card. The
// iOS shell routes edge-function calls through CapacitorHttp, whose Swift half
// parses an application/json answer with JSONSerialization (no key order, numbers
// as doubles) before the page sees it, so the card an edit hands back is the same
// card with its keys in another order. The guard compared JSON.stringify of the
// stored block with the block the client sent, so a key order was enough to refuse.
//
// Each case below takes the stored row, passes the client's copy through
// `bridged` — keys reversed or shuffled, fractional numbers at 17 significant
// digits, a null field dropped — and asserts the real handler accepts it. The
// concurrent cases change the STORED block the way another device would and
// assert the refusal still happens.
//
//   node tools/block-guard-harness.mjs
//   BLOCK_GUARD_SRC=/path/to/old/index.ts BLOCK_GUARD_EXPECT=fail node tools/block-guard-harness.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const SRC = process.env.BLOCK_GUARD_SRC || 'supabase/functions/spotter/index.ts';
const src = fs.readFileSync(SRC, 'utf8');

function lift(name, optional) {
  const m = src.match(new RegExp('^(?:export )?(?:async )?function ' + name + '(?:<[^>]*>)?\\(', 'm'));
  if (!m) { assert(optional, 'not found in index.ts: ' + name); return ''; }
  return src.slice(m.index, src.indexOf('\n}', m.index) + 2).replace(/^export /, '');
}
function constant(name) {
  const m = src.match(new RegExp('^const ' + name + '[^=]*=[^;]*;', 'm'));
  assert(m, 'not found in index.ts: ' + name);
  return m[0];
}

const code = [
  'class BadEdit extends Error {}',
  constant('EDIT_FIELDS'), constant('BLOCK_TYPES'),
  ...['guardNum', 'blockGuardForm', 'sameBlock'].map((n) => lift(n, true)),
  ...['deepCopy', 'cleanEditField', 'cleanBlockFields', 'blockFurnitureText', 'canonId', 'handleCorrection'].map((n) => lift(n)),
].join('\n');

// The database is one row in memory. A PATCH is conditional on the revision the
// handler read, as the real filter is, and the answer is the row as stored.
const db = { row: null, patches: 0, ledger: [] };
const ctx = vm.createContext({
  console: { log() {}, error: console.error, warn() {} }, Request, Response, JSON, Math, Number, String, Array, Object,
  LIMIT_CORRECTIONS: 500,
  json: (v, status = 200) => Response.json(v, { status }),
  utcMidnight: () => '2026-09-24T00:00:00Z',
  dbCount: async () => 0,
  dbSelect: async (table) => table === 'workouts' ? [JSON.parse(JSON.stringify(db.row))] : [],
  dbPatch: async (_t, q, body) => {
    const rev = Number(/user_edit_revision=eq\.(\d+)/.exec(q)[1]);
    if (rev !== (db.row.user_edit_revision ?? 0)) return undefined;
    db.patches++;
    db.row = { ...db.row, ...JSON.parse(JSON.stringify(body)), user_edit_revision: rev + 1 };
    return JSON.parse(JSON.stringify(db.row));
  },
  dbInsertMany: async (_t, rows) => { db.ledger.push(...rows); return rows; },
  applyCatalog: (c) => c,
  canonicalize: () => null,
  catalogById: () => null,
});
vm.runInContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, ctx);

const sameBlockLifted = (x, y) => ctx.sameBlock ? ctx.sameBlock(x, y) : JSON.stringify(x) === JSON.stringify(y);

async function post(body) {
  const r = await ctx.handleCorrection('w1', 'u1',
    new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify(body) }), {});
  return { code: r.status, body: await r.json() };
}

// ---- what the native bridge does to a card on its way to the page ----
function reorder(v, how) {
  if (Array.isArray(v)) return v.map((x) => reorder(x, how));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (how === 'reverse') keys.reverse();
    else keys.sort((a, b) => ((a.length * 7919 + a.charCodeAt(0)) % 13) - ((b.length * 7919 + b.charCodeAt(0)) % 13) || (a < b ? 1 : -1));
    const out = {};
    for (const k of keys) out[k] = reorder(v[k], how);
    return out;
  }
  // JSONSerialization hands doubles back at 17 significant digits on the iOS
  // versions testers carry: 12.3 arrives as 12.300000000000001.
  if (typeof v === 'number' && !Number.isInteger(v)) return Number(v.toPrecision(17));
  return v;
}
function bridged(block, how = 'reverse') {
  const b = reorder(JSON.parse(JSON.stringify(block)), how);
  // A client can also hold a field as null that the server stores absent.
  if (!('duration_seconds' in b)) b.duration_seconds = null;
  return b;
}

// ---- three shapes a real card's block has ----
// As validateProposal writes one: normalizeCard's exercise with recommendation,
// the pack fields, a citation with its source and fractional timestamps.
const pumpyBlock = { title: null, type: 'superset', rounds: null, rest_seconds: null, exercises: [
  { name: 'Overhead Tricep Extension', recommendation: { sets: null, reps: null, duration_seconds: null, rest_seconds: null, note: '' },
    canonical_id: 'overhead_tricep_extension', sets: 3, reps: '12', duration_seconds: null, rest_seconds: 150, weight: null,
    equipment: 'dumbbell', cue: 'Elbows by your ears.', notes: 'Elbows by your ears.', as_performed: null, delta: null,
    t0: 12.3, t1: 19.7, evidence: { source: 'transcript', quote: 'overhead extension', verified: true, t: 12.3 },
    source: { workout_id: 'a0000000-0000-0000-0000-000000000001', block_index: 0, exercise_index: 2 } },
  { name: 'Lateral Raise', recommendation: null, canonical_id: 'lateral_raise', sets: 3, reps: '15', duration_seconds: null,
    rest_seconds: null, weight: '15 lb', equipment: 'dumbbell', cue: null, notes: null, as_performed: null, delta: null,
    t0: null, t1: null, evidence: null },
] };
// A caption read: evidence located in the caption, no timestamps, a circuit.
const captionBlock = { title: 'Finisher', type: 'circuit', rounds: 3, rest_seconds: 60, exercises: [
  { name: 'Jump Squat', canonical_id: 'jump_squat', sets: null, reps: '20', duration_seconds: null, rest_seconds: null,
    weight: null, equipment: null, cue: null, notes: null, evidence: { source: 'caption', quote: '20 jump squats', verified: true, confidence: 0.92 } },
  { name: 'Plank', canonical_id: 'plank', sets: null, reps: null, duration_seconds: 45, rest_seconds: null, weight: null,
    equipment: null, cue: null, notes: null, evidence: { source: 'caption', quote: '45s plank', verified: true, confidence: 0.88 } },
] };
// Hands have been on it: an edited rest of zero, an added movement, a time cap.
const editedBlock = { title: 'AMRAP', type: 'amrap', rounds: null, rest_seconds: null, duration_seconds: 600, exercises: [
  { name: 'Burpee', canonical_id: 'burpee', sets: null, reps: '10', duration_seconds: null, rest_seconds: 0, weight: null,
    equipment: null, notes: null, evidence: null, edited_by_user: true },
  { name: 'Kettlebell Swing', canonical_id: 'kettlebell_swing', sets: null, reps: '15', duration_seconds: null, rest_seconds: null,
    weight: '24 kg', equipment: null, notes: null, evidence: null, added_by_user: true },
] };
const straight = { title: null, type: 'straight', rounds: null, rest_seconds: null, exercises: [
  { name: 'Goblet Squat', canonical_id: 'goblet_squat', sets: 3, reps: '10', duration_seconds: null, rest_seconds: 90,
    weight: null, equipment: 'dumbbell', notes: null, evidence: null } ] };

function seed(blocks) {
  db.row = { id: 'w1', user_id: 'u1', ingest_status: 'ready', shortcode: 'pumpy-w1', platform: 'pumpy',
    user_edit_revision: 2, muscle_groups: [], equipment: [], blocks: JSON.parse(JSON.stringify(blocks)) };
  db.patches = 0;
}

const legit = [];
const expectFail = process.env.BLOCK_GUARD_EXPECT === 'fail';
// control: a copy that never crossed the bridge, which every version accepts.
async function legitimate(label, fn, control) {
  try { await fn(); legit.push([label, 'pass', !!control]); }
  catch (e) { legit.push([label, 'FAIL: ' + e.message, !!control]); }
}

// 1. The owner's case: Pumpy's superset, Superset chosen, rest 2:30.
await legitimate('Pumpy-shaped superset: Edit section after the card came back through the bridge', async () => {
  seed([straight, pumpyBlock]);
  const r = await post({ op: 'edit_block', block: 1, expect_block: bridged(db.row.blocks[1]),
    fields: { title: '', type: 'superset', rounds: '', rest_seconds: 150, duration_seconds: '' } });
  assert.equal(r.code, 200, r.body.message);
  assert.equal(db.row.blocks[1].rest_seconds, 150);
  assert.equal(db.row.blocks[1].exercises[0].t0, 12.3, 'exercises are untouched, float and all');
  assert.deepEqual(db.row.blocks[1].exercises[0].evidence, pumpyBlock.exercises[0].evidence);
});
await legitimate('Caption-read circuit: Remove section with a shuffled copy', async () => {
  seed([straight, captionBlock]);
  const r = await post({ op: 'delete_block', block: 1, expect_block: bridged(db.row.blocks[1], 'shuffle') });
  assert.equal(r.code, 200, r.body.message);
  assert.equal(db.row.blocks.length, 1);
});
await legitimate('Edited AMRAP: Edit section, then again with the answer of the first', async () => {
  seed([editedBlock, straight]);
  let r = await post({ op: 'edit_block', block: 0, expect_block: bridged(db.row.blocks[0]),
    fields: { title: 'AMRAP', type: 'amrap', rounds: '', rest_seconds: '', duration_seconds: 720 } });
  assert.equal(r.code, 200, r.body.message);
  // The answer is what the page keeps, and it too arrives through the bridge.
  r = await post({ op: 'edit_block', block: 0, expect_block: bridged(r.body.workout.blocks[0], 'shuffle'),
    fields: { title: 'Ladder', type: 'amrap', rounds: '', rest_seconds: '', duration_seconds: 720 } });
  assert.equal(r.code, 200, r.body.message);
  assert.equal(db.row.blocks[0].title, 'Ladder');
});
await legitimate('The owner\'s sequence: an exercise edit, then Edit section on its block', async () => {
  seed([straight, pumpyBlock]);
  let r = await post({ op: 'edit', block: 1, index: 0, expect_name: 'Overhead Tricep Extension', fields: { rest_seconds: 0 } });
  assert.equal(r.code, 200, r.body.message);
  r = await post({ op: 'edit_block', block: 1, expect_block: bridged(r.body.workout.blocks[1]),
    fields: { title: 'Superset', type: 'superset', rounds: '', rest_seconds: 150, duration_seconds: '' } });
  assert.equal(r.code, 200, r.body.message);
});
await legitimate('An exact copy still passes', async () => {
  seed([captionBlock]);
  const r = await post({ op: 'edit_block', block: 0, expect_block: JSON.parse(JSON.stringify(db.row.blocks[0])),
    fields: { title: 'Finisher', type: 'circuit', rounds: 4, rest_seconds: 60, duration_seconds: '' } });
  assert.equal(r.code, 200, r.body.message);
}, true);

// ---- a genuinely concurrent change is still refused ----
const concurrent = [
  ['another device changed a rest in the block', (b) => { b.exercises[0].rest_seconds = 45; }],
  ['another device added an exercise to the block', (b) => { b.exercises.push({ name: 'Push-up', sets: 3, reps: '12' }); }],
  ['another device removed an exercise', (b) => { b.exercises.pop(); }],
  ['another device reordered the exercises', (b) => { b.exercises.reverse(); }],
  ['another device renamed the section', (b) => { b.title = 'Arms'; }],
  ['another device changed the rounds', (b) => { b.rounds = 4; }],
  ['another device swapped a movement', (b) => { b.exercises[1].name = 'Front Raise'; }],
  ['another device changed a dose', (b) => { b.exercises[1].reps = '20'; }],
];
for (const [label, change] of concurrent) {
  for (const op of ['edit_block', 'delete_block']) {
    seed([straight, pumpyBlock]);
    const seen = bridged(db.row.blocks[1]);
    change(db.row.blocks[1]);
    const r = await post({ op, block: 1, expect_block: seen,
      fields: { title: '', type: 'superset', rounds: '', rest_seconds: 150, duration_seconds: '' } });
    assert.equal(r.code, 409, op + ' refused when ' + label);
    assert.equal(r.body.status, 'stale');
    assert.equal(db.patches, 0, 'and nothing was written');
  }
}
// A block that moved: the index now holds a different block.
seed([straight, pumpyBlock]);
let moved = await post({ op: 'delete_block', block: 0, expect_block: bridged(pumpyBlock) });
assert.equal(moved.code, 409, 'a delete aimed at a block that is no longer at that index is refused');
// And the old shapes of a bad request keep their old answers.
seed([straight]);
assert.equal((await post({ op: 'edit_block', block: 0, fields: { rest_seconds: 60 } })).code, 409, 'no expect_block is stale');
assert.equal((await post({ op: 'edit_block', block: 3, expect_block: straight, fields: {} })).code, 409, 'no such block is stale');
assert.equal((await post({ op: 'delete_block', block: 0, expect_block: 'x' })).code, 409, 'a non-object is stale');

// ---- the page's half: asStored puts a bridged block back into jsonb's order ----
//
// So an app built from this branch passes even a deployment that still compares
// strings. The stored text comes from a real jsonb round trip in PGlite, not from
// a reimplementation of its key order.
if (!expectFail) {
  const { pathToFileURL } = await import('node:url');
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE ||
    '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js'));
  const pg = new PGlite();
  const app = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
  const a = app.indexOf('  function asStored(');
  assert(a >= 0, 'asStored is in app.ts');
  const page = vm.createContext({ Array, Object, Number, isFinite });
  vm.runInContext(app.slice(a, app.indexOf('\n  }', a) + 4), page);
  for (const [label, block] of [['Pumpy superset', pumpyBlock], ['caption circuit', captionBlock], ['edited AMRAP', editedBlock]]) {
    const stored = (await pg.query('select $1::jsonb b', [JSON.stringify(block)])).rows[0].b;
    for (const how of ['reverse', 'shuffle']) {
      const sent = page.asStored(reorder(JSON.parse(JSON.stringify(stored)), how));
      assert.equal(JSON.stringify(sent), JSON.stringify(stored), label + ' (' + how + '): the strict comparison of an older deployment passes');
      assert.equal(sameBlockLifted(stored, sent), true);
    }
  }
  await pg.close();
}

if (expectFail) {
  for (const [l, r] of legit) console.log((r === 'pass' ? '  pass ' : '  FAIL ') + l + (r === 'pass' ? '' : ' — ' + r.slice(6).split('\n')[0]));
  const bridgedCases = legit.filter((c) => !c[2]);
  assert(bridgedCases.every(([, r]) => r !== 'pass'), 'expected every bridged edit to fail on this source');
  assert(legit.filter((c) => c[2]).every(([, r]) => r === 'pass'), 'and the exact copy to pass');
  console.log('As expected on ' + SRC + ': all ' + bridgedCases.length + ' legitimate block edits through the bridge refused as stale; the exact copy and every concurrent case behave.');
} else {
  for (const [l, r] of legit) assert.equal(r, 'pass', l);
  console.log('PASS block guard: ' + legit.length + ' legitimate edits through the iOS bridge (Pumpy superset, caption circuit, edited AMRAP, ' +
    'the owner\'s sequence, an exact copy) accepted; ' + (concurrent.length * 2 + 4) + ' concurrent or malformed cases refused with nothing written; ' +
    'the page\'s asStored restores jsonb\'s own text for 3 shapes x 2 shuffles');
}
