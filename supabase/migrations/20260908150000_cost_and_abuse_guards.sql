-- One shared admission point for all isolates. Apply before deploying the reader.
create table public.ai_guard_policy (
  singleton boolean primary key default true check (singleton),
  daily_usd numeric not null check (daily_usd >= 0),
  monthly_usd numeric not null check (monthly_usd >= 0),
  max_calls int not null check (max_calls between 1 and 20),
  max_jobs int not null check (max_jobs between 1 and 20),
  user_monthly_usd jsonb not null default '{"free":0.05,"plus":0.50,"pro":1.00,"staff":1.00}'::jsonb
);
insert into public.ai_guard_policy(singleton,daily_usd,monthly_usd,max_calls,max_jobs) values (true, 0.50, 10, 3, 2);
create table public.ai_reservations (
  id uuid primary key, user_id uuid, work_key text not null, provider text not null, model text not null,
  created_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null default (clock_timestamp() + interval '180 seconds'),
  reserved_usd numeric not null check(reserved_usd > 0), charged_usd numeric,
  state text not null default 'reserved' check(state in ('reserved','settled','unknown'))
);
create index on public.ai_reservations(created_at);
create index on public.ai_reservations(work_key,created_at);
create table public.ai_provider_cooldowns(provider text primary key, until_at timestamptz not null);
create table public.ai_actions (
  id uuid primary key, user_id uuid not null, scope text not null,
  created_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null default (clock_timestamp() + interval '180 seconds'),
  finished boolean not null default false,
  credits int not null default 0 check(credits >= 0)
);
create index on public.ai_actions(user_id,created_at);
create table public.upload_permits (
  path text primary key, user_id uuid not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  released boolean not null default false,
  max_bytes bigint not null check(max_bytes between 1 and 26214400)
);

alter table public.ai_guard_policy enable row level security;
alter table public.ai_reservations enable row level security;
alter table public.ai_provider_cooldowns enable row level security;
alter table public.ai_actions enable row level security;
alter table public.upload_permits enable row level security;
grant all on public.ai_guard_policy, public.ai_reservations, public.ai_provider_cooldowns, public.ai_actions, public.upload_permits to service_role;
revoke all on public.ai_guard_policy, public.ai_reservations, public.ai_provider_cooldowns, public.ai_actions, public.upload_permits from anon, authenticated;

create function public.ai_reserve(p_id uuid,p_user uuid,p_work text,p_provider text,p_model text,p_usd numeric)
returns text language plpgsql security definer set search_path=public as $$
declare v public.ai_guard_policy; d numeric; m numeric; w numeric; user_cap numeric; user_used numeric; user_plan text;
begin
  -- Serializes reservations with settlements and policy edits, across providers.
  select * into strict v from public.ai_guard_policy where singleton for update;
  if p_user is null then return 'invalid_user'; end if;
  if p_usd is null or p_usd <= 0 or p_usd > 10 then return 'invalid_cost'; end if;
  if exists(select 1 from public.ai_reservations where id=p_id) then return 'duplicate'; end if;
  if exists(select 1 from public.ai_provider_cooldowns where provider=p_provider and until_at>clock_timestamp()) then return 'cooldown'; end if;
  select coalesce(sum(coalesce(charged_usd,reserved_usd)) filter(where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
         coalesce(sum(coalesce(charged_usd,reserved_usd)),0)
  into d,m from public.ai_reservations where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if d+p_usd>v.daily_usd then return 'daily_budget'; end if;
  if m+p_usd>v.monthly_usd then return 'monthly_budget'; end if;
  select coalesce(plan,'free') into user_plan from profiles where id=p_user;
  if not found then return 'invalid_user'; end if;
  user_cap:=coalesce((v.user_monthly_usd->>coalesce(user_plan,'free'))::numeric,0);
  select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) into user_used from ai_reservations
    where user_id=p_user and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if user_used+p_usd>user_cap then return 'user_monthly_budget'; end if;
  -- A bounded import remains bounded across worker retries and slide isolates.
  select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) into w from public.ai_reservations
    where work_key=p_work and created_at>now()-interval '1 day';
  if w+p_usd>0.25 then return 'work_budget'; end if;
  if (select count(*) from public.ai_reservations where state='reserved' and lease_until>clock_timestamp()) >= v.max_calls then return 'busy'; end if;
  insert into public.ai_reservations(id,user_id,work_key,provider,model,reserved_usd)
  values(p_id,p_user,p_work,p_provider,p_model,p_usd);
  return 'ok';
end $$;

create function public.ai_settle(p_id uuid,p_usd numeric,p_cooldown int default 0)
returns void language plpgsql security definer set search_path=public as $$
declare r public.ai_reservations;
begin
  perform 1 from public.ai_guard_policy where singleton for update;
  select * into r from public.ai_reservations where id=p_id for update;
  if not found or r.state<>'reserved' then return; end if;
  update public.ai_reservations set state=case when p_usd is null then 'unknown' else 'settled' end,
    charged_usd=case when p_usd is null then null else greatest(0,p_usd) end, lease_until=now() where id=p_id;
  if p_cooldown>0 then
    insert into public.ai_provider_cooldowns values(r.provider,now()+make_interval(secs=>least(p_cooldown,300)))
    on conflict(provider) do update set until_at=greatest(ai_provider_cooldowns.until_at,excluded.until_at);
  end if;
end $$;

create function public.ai_budget_status() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('daily_limit',p.daily_usd,'monthly_limit',p.monthly_usd,
   'daily_used',coalesce((select sum(coalesce(charged_usd,reserved_usd)) from ai_reservations where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
   'monthly_used',coalesce((select sum(coalesce(charged_usd,reserved_usd)) from ai_reservations where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0))
 from ai_guard_policy p where singleton
$$;

-- Admission counters are charged BEFORE work. Failed requests still consume a
-- short-window attempt, so a malformed-request flood cannot be retried for free.
create function public.ai_admit(p_id uuid,p_user uuid,p_scope text,p_cap int,p_credits int default 0,p_day_credits int default null,p_month_credits int default null)
returns text language plpgsql security definer set search_path=public as $$
declare n bigint; d bigint; m bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,581));
  if exists(select 1 from ai_actions where user_id=p_user and not finished and lease_until>clock_timestamp()) then return 'busy'; end if;
  if (select count(*) from ai_actions where user_id=p_user and created_at>now()-interval '1 minute')>=6 then return 'minute'; end if;
  select count(*) into n from ai_actions where user_id=p_user and scope=p_scope and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if p_cap is not null and n>=p_cap then return 'daily'; end if;
  select coalesce(sum(credits) filter(where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(credits),0)
    into d,m from ai_actions where user_id=p_user and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if p_day_credits is not null and d+p_credits>p_day_credits then return 'credits_day'; end if;
  if p_month_credits is not null and m+p_credits>p_month_credits then return 'credits_month'; end if;
  insert into ai_actions(id,user_id,scope,credits) values(p_id,p_user,p_scope,greatest(0,p_credits));
  return 'ok';
end $$;
create function public.ai_finish_action(p_id uuid,p_credits int default null,p_finish boolean default true)
returns void language sql security definer set search_path=public as $$
 update ai_actions set finished=case when p_finish then true else finished end,lease_until=case when p_finish then now() else lease_until end,credits=case when p_credits is null then credits else greatest(p_credits,0) end where id=p_id
$$;

-- At most two jobs project-wide and one per user. SKIP LOCKED still prevents
-- duplicate claims; the policy row makes the running count and claim atomic.
create or replace function public.claim_ingest_jobs(p_worker text,p_limit int default 4)
returns setof public.ingest_jobs language plpgsql security definer set search_path=public as $$
declare slots int;
begin
  select max_jobs into slots from ai_guard_policy where singleton for update;
  slots:=greatest(0,slots-(select count(*) from ingest_jobs where status='running'));
  return query with candidates as (
    select j.id from ingest_jobs j where j.status='queued' and j.run_after<=now()
      and not exists(select 1 from ingest_jobs r where r.user_id=j.user_id and r.status='running')
      and not exists(select 1 from ingest_jobs earlier where earlier.user_id=j.user_id and earlier.status='queued' and earlier.run_after<=now() and (earlier.created_at,earlier.id)<(j.created_at,j.id))
    order by j.run_after,j.created_at limit least(greatest(p_limit,0),slots) for update skip locked
  ) update ingest_jobs j set status='running',locked_by=p_worker,locked_at=now(),attempts=j.attempts+1,updated_at=now()
    from candidates c where j.id=c.id returning j.*;
end $$;

-- Storage insert requires an exact, short-lived server-issued permit. The bucket
-- cap also applies to service-issued uploads; browser claims about size are not trusted.
update storage.buckets set file_size_limit=26214400 where id='uploads';
create function public.has_upload_permit(p_path text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from upload_permits where path=p_path and user_id=(select auth.uid()) and expires_at>now())
$$;
drop policy if exists "uploads: insert into your own folder" on storage.objects;
create policy "uploads: permitted insert" on storage.objects for insert to authenticated
with check(bucket_id='uploads' and public.has_upload_permit(name));
-- Cancellation uses an API instead: deleting and re-uploading under a valid
-- permit must not allow unlimited transferred bytes.
drop policy if exists "uploads: delete your own folder" on storage.objects;
drop policy if exists "uploads: read your own folder" on storage.objects;

-- Ingest-owned fields must never be changed through the user's REST client.
revoke insert,update on public.workouts from authenticated,anon;
grant update(title,category,notes,favorite) on public.workouts to authenticated;

-- Library count is protected in the same transaction as all server inserts.
create function public.guard_workout_library() returns trigger language plpgsql security definer set search_path=public as $$
declare cap int; plan_name text; overrides jsonb; plans jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,582));
  if exists(select 1 from workouts where user_id=new.user_id and shortcode=new.shortcode) then return new; end if;
  select plan,limits into plan_name,overrides from profiles where id=new.user_id;
  select value::jsonb into plans from app_config where key='limits.plans';
  cap:=case when coalesce(overrides,'{}') ? 'library' then (overrides->>'library')::int
    when coalesce(plans->coalesce(plan_name,'free'),'{}') ? 'library' then (plans->coalesce(plan_name,'free')->>'library')::int
    when coalesce(plan_name,'free')='free' then 20 else null end;
  if cap is not null and (select count(*) from workouts where user_id=new.user_id)>=cap then
    raise exception 'Library limit reached' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger guard_workout_library before insert on public.workouts for each row execute function public.guard_workout_library();

-- Explicit function grants: none of the RPCs accepting user/cap arguments may
-- be called by a client that could supply a different identity or larger cap.
revoke all on function public.ai_reserve(uuid,uuid,text,text,text,numeric), public.ai_settle(uuid,numeric,int), public.ai_budget_status(), public.ai_admit(uuid,uuid,text,int,int,int,int), public.ai_finish_action(uuid,int,boolean), public.guard_workout_library() from public,anon,authenticated;
grant execute on function public.ai_reserve(uuid,uuid,text,text,text,numeric), public.ai_settle(uuid,numeric,int), public.ai_budget_status(), public.ai_admit(uuid,uuid,text,int,int,int,int), public.ai_finish_action(uuid,int,boolean) to service_role;
revoke all on function public.has_upload_permit(text) from public,anon;
grant execute on function public.has_upload_permit(text) to authenticated;

-- Four outstanding upload slots bound beta storage exposure to 100 MiB. A
-- completed deletion releases a slot; abandoned permits stay held for two hours
-- so expiring a token cannot race an upload still reaching Storage.
create function public.issue_upload_permit(p_user uuid,p_path text,p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
begin
  perform 1 from ai_guard_policy where singleton for update;
  if p_path not like p_user::text || '/%' or p_bytes<1 or p_bytes>26214400 then return 'invalid'; end if;
  if exists(select 1 from upload_permits where user_id=p_user and not released and created_at>now()-interval '2 hours') then return 'pending'; end if;
  if (select count(*) from upload_permits where not released and created_at>now()-interval '2 hours')>=4 then return 'busy'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads')>=4 then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes) values(p_path,p_user,p_bytes);
  return 'ok';
end $$;
revoke all on function public.issue_upload_permit(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.issue_upload_permit(uuid,text,bigint) to service_role;

-- Carry forward already-recorded current-month spend. Historical zero-priced
-- providers still require invoice reconciliation; this is not an invoice import.
do $$ begin
 if to_regclass('public.ai_cost_log') is not null then
   insert into ai_reservations(id,work_key,provider,model,created_at,reserved_usd,charged_usd,state)
   select gen_random_uuid(),'prior-ledger','prior-ledger','prior-ledger',date_trunc('day',created_at at time zone 'UTC') at time zone 'UTC',
     greatest(sum(est_cost_usd),0.000001),sum(est_cost_usd),'settled'
   from ai_cost_log where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
   group by date_trunc('day',created_at at time zone 'UTC');
 end if;
end $$;

create function public.ai_guard_cleanup() returns void language plpgsql security definer set search_path=public as $$
begin
 delete from ai_actions where created_at<now()-interval '40 days';
 delete from ai_reservations where created_at<now()-interval '90 days';
 delete from upload_permits where created_at<now()-interval '7 days';
 delete from ai_provider_cooldowns where until_at<now()-interval '1 day';
end $$;
revoke all on function public.ai_guard_cleanup() from public,anon,authenticated;
grant execute on function public.ai_guard_cleanup() to service_role;
do $$ begin
 if to_regnamespace('cron') is not null then
   perform cron.schedule('spotter-guard-cleanup','17 3 * * *','select public.ai_guard_cleanup()');
 end if;
end $$;

-- Preserve credit usage from before this migration as well as dollar usage.
do $$ begin
 if to_regclass('public.pumpy_usage') is not null then
   insert into ai_actions(id,user_id,scope,created_at,finished,credits)
   select gen_random_uuid(),user_id,'prior-credits',date_trunc('day',created_at at time zone 'UTC') at time zone 'UTC',true,sum(credits)::int
   from pumpy_usage where user_id is not null and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
   group by user_id,date_trunc('day',created_at at time zone 'UTC');
 end if;
end $$;

revoke all on function public.claim_ingest_jobs(text,int) from public,anon,authenticated;
grant execute on function public.claim_ingest_jobs(text,int) to service_role;

alter table public.workouts add constraint workout_title_bytes check (octet_length(coalesce(title,''))<=1200) not valid;
alter table public.workouts add constraint workout_notes_bytes check (octet_length(coalesce(notes,''))<=32000) not valid;

-- Enqueue/requeue already insert their log inside the job transaction. Enforce
-- daily counts there as well as HTTP admission so even an expired request lease
-- cannot enqueue work against an old quota snapshot.
create function public.guard_save_allowance() returns trigger
language plpgsql security definer set search_path=public as $$
declare plan_name text; overrides jsonb; plans jsonb; caps jsonb; k text; cap int; used bigint; kinds text[];
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,581));
 select plan,limits into plan_name,overrides from profiles where id=new.user_id;
 select value::jsonb into plans from app_config where key='limits.plans';
 caps:=coalesce(
   '{"free":{"saves":30,"extract":10,"media":2,"helper":25},"plus":{"saves":200,"extract":60,"media":15,"helper":60},"pro":{"saves":500,"extract":150,"media":50,"helper":600},"staff":{"saves":null,"extract":null,"media":null,"helper":null}}'::jsonb->coalesce(plan_name,'free'),
   '{"saves":30,"extract":10,"media":2,"helper":25}'::jsonb)
   || coalesce(plans->coalesce(plan_name,'free'),'{}'::jsonb) || coalesce(overrides,'{}');
 kinds:=case when new.kind='save' and not new.cached then array['saves','extract']
   when new.kind='save' then array['saves'] when new.kind='reprocess' and not new.cached then array['extract']
   when new.kind='helper' then array['helper'] when new.kind='media' then array['media'] else array[]::text[] end;
 foreach k in array kinds loop
   cap:=(caps->>k)::int;
   select count(*) into used from saves_log where user_id=new.user_id
     and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
     and case k when 'saves' then kind='save' when 'extract' then kind in ('save','reprocess') and not cached else kind=k end;
   if cap is not null and used>=cap then raise exception 'Daily % limit reached',k using errcode='P0001'; end if;
 end loop;
 return new;
end $$;
create trigger guard_save_allowance before insert on public.saves_log for each row execute function public.guard_save_allowance();
revoke all on function public.guard_save_allowance() from public,anon,authenticated;
create index on public.ai_reservations(user_id,created_at);
create index on public.ai_reservations(lease_until) where state='reserved';
create index on public.ingest_jobs(user_id,status,created_at,id);

create function public.ai_budget_user_status(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object('monthly_limit',coalesce((g.user_monthly_usd->>coalesce(p.plan,'free'))::numeric,0),
   'monthly_used',coalesce((select sum(coalesce(charged_usd,reserved_usd)) from ai_reservations where user_id=p_user and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0))
 from ai_guard_policy g cross join profiles p where g.singleton and p.id=p_user
$$;
revoke all on function public.ai_budget_user_status(uuid) from public,anon,authenticated;
grant execute on function public.ai_budget_user_status(uuid) to service_role;
