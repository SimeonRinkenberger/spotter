// The store_entitlements migration of 24 September, applied in PGlite over the
// 13 September one it extends. No network, no production.
//
// What has to hold: the function that is deployed today (six named arguments)
// still syncs after the migration, so applying it first never breaks a
// purchase; the new function records environment and will_renew; an older
// observation still loses; Test Store is a source; nothing but the service role
// can write or call; and there is exactly one sync_store_entitlement, so
// PostgREST never has two candidates to choose between.
//
//   node tools/store-entitlements-db-check.mjs        (PGLITE_MODULE as the other DB checks)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE ||
  '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js'));
const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, plan text not null default 'free');
create table public.subscriptions(user_id uuid primary key, status text, plan text);
insert into auth.users values ('${A}'), ('${B}');
insert into public.profiles(id) values ('${A}'), ('${B}');`);
await db.exec(readFileSync('supabase/migrations/20260913050000_store_entitlements.sql', 'utf8'));
await db.exec(readFileSync('supabase/migrations/20260924120000_store_entitlement_environment.sql', 'utf8'));

const one = async (sql) => (await db.query(sql)).rows[0];
const row = (id) => one(`select active, source, environment, will_renew, product_id from public.store_entitlements where user_id='${id}'`);
const plan = async (id) => (await one(`select plan from public.profiles where id='${id}'`)).plan;
const later = "now() + interval '30 days'";

// The call the deployed function makes today, by name, as PostgREST makes it.
await db.exec(`set role service_role;
select public.sync_store_entitlement(uid=>'${A}', is_active=>true, expiry=>${later}, store=>'apple',
  product=>'spotter_plus_month', observed=>now());
reset role;`);
assert.deepEqual(await row(A), { active: true, source: 'apple', environment: null, will_renew: null, product_id: 'spotter_plus_month' },
  'the six-argument call of the function deployed today still syncs');
assert.equal(await plan(A), 'plus', 'and the plan trigger still runs');

await db.exec(`set role service_role;
select public.sync_store_entitlement(uid=>'${A}', is_active=>true, expiry=>${later}, store=>'apple',
  product=>'spotter_plus_year', observed=>now() + interval '1 second', environment=>'sandbox', will_renew=>false);
reset role;`);
assert.deepEqual(await row(A), { active: true, source: 'apple', environment: 'sandbox', will_renew: false, product_id: 'spotter_plus_year' },
  'the new call records the environment and that auto-renew is off');

await db.exec(`set role service_role;
select public.sync_store_entitlement(uid=>'${A}', is_active=>false, expiry=>null, store=>null,
  product=>null, observed=>now() - interval '1 hour', environment=>null, will_renew=>null);
reset role;`);
assert.equal((await row(A)).active, true, 'an older observation still loses to a newer one');

await db.exec(`set role service_role;
select public.sync_store_entitlement(uid=>'${B}', is_active=>true, expiry=>${later}, store=>'test',
  product=>'monthly', observed=>now(), environment=>'test_store', will_renew=>true);
reset role;`);
assert.deepEqual(await row(B), { active: true, source: 'test', environment: 'test_store', will_renew: true, product_id: 'monthly' },
  'a QA Test Store grant is a source the table accepts');
assert.equal(await plan(B), 'plus');

for (const [what, args] of [
  ['an unknown source', "store=>'stripe', environment=>'production'"],
  ['an unknown environment', "store=>'apple', environment=>'staging'"],
]) {
  await assert.rejects(db.exec(`set role service_role;
select public.sync_store_entitlement(uid=>'${B}', is_active=>true, expiry=>${later}, product=>'x',
  observed=>now() + interval '1 minute', ${args});`), /check constraint/, what + ' is refused');
  await db.exec('reset role');
}

assert.equal((await one(`select count(*)::integer as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sync_store_entitlement'`)).n, 1, 'one function, no overload for PostgREST to choose between');

for (const role of ['anon', 'authenticated']) {
  await db.exec('set role ' + role);
  await assert.rejects(db.exec(`select public.sync_store_entitlement(uid=>'${A}', is_active=>true, expiry=>null,
    store=>'apple', product=>'x', observed=>now(), environment=>'production', will_renew=>true)`), /permission denied/,
    role + ' cannot call the sync');
  for (const sql of [`update public.store_entitlements set will_renew=true`, `update public.store_entitlements set environment='production'`,
    `insert into public.store_entitlements(user_id,active,observed_at) values ('${A}',true,now())`, `delete from public.store_entitlements`])
    await assert.rejects(db.exec(sql), /permission denied/, role + ' cannot write: ' + sql);
  await db.exec('reset role');
}
await db.close();
console.log('PASS store entitlement environment: today\'s six-argument sync still works after the migration, environment and will_renew recorded, older observations lose, Test Store is a source, unknown sources/environments refused, one function, service role only.');
