// C11: the five foreign keys that point at workouts each have an index their
// cascade can use. Replays the tables as the migrations define them (only the
// columns that matter), applies 20260924110000_workout_fk_indexes.sql, and asks
// the planner how it would run each lookup the foreign key makes when a card is
// deleted: the cascade's DELETE for plan and collection_items, and the SET NULL
// UPDATE for workout_logs, corrections and pumpy_threads.
//
//   node tools/fk-index-check.mjs      (PGLITE_MODULE as the other DB checks)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const runtime = process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(pathToFileURL(runtime));
const db = new PGlite();
await db.exec(`
create table public.workouts (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.workout_logs (id uuid primary key default gen_random_uuid(), user_id uuid,
  workout_id uuid references public.workouts(id) on delete set null, started_at timestamptz default now());
create index logs_user_started on public.workout_logs (user_id, started_at desc);
create table public.plan (id uuid primary key default gen_random_uuid(), user_id uuid, day date,
  workout_id uuid not null references public.workouts(id) on delete cascade);
create index plan_user_day on public.plan (user_id, day);
create table public.corrections (id uuid primary key default gen_random_uuid(), user_id uuid,
  workout_id uuid references public.workouts(id) on delete set null, created_at timestamptz default now());
create table public.collection_items (collection_id uuid, user_id uuid,
  workout_id uuid not null references public.workouts(id) on delete cascade, primary key (collection_id, workout_id));
create index collection_items_user on public.collection_items (user_id, workout_id);
create table public.pumpy_threads (id uuid primary key default gen_random_uuid(), user_id uuid,
  workout_id uuid references public.workouts(id) on delete set null, updated_at timestamptz default now());
`);
await db.exec(readFileSync('supabase/migrations/20260924110000_workout_fk_indexes.sql', 'utf8'));
// Idempotent: a second run is a no-op, as `supabase db push` retries expect.
await db.exec(readFileSync('supabase/migrations/20260924110000_workout_fk_indexes.sql', 'utf8'));

// Enough rows that a sequential scan is the planner's honest alternative.
await db.exec(`
insert into workouts (id, user_id) select gen_random_uuid(), gen_random_uuid() from generate_series(1, 2000);
insert into workout_logs (user_id, workout_id) select user_id, case when random() < .2 then null else id end from workouts, generate_series(1, 10);
insert into plan (user_id, day, workout_id) select user_id, current_date, id from workouts;
insert into corrections (user_id, workout_id) select user_id, case when random() < .5 then null else id end from workouts;
insert into collection_items (collection_id, user_id, workout_id) select gen_random_uuid(), user_id, id from workouts;
insert into pumpy_threads (user_id, workout_id) select user_id, case when random() < .5 then null else id end from workouts;
analyze;
`);

const plan = async (sql) => (await db.query('explain ' + sql)).rows.map((r) => r['QUERY PLAN']).join('\n');
let n = 0;
const w = (await db.query('select id from workouts limit 1')).rows[0].id;
for (const [table, index, sql] of [
  ['workout_logs', 'workout_logs_workout', `update public.workout_logs set workout_id = null where workout_id = '${w}'`],
  ['corrections', 'corrections_workout', `update public.corrections set workout_id = null where workout_id = '${w}'`],
  ['pumpy_threads', 'pumpy_threads_workout', `update public.pumpy_threads set workout_id = null where workout_id = '${w}'`],
  ['plan', 'plan_workout', `delete from public.plan where workout_id = '${w}'`],
  ['collection_items', 'collection_items_workout', `delete from public.collection_items where workout_id = '${w}'`],
]) {
  const idx = (await db.query('select indexdef from pg_indexes where schemaname = $1 and indexname = $2', ['public', index])).rows;
  assert.equal(idx.length, 1, index + ' exists');
  const p = await plan(sql);
  assert(p.includes(index), table + ': the foreign key lookup uses ' + index + '\n' + p);
  assert(!/Seq Scan/.test(p), table + ': no sequential scan\n' + p);
  n++;
}
// The generic plan the RI trigger prepares, with the key as a parameter.
await db.exec(`prepare ri(uuid) as update public.workout_logs set workout_id = null where workout_id = $1; set plan_cache_mode = force_generic_plan;`);
const generic = (await db.query(`explain execute ri('${w}')`)).rows.map((r) => r['QUERY PLAN']).join('\n');
assert(generic.includes('workout_logs_workout'), 'a parameterised lookup still uses the partial index\n' + generic);
n++;
// The cascade itself works end to end.
await db.exec(`delete from public.workouts where id = '${w}'`);
const left = (await db.query(`select (select count(*) from plan where workout_id = $1) + (select count(*) from workout_logs where workout_id = $1) as n`, [w])).rows[0].n;
assert.equal(Number(left), 0, 'deleting a card still cascades and nulls');
n++;
console.log('PASS ' + n + ' foreign-key index checks: five indexes, each used by its lookup (generic plan too), cascade intact.');
