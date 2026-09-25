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
// The function as it stands now: 20260925100000 redefines it to pick a cover, and
// every regression below must hold for that definition too.
await db.exec(readFileSync('supabase/migrations/20260925100000_pumpy_covers.sql','utf8'));
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
assert((await db.query('select public.pumpy_cover_keys() k')).rows[0].k.includes(first.workout.pumpy_cover),'a created card carries a known cover');
assert.equal(second.workout.pumpy_cover,first.workout.pumpy_cover,'and a repeated accept the same one');
assert.equal(await count('workouts'),1,'duplicate accepts do not duplicate workouts');
assert.equal(await count('pumpy_messages'),3,'one tool receipt and one assistant receipt');
// The idempotency key is the message AND the decision. Repeating the same
// decision is a lost response being retried and returns the stored receipt;
// changing the decision on a resolved proposal is a conflict that still carries
// the receipt, so the client has the message the thread already holds.
const lateDecline=await confirm(mid,false);
assert.equal(lateDecline.status,'conflict','late decline cannot claim nothing changed');
assert.equal(lateDecline.message,'That one was already accepted.');
assert.deepEqual(lateDecline.messages,first.messages,'and hands back the receipt it already wrote');
assert.equal((await confirm(mid,true,{},other)).status,'not_found','cross-account confirmation fails closed');
mid=await proposal();const declined=await confirm(mid,false);
assert.equal(declined.status,'ok');
assert.deepEqual(await confirm(mid,false),declined,'a repeated decline is a retried response, not a new decision');
const lateAccept=await confirm(mid);
assert.equal(lateAccept.status,'conflict','accept after decline is 409, not 200 with the decline receipt');
assert.equal(lateAccept.message,'That one was already declined.');
assert.deepEqual(lateAccept.messages,declined.messages);
assert.equal(await count('workouts'),1,'and it executes nothing');
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

// ---- the route's own short-circuit agrees with the database ----
//
// handlePumpyConfirm answers a stored receipt without calling the RPC at all, so
// the decision check has to exist in both places or the 409 depends on which
// request happens to arrive first. Run the real handler over the receipts the
// database just wrote.
const vm=await import('node:vm');
const {transformSync}=await import('esbuild');
const routeSrc=readFileSync('supabase/functions/spotter/index.ts','utf8');
const lift=(name)=>{const m=routeSrc.match(new RegExp('^(?:export )?(?:async )?function '+name+'\\(','m'));assert(m,name);return routeSrc.slice(m.index,routeSrc.indexOf('\n}',m.index)+2).replace(/^export /,'');};
let rpcCalls=0;
const stored=(await db.query('select id,meta from pumpy_messages where meta->>$1 is not null order by id',['confirm_accept'])).rows;
const acceptedMsg=stored.find(r=>r.meta.confirm_accept===true), declinedMsg=stored.find(r=>r.meta.confirm_accept===false);
assert(acceptedMsg&&declinedMsg,'the decision is stored next to the receipt');
const routeCtx=vm.createContext({console,Request,Response,assert,
  json:(v,status=200)=>Response.json(v,{status}),
  dbSelect:async(_t,q)=>{const id=Number(q.match(/id=eq\.(\d+)/)[1]);const row=stored.find(r=>Number(r.id)===id);return row?[{id:row.id,meta:row.meta}]:[];},
  rpc:async()=>{rpcCalls++;return {status:'ok'};},
  execProposal:async()=>({}),
});
vm.runInContext(transformSync(lift('handlePumpyConfirm'),{loader:'ts',format:'cjs'}).code,routeCtx);
const route=async(id,accept)=>{const r=await routeCtx.handlePumpyConfirm(
  new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({message_id:Number(id),accept})}),'u',{});
  return {status:r.status,body:await r.json()};};
const replay=await route(acceptedMsg.id,true);
assert.equal(replay.status,200,'the same decision replays the receipt');
assert.equal(rpcCalls,0,'without touching the database');
const flipped=await route(acceptedMsg.id,false);
assert.equal(flipped.status,409,'declining an accepted proposal is a conflict at the route too');
assert.equal(flipped.body.message,'That one was already accepted.');
const lateYes=await route(declinedMsg.id,true);
assert.equal(lateYes.status,409,'and accepting a declined one no longer returns 200 with the decline receipt');
assert.equal(lateYes.body.message,'That one was already declined.');
assert(Array.isArray(lateYes.body.messages)&&lateYes.body.messages.length,'the receipt rides along with the 409');
assert.equal(rpcCalls,0,'no short-circuit path executes anything');

console.log('PASS atomic Pumpy confirmation (with its cover): duplicate accepts, accept/decline order in SQL and on the route, account scope, append CAS/override, entitlement, plan rollback/deduplication, injected receipt failure rollback, library cap, RPC grants');
await db.close();
