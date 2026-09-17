// Persistence regressions: execute the shipping migration and RPC in PostgreSQL.
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
const u=crypto.randomUUID(), other=crypto.randomUUID(), j=crypto.randomUUID(), w=crypto.randomUUID();
const blocks=[{exercises:[{name:'Squat',sets:3,reps:'12'}]}];
const edited=[{exercises:[{name:'My squat',sets:2,reps:'7',edited_by_user:true}]}];
const payload={title:'New read',blocks,muscle_groups:['Legs'],equipment:[],tags:[],has_full_workout:true,read_quality:'premium',read_plan:'plus'};
await db.query("insert into profiles values ($1,'plus'),($2,'free')",[u,other]);
await db.query("insert into ingest_jobs(id,user_id,shortcode,status,locked_by,attempts,claim_generation,created_at) values($1,$2,'video','running','worker',2,2,now())",[j,u]);
await db.query("insert into workouts(id,user_id,shortcode,ingest_job_id,ingest_status,blocks,title) values($1,$2,'video',$3,'processing',$4,'Original')",[w,u,j,blocks]);
let generation=2;
const finish=async(attempt=generation,user=u,worker='worker')=>(await db.query('select finish_ingest_job($1,$2,$3,$4,$5) as result',[j,user,worker,attempt,payload])).rows[0].result;
const workout=async()=>(await db.query('select * from workouts where id=$1',[w])).rows[0];
assert.equal((await finish(1)).status,'stale','same worker, prior claim generation');
assert.equal((await finish(2,u,'old-worker')).status,'stale');
assert.equal((await finish(2,other)).status,'stale','wrong account cannot complete');
assert.equal((await workout()).title,'Original');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);
await db.query("update workouts set title='My personal title',category='My category' where id=$1",[w]);
await db.query("select set_config('request.jwt.claim.sub','',false)");

// Simulate a correction after the model took its old snapshot, before completion.
const override={blocks:edited,muscle_groups:['Legs'],equipment:['Dumbbell'],has_full_workout:true};
await db.query('update workouts set user_workout_override=$1 where id=$2',[override,w]);
assert.equal((await finish()).filled,1);
assert.deepEqual((await workout()).blocks,edited,'in-flight read preserves the committed edit');
assert.equal((await workout()).title,'My personal title','title rename survives reader completion');
assert.equal((await workout()).category,'My category','personal category survives reader completion');
assert.deepEqual((await workout()).equipment,['Dumbbell']);
assert.equal((await finish()).status,'stale','duplicate completion does nothing');
// Synchronous/direct-cache writes also pass through the same database protection.
await db.query('update workouts set blocks=$1,equipment=$2 where id=$3',[blocks,['Barbell'],w]);
assert.deepEqual((await workout()).blocks,edited);
// Deleting every movement is an intentional empty list, not missing evidence.
await db.query('update workouts set user_workout_override=$1 where id=$2',[{...override,blocks:[],has_full_workout:false},w]);
await db.query('update workouts set blocks=$1,has_full_workout=true where id=$2',[blocks,w]);
assert.deepEqual((await workout()).blocks,[]);
assert.equal((await workout()).has_full_workout,false);
const reset=async()=>{await db.query("update ingest_jobs set status='running',locked_by='worker',attempts=2 where id=$1",[j]);await db.query("update workouts set ingest_status='processing',ingest_job_id=$1 where id=$2",[j,w]);generation=Number((await db.query('select claim_generation from ingest_jobs where id=$1',[j])).rows[0].claim_generation);};
await reset();
await db.query("update profiles set plan='free' where id=$1",[u]);
assert.equal((await finish()).status,'access_changed','downgrade during processing fails closed');
assert.equal((await workout()).ingest_status,'processing');
// A previous-month reservation belongs to that job, even after midnight.
await db.query("update ingest_jobs set created_at=date_trunc('month',now())-interval '1 minute' where id=$1",[j]);
await db.query("insert into video_previews(user_id,shortcode,month,created_at) select $1,'video',date_trunc('month',created_at),created_at-interval '1 second' from ingest_jobs where id=$2",[u,j]);
await db.query("insert into video_previews(user_id,shortcode,month) values($1,'video',date_trunc('month',now()))",[u]);
assert.equal((await finish()).filled,1);
let previews=(await db.query('select completed from video_previews order by month')).rows;
assert.deepEqual(previews.map(x=>x.completed),[true,false],'complete only the reserved month');
await reset();
await db.query('update workouts set ingest_job_id=$1 where id=$2',[crypto.randomUUID(),w]);
assert.equal((await finish()).filled,0,'superseded job cannot touch the new job workout');
assert.equal((await workout()).ingest_status,'processing');
assert.equal((await db.query("select has_function_privilege('authenticated','finish_ingest_job(uuid,uuid,text,integer,jsonb)','execute') as ok")).rows[0].ok,false);
// A budget pause resets the retry counter, but must never reset the fence.
await reset();
const priorGeneration=generation;
const fail=async(g,dead=false)=>(await db.query('select fail_ingest_job($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) as ok',
  [j,u,'worker',g,dead,!dead,false,'test error','Try again'])).rows[0].ok;
assert.equal(await fail(generation),true);
await reset();
assert.ok(generation>priorGeneration);
assert.equal(await fail(priorGeneration,true),false);
assert.equal((await workout()).ingest_status,'processing');
const publish=async(g,card,patch=false)=>(await db.query('select publish_ingest_cache($1,$2,$3,$4,$5,$6) as ok',
  [j,u,'worker',g,{shortcode:'video',...card},patch])).rows[0].ok;
assert.equal(await publish(generation,{card:{title:'Current'}}),true);
assert.equal(await publish(priorGeneration,{card:{title:'Stale'}}),false);
assert.equal(await publish(generation,{basic_card:{title:'Basic'},basic_v:10},true),true);
const cached=(await db.query("select * from video_cache where shortcode='video'")).rows[0];
assert.equal(cached.card.title,'Current');assert.equal(cached.basic_card.title,'Basic');
const stage=async(g)=>(await db.query("select stage_ingest_job($1,$2,'worker',$3,'watching') as ok",[j,u,g])).rows[0].ok;
assert.equal(await stage(priorGeneration),false);
assert.equal(await stage(generation),true);
assert.equal((await workout()).media_stage,'watching');
const currentRevision=(await workout()).user_edit_revision;
const staleEdit=await db.query('update workouts set user_workout_override=$1 where id=$2 and user_edit_revision=$3 returning id',[override,w,Number(currentRevision)-1]);
assert.equal(staleEdit.rows.length,0,'concurrent stale personal edits reject without silently losing the winner');
assert.equal(await fail(generation,true),true);
assert.equal((await workout()).ingest_status,'failed');
assert.equal((await db.query('select completed from video_previews order by month')).rows.length,2,'failed old job preserves completed old preview and unrelated new-month reservation');
const previewWorkout=crypto.randomUUID();
await db.query("insert into workouts(id,user_id,shortcode,ingest_status,blocks) values($1,$2,'cached-video','ready','[]')",[previewWorkout,other]);
const cachedPreview=async(explicit,body=payload)=>(await db.query('select complete_cached_preview($1,$2,$3,$4) as result',[previewWorkout,other,body,explicit])).rows[0].result;
assert.equal((await cachedPreview(false)).status,'access_changed','no silent use of a new preview');
await assert.rejects(cachedPreview(true,{...payload,calories:'not an integer'}));
assert.equal((await db.query('select count(*)::int as n from video_previews where user_id=$1',[other])).rows[0].n,0,'failed cached delivery rolls its reservation back');
assert.equal((await cachedPreview(true)).status,'ok');
assert.equal((await cachedPreview(false)).status,'ok','repeat cached delivery is idempotent');
assert.equal((await db.query('select count(*)::int as n from video_previews where user_id=$1 and completed',[other])).rows[0].n,1);
await db.query("update workouts set ingest_status='processing' where id=$1",[previewWorkout]);
assert.equal((await cachedPreview(true)).status,'processing','new background job wins over stale cache request');
const enqueued=await Promise.all(Array.from({length:6},()=>db.query("select * from enqueue_ingest($1,'https://example.test/a','duplicate','tiktok','video','Test')",[other])));
assert.equal(enqueued.filter(x=>x.rows[0].job_created).length,1);
const first=enqueued.find(x=>x.rows[0].job_created).rows[0];
assert.equal((await db.query("select count(*)::int as n from saves_log where shortcode='duplicate'")).rows[0].n,1);
await db.query("update ingest_jobs set status='done' where id=$1",[first.job_id]);
// Also repair legacy dangling processing rows rather than reattaching a done job.
const requeued=(await db.query('select * from requeue_ingest($1,$2)',[other,first.workout_id])).rows[0];
assert.notEqual(requeued.job_id,first.job_id);assert.equal(requeued.job_created,true);
const again=(await db.query('select * from requeue_ingest($1,$2)',[other,first.workout_id])).rows[0];
assert.equal(again.job_id,requeued.job_id);assert.equal(again.job_created,false);
assert.equal((await db.query("select count(*)::int as n from saves_log where shortcode='duplicate'")).rows[0].n,2,'duplicate retry does not reserve a second quota row');
await db.close();
console.log('PASS reader completion SQL: generations including budget retry, account isolation, duplicate completion, edit/delete preservation, concurrent edit rejection, entitlement change, month boundary, superseded jobs, cache and stage fencing, failure cleanup, atomic cached preview/rollback and RPC permissions.');
