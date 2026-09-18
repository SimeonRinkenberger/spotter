// Creator codes: execute the shipping migration in PostgreSQL and assert what it
// promises. Every redeem status, one code per account, closed codes, own code,
// max redemptions, the store source skipping the subscribed check, the earning
// window and duplicates, refunds, stats and owed arithmetic, the two views, the
// email lookup, and that anon/authenticated are locked out of the money.
//
// The shim is the ops harness's: the production schema reduced to the columns
// the scorecard migration reads, plus Supabase's `alter default privileges ...
// grant all to anon, authenticated`, without which the revokes in the migration
// would pass trivially and prove nothing. The scorecard migration is applied
// first because ops_creator_week reuses its week boundary and its exclusion of
// staff and throwaway accounts, exactly as it will in production.
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
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key,plan text not null default 'free',created_at timestamptz not null default now());
create table public.app_config(key text primary key,value text not null,updated_at timestamptz not null default now());
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
create schema net;
create function net.http_post(url text,headers jsonb default '{}'::jsonb,body jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000) returns bigint language sql as $net$ select 1::bigint $net$;`);

await db.exec(readFileSync('supabase/migrations/20260917180000_ops_scorecard.sql','utf8'));
const migration=readFileSync('supabase/migrations/20260918150000_creator_codes.sql','utf8');
await db.exec(migration);
await db.exec(migration);   // re-runnable: a second apply is a no-op, not an error

const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const rejects=async(sql,args,re,why)=>{await assert.rejects(db.query(sql,args),re,why);};
const uid=()=>crypto.randomUUID();

// ---------- dials ----------
const seeds=await q("select key,value from public.app_config where key like 'creator.%' order by key");
assert.deepEqual(seeds.map(r=>r.key),['creator.commission_bps','creator.commission_months','creator.discount']);
assert.equal(seeds[0].value,'2000');assert.equal(seeds[1].value,'12');
assert.deepEqual(JSON.parse(seeds[2].value),{percent_off:10,months:12});

// ---------- accounts ----------
// A creator with an account, four real people, one already on Stripe, one with
// a live store entitlement, one whose Restore found nothing, one staff comp and
// one throwaway fixture.
const creator=uid(),alice=uid(),bob=uid(),carol=uid(),dave=uid(),sam=uid(),stored=uid(),restored=uid(),staff=uid(),tw=uid();
for (const [u,plan,mail] of [[creator,'free','Creator@Example.com'],[alice,'free','alice@example.com'],[bob,'free','bob@example.com'],
  [carol,'free','carol@example.com'],[dave,'free','dave@example.com'],[sam,'free','sam@example.com'],[stored,'free','stored@example.com'],
  [restored,'free','restored@example.com'],[staff,'staff','owner@example.com'],[tw,'free','spotter-tw-probe@example.com']]) {
  await q('insert into auth.users(id,email) values($1,$2)',[u,mail]);
  await q('insert into public.profiles(id,plan) values($1,$2)',[u,plan]);
}
await q("insert into public.subscriptions values($1,'stripe','canceled','month','plus','spotter_plus_month')",[sam]);
await q("insert into public.store_entitlements(user_id,active,expires_at,source,product_id) values($1,true,now()+interval '20 days','apple','plus_month')",[stored]);
await q("insert into public.store_entitlements(user_id,active) values($1,false)",[restored]);

// ---------- minting ----------
// Lower-case in, upper-case stored; no rate given, the dials fill it in.
const maria=await one("insert into public.creator_codes(code,creator_name,creator_user_id,contact) values('maria',' Maria ',$1,'maria@pay.example') returning *",[creator]);
assert.equal(maria.code,'MARIA');assert.equal(maria.creator_name,'Maria');
assert.equal(maria.commission_bps,2000);assert.equal(maria.commission_months,12);
await q("update public.app_config set value='1500' where key='creator.commission_bps'");
await q("update public.app_config set value='junk' where key='creator.commission_months'");
const later=await one("insert into public.creator_codes(code,creator_name) values('LATER','Later') returning *");
assert.equal(later.commission_bps,1500,'a new code takes the dial at mint time');
assert.equal(later.commission_months,12,'an unreadable dial falls back to the compiled default');
assert.equal(maria.commission_bps,2000,'a code already minted keeps its promise');
await q("update public.app_config set value='2000' where key='creator.commission_bps'");
await q("update public.app_config set value='12' where key='creator.commission_months'");
await rejects("insert into public.creator_codes(code,creator_name) values('ab','Short')",[],/check/,'two characters is not a code');
await rejects("insert into public.creator_codes(code,creator_name) values('MAR IA','Space')",[],/check/,'a space is not a code');
await rejects("insert into public.creator_codes(code,creator_name) values('Maria','Again')",[],/unique|duplicate/,'case-insensitively unique');
await rejects("insert into public.creator_codes(code,creator_name,commission_bps) values('BIG','Big',10001)",[],/check/,'bps stops at 10000');
await rejects("insert into public.creator_codes(code,creator_name,commission_months) values('LONG','Long',0)",[],/check/,'months start at 1');
await q("insert into public.creator_codes(code,creator_name,active) values('OLD','Old',false)");
await q("insert into public.creator_codes(code,creator_name,expires_at) values('GONE','Gone',now()-interval '1 day')");
await q("insert into public.creator_codes(code,creator_name,max_redemptions) values('ONE','One',1)");
const before=(await one("select updated_at from public.creator_codes where code='MARIA'")).updated_at;
await new Promise(r=>setTimeout(r,20));
await q("update public.creator_codes set note='seen' where code='MARIA'");
assert.ok((await one("select updated_at from public.creator_codes where code='MARIA'")).updated_at>before,'updated_at moves on update');

// ---------- redeeming ----------
const redeem=async(u,code,source='app')=>one('select * from public.redeem_creator_code($1,$2,$3)',[u,code,source]);
let r=await redeem(alice,'maria','link');
assert.equal(r.status,'ok');assert.equal(r.code,'MARIA');assert.equal(r.creator_name,'Maria');assert.ok(r.redeemed_at instanceof Date);
r=await redeem(alice,'LATER','app');
assert.equal(r.status,'already_redeemed','one code per account, first wins');
assert.equal(r.code,'MARIA');assert.equal(r.creator_name,'Maria');assert.ok(r.redeemed_at instanceof Date,'the answer names the code on file');
assert.equal((await one('select count(*)::int as n from public.creator_referrals where user_id=$1',[alice])).n,1);
assert.equal((await redeem(bob,'ma')).status,'bad_code');
assert.equal((await redeem(bob,'')).status,'bad_code');
assert.equal((await redeem(bob,'has space')).status,'bad_code');
assert.equal((await redeem(bob,'NOPE')).status,'unknown_code');
assert.equal((await redeem(creator,'MARIA')).status,'own_code');
assert.equal((await redeem(bob,'OLD')).status,'code_closed','inactive');
assert.equal((await redeem(bob,'GONE')).status,'code_closed','expired');
assert.equal((await redeem(carol,'one')).status,'ok','the last redemption');
assert.equal((await redeem(bob,'ONE')).status,'code_closed','and none after it');
assert.equal((await redeem(sam,'MARIA')).status,'already_subscribed','a subscriptions row, even a canceled one, is not a new subscriber');
assert.equal((await redeem(stored,'MARIA')).status,'already_subscribed','a live store entitlement is not a new subscriber');
assert.equal((await redeem(stored,'MARIA','store')).status,'ok','the store event arrives after the purchase, so it skips the check');
assert.equal((await redeem(restored,'MARIA')).status,'ok','a Restore that found nothing is not a subscription');
assert.equal((await redeem(bob,'MARIA','signup')).status,'ok');
assert.equal((await redeem(dave,'MARIA','app')).status,'ok');
assert.equal((await redeem(staff,'MARIA','app')).status,'ok');
assert.equal((await redeem(tw,'MARIA','app')).status,'ok');
await rejects('select * from public.redeem_creator_code($1,$2,$3)',[uid(),'MARIA','email'],/unknown source/,'a source the app does not send is a bug, not a status');
assert.equal((await one("select count(*)::int as n from public.creator_referrals where source='store'")).n,1);

// ---------- the ledger ----------
const T0='2026-03-01T12:00:00Z';
const plus=(months,days=0)=>{const d=new Date(T0);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(d.getUTCDate()+days);return d.toISOString();};
const earn=async(u,ext,at,gross,source='apple')=>(await one('select public.record_creator_earning($1,$2,$3,$4,$5) as s',[u,source,ext,at,gross])).s;
assert.equal(await earn(carol,'rc:x1',T0,699),'ok','ONE is carol\'s code');
assert.equal(await earn(uid(),'rc:none',T0,699),'no_referral');
assert.equal(await earn(alice,'rc:t1',T0,1999),'ok');
assert.equal((await one('select first_paid_at from public.creator_referrals where user_id=$1',[alice])).first_paid_at.toISOString(),new Date(T0).toISOString(),'the first payment starts the window');
assert.equal(await earn(alice,'rc:t1',T0,1999),'duplicate','a redelivered webhook writes nothing');
assert.equal(await earn(alice,'rc:t2',plus(6),1999,'google'),'ok');
assert.equal(await earn(alice,'rc:t3',plus(12),1999),'outside_window','twelve months on, the window has closed');
assert.equal(await earn(alice,'rc:t3b',plus(12,-1),1999),'ok','the day before, it has not');
assert.equal(await earn(alice,'rc:refund:t1',plus(13),-1999),'ok','a refund lands whenever it lands');
assert.equal(await earn(alice,'rc:refund:t1',plus(13),-1999),'duplicate');
await rejects('select public.record_creator_earning($1,$2,$3,$4,$5)',[alice,'stripe','rc:s1',T0,100],/unknown source/);
await rejects('select public.record_creator_earning($1,$2,$3,$4,$5)',[alice,'apple','',T0,100],/external id/);
const rows=await q('select external_id,gross_cents,commission_cents,source from public.creator_earnings where user_id=$1 order by id',[alice]);
assert.deepEqual(rows.map(x=>[x.external_id,x.gross_cents,x.commission_cents,x.source]),
  [['rc:t1',1999,400,'apple'],['rc:t2',1999,400,'google'],['rc:t3b',1999,400,'apple'],['rc:refund:t1',-1999,-400,'apple']],
  '20% of 19.99 rounds to 4.00, and the refund mirrors it');
assert.equal((await one('select first_paid_at from public.creator_referrals where user_id=$1',[alice])).first_paid_at.toISOString(),new Date(T0).toISOString(),'a later payment never moves the window');

// ---------- stats and owed ----------
await q("update public.profiles set plan='plus' where id=$1",[alice]);
await q("update public.profiles set plan='pro' where id=$1",[bob]);
const stats=async(u)=>q('select * from public.creator_stats($1)',[u]);
let s=await stats(creator);
assert.equal(s.length,1);s=s[0];
assert.equal(s.code,'MARIA');assert.equal(s.active,true);
assert.equal(s.signups,7,'alice, stored, restored, bob, dave, staff, tw');
assert.equal(s.subscribers,2,'alice and bob are on a paid plan right now');
assert.equal(Number(s.earned_cents),800);assert.equal(Number(s.paid_cents),0);assert.equal(Number(s.owed_cents),800);
assert.equal(s.commission_bps,2000);assert.equal(s.commission_months,12);
assert.equal((await stats(alice)).length,0,'a person with no code sees no creator numbers');
await q("insert into public.creator_payouts(code_id,amount_cents,note) values($1,300,'first payout')",[maria.id]);
s=(await stats(creator))[0];
assert.equal(Number(s.paid_cents),300);assert.equal(Number(s.owed_cents),500,'owed is earned minus paid');
const view=await one("select * from public.creator_code_stats where code='MARIA'");
assert.equal(view.contact,'maria@pay.example');assert.equal(view.creator_user_id,creator);assert.equal(view.note,'seen');
assert.equal(view.signups,7);assert.equal(view.subscribers,2);assert.equal(view.first_payments,1);
assert.equal(view.redemptions_30d,7);assert.ok(view.last_redeemed_at instanceof Date);
assert.equal(Number(view.earned_cents),800);assert.equal(Number(view.paid_cents),300);assert.equal(Number(view.owed_cents),500);
assert.equal(view.currency,'usd');
const oneRow=await one("select * from public.creator_code_stats where code='ONE'");
assert.equal(oneRow.signups,1);assert.equal(Number(oneRow.earned_cents),140);
assert.equal((await one("select signups,earned_cents from public.creator_code_stats where code='OLD'")).signups,0,'a code nobody used is a row of zeros, not a missing row');

// ---------- email lookup ----------
assert.equal((await one("select public.creator_user_for_email(' creator@example.com ') as id")).id,creator,'case- and space-insensitive');
assert.equal((await one("select public.creator_user_for_email('nobody@example.com') as id")).id,null);

// ---------- the scorecard line ----------
// Redemptions above were all now(); move two of them and one earning back a
// week so this week and last week can be told apart. Staff and throwaway
// redemptions must not appear in either.
await q("update public.creator_referrals set redeemed_at=now()-interval '7 days' where user_id in ($1,$2)",[bob,dave]);
await q("update public.creator_referrals set first_paid_at=now() where user_id=$1",[carol]);
await q("update public.creator_referrals set first_paid_at=now()-interval '7 days' where user_id=$1",[alice]);
await q("update public.creator_earnings set paid_at=now() where external_id in ('rc:x1','rc:t1')");
await q("update public.creator_earnings set paid_at=now()-interval '7 days' where external_id in ('rc:t2','rc:t3b')");
await q("update public.creator_earnings set paid_at=now()-interval '14 days' where external_id='rc:refund:t1'");
await q("update public.creator_codes set created_at=now()-interval '21 days' where code='MARIA'");
const weeks=await q('select * from public.ops_creator_week order by week_start');
assert.ok(weeks.length>=4,'one row per week since the first code, zero-filled');
const thisWeek=weeks[weeks.length-1],lastWeek=weeks[weeks.length-2];
const wk=d=>{const x=new Date(d);const dow=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-dow);return x.toISOString().slice(0,10);};
assert.equal(new Date(thisWeek.week_start).toISOString().slice(0,10),wk(new Date()));
// Placed relative to a real now(), so a run in the first seconds of a Monday
// could split "now" and "now minus seven days" differently; the totals across
// the two weeks are what is pinned, and the split is checked when it is clean.
const both=(col)=>Number(thisWeek[col])+Number(lastWeek[col]);
assert.equal(both('redemptions'),6,'alice, carol, stored, restored, bob and dave; staff and the throwaway are excluded');
assert.equal(both('store_redemptions'),1);
assert.equal(both('first_payments'),2,'alice and carol');
assert.equal(both('commission_usd'),Number((4+1.4+4+4).toFixed(2)),'this week 4.00 + 1.40, last week 4.00 + 4.00');
assert.equal(Number(weeks[weeks.length-3].refunds),1);
assert.equal(Number(weeks[weeks.length-3].commission_usd),-4,'the refund week is negative');
if (Number(thisWeek.redemptions)===4) {
  assert.equal(Number(thisWeek.prev_redemptions),2,'prev_* is last week, not the last week with data');
  assert.equal(Number(thisWeek.prev_first_payments),1);
  assert.equal(Number(thisWeek.prev_commission_usd),8);
  assert.equal(Number(lastWeek.prev_commission_usd),-4);
}
assert.equal(Number(thisWeek.owed_now_usd),Number(((800-300+140)/100).toFixed(2)),'owed right now, across every code');
assert.equal(Number(weeks[0].redemptions),0);

// ---------- who may read what ----------
const priv=async(role,obj,kind)=>(await one(`select has_table_privilege('${role}','${obj}','${kind}') as ok`)).ok;
for (const t of ['creator_earnings','creator_payouts','creator_code_stats','ops_creator_week']) {
  for (const role of ['anon','authenticated']) assert.equal(await priv(role,'public.'+t,'select'),false,role+' cannot read '+t);
  assert.equal(await priv('service_role','public.'+t,'select'),true);
}
for (const t of ['creator_codes','creator_referrals']) {
  for (const kind of ['insert','update','delete']) assert.equal(await priv('authenticated','public.'+t,kind),false,'authenticated cannot '+kind+' '+t);
  assert.equal(await priv('anon','public.'+t,'select'),false);
}
for (const fn of ['redeem_creator_code(uuid,text,text)','record_creator_earning(uuid,text,text,timestamptz,int)','creator_stats(uuid)','creator_user_for_email(text)','creator_config_int(text,int)']) {
  assert.equal((await one(`select has_function_privilege('authenticated','public.${fn}','execute') as ok`)).ok,false,'authenticated cannot call '+fn);
  assert.equal((await one(`select has_function_privilege('service_role','public.${fn}','execute') as ok`)).ok,true);
}
await db.exec('set role authenticated');
await q("select set_config('request.jwt.claim.sub',$1,false)",[creator]);
let mine=await q('select code,creator_name,commission_bps,active from public.creator_codes');
assert.deepEqual(mine,[{code:'MARIA',creator_name:'Maria',commission_bps:2000,active:true}],'a creator reads their own code row and nobody else\'s');
await rejects('select contact from public.creator_codes',[],/permission denied/,'and never the payout handle');
await rejects('select note from public.creator_codes',[],/permission denied/,'nor the owner\'s note');
assert.equal((await q('select * from public.creator_referrals')).length,0,'the creator has no referral of their own');
await q("select set_config('request.jwt.claim.sub',$1,false)",[alice]);
assert.equal((await q('select code from public.creator_codes')).length,0,'a referred person does not see the code table');
await rejects('select * from public.creator_codes',[],/permission denied/,'and select * is refused outright, because * includes contact');
mine=await q('select user_id,source from public.creator_referrals');
assert.deepEqual(mine,[{user_id:alice,source:'link'}],'a person reads their own referral only');
await rejects('select * from public.creator_earnings',[],/permission denied/);
await rejects('select * from public.creator_payouts',[],/permission denied/);
await rejects('select * from public.creator_code_stats',[],/permission denied/);
await rejects('select * from public.creator_stats($1)',[alice],/permission denied/);
await rejects("insert into public.creator_referrals(user_id,code_id,source) values($1,$2,'app')",[carol,maria.id],/permission denied/);
await db.exec('reset role');

// ---------- deleting an account ----------
await q('delete from auth.users where id=$1',[alice]);
assert.equal((await q('select * from public.creator_referrals where user_id=$1',[alice])).length,0,'the referral goes with the account');
assert.equal((await one('select count(*)::int as n from public.creator_earnings where external_id like $1 and user_id is null',['rc:t%'])).n,3,'the ledger keeps the money and forgets the person');
assert.equal(Number((await stats(creator))[0].earned_cents),800,'nothing owed disappears with an account');
await q('delete from auth.users where id=$1',[creator]);
assert.equal((await one("select creator_user_id from public.creator_codes where code='MARIA'")).creator_user_id,null,'a creator leaving keeps their code and its ledger');

await db.close();
console.log('PASS creator codes SQL: dials seeded, mint normalises and takes the dials, every redeem status, one code per account, closed and spent codes, own code, subscribed check skipped for the store, twelve-month window with duplicates and refunds, stats and owed arithmetic, owner and creator views, email lookup, weekly scorecard line with staff/throwaway exclusion, and anon/authenticated locked out of contact, notes, the ledger and the payouts.');
