// The upload permit after 20260924130000: two outstanding per person, sixteen
// for the product, sheets still on their own ceiling. Runs the shipping SQL in
// PGlite over the minimal schema tools/ai-guard-db-check.mjs builds; no network.
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
// The one column 20260915100000 adds that the permit reads; that migration also
// touches video_cache and storage, which this schema does not carry.
await db.exec("alter table public.upload_permits add column if not exists kind text not null default 'media';");
const migration = readFileSync('supabase/migrations/20260924130000_upload_permits_per_user.sql', 'utf8');
await db.exec(migration);

const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const user = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const file = (u, n) => u + '/00000000-0000-4000-8000-' + String(n).padStart(12, '0') + '.mp4';
const permit = async (u, path, bytes = 1000) => (await q('select issue_upload_permit($1,$2,$3) as r', [u, path, bytes]))[0].r;

const a = user(1);
ok(await permit(a, file(a, 1)) === 'ok', 'first outstanding upload admitted');
ok(await permit(a, file(a, 2)) === 'ok', 'second outstanding upload admitted (the extension and the app at once)');
ok(await permit(a, file(a, 3)) === 'pending', 'a third outstanding upload for one person is refused');
ok(await permit(a, user(9) + '/x.mp4') === 'invalid', 'a path outside the caller\'s folder is invalid');
ok(await permit(a, file(a, 4), 26214401) === 'invalid', 'over the 25 MB cap is invalid');

// Releasing one frees the person's slot.
await q('update upload_permits set released=true where path=$1', [file(a, 1)]);
ok(await permit(a, file(a, 5)) === 'ok', 'a released permit frees a slot');

// Sheets are counted on their own ceiling and never spend a video slot.
await q("insert into upload_permits(path,user_id,max_bytes,kind) values($1,$2,1000,'sheet'),($3,$2,1000,'sheet'),($4,$2,1000,'sheet')",
  [user(20) + '/pack/tt-1/sheet-1.jpg', user(20), user(20) + '/pack/tt-1/sheet-2.jpg', user(20) + '/pack/tt-1/sheet-3.jpg']);
ok(await permit(user(20), file(user(20), 1)) === 'ok', 'outstanding sheets do not block a video permit');

// Product ceiling: 16 outstanding video permits in all. a holds 2, user 20 holds 1.
let admitted = 0;
for (let i = 30; i < 60 && admitted < 13; i++) {
  if (await permit(user(i), file(user(i), 1)) === 'ok') admitted++;
}
ok(admitted === 13 && (await q("select count(*)::int n from upload_permits where kind='media' and not released"))[0].n === 16,
  'sixteen outstanding video permits across the product');
ok(await permit(user(70), file(user(70), 1)) === 'busy', 'the seventeenth is refused as busy');

// The bucket's own object count is the second half of the ceiling.
await q('update upload_permits set released=true');
for (let i = 0; i < 16; i++) await q("insert into storage.objects values('uploads',$1)", [user(80) + '/f' + i + '.mp4']);
ok(await permit(user(71), file(user(71), 1)) === 'busy', 'sixteen objects in the bucket refuse a new permit');
await q("delete from storage.objects where name=$1", [user(80) + '/f0.mp4']);
await q("insert into storage.objects values('uploads',$1)", [user(80) + '/pack/tt-1/sheet-1.jpg']);
ok(await permit(user(71), file(user(71), 1)) === 'ok', 'a pack sheet in the bucket is not counted against videos');

const grants = await q("select has_function_privilege('authenticated','issue_upload_permit(uuid,text,bigint)','EXECUTE') as a, has_function_privilege('service_role','issue_upload_permit(uuid,text,bigint)','EXECUTE') as s");
ok(!grants[0].a && grants[0].s, 'only the service role may issue permits');
ok(!/insert into|update |delete from/i.test(migration.replace(/insert into upload_permits/i, '')),
  'the migration replaces one function and writes no row');

console.log('PASS ' + checks + ' upload permit checks (two per person, sixteen for the product).');
