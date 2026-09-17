// Operational scorecard and alerting regressions: execute the shipping migration
// in PostgreSQL, seed fixtures, and assert every view counts what it claims and
// every alert fires exactly once per day.
//
// The shim below is the production schema reduced to the columns this migration
// reads. It also replicates the one Supabase default that makes the grants in the
// migration load-bearing: `alter default privileges ... grant all to anon,
// authenticated`. Without it the revokes would pass trivially in PGlite and the
// test would prove nothing about the database the views actually ship to.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js'));
const db=new PGlite();

await db.exec(`set timezone='UTC';
create role anon;create role authenticated;create role service_role;
grant usage on schema public to anon,authenticated,service_role;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,created_at timestamptz not null default now());
create table public.profiles(id uuid primary key,plan text not null default 'free',created_at timestamptz not null default now());
create table public.app_config(key text primary key,value text not null);
create table public.workouts(id uuid primary key default gen_random_uuid(),user_id uuid,created_at timestamptz not null default now(),
  ingest_status text not null default 'ready',has_full_workout boolean not null default false,ingest_job_id uuid);
create table public.workout_logs(id uuid primary key default gen_random_uuid(),user_id uuid,
  started_at timestamptz not null default now(),completed_at timestamptz);
create table public.ingest_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,status text not null default 'queued',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),finished_at timestamptz,
  locked_at timestamptz,attempts int not null default 0,max_attempts int not null default 4,claim_generation bigint not null default 0);
create table public.corrections(id bigint generated always as identity primary key,workout_id uuid,
  created_at timestamptz not null default now(),kind text,field text);
create table public.video_previews(user_id uuid,month date,shortcode text,completed boolean not null default false,
  created_at timestamptz not null default now(),primary key(user_id,month,shortcode));
create table public.subscriptions(user_id uuid primary key,source text,status text,"interval" text,plan text,price_lookup_key text);
create table public.store_entitlements(user_id uuid primary key,active boolean not null default false,expires_at timestamptz,
  source text,product_id text);
create table public.ai_reservations(id uuid primary key default gen_random_uuid(),user_id uuid,
  created_at timestamptz not null default now(),reserved_usd numeric,charged_usd numeric,state text not null default 'reserved',
  attempt_meta jsonb not null default '{}'::jsonb);
create table public.ai_guard_policy(singleton boolean primary key,daily_usd numeric,monthly_usd numeric);
create table public.ai_provider_cooldowns(provider text primary key,until_at timestamptz not null);
create table public.upload_permits(path text primary key,user_id uuid,created_at timestamptz not null default now(),
  released boolean not null default false);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,
  created_at timestamptz not null default now());
insert into public.ai_guard_policy values(true,0.50,10);
alter default privileges in schema public grant all on tables to anon,authenticated;
-- pg_net, reduced to "record what you were asked to post". The cron body is run
-- verbatim further down, so the argument names here have to match the call.
create schema net;
create table public.net_calls(url text,headers jsonb,body jsonb,called_at timestamptz default now());
create function net.http_post(url text,headers jsonb default '{}'::jsonb,body jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000) returns bigint language plpgsql as $net$
begin insert into public.net_calls(url,headers,body) values(url,headers,body); return 1; end $net$;`);

const migration=readFileSync('supabase/migrations/20260917180000_ops_scorecard.sql','utf8');
await db.exec(migration);

// ---------- fixtures ----------
// Four real accounts, one staff comp and one throwaway. The last two must not
// appear in a single number anywhere below; that is the whole point of them.
const [payerM,payerY,freeA,freeB,staff,tw]=Array.from({length:6},()=>crypto.randomUUID());
const email=(u)=>`user-${u.slice(0,8)}@example.com`;
for (const [u,plan,mail] of [[payerM,'plus',email(payerM)],[payerY,'plus',email(payerY)],
  [freeA,'free',email(freeA)],[freeB,'free',email(freeB)],
  [staff,'staff','owner@example.com'],[tw,'free','spotter-tw-probe@example.com']]) {
  await db.query('insert into auth.users(id,email,created_at) values($1,$2,now()-interval \'3 days\')',[u,mail]);
  await db.query('insert into public.profiles(id,plan,created_at) values($1,$2,now()-interval \'3 days\')',[u,plan]);
}
// Fixtures are placed relative to a real now(), so a harness run shortly after a
// Monday 00:00 UTC boundary splits them across two weeks. Every assertion below
// therefore totals a column across weeks rather than pinning one week_start, and
// the week boundary itself is checked directly instead of by side effect.
const only=(rows)=>{assert.equal(rows.length,1,'expected exactly one row, got '+rows.length);return rows[0];};
const view=async(name,extra='')=>(await db.query(`select * from public.${name} ${extra}`)).rows;
const total=(rows,col,filter=()=>true)=>rows.filter(filter).reduce((n,r)=>n+Number(r[col]??0),0);
assert.equal((await db.query("select public.ops_week('2026-09-17T04:00:00Z'::timestamptz) as w")).rows[0].w
  .toISOString().slice(0,10),'2026-09-14','the week starts Monday, in UTC');
assert.equal((await db.query("select public.ops_week('2026-09-14T00:00:00Z'::timestamptz) as w")).rows[0].w
  .toISOString().slice(0,10),'2026-09-14','Monday 00:00 UTC belongs to its own week');

// Revenue: one monthly Stripe payer, one annual Stripe payer, one Google store
// purchase on a product the price book has never heard of.
await db.query(`insert into public.subscriptions values
  ($1,'stripe','active','month','plus','spotter_plus_month'),
  ($2,'stripe','active','year','plus','spotter_plus_year'),
  ($3,'stripe','active','month','plus','spotter_plus_month')`,[payerM,payerY,staff]);
await db.query(`insert into public.store_entitlements(user_id,active,expires_at,source,product_id)
  values($1,true,now()+interval '20 days','google','plus_mystery_sku')`,[freeB]);

const revenue=await view('ops_revenue_week','order by source,"interval"');   // always the current week only
// Segmented by source, status, interval and plan: two Stripe lines and one store
// line, and the staff comp on none of them.
assert.equal(revenue.length,3,'staff subscription is excluded; monthly and annual are separate lines');
const stripeRows=revenue.filter(r=>r.source==='stripe');
assert.equal(stripeRows.reduce((n,r)=>n+Number(r.accounts),0),2,'staff comp excluded from paid accounts');
assert.equal(stripeRows.reduce((n,r)=>n+Number(r.entitled_accounts),0),2);
assert.equal(stripeRows.reduce((n,r)=>n+Number(r.unpriced_accounts),0),0);
// One week of $6.99/month and one week of $50/year, recognized straight-line.
const monthRow=stripeRows.find(r=>r.interval==='month'), yearRow=stripeRows.find(r=>r.interval==='year');
assert.equal(Number(monthRow.gross_recognized_usd),+(699/100*7/30.4375).toFixed(2));
assert.equal(Number(yearRow.gross_recognized_usd),+(5000/100*7/365.25).toFixed(2),
  'annual cash is recognized straight-line, not collected in one week');
assert.ok(Number(yearRow.gross_recognized_usd)<1.0,'a $50 year is under a dollar a week');
assert.ok(Number(monthRow.net_recognized_usd)<Number(monthRow.gross_recognized_usd),'net is after processor fees');
assert.equal(monthRow.prices_verified,false,'seeded prices are flagged unverified until the owner confirms them');
const googleRow=revenue.find(r=>r.source==='google');
assert.equal(Number(googleRow.accounts),1);
assert.equal(Number(googleRow.unpriced_accounts),1,'an unknown store product is reported, not silently counted as $0');
assert.equal(Number(googleRow.gross_recognized_usd),0);

// Imports: six cards for real accounts, plus one for the throwaway.
const card=async(user,status,full,ago='1 hour')=>(await db.query(
  `insert into public.workouts(user_id,created_at,ingest_status,has_full_workout)
   values($1,now()-interval '${ago}',$2,$3) returning id`,[user,status,full])).rows[0].id;
const late   =await card(freeA,'ready',true,'30 hours');
const usable1=await card(freeA,'ready',true,'20 hours');
const usable2=await card(freeA,'ready',true,'18 hours');
const thin   =await card(freeB,'ready',false,'16 hours');
const failed =await card(freeB,'failed',false,'14 hours');
const usable3=await card(payerM,'ready',true,'5 hours');
await card(tw,'ready',true,'5 hours');
assert.ok(failed,'the failed card exists to be counted as a failure, not an import');
// A rename an hour after the import is a critical correction; a reps tweak is
// not; a delete twenty-nine hours later is outside the reaction window entirely.
await db.query(`insert into public.corrections(workout_id,created_at,kind,field) values
  ($1,now()-interval '19 hours','edit','name'),
  ($2,now()-interval '17 hours','edit','reps'),
  ($3,now()-interval '1 hour','delete','exercise')`,[usable1,usable2,late]);
const imports=await view('ops_imports_week');
assert.equal(total(imports,'imports'),6,'throwaway import excluded');
assert.equal(total(imports,'ready_imports'),5);
assert.equal(total(imports,'usable_imports'),4,'ready with no exercises is not a usable import');
assert.equal(total(imports,'failed_imports'),1);
assert.equal(total(imports,'corrected_24h'),2,'the twenty-nine-hour-late delete is outside the window');
assert.equal(total(imports,'critical_corrected_24h'),1,'a reps edit is not a critical correction');

// Activation: three accounts got a ready card, the throwaway does not count.
const activation=await view('ops_activation_week','order by week_start');
assert.equal(total(activation,'activated_users'),3);
assert.equal(total(activation,'signups'),4,'staff and throwaway are not signups');
assert.equal(Number(activation[activation.length-1].activated_cumulative),3,'the running total is a window, not a re-count');

// Sessions and return. freeA trained last week and this week; payerM only today.
await db.query(`insert into public.workout_logs(user_id,started_at,completed_at) values
  ($1,now()-interval '9 days',now()-interval '9 days'+interval '40 minutes'),
  ($1,now()-interval '2 hours',now()-interval '1 hour'),
  ($2,now()-interval '3 hours',null),
  ($3,now()-interval '3 hours',now()-interval '2 hours')`,[freeA,payerM,tw]);
const started=await view('ops_started_week','order by week_start');
assert.equal(total(started,'sessions_started'),3,'throwaway session excluded');
assert.equal(total(started,'sessions_completed'),2,'a started-but-unfinished session is not a completion');
const returns=(await db.query('select * from public.ops_return_week order by week_start')).rows;
assert.equal(returns.length,2,'two cohorts: last week and this week');
const oldCohort=returns[0], newCohort=returns[1];
assert.equal(Number(oldCohort.cohort_users),1);
assert.equal(Number(oldCohort.returned_later),1,'freeA came back in a later ISO week');
assert.equal(Number(oldCohort.pct_returned),100.0);
assert.equal(Number(newCohort.returned_later),0,'payerM has no later week yet');

// Incidents, from the RELIABILITY-GTM "Monitor" paragraph.
const terminalJob=crypto.randomUUID();
await db.query(`insert into public.ingest_jobs(id,user_id,status,created_at,finished_at,locked_at,claim_generation)
  values($1,$2,'done',now()-interval '6 hours',now()-interval '6 hours'+interval '31 seconds',
         now()-interval '6 hours'+interval '3 seconds',3)`,[terminalJob,freeA]);
await db.query(`update public.workouts set ingest_status='processing',ingest_job_id=$1 where id=$2`,[terminalJob,usable3]);
await db.query(`insert into public.video_previews(user_id,month,shortcode,completed,created_at)
  values($1,date_trunc('month',now())::date,'abandoned',false,now()-interval '3 hours'),
        ($1,date_trunc('month',now())::date,'inflight',false,now()-interval '5 minutes')`,[payerM]);
await db.query(`insert into public.ai_reservations(user_id,created_at,reserved_usd,charged_usd,state,attempt_meta)
  values($1,now()-interval '4 hours',0.02,null,'reserved','{}'::jsonb),
        ($1,now()-interval '4 hours',0.02,null,'unknown','{}'::jsonb)`,[freeA]);
const incidentRows=await view('ops_incidents_week');
const incidents=(s)=>total(incidentRows,'incidents',r=>r.signal===s);
assert.equal(incidents('processing_on_terminal_job'),1,'the fence makes this impossible; a count is a bug or legacy data');
assert.equal(incidents('preview_reserved_not_completed'),1,'a read five minutes old is in flight, not a loss');
assert.equal(incidents('job_reclaimed'),1);
assert.equal(incidents('reservation_unsettled'),1);
assert.equal(incidents('reservation_unknown'),1);
await db.query(`update public.workouts set ingest_status='ready' where id=$1`,[usable3]);

// Latency: one done job, 31 seconds end to end, 3 seconds of it queued.
const latency=only(await view('ops_latency_week'));
assert.equal(Number(latency.jobs),1);
assert.equal(Number(latency.p50_total_seconds),31.0);
assert.equal(Number(latency.p50_queue_seconds),3.0,'queue wait is capacity; total is the model and the scrape');

// Cost per delivered workout. One reservation is attributed to the delivered
// job; one is loose coaching spend; the four ready cards this week are all
// denominators, including the ones that cost nothing.
await db.query(`insert into public.ai_reservations(user_id,created_at,reserved_usd,charged_usd,state,attempt_meta)
  values($1,now()-interval '6 hours',0.01,0.008,'settled',jsonb_build_object('purpose','extract','job_id',$2::text)),
        ($1,now()-interval '2 hours',0.004,null,'settled',jsonb_build_object('purpose','coach'))`,[freeA,terminalJob]);
// Throwaway spend is excluded from the scorecard but NOT from the budget guard
// below, which is the correct split: the owner's fixtures do not flatter the unit
// economics, and they do still spend the same real dollars against the day cap.
await db.query(`insert into public.ai_reservations(user_id,created_at,reserved_usd,charged_usd,state,attempt_meta)
  values($1,now()-interval '2 hours',0.03,0.03,'settled',jsonb_build_object('purpose','extract'))`,[tw]);
const costRows=await view('ops_cost_week');
const purpose=(p)=>costRows.filter(r=>r.purpose===p);
assert.equal(total(costRows,'ai_usd',r=>r.purpose==='extract'),0.008,
  'charged beats reserved, and throwaway spend is excluded');
assert.equal(total(costRows,'ai_usd',r=>r.purpose==='all'),0.052,
  'a reservation with no job still lands in the week it was made');
assert.equal(purpose('coach').length,1,'a purpose with no delivered job of its own still reports');
// The denominator is delivered cards, not billed jobs: five cards were delivered
// and exactly one of them had a reservation attached to its job.
assert.equal(total(costRows,'delivered_workouts',r=>r.purpose==='all'),5,
  'cached and deterministic cards are denominators too');
for (const r of costRows) if (Number(r.delivered_workouts)>0)
  assert.equal(Number(r.usd_per_delivered),+(Number(r.ai_usd)/Number(r.delivered_workouts)).toFixed(4));

// Subsidy. Free-account spend divided by the payers carrying it.
const subsidy=await view('ops_subsidy_week');
assert.equal(Number(subsidy[0].payers),2,'staff is not a payer');
assert.equal(total(subsidy,'free_usd'),0.052);
assert.equal(total(subsidy,'paid_usd'),0);
assert.equal(total(subsidy,'free_subsidy_per_payer_usd'),0.026,'the free tier costs the payers 2.6 cents so far');

// ---------- the pager ----------
const fire=async()=>Object.fromEntries((await db.query('select * from public.ops_alert_check()')).rows.map(r=>[r.key,r]));
// A quiet database pages nobody. Two unsettled reservations are already there,
// so the only expected alert on a clean run is that one.
let fired=await fire();
assert.deepEqual(Object.keys(fired).sort(),['reservations_unsettled'],'nothing else is wrong yet');
assert.equal(Number(fired.reservations_unsettled.detail.count),1);
assert.deepEqual(await fire(),{},'a second tick fifteen minutes later re-fires nothing');

// Now break everything at once, the way 3 am does.
await db.query(`insert into public.ingest_jobs(user_id,status,created_at) values($1,'queued',now()-interval '14 minutes')`,[freeA]);
await db.query(`insert into public.ai_provider_cooldowns values('gemini',now()+interval '4 minutes')`);
await db.query(`insert into public.upload_permits(path,user_id,created_at,released)
  values('uploads/x/abandoned.mp4',$1,now()-interval '90 minutes',false)`,[freeA]);
await db.query(`insert into storage.objects(bucket_id,name,created_at) values('uploads','x/leaked.mp4',now()-interval '30 hours')`);
await db.query(`insert into public.ingest_jobs(user_id,status,attempts,max_attempts,created_at) values($1,'failed',4,4,now()-interval '20 minutes')`,[freeA]);
for (let i=0;i<5;i++) await db.query(
  `insert into public.ingest_jobs(user_id,status,created_at,finished_at) values($1,$2,now()-interval '30 minutes',now()-interval '10 minutes')`,
  [freeA,i<3?'dead':'done']);
for (let i=0;i<21;i++) await db.query(
  `insert into auth.users(id,email,created_at) values(gen_random_uuid(),'flood-'||$1||'@example.com',now()-interval '10 minutes')`,[i]);
// 95% of a $0.50 day and of a $10 month, in one charge that is already settled.
await db.query(`insert into public.ai_reservations(user_id,created_at,reserved_usd,charged_usd,state,attempt_meta)
  values($1,now(),0.49,0.49,'settled',jsonb_build_object('purpose','extract'))`,[freeA]);
await db.query(`insert into public.ai_reservations(user_id,created_at,reserved_usd,charged_usd,state,attempt_meta)
  values($1,date_trunc('month',now())+interval '1 hour',9.6,9.6,'settled',jsonb_build_object('purpose','extract'))`,[freeA]);

fired=await fire();
const expected=['job_failure_rate','jobs_at_max_attempts','provider_cooldown','queue_stalled','signup_spike',
  'spend_day_60','spend_day_80','spend_day_95','spend_month_60','spend_month_80','spend_month_95',
  'upload_objects_leaked','upload_permits_stale'];
assert.deepEqual(Object.keys(fired).sort(),expected,'every threshold in the brief fires');
assert.equal(fired.queue_stalled.level,'critical');
assert.equal(Number(fired.queue_stalled.detail.oldest_minutes),14);
assert.equal(fired.spend_day_95.level,'critical');
assert.equal(fired.spend_day_60.level,'info');
assert.ok(Number(fired.spend_day_95.detail.pct)>=95);
assert.equal(Number(fired.job_failure_rate.detail.finished),6,'a rate, not a count: five finished is the floor');
assert.equal(Number(fired.signup_spike.detail.signups_last_hour),21);
assert.deepEqual(fired.provider_cooldown.detail.providers,['gemini']);
assert.equal(Number(fired.upload_objects_leaked.detail.count),1);
assert.equal(JSON.stringify(fired.queue_stalled.detail).includes('@example.com'),false,'alert detail carries no user content');

assert.deepEqual(await fire(),{},'every alert fires exactly once per day');
assert.equal((await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n,expected.length+1);
// Roll the day back and the same conditions page again tomorrow.
await db.query(`update public.ops_alerts set day=day-1`);
const tomorrow=await fire();
assert.equal(Object.keys(tomorrow).length,expected.length+1,'a new UTC day re-arms every alert');
assert.equal((await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n,2*(expected.length+1));

// ---------- the fifteen-minute tick ----------
// The cron command, lifted verbatim out of the migration and run against the
// pg_net stub. This is the whole delivery path below the edge function: if this
// body is wrong, alerts are recorded and nobody is ever told, which is the exact
// failure the whole file exists to prevent and the one a view test cannot see.
const tick=migration.split('$cron$')[1];
assert.ok(tick.includes('ops_alert_check'),'the cron body was extracted, not an empty string');
const posts=async()=>(await db.query('select * from public.net_calls order by called_at')).rows;

// Nothing new fired: the check runs, finds today's rows already there, and stops
// before spending a request.
await db.exec(tick);
assert.equal((await posts()).length,0,'a tick with nothing new to report posts nothing');

// Alerts fire but worker_url is not configured. The rows must still be written —
// an alerting system that only remembers outages while the notifier is healthy
// forgets the ones worth remembering.
await db.query('delete from public.ops_alerts');
await db.exec(tick);
assert.equal((await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n,expected.length+1,
  'the check records its alerts even when there is nowhere to send them');
assert.equal((await posts()).length,0,'and does not post to a URL it does not have');

// Configured. Now the same tick reaches the worker route with the shared secret.
await db.query(`insert into public.app_config(key,value) values
  ('worker_url','https://project.supabase.co/functions/v1/spotter/api/worker/tick'),
  ('worker_secret','test-secret')`);
await db.query('delete from public.ops_alerts');
await db.exec(tick);
const post=only(await posts());
assert.equal(post.url,'https://project.supabase.co/functions/v1/spotter/api/worker/ops-alert',
  'the ops URL is derived from the worker URL, not stored a third time');
assert.equal(post.headers['x-worker-secret'],'test-secret','machine to machine, behind the existing secret');
assert.equal(Number(post.body.fired),expected.length+1);

// A worker_url that does not contain the worker path must not be posted to:
// replace() would return it unchanged and an ops body would drain the queue.
await db.query(`update public.app_config set value='https://project.supabase.co/functions/v1/spotter' where key='worker_url'`);
await db.query('delete from public.ops_alerts');
await db.exec(tick);
assert.equal((await posts()).length,1,'a worker_url of the wrong shape is refused rather than guessed at');
assert.equal((await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n,expected.length+1,
  'and the alerts are recorded anyway');

// ---------- reachability ----------
// Supabase grants anon and authenticated all privileges on new public tables by
// default (replicated above). These revokes are the only thing standing between
// a signed-in browser and the entire business in aggregate.
const objects=['ops_alerts','ops_price_book','ops_included_accounts','ops_revenue_week','ops_activation_week',
  'ops_started_week','ops_return_week','ops_imports_week','ops_incidents_week','ops_cost_week','ops_subsidy_week',
  'ops_latency_week'];
for (const o of objects) for (const role of ['anon','authenticated']) {
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) as ok',[role,'public.'+o,'select'])).rows[0].ok,
    false,`${role} must not select ${o}`);
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) as ok',[role,'public.'+o,'insert'])).rows[0].ok,
    false,`${role} must not write ${o}`);
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) as ok',['service_role','public.'+o,'select'])).rows[0].ok,
    true,`service_role reads ${o}`);
}
for (const role of ['anon','authenticated','public'])
  assert.equal((await db.query("select has_function_privilege($1,'public.ops_alert_check()','execute') as ok",[role])).rows[0].ok,
    false,`${role} must not run the alert check`);
assert.equal((await db.query("select has_function_privilege('service_role','public.ops_alert_check()','execute') as ok")).rows[0].ok,true);

// Re-runnable: the whole migration applies a second time without error and
// without duplicating the price book, losing an alert or dropping a view other
// views depend on.
const alertsBefore=(await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n;
await db.exec(migration);
assert.equal((await db.query('select count(*)::int as n from public.ops_price_book')).rows[0].n,8,'price book seed is idempotent');
assert.equal((await db.query('select count(*)::int as n from public.ops_alerts')).rows[0].n,alertsBefore,'re-applying keeps alert history');
// Four seeded accounts plus the twenty-one signup-spike users, none of which
// have a profile row yet — an account whose profile has not been created is
// still a signup, and dropping it would understate the number a launch watches.
assert.equal((await db.query('select count(*)::int as n from public.ops_included_accounts')).rows[0].n,25,
  'a view other views depend on is replaced in place, not dropped');

await db.close();
console.log('PASS ops scorecard SQL: nine weekly views with staff/throwaway exclusion, straight-line recognized revenue, unpriced store products surfaced, critical-correction proxy, reliability incident signals, cost per delivered card over a cached denominator, free-user subsidy, ingest percentiles, thirteen alert thresholds firing once per UTC day and re-arming the next, the cron tick posting to the derived worker URL and still recording alerts when it cannot, and anon/authenticated locked out of all of it.');
