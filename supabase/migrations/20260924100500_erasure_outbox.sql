-- Erasure at third parties, durably: the erasure outbox.
--
-- Deleting an account also has to delete it where other companies hold it:
-- the RevenueCat subscriber (keyed by the Supabase user id), the Stripe
-- customer (Stripe-era accounts), the Strava grant. Each of those calls can
-- fail — a key that is not set yet, a key of the wrong kind, an outage — and
-- until now a failure was a log line and nothing else, because the account row
-- that named the subscriber was gone a moment later.
--
-- So the request is written down first. A row goes in BEFORE the provider is
-- called and comes out when the provider says done (404 counts: already gone).
-- Anything else leaves it here, and the hourly push tick tries again with
-- exponential backoff (5 min, doubling, capped at a day). After 8 attempts or 7
-- days an ops_alerts row ('erasure_stuck') pages the owner, once per row per
-- day. RevenueCat and Stripe rows keep retrying after that, at the daily cap,
-- so they drain the day the missing key is set. A Strava row carries the grant's
-- tokens (they are what deauthorizing needs), so it is dropped when it gives up
-- rather than kept indefinitely — a stale Strava grant is one the athlete can
-- revoke on strava.com.
--
-- `subject` is the pseudonymous id the provider knows the person by (app user
-- id, Stripe customer id, Strava athlete id). Nothing here is readable by a
-- browser: RLS on with no policy, no grants to anon/authenticated, and the three
-- functions are service-role only.

create table if not exists public.erasure_outbox (
  id          bigint generated always as identity primary key,
  provider    text not null check (provider in ('revenuecat', 'stripe', 'strava')),
  subject     text not null,
  detail      jsonb not null default '{}'::jsonb,
  attempts    int not null default 0,
  next_at     timestamptz not null default now(),
  last_error  text,
  created_at  timestamptz not null default now(),
  alerted_at  timestamptz,
  unique (provider, subject)
);
create index if not exists erasure_outbox_due on public.erasure_outbox (next_at);

alter table public.erasure_outbox enable row level security;   -- no policies: service role only
revoke all on public.erasure_outbox from public, anon, authenticated;
grant all on public.erasure_outbox to service_role;

-- Write the request down. A second deletion attempt for the same subject (the
-- first stopped at a later step and the person tried again) refreshes the row
-- rather than adding a second one.
create or replace function public.erasure_enqueue(p_provider text, p_subject text, p_detail jsonb default '{}'::jsonb)
returns bigint
language sql security definer set search_path = public, pg_catalog as $$
  insert into public.erasure_outbox (provider, subject, detail)
  values (p_provider, p_subject, coalesce(p_detail, '{}'::jsonb))
  on conflict (provider, subject) do update set detail = excluded.detail, next_at = now()
  returning id;
$$;

-- The rows that are due, leased for 15 minutes so two overlapping ticks cannot
-- call a provider twice for the same row. erasure_settle sets the real next_at.
create or replace function public.erasure_claim(p_limit int default 10)
returns setof public.erasure_outbox
language sql security definer set search_path = public, pg_catalog as $$
  with due as (
    select id from public.erasure_outbox
    where next_at <= now()
    order by next_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.erasure_outbox o set next_at = now() + interval '15 minutes'
  from due where o.id = due.id
  returning o.*;
$$;

-- The provider's answer. Done: the row goes. Not done: one more attempt, the
-- next one later, and the page once the row has waited long enough. A Strava row
-- that has given up is dropped with its tokens. `p_detail`, when given, replaces
-- the stored detail (a refreshed Strava token pair has to be kept for the retry).
create or replace function public.erasure_settle(p_id bigint, p_ok boolean, p_error text default null,
  p_detail jsonb default null)
returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  r public.erasure_outbox;
begin
  if p_ok then
    delete from public.erasure_outbox where id = p_id;
    return 'done';
  end if;

  update public.erasure_outbox
     set attempts   = attempts + 1,
         last_error = left(coalesce(p_error, 'unknown'), 300),
         detail     = coalesce(p_detail, detail),
         next_at    = now() + least(interval '1 day', interval '5 minutes' * power(2, least(attempts, 12)))
   where id = p_id
  returning * into r;
  if not found then return 'missing'; end if;

  if r.alerted_at is null and (r.attempts >= 8 or r.created_at <= now() - interval '7 days') then
    insert into public.ops_alerts (key, day, level, detail)
    select 'erasure_stuck', (now() at time zone 'UTC')::date, 'warn',
           jsonb_build_object(
             'count', count(*),
             'providers', coalesce(jsonb_agg(distinct o.provider), '[]'::jsonb))
      from public.erasure_outbox o
     where o.attempts >= 8 or o.created_at <= now() - interval '7 days'
    on conflict (key, day) do nothing;
    update public.erasure_outbox set alerted_at = now() where id = p_id;
    if r.provider = 'strava' then
      delete from public.erasure_outbox where id = p_id;
      return 'gave_up';
    end if;
    return 'alerted';
  end if;
  return 'retry';
end $$;

revoke all on function public.erasure_enqueue(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.erasure_claim(int) from public, anon, authenticated;
revoke all on function public.erasure_settle(bigint, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.erasure_enqueue(text, text, jsonb) to service_role;
grant execute on function public.erasure_claim(int) to service_role;
grant execute on function public.erasure_settle(bigint, boolean, text, jsonb) to service_role;
