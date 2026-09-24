// A reorder, written the way handleCorrection writes it, against every migration
// replayed in PGlite (tools/schema-replay.mjs):
//
//   - the order lands through the same patch as every correction: the personal
//     override snapshot plus blocks, fenced on user_edit_revision, so a second
//     write from the same stale read changes nothing;
//   - the override trigger holds it: a later reader completion or cache write of
//     the extractor's blocks cannot put the old order back;
//   - the ledger takes one row per reorder, kind 'edit', field 'order', and that
//     row is what the daily edit limit counts;
//   - a field the constraint does not know is still refused.
//
// applyReorder itself is lifted out of index.ts, so the blocks written here are
// the blocks the function would write.
//
//   node tools/reorder-db-check.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { replaySchema } from './schema-replay.mjs';

const idx = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
function tsFn(name) {
  const a = idx.indexOf('\nfunction ' + name + '(');
  assert(a >= 0, 'not found in index.ts: ' + name);
  return idx.slice(a + 1, idx.indexOf('\n}\n', a) + 3);
}
const srv = vm.createContext({});
vm.runInContext(transformSync('class BadEdit extends Error {}\n' + tsFn('applyReorder') + '\n' + tsFn('reorderGuard') +
  '\n' + tsFn('layoutText'), { loader: 'ts' }).code, srv);
const call = (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, srv)));

let checks = 0;
async function ok(what, f) { await f(); checks++; console.log('  ok  ' + what); }

const { db } = await replaySchema();
const U = '33333333-3333-4333-8333-333333333333';
const W = 'cccccccc-0000-4000-8000-000000000003';
const EXTRACTED = [
  { title: 'Warm-up', type: 'straight', rounds: null, rest_seconds: null, exercises: [
    { name: 'Jump Rope', canonical_id: 'jump-rope', sets: 1, duration_seconds: 300, evidence: { source: 'caption', quote: 'rope' } }] },
  { title: 'Strength', type: 'straight', rounds: null, rest_seconds: 120, exercises: [
    { name: 'Goblet Squat', canonical_id: 'goblet-squat', sets: 4, reps: '8', rest_seconds: 90 },
    { name: 'Dumbbell Row', canonical_id: 'dumbbell-row', sets: 3, reps: '10', each: true }] },
  { title: 'Finisher', type: 'superset', rounds: 3, rest_seconds: 60, exercises: [
    { name: 'Kettlebell Swing', canonical_id: 'kettlebell-swing', sets: 3, reps: '15', rest_seconds: 0 }] },
];
await db.exec(`insert into auth.users(id, email) values ('${U}', 'r@example.com');`);
await db.query(`insert into public.workouts(id, user_id, url, shortcode, platform, title, blocks, muscle_groups, equipment, has_full_workout)
  values ($1, $2, 'https://example.com/r', 'fx-r', 'web', 'Reorder card', $3, '{Legs}', '{Kettlebell}', true)`, [W, U, EXTRACTED]);
const row = async () => (await db.query('select * from public.workouts where id = $1', [W])).rows[0];

// What handleCorrection does after applyReorder: the kept filter, then one patch
// with the override snapshot, fenced on the revision it read. Returns rows hit.
async function patch(blocks, revision) {
  const kept = blocks.filter((b) => Array.isArray(b.exercises) && b.exercises.length > 0);
  const total = kept.reduce((n, b) => n + b.exercises.length, 0);
  const r = await db.query(`update public.workouts set user_workout_override = $1, blocks = $2, has_full_workout = $3
    where id = $4 and user_id = $5 and user_edit_revision = $6 returning id`,
  [{ blocks: kept, muscle_groups: ['Legs'], equipment: ['Kettlebell'], has_full_workout: total > 0 }, kept, total > 0, W, U, revision]);
  return r.rows.length;
}
async function ledger(field, oldValue, newValue) {
  await db.query(`insert into public.corrections(user_id, workout_id, shortcode, platform, kind, field, old_value, new_value,
    block_index, exercise_index) values ($1, $2, 'fx-r', 'web', 'edit', $3, $4, $5, null, null)`, [U, W, field, oldValue, newValue]);
}

console.log('the write');

// Finisher to the top, the row into the superset, the warm-up emptied into Strength.
const ORDER = [
  { block: 2, exercises: [0, [1, 1]] },
  { block: 1, exercises: [[0, 0], 0] },
  { block: 0, exercises: [] },
];

await ok('the order lands through the correction patch, and the revision moves on', async () => {
  const w = await row();
  assert.equal(call('reorderGuard(' + JSON.stringify(EXTRACTED) + ', ' + JSON.stringify(w.blocks) + ')'), true);
  const next = call('applyReorder(' + JSON.stringify(w.blocks) + ', ' + JSON.stringify(ORDER) + ')');
  assert.equal(await patch(next, Number(w.user_edit_revision)), 1);
  const after = await row();
  assert.deepEqual(after.blocks.map((b) => b.title), ['Finisher', 'Strength'], 'the emptied warm-up is gone');
  assert.deepEqual(after.blocks[0].exercises.map((x) => x.name), ['Kettlebell Swing', 'Dumbbell Row']);
  assert.deepEqual(after.blocks[1].exercises.map((x) => x.name), ['Jump Rope', 'Goblet Squat']);
  assert.deepEqual(after.blocks[1].exercises[0], EXTRACTED[0].exercises[0], 'evidence and all, as it was');
  assert.equal(after.blocks[0].rounds, 3);
  assert.equal(Number(after.user_edit_revision), Number(w.user_edit_revision) + 1);
  // A second write from the same read is fenced out.
  assert.equal(await patch(EXTRACTED, Number(w.user_edit_revision)), 0);
  assert.deepEqual((await row()).blocks.map((b) => b.title), ['Finisher', 'Strength']);
});

await ok('a later extractor write cannot put the old order back', async () => {
  // Reader completion and cache writes are service-role updates of blocks.
  await db.query('update public.workouts set blocks = $1, equipment = $2 where id = $3', [EXTRACTED, ['Barbell'], W]);
  const w = await row();
  assert.deepEqual(w.blocks.map((b) => b.title), ['Finisher', 'Strength']);
  assert.deepEqual(w.equipment, ['Kettlebell']);
});

await ok('the stale guard sees the stored order, so the old client view is refused', async () => {
  const w = await row();
  assert.equal(call('reorderGuard(' + JSON.stringify(w.blocks) + ', ' + JSON.stringify(EXTRACTED) + ')'), false);
  assert.equal(call('reorderGuard(' + JSON.stringify(w.blocks) + ', ' + JSON.stringify(w.blocks) + ')'), true);
});

console.log('the ledger');

await ok('one row per reorder, kind edit, field order, counted by the daily limit', async () => {
  const w = await row();
  await ledger('order', call('layoutText(' + JSON.stringify(EXTRACTED) + ')'), call('layoutText(' + JSON.stringify(w.blocks) + ')'));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  // The count handleCorrection makes before it lets an edit through.
  const n = (await db.query('select count(*)::int as n from public.corrections where user_id = $1 and created_at >= $2',
    [U, today.toISOString()])).rows[0].n;
  assert.equal(n, 1);
  const r = (await db.query("select kind, field, block_index, exercise_index, new_value from public.corrections where user_id = $1", [U])).rows[0];
  assert.deepEqual([r.kind, r.field, r.block_index, r.exercise_index], ['edit', 'order', null, null]);
  assert.deepEqual(JSON.parse(r.new_value).map((b) => b.title), ['Finisher', 'Strength']);
});

await ok('the constraint still refuses a field nobody declared', async () => {
  await assert.rejects(() => ledger('ordering', null, null), /corrections_field_check/);
  await assert.rejects(() => db.query(`insert into public.corrections(user_id, workout_id, kind, field)
    values ($1, $2, 'reorder', 'order')`, [U, W]), /corrections_kind_check/);
});

await ok('the migration re-runs cleanly', async () => {
  await db.exec(fs.readFileSync('supabase/migrations/20260924150000_corrections_order.sql', 'utf8'));
  await ledger('order', '[]', '[]');
});

console.log('\n' + checks + ' checks passed.');
