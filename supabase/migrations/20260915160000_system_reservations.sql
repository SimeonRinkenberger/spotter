-- Spotter — a reservation with no user behind it.
--
-- Found live on v161: every call to the sheets A/B bench came back 429
-- `invalid_user`. The bench is a worker route behind its own secret, above the
-- user-auth gate, and it deliberately has no user — it is the owner measuring one
-- model against another, not somebody's save. ai_reserve refuses a null p_user,
-- and it is right to: everywhere else in this system a null user means an actor
-- that lost track of who it was working for, and a spend nobody can be held to is
-- a spend nobody notices. Failing closed is the correct default.
--
-- So the default stays, and a system reservation has to say so out loud. A null
-- user is admitted only when the work key names itself `sys:…`, which nothing but
-- a deliberately-constructed system actor ever does. Everything else that bounded
-- such a call still bounds it:
--
--   * the global daily and monthly ceilings, which is the whole point of keeping
--     the reservation rather than skipping it;
--   * the provider cooldown;
--   * the per-work-key budget, which for the bench means each model gets its own
--     $0.25 a day — a bench that runs away costs a quarter, not a month;
--   * the concurrency cap.
--
-- What is skipped is the per-user plan cap, because there is no user to have a
-- plan. Nothing here can charge a real person: `ai_reservations.user_id` stays
-- null, so no real user's month moves, and the route's own ai_cost_log rows carry
-- a null user for the same reason.
--
-- Idempotent, and no other behaviour changes: a null user with any other work key
-- is still `invalid_user`, and a named user still walks the identical path.

create or replace function public.ai_reserve(p_id uuid,p_user uuid,p_work text,p_provider text,p_model text,p_usd numeric)
returns text language plpgsql security definer set search_path=public as $$
declare v public.ai_guard_policy; d numeric; m numeric; w numeric; user_cap numeric; user_used numeric; user_plan text;
begin
  -- Serializes reservations with settlements and policy edits, across providers.
  select * into strict v from public.ai_guard_policy where singleton for update;
  -- A system reservation says so in its work key, and nothing else may be null.
  if p_user is null and p_work not like 'sys:%' then return 'invalid_user'; end if;
  if p_usd is null or p_usd <= 0 or p_usd > 10 then return 'invalid_cost'; end if;
  if exists(select 1 from public.ai_reservations where id=p_id) then return 'duplicate'; end if;
  if exists(select 1 from public.ai_provider_cooldowns where provider=p_provider and until_at>clock_timestamp()) then return 'cooldown'; end if;
  select coalesce(sum(coalesce(charged_usd,reserved_usd)) filter(where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
         coalesce(sum(coalesce(charged_usd,reserved_usd)),0)
  into d,m from public.ai_reservations where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if d+p_usd>v.daily_usd then return 'daily_budget'; end if;
  if m+p_usd>v.monthly_usd then return 'monthly_budget'; end if;
  -- The per-user plan cap, skipped only when there is no user to have a plan.
  if p_user is not null then
    select coalesce(plan,'free') into user_plan from profiles where id=p_user;
    if not found then return 'invalid_user'; end if;
    user_cap:=coalesce((v.user_monthly_usd->>coalesce(user_plan,'free'))::numeric,0);
    select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) into user_used from ai_reservations
      where user_id=p_user and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
    if user_used+p_usd>user_cap then return 'user_monthly_budget'; end if;
  end if;
  -- A bounded import remains bounded across worker retries and slide isolates —
  -- and a bench remains bounded across however many times it is run.
  select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) into w from public.ai_reservations
    where work_key=p_work and created_at>now()-interval '1 day';
  if w+p_usd>0.25 then return 'work_budget'; end if;
  if (select count(*) from public.ai_reservations where state='reserved' and lease_until>clock_timestamp()) >= v.max_calls then return 'busy'; end if;
  insert into public.ai_reservations(id,user_id,work_key,provider,model,reserved_usd)
  values(p_id,p_user,p_work,p_provider,p_model,p_usd);
  return 'ok';
end $$;
revoke all on function public.ai_reserve(uuid,uuid,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.ai_reserve(uuid,uuid,text,text,text,numeric) to service_role;
