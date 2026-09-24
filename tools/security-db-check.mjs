// The whole schema, every migration in order, in PGlite — then the access rules
// the browser roles live under, asserted as those roles.
//
//   node tools/security-db-check.mjs
//
// The other DB checks each rebuild the few tables their migration touches. This
// one replays supabase/migrations/*.sql end to end over a small Supabase shim
// (auth.uid() from the request claim, storage/cron/net stand-ins, and Supabase's
// own `alter default privileges ... grant all to anon, authenticated`, without
// which a revoke would pass trivially and prove nothing), so a grant or policy
// is checked as production holds it after the whole history, not as one file
// wrote it.
//
// What it proves:
//   - a plan day or a session can only name the caller's own card (NULL session
//     card allowed), and every insert shape the app sends still works;
//   - the session insert cannot carry strava_activity_id, and the exact payload
//     iOS builds 5-7 send is still accepted, with `returning id`;
//   - the service-only tables refuse every write from anon and authenticated,
//     SELECTs a client uses still work, and no browser role can TRUNCATE;
//   - a push endpoint that is not https cannot be stored;
//   - ops_week has a pinned search_path;
//   - erasure_outbox (if present) is service-only with RLS on;
//   - the security migrations re-run cleanly.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PGLITE = process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(pathToFileURL(PGLITE));
const { pgcrypto } = await import(pathToFileURL(PGLITE.replace(/index\.js$/, 'contrib/pgcrypto.js')));
const db = new PGlite({ extensions: { pgcrypto } });

const failures = [];
let passed = 0;
function check(ok, what) {
  if (ok) passed++;
  else { failures.push(what); console.error('FAIL ' + what); }
}

await db.exec(`set timezone='UTC';
create extension pgcrypto;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create publication supabase_realtime;
create schema auth; create schema storage; create schema cron; create schema net;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz not null default now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
create table storage.buckets(id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid,
  created_at timestamptz not null default now(), updated_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]$$;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$insert into cron.job(jobname, schedule, command) values (n, s, c)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid$$;
create function cron.unschedule(n text) returns boolean language sql as $$delete from cron.job where jobname = n returning true$$;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$select 1::bigint$$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);

const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  // pg_net / pg_cron are stood in for by the shim above; PGlite has neither.
  const sql = readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]*;/gi, '');
  try { await db.exec(sql); } catch (e) { check(false, 'migration applies: ' + f + ' — ' + e.message); await db.exec('rollback').catch(() => {}); }
}
check(files.length >= 48, 'replayed ' + files.length + ' migrations');
// Re-runnable: every migration of this cycle applied a second time is a no-op.
for (const f of files.filter((x) => x >= '20260924100000' && x < '20260924110000')) {
  try { await db.exec(readFileSync('supabase/migrations/' + f, 'utf8')); check(true, ''); }
  catch (e) { check(false, 're-runs cleanly: ' + f + ' — ' + e.message); await db.exec('rollback').catch(() => {}); }
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const WA = 'aaaaaaaa-0000-4000-8000-000000000001';
const WB = 'bbbbbbbb-0000-4000-8000-000000000002';
await db.exec(`insert into auth.users(id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
insert into public.workouts(id, user_id, url, shortcode, platform, title)
  values ('${WA}', '${A}', 'https://example.com/a', 'fx-a', 'web', 'A card'),
         ('${WB}', '${B}', 'https://example.com/b', 'fx-b', 'web', 'B card');`);

// Run one statement as a browser role; returns null on success or the error message.
async function as(role, uid, sql) {
  try {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
    await db.query(sql);
    return null;
  } catch (e) {
    return e.message;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const refusedBy = (err, re) => err !== null && re.test(err);
const RLS = /row-level security/;
const DENIED = /permission denied/;

// ---------- F-2: own card only ----------
{
  let e = await as('authenticated', A, `insert into public.plan(user_id, day, workout_id) values ('${A}', '2026-09-24', '${WB}')`);
  check(refusedBy(e, RLS), "plan: A cannot plan B's card (" + e + ')');
  e = await as('authenticated', A, `insert into public.plan(user_id, day, workout_id) values ('${A}', '2026-09-24', '${WA}')`);
  check(e === null, 'plan: A plans their own card (' + e + ')');
  e = await as('authenticated', A, `insert into public.plan(user_id, day, workout_id) values ('${A}', '2026-09-25', '${WA}'), ('${A}', '2026-10-01', '${WA}') returning id`);
  check(e === null, 'plan: the copy-week batch insert still works (' + e + ')');
  e = await as('authenticated', A, `insert into public.workout_logs(user_id, workout_id, workout_title, started_at, completed_at, duration_seconds, entries)
    values ('${A}', '${WB}', 'x', now(), now(), 60, '[]'::jsonb)`);
  check(refusedBy(e, RLS), "workout_logs: A cannot log a session against B's card (" + e + ')');
  e = await as('authenticated', A, `insert into public.workout_logs(user_id, workout_id, workout_title, started_at, completed_at, duration_seconds, entries)
    values ('${A}', null, 'Freestyle', now(), now(), 60, '[{"name":"Squat","sets":[{"reps":5}]}]'::jsonb) returning id`);
  check(e === null, 'workout_logs: a session with no card is still accepted (' + e + ')');
  e = await as('authenticated', B, `insert into public.plan(user_id, day, workout_id) values ('${A}', '2026-09-24', '${WA}')`);
  check(refusedBy(e, RLS), 'plan: B cannot write a row owned by A');
}

// ---------- F-3: the session insert, exactly as builds 5-7 send it ----------
{
  let e = await as('authenticated', A, `insert into public.workout_logs(user_id, workout_id, workout_title, started_at, completed_at, duration_seconds, entries)
    values ('${A}', '${WA}', 'A card', now() - interval '40 minutes', now(), 2400, '[{"name":"Squat","sets":[{"reps":5,"weight":60}]}]'::jsonb) returning id`);
  check(e === null, 'workout_logs: the finishWorkout payload of builds 5-7 is accepted, returning id (' + e + ')');
  e = await as('authenticated', A, `insert into public.workout_logs(user_id, workout_id, workout_title, started_at, completed_at, duration_seconds, entries, strava_activity_id)
    values ('${A}', '${WA}', 'A card', now(), now(), 60, '[]'::jsonb, 1)`);
  check(refusedBy(e, DENIED), 'workout_logs: strava_activity_id cannot be set on insert (' + e + ')');
  e = await as('authenticated', A, `insert into public.workout_logs(user_id, workout_id, workout_title, started_at, completed_at, duration_seconds, entries, strava_activity_id)
    values ('${A}', '${WA}', 'A card', now(), now(), 60, '[]'::jsonb, null)`);
  check(refusedBy(e, DENIED), 'workout_logs: not even as null (the reason builds 5-7 were checked first)');
  e = await as('authenticated', A, `update public.workout_logs set entries = '[{"name":"Squat","sets":[{"reps":6}]}]'::jsonb where user_id = '${A}'`);
  check(e === null, 'workout_logs: correcting the sets of a session still works (' + e + ')');
  e = await as('authenticated', A, `update public.workout_logs set workout_id = '${WB}' where user_id = '${A}'`);
  check(refusedBy(e, DENIED), 'workout_logs: a session cannot be re-pointed at another card');
  e = await as('authenticated', A, `delete from public.workout_logs where user_id = '${A}' and workout_id is null`);
  check(e === null, 'workout_logs: deleting your own session still works');
}

// ---------- F-4: service-only tables ----------
const SERVICE_ONLY = ['ai_cost_log', 'app_config', 'billing_customers', 'billing_events', 'exercise_catalog',
  'exercise_demo_videos', 'exercise_videos', 'ingest_jobs', 'pumpy_usage', 'saves_log', 'video_cache', 'video_previews'];
for (const t of SERVICE_ONLY) {
  const r = await db.query(`select
      bool_or(has_table_privilege(r, 'public.${t}', 'INSERT')) as ins,
      bool_or(has_table_privilege(r, 'public.${t}', 'UPDATE')) as upd,
      bool_or(has_table_privilege(r, 'public.${t}', 'DELETE')) as del,
      bool_or(has_table_privilege(r, 'public.${t}', 'TRUNCATE')) as trn,
      bool_or(exists(select 1 from information_schema.column_privileges c where c.table_schema = 'public'
        and c.table_name = '${t}' and c.grantee = r and c.privilege_type in ('INSERT', 'UPDATE'))) as colw
    from unnest(array['anon', 'authenticated']) r`);
  const g = r.rows[0];
  check(!g.ins && !g.upd && !g.del && !g.trn && !g.colw, t + ': no INSERT/UPDATE/DELETE/TRUNCATE for anon or authenticated (' + JSON.stringify(g) + ')');
}
{
  let e = await as('authenticated', A, `update public.app_config set value = 'x' where true`);
  check(refusedBy(e, DENIED), 'app_config: an UPDATE is refused by grant, not only by RLS (' + e + ')');
  e = await as('anon', null, `insert into public.saves_log(user_id) values ('${A}')`);
  check(refusedBy(e, DENIED), 'saves_log: anon INSERT refused by grant (' + e + ')');
  e = await as('authenticated', A, `select id, muscle_groups, secondary_muscles from public.exercise_catalog limit 1`);
  check(e === null, 'exercise_catalog: the SELECT the app makes still works (' + e + ')');
  e = await as('authenticated', A, `truncate public.workouts`);
  check(refusedBy(e, DENIED), 'no browser role can TRUNCATE a user table');
  const trunc = await db.query(`select count(*)::int as n from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))`);
  check(trunc.rows[0].n === 0, 'TRUNCATE held by a browser role on ' + trunc.rows[0].n + ' public tables');
}

// ---------- every client write kind of builds 5-7 still works ----------
{
  const writes = [
    ['collections insert', `insert into public.collections(id, user_id, name) values ('cccccccc-0000-4000-8000-000000000001', '${A}', 'Legs')`],
    ['collections update', `update public.collections set name = 'Leg day' where user_id = '${A}'`],
    ['collection_items insert (own card)', `insert into public.collection_items(collection_id, workout_id, user_id) values ('cccccccc-0000-4000-8000-000000000001', '${WA}', '${A}')`],
    ['collection_items delete', `delete from public.collection_items where user_id = '${A}'`],
    ['collections delete', `delete from public.collections where user_id = '${A}'`],
    ['plan delete', `delete from public.plan where user_id = '${A}' and day = '2026-10-01'`],
    ['profiles update (display_name, settings)', `update public.profiles set display_name = 'A', settings = '{"goal":3}'::jsonb where id = '${A}'`],
    ['workouts update (title, notes, favorite, category)', `update public.workouts set title = 'A2', notes = 'n', favorite = true where id = '${WA}'`],
    ['achievements upsert', `insert into public.achievements(user_id, key, kind) values ('${A}', 'first', 'milestone') on conflict do nothing`],
    ['push_subscriptions upsert (https)', `insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, tz, remind_plan, remind_at)
      values ('${A}', 'https://fcm.googleapis.com/fcm/send/abc', 'p', 'a', 'UTC', true, 1050)
      on conflict (endpoint) do update set remind_plan = excluded.remind_plan, tz = excluded.tz`],
    ['push_devices upsert', `insert into public.push_devices(user_id, token, platform, env, tz) values ('${A}', 'tok-a', 'ios', 'production', 'UTC')
      on conflict (token) do update set tz = excluded.tz`],
    ['push_subscriptions delete', `delete from public.push_subscriptions where user_id = '${A}'`],
    ['pumpy_threads delete', `delete from public.pumpy_threads where user_id = '${A}'`],
    ['workouts delete', `delete from public.workouts where id = '${WA}' and false`],
  ];
  for (const [what, sql] of writes) {
    const e = await as('authenticated', A, sql);
    check(e === null, 'still allowed: ' + what + (e ? ' (' + e + ')' : ''));
  }
}

// ---------- F-1: a push endpoint is https ----------
{
  let e = await as('authenticated', A, `insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
    values ('${A}', 'http://169.254.169.254/latest/meta-data/', 'p', 'a')`);
  check(refusedBy(e, /push_subscriptions_endpoint_https|check constraint/), 'push_subscriptions: a non-https endpoint cannot be stored (' + e + ')');
  e = await as('authenticated', A, `insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
    values ('${A}', 'https://web.push.apple.com/QGuQ-abc', 'p', 'a')`);
  check(e === null, 'push_subscriptions: an Apple web push endpoint is stored (' + e + ')');
  const v = await db.query(`select convalidated from pg_constraint where conname = 'push_subscriptions_endpoint_https'`);
  check(v.rows[0]?.convalidated === true, 'the endpoint constraint is validated, not left NOT VALID');
}

// ---------- F-5: ops_week ----------
{
  const r = await db.query(`select array_to_string(proconfig, ',') as cfg from pg_proc where oid = 'public.ops_week(timestamptz)'::regprocedure`);
  check(/search_path=pg_catalog, ?public/.test(r.rows[0]?.cfg ?? ''), 'ops_week has search_path pinned (' + r.rows[0]?.cfg + ')');
  const w = await db.query(`select public.ops_week('2026-09-24T12:00:00Z') as d`);
  check(String(w.rows[0].d instanceof Date ? w.rows[0].d.toISOString().slice(0, 10) : w.rows[0].d) === '2026-09-21', 'ops_week still answers the Monday');
}

// ---------- the erasure outbox, when its migration is present ----------
{
  const t = await db.query(`select relrowsecurity from pg_class where oid = to_regclass('public.erasure_outbox')`);
  if (t.rows.length) {
    check(t.rows[0].relrowsecurity === true, 'erasure_outbox has RLS on');
    const g = await db.query(`select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'erasure_outbox' and grantee in ('anon', 'authenticated')`);
    check(g.rows[0].n === 0, 'erasure_outbox grants nothing to anon or authenticated (' + g.rows[0].n + ' grants)');
    const e = await as('authenticated', A, `select * from public.erasure_outbox`);
    check(refusedBy(e, DENIED), 'erasure_outbox cannot be read by a signed-in client');
    const fns = await db.query(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname like 'erasure\\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    check(fns.rows.length === 0, 'no erasure_* function is callable by a browser role (' + fns.rows.map((r) => r.proname).join(',') + ')');
  }
}

await db.close();
if (failures.length) {
  console.error('\n' + failures.length + ' of ' + (failures.length + passed) + ' schema security checks FAILED');
  process.exit(1);
}
console.log('PASS ' + passed + ' schema security checks over ' + files.length + ' replayed migrations: own-card references, the session insert columns, service-only write grants, https push endpoints, ops_week search_path, every client write of builds 5-7 still allowed.');
