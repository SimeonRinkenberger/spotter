// Atomic Pumpy confirmation persistence regressions: no network or paid calls.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js'));
const db=new PGlite();
await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
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
  confidence numeric,extracted_by text,ingest_error text,media_stage text);`);
await db.exec(`alter table ingest_jobs alter column id set default gen_random_uuid(),
  alter column status set default 'queued',alter column created_at set default now(),
  alter column attempts set default 0,add column url text,add column platform text,add column kind text;
  alter table workouts alter column id set default gen_random_uuid(),alter column blocks set default '[]',
  add unique(user_id,shortcode);
  create unique index ingest_active on ingest_jobs(user_id,shortcode) where status in ('queued','running');
  create table saves_log(user_id uuid,shortcode text,cached boolean,kind text,platform text,job_id uuid);`);
// Use the actual production reservation function, not a mocked quota check.
const previewSQL=readFileSync('supabase/migrations/20260917120000_reader_quality_previews.sql','utf8');
await db.exec(previewSQL.slice(previewSQL.indexOf('create or replace function public.reserve_video_preview'),previewSQL.indexOf('-- Retire unused provider')));
await db.exec(readFileSync('supabase/migrations/20260917130000_reader_completion_fence.sql','utf8'));

await db.exec(`alter table profiles add column limits jsonb;
create table app_config(key text primary key,value text);
create table pumpy_threads(id uuid primary key,user_id uuid,updated_at timestamptz);
create table pumpy_messages(id bigint generated always as identity primary key,thread_id uuid,user_id uuid,
 role text,content text,meta jsonb,created_at timestamptz default now());
create table plan(id uuid primary key default gen_random_uuid(),user_id uuid,day date,workout_id uuid);
alter table corrections add column user_id uuid,add column shortcode text,add column platform text,
 add column kind text,add column old_value text,add column new_value text,
 add column old_canonical_id text,add column new_canonical_id text,add column old_exercise jsonb,add column new_exercise jsonb,
 add column block_index integer,add column exercise_index integer,add column exercise_name text,add column extracted_by text,add column confidence numeric;`);
const guard=readFileSync('supabase/migrations/20260908150000_cost_and_abuse_guards.sql','utf8');
await db.exec(guard.slice(guard.indexOf('create function public.guard_workout_library()'),guard.indexOf('-- Explicit function grants')));
await db.exec(readFileSync('supabase/migrations/20260917140000_pumpy_confirmation.sql','utf8'));
const u=crypto.randomUUID(),other=crypto.randomUUID(),thread=crypto.randomUUID();
await db.query("insert into profiles(id,plan) values($1,'plus'),($2,'plus')",[u,other]);
await db.query('insert into pumpy_threads values($1,$2,now())',[thread,u]);
const block={title:null,type:'straight',exercises:[{name:'Squat',reps:'5'}]};
const create={kind:'create_workout',title:'Training',summary:'Training',category:'Strength',muscle_groups:['Legs'],equipment:[],difficulty:null,duration_minutes:20,blocks:[block]};
const proposal=async(p=create,method=null)=>(await db.query("insert into pumpy_messages(thread_id,user_id,role,meta) values($1,$2,'assistant',$3) returning id",[thread,u,{proposal:p,status:'pending',model:'fixture',method}])).rows[0].id;
const confirm=async(mid,accept=true,prepared={id:crypto.randomUUID()},user=u)=>(await db.query('select confirm_pumpy_proposal($1,$2,$3,$4) result',[user,mid,accept,prepared])).rows[0].result;
const count=async(table)=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
const status=async(mid)=>(await db.query('select meta from pumpy_messages where id=$1',[mid])).rows[0].meta.status;
let mid=await proposal();
const [first,second]=await Promise.all([confirm(mid),confirm(mid)]);
assert.equal(first.workout.id,second.workout.id,'same proposal returns same created row');
assert.equal(await count('workouts'),1,'duplicate accepts do not duplicate workouts');
assert.equal(await count('pumpy_messages'),3,'one tool receipt and one assistant receipt');
assert.deepEqual(await confirm(mid,false),first,'late decline cannot claim nothing changed');
assert.equal((await confirm(mid,true,{},other)).status,'not_found','cross-account confirmation fails closed');
mid=await proposal();const declined=await confirm(mid,false);
assert.deepEqual(await confirm(mid),declined,'accept after decline does not execute');
assert.equal(await count('workouts'),1);
const id=first.workout.id;
const append={kind:'append_exercises',workout_id:id,workout_title:'Training',block_title:'Added',exercises:[{name:'Lunge',canonical_id:'lunge'}],summary:'Add lunge'};
mid=await proposal(append);
const prepared={expected_revision:0,base_blocks:[block],blocks:[block,{title:'Added',exercises:append.exercises}],muscle_groups:['Legs'],equipment:[]};
const added=await confirm(mid,true,prepared);
assert.equal(added.workout.blocks.length,2);
assert.deepEqual(await confirm(mid,true,prepared),added,'append receipt replay ignores stale prepared snapshot');
assert.equal(await count('corrections'),1,'append correction recorded once');
assert.equal(added.workout.user_edit_revision,1,'append becomes a persistent user override');
// Background replacement can change blocks without incrementing personal edit revision.
const beforeAppend=await proposal(append);
assert.equal((await confirm(beforeAppend,true,{...prepared,expected_revision:1})).status,'conflict','changed base blocks reject stale prepared append even at current edit revision');
await db.query("update workouts set ingest_status='processing' where id=$1",[id]);
assert.equal((await confirm(beforeAppend,true,{...prepared,expected_revision:1,base_blocks:added.workout.blocks})).status,'conflict','cannot append while reader owns pending row');
await db.query("update workouts set ingest_status='ready' where id=$1",[id]);
mid=await proposal(append);
assert.equal((await confirm(mid,true,prepared)).status,'conflict','stale revision cannot overwrite an edit');
assert.equal(await status(mid),'pending');
await db.query("update profiles set plan='free' where id=$1",[u]);
assert.equal((await confirm(mid,true,{...prepared,expected_revision:1})).status,'limit','downgrade blocks pending acceptance');
assert.deepEqual(await confirm(first.messages[0].id-2),first,'resolved result is still retrievable after downgrade');
await db.query("update profiles set plan='plus' where id=$1",[u]);
mid=await proposal({kind:'plan_days',days:[{day:'2026-10-01',workout_id:id},{day:'2026-10-02',workout_id:crypto.randomUUID()}]});
await assert.rejects(()=>confirm(mid),'one missing workout rolls back the entire plan');
assert.equal(await count('plan'),0);
assert.equal(await status(mid),'pending');
mid=await proposal({kind:'plan_days',days:[{day:'2026-10-01',workout_id:id},{day:'2026-10-01',workout_id:id}]});
const plan=await confirm(mid);assert.equal(plan.plan.length,1);
assert.deepEqual(await confirm(mid),plan);assert.equal(await count('plan'),1);
// A failure after mutation but before confirmation receipt must roll back both.
await db.exec(`create function reject_pumpy_receipt() returns trigger language plpgsql as $$ begin
 if new.role='assistant' and new.content like 'Saved%' then raise exception 'injected receipt failure'; end if; return new; end $$;
 create trigger reject_pumpy_receipt before insert on pumpy_messages for each row execute function reject_pumpy_receipt();`);
mid=await proposal();const before=await count('workouts');
await assert.rejects(()=>confirm(mid));assert.equal(await count('workouts'),before);assert.equal(await status(mid),'pending');
await db.exec('drop trigger reject_pumpy_receipt on pumpy_messages');
await confirm(mid);assert.equal(await count('workouts'),before+1);
await db.query('update profiles set limits=$1 where id=$2',[{library:await count('workouts')},u]);
mid=await proposal();assert.equal((await confirm(mid)).kind,'library','current library cap returns an actionable limit without executing');
assert.equal(await status(mid),'pending');
await db.query('update profiles set limits=null where id=$1',[u]);
const many={...create,blocks:Array.from({length:13},()=>block)};
mid=await proposal(many);await assert.rejects(()=>confirm(mid),'model proposal retains 12-block bound');
mid=await proposal(many,'deterministic_combine');
const combined=await confirm(mid);assert.equal(combined.workout.blocks.length,13,'complete deterministic combine preserves more than twelve blocks');
assert.equal(combined.workout.extracted_by,'pumpy:deterministic_combine');
mid=await proposal({...create,blocks:[{exercises:'invalid'}]},'deterministic_combine');
await assert.rejects(()=>confirm(mid),'malformed exercise collection rejected');assert.equal(await status(mid),'pending');
mid=await proposal({...create,blocks:[{exercises:[{name:''}]}]},'deterministic_combine');
await assert.rejects(()=>confirm(mid),'unnamed exercise rejected');
mid=await proposal({...create,blocks:[{...block,title:'x'.repeat(60001)}]},'deterministic_combine');
await assert.rejects(()=>confirm(mid),'deterministic output remains bounded');
assert.equal((await db.query("select has_function_privilege('authenticated','confirm_pumpy_proposal(uuid,bigint,boolean,jsonb)','execute') ok")).rows[0].ok,false);
assert.equal((await db.query("select has_function_privilege('anon','confirm_pumpy_proposal(uuid,bigint,boolean,jsonb)','execute') ok")).rows[0].ok,false);
console.log('PASS atomic Pumpy confirmation: duplicate accepts, accept/decline order, account scope, append CAS/override, entitlement, plan rollback/deduplication, injected receipt failure rollback, library cap, RPC grants');
await db.close();
