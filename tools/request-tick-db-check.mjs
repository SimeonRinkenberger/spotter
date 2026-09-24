// The free-path throttle (20260924130100_request_ticks): 30 a minute per person
// per route, and nothing else. Runs the shipping SQL in PGlite over the minimal
// schema the other guard checks build, beside the real ai_admit, so "paid
// admission unaffected" is the real function's answer; no network.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const runtime = process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(pathToFileURL(runtime));
const db = new PGlite();
let checks = 0;
const ok = (condition, label) => { assert.ok(condition, label); checks++; };
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key);
create schema storage;
create table storage.buckets(id text primary key,file_size_limit bigint);
insert into storage.buckets values ('uploads',104857600);
create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
create table public.profiles(id uuid primary key,plan text,limits jsonb);
create table public.saves_log(id bigint generated always as identity, user_id uuid,created_at timestamptz default now(),kind text,cached boolean default false);
create table public.app_config(key text primary key,value text);
create table public.workouts(id uuid default gen_random_uuid(),user_id uuid,shortcode text,title text,category text,notes text,favorite boolean);
create table public.ingest_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,status text default 'queued',run_after timestamptz default now(),created_at timestamptz default now(),locked_by text,locked_at timestamptz,attempts int default 0,updated_at timestamptz);
`);
await db.exec(readFileSync('supabase/migrations/20260908150000_cost_and_abuse_guards.sql', 'utf8'));
const migration = readFileSync('supabase/migrations/20260924130100_request_ticks.sql', 'utf8');
await db.exec(migration);
await db.exec(migration);   // idempotent: a second run changes nothing and does not fail
ok(true, 'the migration runs twice without error');

const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const user = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
for (let i = 1; i <= 5; i++) await q('insert into auth.users values ($1)', [user(i)]);
const tick = async (u, route, limit = 30) => (await q('select request_tick($1,$2,$3) as r', [u, route, limit]))[0].r;
const ticks = async (where = 'true', args = []) => (await q('select count(*)::int n from request_ticks where ' + where, args))[0].n;

// 30 accepted, the 31st refused and not counted.
const a = user(1), b = user(2);
let accepted = 0;
for (let i = 0; i < 30; i++) if (await tick(a, '/api/ingest')) accepted++;
ok(accepted === 30, '30 free requests in a minute are accepted');
ok(await tick(a, '/api/ingest') === false, 'the 31st in the same minute is refused');
ok(await tick(a, '/api/ingest') === false && await ticks('user_id=$1', [a]) === 30, 'refusals are not counted, so the window slides');

// Per route and per person.
ok(await tick(a, '/api/ingest/prepare') === true && await tick(a, '/api/uploads/authorize') === true,
  'a busy /api/ingest does not throttle prepare or authorize (one limit per route)');
ok(await tick(b, '/api/ingest') === true, 'another person is not throttled by the first');

// The window is one minute: age the oldest tick past it and one more gets in.
await q("update request_ticks set at = now() - interval '61 seconds' where id = (select min(id) from request_ticks where user_id=$1 and route='/api/ingest')", [a]);
ok(await tick(a, '/api/ingest') === true, 'a tick older than a minute no longer counts');
ok(await tick(a, '/api/ingest') === false, 'and the limit holds again after that one');

// Paid admission is untouched: 31 ticks write no ai_actions row, and ai_admit
// answers for this person exactly as it would with no ticks at all (6 a minute).
ok((await q('select count(*)::int n from ai_actions'))[0].n === 0 && (await q('select count(*)::int n from saves_log'))[0].n === 0,
  'a tick writes no admission and no save row');
const admits = [];
for (let i = 0; i < 7; i++) {
  admits.push((await q("select ai_admit(gen_random_uuid(), $1, 'saves', 30) as r", [a]))[0].r);
  await q('update ai_actions set finished=true, lease_until=now()');
}
ok(admits.slice(0, 6).every((r) => r === 'ok') && admits[6] === 'minute',
  'ai_admit still admits six a minute for a throttled person, and refuses the seventh on its own count');

// Pruning: rows over ten minutes old go, anyone's, a hundred per call at most.
await q("insert into request_ticks(user_id,route,at) select $1,'/api/ingest',now()-interval '11 minutes' from generate_series(1,150)", [user(3)]);
await tick(user(4), '/api/ingest');
ok(await ticks("user_id=$1", [user(3)]) === 50, 'a call prunes up to 100 rows older than ten minutes, whoever wrote them');
await tick(user(4), '/api/ingest');
ok(await ticks("at < now() - interval '10 minutes'") === 0, 'and the next call takes the rest');

// The account takes its rows with it.
await q('delete from auth.users where id=$1', [b]);
ok(await ticks('user_id=$1', [b]) === 0, 'deleting the account deletes its ticks');

// Arguments.
let threw = false;
try { await tick(a, '/api/ingest', 0); } catch { threw = true; }
ok(threw, 'a non-positive limit is an error (the edge function fails open on errors)');

// Service-only.
const g = (await q(`select
  has_function_privilege('authenticated','request_tick(uuid,text,int)','EXECUTE') as fa,
  has_function_privilege('anon','request_tick(uuid,text,int)','EXECUTE') as fn,
  has_function_privilege('service_role','request_tick(uuid,text,int)','EXECUTE') as fs,
  has_table_privilege('authenticated','public.request_ticks','SELECT') as ta,
  has_table_privilege('anon','public.request_ticks','INSERT') as tn,
  (select relrowsecurity from pg_class where oid='public.request_ticks'::regclass) as rls,
  (select prosecdef from pg_proc where proname='request_tick') as definer,
  (select array_to_string(proconfig, ',') from pg_proc where proname='request_tick') as config`))[0];
ok(!g.fa && !g.fn && g.fs, 'only the service role may call request_tick');
ok(!g.ta && !g.tn && g.rls, 'the table is RLS-on with no browser grants');
ok(g.definer && /search_path=public, pg_catalog|search_path=public,pg_catalog/.test(g.config), 'security definer with search_path pinned');

console.log('PASS ' + checks + ' request_tick checks (30 a minute per person per route; admission untouched).');
