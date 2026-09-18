// Staging correctness: the reader fence, the Pumpy confirmation and the AI attempt
// ledger under GENUINE multi-connection concurrency on real PostgreSQL 15.
//
// Why this exists: tools/reader-completion-db-check.mjs, tools/pumpy-confirm-db-check.mjs
// and tools/ai-attempt-db-check.mjs prove the same SQL in PGlite, which is a single
// connection and a single backend. Promise interleaving there is cooperative; it can
// never produce a row lock wait, a lock-release re-check under READ COMMITTED, a
// deadlock, or a serialization failure. Those are exactly the failures that corrupt a
// user's workout card, double-charge a preview, or apply a Pumpy proposal twice.
//
// This harness starts a throwaway postgres:15-alpine container, rebuilds the shimmed
// schema those three checks agree on, applies the REAL migration files, and then runs
// every scenario with N genuinely separate TCP connections, repeated with randomized
// jitter and randomized task order. Every scenario uses a lock barrier so the workers
// are actually inside the function at the same time rather than merely started together.
//
// No network calls, no AI calls, no production database. See tools/staging/README.md.

import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID, randomBytes} from 'node:crypto';
import pg from 'pg';

const {Client} = pg;

const CONTAINER = process.env.STAGING_CONTAINER || 'spotter-staging-pg';
const IMAGE = 'postgres:15-alpine';
const PORT = Number(process.env.STAGING_PORT || 54329);
const ROUNDS = Number(process.env.STAGING_ROUNDS || 20);
const KEEP = process.env.STAGING_KEEP === '1';

// pg returns numeric as a string to avoid float loss. Keep it that way and compare
// with Number() at the assertion site, so a silent precision change cannot hide a
// money bug.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.random() * 0.05; // seconds, fed to pg_sleep
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

// jsonb does not preserve key order, so compare canonically or the harness invents
// failures of its own. Key ORDER is not a product invariant; key/value content is.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// ---------------------------------------------------------------- result recording

const scenarios = [];
let current = null;

function scenario(id, name) {
  current = {id, name, rounds: 0, checks: 0, violations: [], findings: [], codes: new Map(), expected: new Set(), ms: 0};
  scenarios.push(current);
  return current;
}
function note(code) {
  if (!code) return;
  current.codes.set(code, (current.codes.get(code) || 0) + 1);
}
function check(ok, message, detail) {
  current.checks += 1;
  if (!ok) current.violations.push(detail === undefined ? message : message + ' :: ' + JSON.stringify(detail));
}
// SQLSTATEs this scenario deliberately provokes (the injected-failure sub-cases).
// They are still printed, but flagged so the table is not read as a real error budget.
function expectCode(code) { current.expected.add(code); }
function finding(message) {
  if (!current.findings.includes(message)) current.findings.push(message);
}

// ---------------------------------------------------------------- container

function docker(args, opts = {}) {
  return spawnSync('docker', args, {encoding: 'utf8', ...opts});
}

function startContainer(password) {
  const existing = docker(['ps', '-aq', '--filter', 'name=^/' + CONTAINER + '$']).stdout.trim();
  if (existing) {
    // Our own throwaway from a previous run. Its password was generated then and is
    // gone, so it cannot be reused: replace it rather than guess.
    process.stdout.write('removing previous ' + CONTAINER + '\n');
    docker(['rm', '-f', CONTAINER]);
  }
  const run = docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    // -e NAME with no value inherits from this process, so the password never appears
    // in the docker command line (and therefore never in `ps` output).
    '-e', 'POSTGRES_PASSWORD',
    '-e', 'POSTGRES_DB=postgres',
    '-p', '127.0.0.1:' + PORT + ':5432',
    IMAGE,
    // Keep the log quiet but keep lock waits visible if anything hangs.
    '-c', 'log_lock_waits=on', '-c', 'deadlock_timeout=200ms', '-c', 'max_connections=60',
  ], {env: {...process.env, POSTGRES_PASSWORD: password}});
  if (run.status !== 0) throw new Error('docker run failed: ' + (run.stderr || run.stdout));
  return run.stdout.trim().slice(0, 12);
}

function stopContainer() {
  if (KEEP) {
    process.stdout.write('STAGING_KEEP=1 — leaving ' + CONTAINER + ' running on port ' + PORT + '\n');
    return;
  }
  // --rm on the run means stop also removes it; force rm covers a wedged stop.
  docker(['stop', '-t', '2', CONTAINER]);
  docker(['rm', '-f', CONTAINER]);
}

async function waitReady(password) {
  const deadline = Date.now() + 60000;
  for (;;) {
    const ready = docker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-q']);
    if (ready.status === 0) {
      // pg_isready goes green over the unix socket before TCP is accepting. Prove TCP.
      try {
        const probe = connect(password);
        await probe.connect();
        await probe.query('select 1');
        await probe.end();
        return;
      } catch (e) {
        if (Date.now() > deadline) throw e;
      }
    }
    if (Date.now() > deadline) throw new Error('postgres did not become ready in 60s');
    await sleep(300);
  }
}

function connect(password) {
  return new Client({
    host: '127.0.0.1', port: PORT, user: 'postgres', password, database: 'postgres',
    application_name: 'spotter-staging-check',
  });
}

const clients = [];
async function newClient(password, label) {
  const c = connect(password);
  await c.connect();
  // A blocked worker must surface as an error, not a hung harness. Every scenario's
  // intentional waits are well under a second.
  await c.query("set lock_timeout='10s'");
  await c.query("set statement_timeout='30s'");
  await c.query("set application_name=" + quoteLiteral('spotter-staging:' + label));
  clients.push(c);
  return c;
}
function quoteLiteral(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// ---------------------------------------------------------------- query helpers

async function q(client, sql, params) {
  const r = await client.query(sql, params);
  return r;
}

// Run a unit of work in its own transaction and never throw: the SQLSTATE is the
// point of the exercise. Returns {ok, rows, rowCount, code, message}.
async function tx(client, body) {
  try {
    await client.query('begin');
  } catch (e) {
    note(e.code);
    return {ok: false, code: e.code, message: e.message, rows: [], rowCount: 0};
  }
  try {
    const r = await body(client);
    await client.query('commit');
    return {ok: true, rows: r ? r.rows : [], rowCount: r ? r.rowCount : 0};
  } catch (e) {
    note(e.code);
    try { await client.query('rollback'); } catch { /* connection already reset */ }
    if (e.code === '40P01') finding('deadlock (40P01) observed: ' + e.message);
    if (e.code === '40001') finding('serialization failure (40001) observed: ' + e.message);
    if (e.code === '55P03' || e.code === '57014') finding('lock/statement timeout (' + e.code + ') observed: ' + e.message);
    return {ok: false, code: e.code, message: e.message, rows: [], rowCount: 0};
  }
}

const PARKED_SQL = "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and application_name like 'spotter-staging:w%'";
function recordParked(parked) {
  current.parked = Math.max(current.parked || 0, parked);
  current.parkedMin = current.parkedMin === undefined ? parked : Math.min(current.parkedMin, parked);
}

// The barrier. Every function under test begins by taking a row lock (profiles for the
// ingest/Pumpy RPCs, ai_guard_policy for the AI ledger). Holding that row from a
// controller connection parks every worker INSIDE its function call; releasing it lets
// them race for real. Without this, Node's event loop hands them out one at a time and
// the test degenerates into the PGlite case it is meant to replace.
async function contend(controller, lockSql, lockParams, tasks) {
  await controller.query('begin');
  await controller.query(lockSql, lockParams);
  const started = shuffle(tasks.slice()).map((t) => t());
  // Longer than the maximum pg_sleep jitter, so every worker has reached its first
  // lock by the time the sensor below samples.
  await sleep(60 + Math.floor(Math.random() * 60));
  // Self-check: count the workers actually asleep on a lock before the barrier is
  // lifted. If this were 0 the scenario would be running sequentially and passing
  // vacuously, which is the exact failure mode that let PGlite look green.
  recordParked(Number((await controller.query(PARKED_SQL)).rows[0].n));
  await controller.query('commit');
  return Promise.all(started);
}

// ---------------------------------------------------------------- schema

function slice(file, from, to) {
  const sql = readFileSync(file, 'utf8');
  const a = sql.indexOf(from);
  if (a < 0) throw new Error('slice start not found in ' + file + ': ' + from);
  const b = to === undefined ? sql.length : sql.indexOf(to, a);
  if (to !== undefined && b < 0) throw new Error('slice end not found in ' + file + ': ' + to);
  return sql.slice(a, b);
}

const M = 'supabase/migrations/';
const GUARDS = M + '20260908150000_cost_and_abuse_guards.sql';
const PREVIEWS = M + '20260917120000_reader_quality_previews.sql';
const FENCE = M + '20260917130000_reader_completion_fence.sql';
const PUMPY = M + '20260917140000_pumpy_confirmation.sql';
const ATTEMPT = M + '20260917150000_ai_attempt_observability.sql';

// Table shapes are copied verbatim from the three PGlite checks, which stay the source
// of truth. Divergences between them are recorded in design/gtm/STAGING-CONCURRENCY.md.
const BASE_SHIM = `set timezone='UTC';create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql as $fn$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$fn$;
create table profiles(id uuid primary key,plan text);
create table corrections(workout_id uuid,field text);
create table ingest_jobs(id uuid primary key,user_id uuid,shortcode text,status text,locked_by text,
  attempts int,created_at timestamptz,step text,finished_at timestamptz,updated_at timestamptz,
  locked_at timestamptz,meta jsonb,card jsonb,run_after timestamptz,last_error text);
create table video_previews(user_id uuid,shortcode text,month date,completed boolean default false,
  created_at timestamptz default now(),primary key(user_id,shortcode,month));
create table video_cache(shortcode text primary key,card jsonb,basic_card jsonb,basic_v integer);
create table workouts(id uuid primary key,user_id uuid,shortcode text,ingest_job_id uuid,ingest_status text,
  url text,platform text,kind text,author text,title text,caption text,thumb_url text,category text,
  muscle_groups text[],equipment text[],difficulty text,duration_minutes int,calories int,
  blocks jsonb,tags text[],has_full_workout boolean,read_quality text,read_plan text,source_url text,
  confidence numeric,extracted_by text,ingest_error text,media_stage text);`;

const BASE_SHIM_2 = `alter table ingest_jobs alter column id set default gen_random_uuid(),
  alter column status set default 'queued',alter column created_at set default now(),
  alter column attempts set default 0,add column url text,add column platform text,add column kind text;
  alter table workouts alter column id set default gen_random_uuid(),alter column blocks set default '[]',
  add unique(user_id,shortcode);
  create unique index ingest_active on ingest_jobs(user_id,shortcode) where status in ('queued','running');
  create table saves_log(user_id uuid,shortcode text,cached boolean,kind text,platform text,job_id uuid);`;

// Exactly what tools/pumpy-confirm-db-check.mjs adds on top of the base shim.
const PUMPY_SHIM = `alter table profiles add column limits jsonb;
create table app_config(key text primary key,value text);
create table pumpy_threads(id uuid primary key,user_id uuid,updated_at timestamptz);
create table pumpy_messages(id bigint generated always as identity primary key,thread_id uuid,user_id uuid,
 role text,content text,meta jsonb,created_at timestamptz default now());
create table plan(id uuid primary key default gen_random_uuid(),user_id uuid,day date,workout_id uuid);
alter table corrections add column user_id uuid,add column shortcode text,add column platform text,
 add column kind text,add column old_value text,add column new_value text,
 add column old_canonical_id text,add column new_canonical_id text,add column old_exercise jsonb,add column new_exercise jsonb,
 add column block_index integer,add column exercise_index integer,add column exercise_name text,add column extracted_by text,add column confidence numeric;`;

// The month-boundary wrapper. reserve_video_preview reads now() and is declared
// `set search_path=public`; pg_catalog is still searched first, so public.now() cannot
// shadow it and the shipping function is not clock-controllable. This wrapper is the
// migration's own body with now() textually replaced by a parameter — the advisory
// lock, the existence probe and the >=4 cap are untouched. The substitution count is
// asserted so a future edit to the real function cannot silently desynchronise it.
function clockWrapper() {
  const real = slice(PREVIEWS, 'create or replace function public.reserve_video_preview', '-- Retire unused provider');
  const open = real.indexOf('declare m date');
  const close = real.indexOf('end $$;', open);
  if (open < 0 || close < 0) throw new Error('reserve_video_preview body markers moved: update the staging clock wrapper');
  const body = real.slice(open, close) + 'end ';
  const occurrences = (body.match(/now\(\)/g) || []).length;
  if (occurrences !== 1) {
    throw new Error('reserve_video_preview now() occurrences changed (' + occurrences + '): update the staging clock wrapper');
  }
  const shifted = body.replace(/now\(\)/g, 'p_now');
  return 'create function public.staging_reserve_video_preview_at(p_user uuid,p_shortcode text,p_now timestamptz)\n'
    + 'returns boolean language plpgsql security definer set search_path=public as $wrap$\n' + shifted + '$wrap$;';
}

async function buildSchema(admin) {
  await admin.query(BASE_SHIM);
  await admin.query(BASE_SHIM_2);
  await admin.query(slice(PREVIEWS, 'create or replace function public.reserve_video_preview', '-- Retire unused provider'));
  await admin.query(readFileSync(FENCE, 'utf8'));
  await admin.query(PUMPY_SHIM);
  await admin.query(slice(GUARDS, 'create function public.guard_workout_library()', '-- Explicit function grants'));
  await admin.query(readFileSync(PUMPY, 'utf8'));
  // AI ledger. Unlike tools/ai-attempt-db-check.mjs (which shims ai_guard_policy as a
  // lone boolean column) we take the real policy table, so ai_reserve's budget
  // arithmetic is exercised under concurrency too — that is the money invariant.
  await admin.query(slice(GUARDS, 'create table public.ai_guard_policy (', 'create table public.ai_reservations ('));
  await admin.query(slice(GUARDS, 'create table public.ai_reservations (', 'create table public.ai_actions'));
  await admin.query(slice(GUARDS, 'create function public.ai_reserve(', 'create function public.ai_settle('));
  await admin.query(slice(GUARDS, 'create function public.ai_settle(', 'create function public.ai_budget_status'));
  await admin.query(readFileSync(ATTEMPT, 'utf8'));
  await admin.query(clockWrapper());
}

// ---------------------------------------------------------------- fixtures

const USER_A = randomUUID();
const USER_B = randomUUID();
const BLOCKS = [{name: 'Main', exercises: [{name: 'Squat', sets: 3, reps: '12'}]}];
const EDITED = [{name: 'Main', exercises: [{name: 'My squat', sets: 2, reps: '7', edited_by_user: true}]}];
const PAYLOAD = {
  title: 'New read', blocks: BLOCKS, muscle_groups: ['Legs'], equipment: [], tags: [],
  has_full_workout: true, read_quality: 'premium', read_plan: 'plus',
};

async function seedUsers(admin) {
  await admin.query("insert into profiles(id,plan) values ($1,'plus'),($2,'plus')", [USER_A, USER_B]);
}

// A clean running job with its processing workout, one per round, so a round can never
// inherit the previous round's state.
async function freshJob(admin, tag, user = USER_A) {
  const job = randomUUID(); const workout = randomUUID(); const shortcode = 'sc-' + tag;
  await admin.query(
    "insert into ingest_jobs(id,user_id,shortcode,status,locked_by,locked_at,attempts,claim_generation,created_at) values($1,$2,$3,'running','worker',now(),2,2,now())",
    [job, user, shortcode]);
  await admin.query(
    "insert into workouts(id,user_id,shortcode,ingest_job_id,ingest_status,blocks,title) values($1,$2,$3,$4,'processing',$5,'Original')",
    [workout, user, shortcode, job, JSON.stringify(BLOCKS)]);
  const gen = Number((await admin.query('select claim_generation from ingest_jobs where id=$1', [job])).rows[0].claim_generation);
  return {job, workout, shortcode, gen, user};
}

const finishSql = 'select finish_ingest_job($1,$2,$3,$4,$5) as result';
// Each scenario barriers on the FIRST lock its callers take, so every worker parks
// rather than only the ones that happen to touch profiles.
const lockJob = 'select 1 from ingest_jobs where id=$1 for update';
const lockWorkout = 'select 1 from workouts where id=$1 for update';
const lockMessage = 'select 1 from pumpy_messages where id=$1 for update';
const lockPreviewUser = 'select pg_advisory_xact_lock(hashtextextended($1::text,917))';

// ---------------------------------------------------------------- scenario 1

async function scenarioOneWriter(admin, pool) {
  const s = scenario(1, 'Two workers complete the same job concurrently');
  const t0 = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    const f = await freshJob(admin, 's1-' + round);
    // Half the rounds pit the current generation against a stale one (a reclaimed
    // worker that woke up); half pit two live invocations of the same claim against
    // each other (a retried HTTP call to the same worker).
    const staleRound = round % 2 === 0;
    const gens = staleRound ? [f.gen, f.gen - 1] : [f.gen, f.gen];
    const workers = staleRound ? ['worker', 'worker'] : ['worker', 'worker'];
    const results = await contend(pool.controller, lockJob, [f.job], gens.map((g, i) => () =>
      tx(pool.workers[i], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_A, workers[i], g, JSON.stringify({...PAYLOAD, title: 'read-' + i})]);
      })));
    const parsed = results.map((r) => (r.ok ? r.rows[0].result : {status: 'error:' + r.code, filled: -1}));
    const done = parsed.filter((p) => p.status === 'done');
    const filled = parsed.reduce((n, p) => n + (p.filled > 0 ? p.filled : 0), 0);
    check(filled === 1, 's1 exactly one row written', {round, parsed});
    check(done.length === 1, 's1 exactly one completion reports done', {round, parsed});
    if (staleRound) {
      check(parsed.some((p) => p.status === 'stale'), 's1 the stale generation is rejected as stale', {round, parsed});
    }
    const w = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
    const j = (await admin.query('select * from ingest_jobs where id=$1', [f.job])).rows[0];
    check(w.ingest_status === 'ready', 's1 workout reaches ready exactly once', {round, status: w.ingest_status});
    check(/^read-[01]$/.test(w.title), 's1 workout holds one complete payload, not a mixture', {round, title: w.title});
    check(canon(w.blocks) === canon(BLOCKS), 's1 blocks not corrupted', {round, blocks: w.blocks});
    check(j.status === 'done' && j.locked_by === null, 's1 job closed once', {round, status: j.status});
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 2

async function scenarioCompletionVsEdit(admin, pool) {
  const s = scenario(2, 'Completion racing a user correction (and a Pumpy append)');
  const t0 = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    const f = await freshJob(admin, 's2-' + round);
    const override = {blocks: EDITED, muscle_groups: ['Legs'], equipment: ['Dumbbell'], has_full_workout: true};
    // Barrier on the workout row: the completion and the edit both end up wanting it,
    // so both commit orders really occur instead of the edit always winning.
    const results = await contend(pool.controller, lockWorkout, [f.workout], [
      () => tx(pool.workers[0], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_A, 'worker', f.gen, JSON.stringify(PAYLOAD)]);
      }),
      // The user's own edit is its own transaction on its own connection, run as the
      // authenticated owner so the trigger's auth.uid() branch is the real one.
      () => tx(pool.workers[1], async (c) => {
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [USER_A]);
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query("update workouts set user_workout_override=$1,title='My personal title' where id=$2 and user_id=$3",
          [JSON.stringify(override), f.workout, USER_A]);
      }),
    ]);
    const completion = results.find((r) => r.ok && r.rows[0] && r.rows[0].result);
    const w = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
    check(results.every((r) => r.ok), 's2 neither side errors out', {round, codes: results.map((r) => r.code)});
    check(canon(w.blocks) === canon(EDITED), 's2 the personal edit survives either commit order', {round, blocks: w.blocks});
    check(canon(w.equipment) === canon(['Dumbbell']), 's2 personal equipment survives', {round, equipment: w.equipment});
    check(w.title === 'My personal title', 's2 personal title rename survives reader completion', {round, title: w.title});
    check(Number(w.user_edit_revision) === 1, 's2 exactly one personal edit revision', {round, rev: w.user_edit_revision});
    if (completion) {
      check(w.ingest_status === 'ready', 's2 an accepted completion still lands the row', {round, status: w.ingest_status});
    }
    s.rounds++;
  }

  // 2b: the same race, but the "correction" arrives through the Pumpy append path,
  // which reaches the row through confirm_pumpy_proposal rather than a REST update.
  for (let round = 0; round < ROUNDS; round++) {
    const f = await freshJob(admin, 's2b-' + round);
    const thread = randomUUID();
    await admin.query('insert into pumpy_threads values($1,$2,now())', [thread, USER_A]);
    const proposal = {
      kind: 'append_exercises', workout_id: f.workout, workout_title: 'Original', block_title: 'Added',
      exercises: [{name: 'Lunge', canonical_id: 'lunge'}], summary: 'Add lunge',
    };
    const mid = (await admin.query(
      "insert into pumpy_messages(thread_id,user_id,role,meta) values($1,$2,'assistant',$3) returning id",
      [thread, USER_A, JSON.stringify({proposal, status: 'pending', model: 'fixture'})])).rows[0].id;
    const appended = [...BLOCKS, {title: 'Added', exercises: proposal.exercises}];
    const prepared = {expected_revision: 0, base_blocks: BLOCKS, blocks: appended, muscle_groups: ['Legs'], equipment: []};
    const results = await contend(pool.controller, lockWorkout, [f.workout], [
      () => tx(pool.workers[0], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_A, 'worker', f.gen, JSON.stringify(PAYLOAD)]);
      }),
      () => tx(pool.workers[1], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query('select confirm_pumpy_proposal($1,$2,true,$3) as result', [USER_A, mid, JSON.stringify(prepared)]);
      }),
    ]);
    const pumpy = results.map((r) => (r.ok && r.rows[0] && r.rows[0].result ? r.rows[0].result : null))
      .find((x) => x && (x.status === 'ok' || x.status === 'conflict' || x.status === 'limit'));
    const w = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
    const corr = Number((await admin.query('select count(*)::int n from corrections where workout_id=$1', [f.workout])).rows[0].n);
    const meta = (await admin.query('select meta from pumpy_messages where id=$1', [mid])).rows[0].meta;
    check(results.every((r) => r.ok), 's2b neither side errors out', {round, codes: results.map((r) => r.code)});
    if (pumpy && pumpy.status === 'ok') {
      check(canon(w.blocks) === canon(appended), 's2b an accepted append is the row the user sees', {round, blocks: w.blocks});
      check(corr === proposal.exercises.length, 's2b accepted append records its corrections once', {round, corr});
      check(meta.status === 'done', 's2b accepted append marks the proposal done', {round, meta: meta.status});
    } else {
      check(corr === 0, 's2b a rejected append writes no corrections', {round, corr, pumpy});
      check(meta.status === 'pending', 's2b a rejected append leaves the proposal retryable', {round, meta: meta.status, pumpy});
      check(canon(w.blocks) !== canon(appended), 's2b a rejected append did not half-apply', {round, blocks: w.blocks});
    }
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 3

async function scenarioSweeperReclaim(admin, pool) {
  const s = scenario(3, 'Sweeper reclaims a job while the old worker is mid-completion');
  const t0 = Date.now();
  const sweep = "update ingest_jobs set status='running',locked_by='sweeper',locked_at=now(),attempts=attempts+1,updated_at=now() where id=$1 and status='running' returning claim_generation";
  for (let round = 0; round < ROUNDS; round++) {
    const f = await freshJob(admin, 's3-' + round);
    const sweeperFirst = round % 2 === 0;
    const worker = pool.workers[0]; const sweeper = pool.workers[1];
    let completion; let reclaim;
    if (sweeperFirst) {
      // The sweeper holds the job row uncommitted; the worker's finish_ingest_job
      // parks on `select ... for update` and, under READ COMMITTED, re-reads the
      // reclaimed row when the lock is released. This is the interleaving PGlite
      // cannot produce at all, and the one the fence exists for.
      await sweeper.query('begin');
      reclaim = await sweeper.query(sweep, [f.job]);
      const running = tx(worker, async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_A, 'worker', f.gen, JSON.stringify(PAYLOAD)]);
      });
      await sleep(60 + Math.floor(Math.random() * 60));
      recordParked(Number((await admin.query(PARKED_SQL)).rows[0].n));
      await sweeper.query('commit');
      completion = await running;
      const res = completion.ok ? completion.rows[0].result : {status: 'error:' + completion.code, filled: -1};
      check(res.status === 'stale' && res.filled === 0, 's3 the reclaimed worker is fenced out', {round, res});
      const w = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
      const j = (await admin.query('select * from ingest_jobs where id=$1', [f.job])).rows[0];
      check(w.ingest_status === 'processing', 's3 workout stays processing for the new owner', {round, status: w.ingest_status});
      check(w.title === 'Original', 's3 the fenced worker wrote nothing', {round, title: w.title});
      check(j.status === 'running' && j.locked_by === 'sweeper', 's3 the job stays with the sweeper', {round, j: {s: j.status, l: j.locked_by}});
      check(Number(j.claim_generation) === f.gen + 1, 's3 reclaim bumps the generation exactly once', {round, gen: j.claim_generation});
      check(Number(reclaim.rows[0].claim_generation) === f.gen + 1, 's3 the sweeper sees the new generation', {round});
    } else {
      // Opposite order: the worker commits first, so the sweeper's reclaim must find
      // nothing to reclaim rather than resurrecting a finished job.
      await worker.query('begin');
      completion = await worker.query(finishSql, [f.job, USER_A, 'worker', f.gen, JSON.stringify(PAYLOAD)]);
      const sweeping = tx(sweeper, async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(sweep, [f.job]);
      });
      await sleep(60 + Math.floor(Math.random() * 60));
      recordParked(Number((await admin.query(PARKED_SQL)).rows[0].n));
      await worker.query('commit');
      reclaim = await sweeping;
      check(reclaim.ok && reclaim.rowCount === 0, 's3 a finished job cannot be reclaimed', {round, reclaim: {ok: reclaim.ok, n: reclaim.rowCount, code: reclaim.code}});
      const w = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
      const j = (await admin.query('select * from ingest_jobs where id=$1', [f.job])).rows[0];
      check(w.ingest_status === 'ready' && w.title === 'New read', 's3 the winning completion landed', {round, status: w.ingest_status});
      check(j.status === 'done', 's3 job is done and stays done', {round, status: j.status});
    }
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 4

async function scenarioPumpyConfirmations(admin, pool) {
  const s = scenario(4, 'Five concurrent Pumpy confirmations of the same proposal');
  const t0 = Date.now();
  const block = {title: null, type: 'straight', exercises: [{name: 'Squat', reps: '5'}]};
  const create = {
    kind: 'create_workout', title: 'Training', summary: 'Training', category: 'Strength',
    muscle_groups: ['Legs'], equipment: [], difficulty: null, duration_minutes: 20, blocks: [block],
  };
  const thread = randomUUID();
  await admin.query('insert into pumpy_threads values($1,$2,now())', [thread, USER_A]);
  for (let round = 0; round < ROUNDS; round++) {
    const mid = (await admin.query(
      "insert into pumpy_messages(thread_id,user_id,role,meta) values($1,$2,'assistant',$3) returning id",
      [thread, USER_A, JSON.stringify({proposal: {...create, title: 'Training ' + round}, status: 'pending', model: 'fixture'})])).rows[0].id;
    // Half the rounds replay the same prepared identity (a retried HTTP request that
    // reused its body); half send five different identities (five independent client
    // taps). Both must produce one workout.
    const sameIdentity = round % 2 === 0;
    const shared = randomUUID();
    const before = Number((await admin.query('select count(*)::int n from workouts where user_id=$1', [USER_A])).rows[0].n);
    const results = await contend(pool.controller, lockMessage, [mid], pool.workers.slice(0, 5).map((c) => () =>
      tx(c, async (cc) => {
        await cc.query('select pg_sleep($1)', [jitter()]);
        return cc.query('select confirm_pumpy_proposal($1,$2,true,$3) as result',
          [USER_A, mid, JSON.stringify({id: sameIdentity ? shared : randomUUID()})]);
      })));
    const payloads = results.map((r) => (r.ok ? r.rows[0].result : {status: 'error:' + r.code}));
    const okays = payloads.filter((p) => p.status === 'ok');
    const after = Number((await admin.query('select count(*)::int n from workouts where user_id=$1', [USER_A])).rows[0].n);
    const receipts = Number((await admin.query(
      "select count(*)::int n from pumpy_messages where thread_id=$1 and meta->>'proposal_message_id'=$2", [thread, String(mid)])).rows[0].n);
    const ids = new Set(okays.map((p) => p.workout && p.workout.id));
    check(after - before === 1, 's4 exactly one workout is created by five confirmations', {round, before, after, payloads: payloads.map((p) => p.status)});
    check(okays.length === 5, 's4 every caller gets the same successful receipt', {round, payloads: payloads.map((p) => p.status)});
    check(ids.size === 1, 's4 all five receipts name the same workout', {round, ids: [...ids]});
    check(receipts === 1, 's4 exactly one tool receipt is recorded', {round, receipts});
    const canonical = canon(okays[0]);
    check(okays.every((p) => canon(p) === canonical), 's4 the replayed receipt is identical', {round});
    const meta = (await admin.query('select meta from pumpy_messages where id=$1', [mid])).rows[0].meta;
    check(meta.status === 'done', 's4 the proposal is resolved exactly once', {round, status: meta.status});
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 5

async function scenarioPreviewBoundary(admin, pool) {
  const s = scenario(5, 'Preview reservation cap and the UTC month boundary');
  const t0 = Date.now();
  // 5a: the REAL reserve_video_preview, eight concurrent taps, real clock. Four free
  // previews a month is the Basic plan promise; a fifth is money the owner did not agree to.
  for (let round = 0; round < ROUNDS; round++) {
    const user = randomUUID();
    await admin.query("insert into profiles(id,plan) values($1,'free')", [user]);
    const results = await contend(pool.controller, lockPreviewUser, [user], pool.workers.slice(0, 8).map((c, i) => () =>
      tx(c, async (cc) => {
        await cc.query('select pg_sleep($1)', [jitter()]);
        return cc.query('select reserve_video_preview($1,$2) as ok', [user, 'vid-' + round + '-' + i]);
      })));
    const granted = results.filter((r) => r.ok && r.rows[0].ok === true).length;
    const rows = Number((await admin.query('select count(*)::int n from video_previews where user_id=$1', [user])).rows[0].n);
    check(granted === 4, 's5a exactly four of eight concurrent reservations are granted', {round, granted, codes: results.map((r) => r.code)});
    check(rows === 4, 's5a exactly four reservation rows exist', {round, rows});
    s.rounds++;
  }
  // 5b: the month boundary, via the clock wrapper (see clockWrapper()). Half the callers
  // are a second before the UTC month rolls over, half a second after, all at once.
  for (let round = 0; round < ROUNDS; round++) {
    const user = randomUUID();
    await admin.query("insert into profiles(id,plan) values($1,'free')", [user]);
    const boundary = "date_trunc('month',now() at time zone 'UTC' + interval '1 month')";
    const before = (await admin.query('select (' + boundary + " - interval '1 second') at time zone 'UTC' as t")).rows[0].t;
    const after = (await admin.query('select (' + boundary + " + interval '1 second') at time zone 'UTC' as t")).rows[0].t;
    // Fill this month's four so the old month is exactly at its cap when the clock turns.
    for (let i = 0; i < 4; i++) {
      await admin.query('select staging_reserve_video_preview_at($1,$2,$3)', [user, 'fill-' + i, before]);
    }
    const plan = [before, before, before, before, after, after, after, after];
    const results = await contend(pool.controller, lockPreviewUser, [user], plan.map((t, i) => () =>
      tx(pool.workers[i], async (cc) => {
        await cc.query('select pg_sleep($1)', [jitter()]);
        return cc.query('select staging_reserve_video_preview_at($1,$2,$3) as ok', [user, 'edge-' + round + '-' + i, t]);
      })));
    // contend() shuffles the launch order, so the verdict is read from the rows that landed.
    const byMonth = (await admin.query(
      "select to_char(month,'YYYY-MM') m,count(*)::int n from video_previews where user_id=$1 group by 1 order by 1", [user])).rows;
    const granted = results.filter((r) => r.ok && r.rows[0].ok === true).length;
    check(byMonth.length === 2, 's5b reservations land in exactly two months', {round, byMonth});
    check(byMonth.every((r) => r.n <= 4), 's5b neither month exceeds four reservations', {round, byMonth});
    check(byMonth[0] && byMonth[0].n === 4, 's5b the closing month keeps exactly its four', {round, byMonth});
    check(byMonth[1] && byMonth[1].n === 4, 's5b the opening month grants a fresh four', {round, byMonth});
    check(granted === 4, 's5b only the four post-boundary callers are granted', {round, granted});
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 6

async function scenarioAccountSwitch(admin, pool) {
  const s = scenario(6, 'Account switch: user B completes user A\'s job');
  const t0 = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    const f = await freshJob(admin, 's6-' + round);
    // Give B a row of their own with the same shortcode, so a mis-scoped update would
    // have somewhere wrong to land and we would see it.
    const bWorkout = randomUUID();
    await admin.query(
      "insert into workouts(id,user_id,shortcode,ingest_status,blocks,title) values($1,$2,$3,'ready',$4,'B original')",
      [bWorkout, USER_B, f.shortcode, JSON.stringify(BLOCKS)]);
    const results = await contend(pool.controller, lockJob, [f.job], [
      () => tx(pool.workers[0], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_A, 'worker', f.gen, JSON.stringify(PAYLOAD)]);
      }),
      () => tx(pool.workers[1], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query(finishSql, [f.job, USER_B, 'worker', f.gen, JSON.stringify({...PAYLOAD, title: 'B injected'})]);
      }),
    ]);
    const parsed = results.map((r) => (r.ok ? r.rows[0].result : {status: 'error:' + r.code, filled: -1}));
    const a = (await admin.query('select * from workouts where id=$1', [f.workout])).rows[0];
    const b = (await admin.query('select * from workouts where id=$1', [bWorkout])).rows[0];
    check(parsed.filter((p) => p.status === 'done').length === 1, 's6 only one completion succeeds', {round, parsed});
    check(a.user_id === USER_A && a.title === 'New read', 's6 the owner\'s row gets the owner\'s payload', {round, title: a.title});
    check(b.title === 'B original' && b.ingest_status === 'ready', 's6 the other account\'s row is untouched', {round, title: b.title});
    check(Number((await admin.query('select count(*)::int n from video_previews where user_id=$1', [USER_B])).rows[0].n) === 0,
      's6 no preview is spent on the wrong account', {round});
    await admin.query('delete from workouts where id=$1', [bWorkout]);
    s.rounds++;
  }
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- scenario 7

async function scenarioAttemptAccounting(admin, pool) {
  const s = scenario(7, 'AI attempt accounting under parallel settlement');
  const t0 = Date.now();
  const lockPolicy = 'select 1 from ai_guard_policy where singleton for update';
  // 7a: ten reservations settled in parallel. Each terminal record must land on its own
  // reservation — a metadata mix-up here is a mis-attributed charge in the ledger the
  // $0.50/day guard reads.
  for (let round = 0; round < ROUNDS; round++) {
    const ids = Array.from({length: 10}, () => randomUUID());
    for (const id of ids) {
      await admin.query("insert into ai_reservations(id,user_id,work_key,provider,model,reserved_usd) values($1::uuid,$2,$1::text,'openai','gpt-5.6-luna',0.02)", [id, USER_A]);
    }
    await contend(pool.controller, lockPolicy, [], ids.map((id, i) => () =>
      tx(pool.workers[i], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query('select ai_record_attempt($1,$2,$3,$4,0) as ok', [id,
          JSON.stringify({purpose: 'extract', environment: 'staging', attempt_status: 'succeeded', provider_request_id: 'req-' + i, input_tokens: 100 + i}),
          true, 0.001 * (i + 1)]);
      })));
    const rows = (await admin.query('select id,state,charged_usd,attempt_meta from ai_reservations where id = any($1)', [ids])).rows;
    let misattributed = 0;
    rows.forEach((r) => {
      const i = ids.indexOf(r.id);
      if (r.attempt_meta.provider_request_id !== 'req-' + i) misattributed++;
      if (r.attempt_meta.input_tokens !== 100 + i) misattributed++;
      if (Math.abs(Number(r.charged_usd) - 0.001 * (i + 1)) > 1e-9) misattributed++;
      if (r.state !== 'settled') misattributed++;
    });
    check(misattributed === 0, 's7a terminal metadata and charge land on their own reservation', {round, misattributed});
    s.rounds++;
  }

  // 7b: a forced failure of the metadata write must leave the reservation HELD at its
  // conservative reserved_usd — a rolled-back reservation would be a free provider call.
  await admin.query("alter table ai_reservations add constraint staging_reject_marked check (attempt_meta->>'failure_kind' is distinct from 'staging_forced')");
  expectCode('23514'); // the injected check constraint below is meant to fire
  for (let round = 0; round < ROUNDS; round++) {
    const ids = Array.from({length: 5}, () => randomUUID());
    for (const id of ids) {
      await admin.query("insert into ai_reservations(id,user_id,work_key,provider,model,reserved_usd) values($1::uuid,$2,$1::text,'openai','gpt-5.6-luna',0.02)", [id, USER_A]);
    }
    const doomed = [1, 3];
    const results = await contend(pool.controller, lockPolicy, [], ids.map((id, i) => () =>
      tx(pool.workers[i], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query('select ai_record_attempt($1,$2,true,$3,0) as ok', [id,
          JSON.stringify(doomed.includes(i)
            ? {attempt_status: 'failed', failure_kind: 'staging_forced'}
            : {attempt_status: 'succeeded', provider_request_id: 'ok-' + i}),
          0.001]);
      })));
    const rows = (await admin.query('select id,state,charged_usd,attempt_meta from ai_reservations where id = any($1)', [ids])).rows;
    rows.forEach((r) => {
      const i = ids.indexOf(r.id);
      if (doomed.includes(i)) {
        check(!results[i] || r.state === 'reserved', 's7b a failed metadata write leaves the reservation held', {round, i, state: r.state});
        check(r.charged_usd === null, 's7b a failed attempt is not settled cheap', {round, i, charged: r.charged_usd});
        check(Number(r.reserved_usd || 0.02) === 0.02, 's7b the conservative reservation stands', {round, i});
      } else {
        check(r.state === 'settled', 's7b neighbouring settlements are unaffected by the failure', {round, i, state: r.state});
        check(r.attempt_meta.provider_request_id === 'ok-' + i, 's7b neighbouring metadata is its own', {round, i});
      }
    });
    const failed = results.filter((r) => !r.ok).length;
    check(failed === doomed.length, 's7b exactly the doomed writes fail', {round, failed});
    s.rounds++;
  }
  await admin.query('alter table ai_reservations drop constraint staging_reject_marked');

  // 7c: the budget guard itself. ai_reserve serializes on the policy row; ten parallel
  // admissions must not be able to spend past the daily cap between them.
  await admin.query('update ai_guard_policy set max_calls=20, daily_usd=0.50, monthly_usd=10, user_monthly_usd=$1 where singleton',
    [JSON.stringify({free: 0.05, plus: 0.5, pro: 1.0, staff: 1.0})]);
  await admin.query("update profiles set plan='pro' where id=$1", [USER_B]);
  for (let round = 0; round < 5; round++) {
    await admin.query('delete from ai_reservations');
    const attempts = Array.from({length: 10}, () => ({id: randomUUID(), work: randomUUID()}));
    const results = await contend(pool.controller, lockPolicy, [], attempts.map((a, i) => () =>
      tx(pool.workers[i], async (c) => {
        await c.query('select pg_sleep($1)', [jitter()]);
        return c.query("select ai_reserve($1,$2,$3,'openai','gpt-5.6-luna',0.10) as r", [a.id, USER_B, a.work]);
      })));
    const verdicts = results.map((r) => (r.ok ? r.rows[0].r : 'error:' + r.code));
    const spend = Number((await admin.query('select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) s from ai_reservations')).rows[0].s);
    check(spend <= 0.5 + 1e-9, 's7c concurrent admissions never exceed the daily guard', {round, spend, verdicts});
    check(verdicts.filter((v) => v === 'ok').length === 5, 's7c exactly the affordable admissions are granted', {round, verdicts});
    s.rounds++;
  }
  await admin.query('delete from ai_reservations');
  s.ms = Date.now() - t0;
}

// ---------------------------------------------------------------- report

function report() {
  const pad = (v, n) => String(v).padEnd(n);
  const lpad = (v, n) => String(v).padStart(n);
  const lines = [];
  lines.push('');
  lines.push(pad('#', 3) + pad('scenario', 58) + lpad('rounds', 7) + lpad('checks', 8) + lpad('fail', 6)
    + lpad('parked', 8) + lpad('ms', 8) + '  codes');
  lines.push('-'.repeat(120));
  let violations = 0;
  for (const s of scenarios) {
    // A scenario that never observed a parked worker ran sequentially and proved
    // nothing — the exact vacuous pass this harness exists to rule out.
    if (s.parkedMin === 0) s.violations.push('no contention observed: this scenario did not actually race');
    violations += s.violations.length;
    const codes = [...s.codes.entries()].map(([c, n]) => c + 'x' + n + (s.expected.has(c) ? '(injected)' : '')).join(' ') || '-';
    const parked = s.parked === undefined ? 'n/a' : s.parkedMin + '-' + s.parked;
    lines.push(pad(s.id, 3) + pad(s.name, 58) + lpad(s.rounds, 7) + lpad(s.checks, 8)
      + lpad(s.violations.length, 6) + lpad(parked, 8) + lpad(s.ms, 8) + '  ' + codes);
  }
  lines.push('-'.repeat(120));
  lines.push('parked = workers observed asleep on a row/advisory lock while the barrier was held (min-max per round).');
  const findings = scenarios.flatMap((s) => s.findings.map((f) => s.id + ': ' + f));
  if (findings.length) {
    lines.push('');
    lines.push('FINDINGS (Postgres resolved these; a caller would have to retry):');
    findings.forEach((f) => lines.push('  - ' + f));
  }
  if (violations) {
    lines.push('');
    lines.push('INVARIANT VIOLATIONS:');
    for (const s of scenarios) s.violations.slice(0, 12).forEach((v) => lines.push('  - [' + s.id + '] ' + v));
  }
  lines.push('');
  lines.push(violations ? 'FAIL ' + violations + ' invariant violation(s)' : 'PASS no invariant violations across ' + scenarios.reduce((n, s) => n + s.checks, 0) + ' assertions');
  process.stdout.write(lines.join('\n') + '\n');
  return violations;
}

// ---------------------------------------------------------------- main

let started = false;
async function main() {
  const password = randomBytes(24).toString('base64url');
  process.stdout.write('starting ' + IMAGE + ' as ' + CONTAINER + ' on 127.0.0.1:' + PORT + '\n');
  startContainer(password);
  started = true;
  await waitReady(password);
  const admin = await newClient(password, 'admin');
  const controller = await newClient(password, 'controller');
  await buildSchema(admin);
  await seedUsers(admin);
  const workers = [];
  for (let i = 0; i < 10; i++) workers.push(await newClient(password, 'w' + i));
  const pool = {controller, workers};
  process.stdout.write('schema ready, ' + (workers.length + 2) + ' separate connections, ' + ROUNDS + ' randomized rounds per scenario\n');

  await scenarioOneWriter(admin, pool);
  await scenarioCompletionVsEdit(admin, pool);
  await scenarioSweeperReclaim(admin, pool);
  await scenarioPumpyConfirmations(admin, pool);
  await scenarioPreviewBoundary(admin, pool);
  await scenarioAccountSwitch(admin, pool);
  await scenarioAttemptAccounting(admin, pool);

  return report();
}

async function shutdown() {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  if (started) stopContainer();
}
process.on('SIGINT', () => { shutdown().finally(() => process.exit(130)); });

main().then(async (violations) => {
  await shutdown();
  process.exit(violations ? 1 : 0);
}).catch(async (e) => {
  process.stderr.write('HARNESS ERROR: ' + (e && e.stack ? e.stack : e) + '\n');
  await shutdown();
  process.exit(2);
});
