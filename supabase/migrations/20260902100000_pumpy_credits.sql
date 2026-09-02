-- Spotter — Pumpy credits: a per-user meter on the coach, driven by a plan.
--
-- Credits exist to stop abuse, not to pinch anyone. One credit is 1,000 weighted
-- tokens (input + 4 × output) summed over every model call in one turn and rounded
-- up per turn, so a turn that needed three round trips costs what it cost, and a
-- free-tier answer still counts (it burns quota even when it burns no dollars).
-- Caps live in app_config (`pumpy.plans`) so they change without a deploy; a
-- per-user override sits on the profile for staff and special cases.
--
-- Users can read their own plan (the existing "own profile read" policy) but
-- cannot change it: profiles carries a column-level `grant update (display_name,
-- settings)` and nothing else, so the two new columns are read-only to clients.

alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists pumpy_limits jsonb;   -- {"day": int|null, "month": int|null}; null = unlimited
do $$ begin
  alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'plus', 'pro', 'staff'));
exception when duplicate_object then null; end $$;

-- One row per Pumpy turn: how many model calls it took, what they cost, what it
-- was charged. No FK on user_id, like saves_log — deleting a user leaves the
-- ledger rows, and the throwaway tooling deletes them by user_id.
create table if not exists public.pumpy_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  thread_id     uuid,
  created_at    timestamptz not null default now(),
  calls         int not null default 0,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  credits       int not null default 0,
  est_cost_usd  numeric(12,6) not null default 0,
  model         text,
  short_circuit boolean not null default false
);
create index if not exists pumpy_usage_user_time on public.pumpy_usage (user_id, created_at desc);
alter table public.pumpy_usage enable row level security;   -- no policies: service role only

-- The three numbers the chat handler needs before a turn, in one round trip:
-- credits today, credits this month, and requests in the last minute (every row
-- counts for the rate limit, short-circuited turns included — it is a limit on
-- requests, not on spend).
create or replace function public.pumpy_usage_totals(p_user uuid)
returns table (day_credits bigint, month_credits bigint, minute_turns bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(credits) filter (where created_at >= (date_trunc('day',   now() at time zone 'utc') at time zone 'utc')), 0)::bigint,
    coalesce(sum(credits) filter (where created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0)::bigint,
    count(*) filter (where created_at >= now() - interval '60 seconds')::bigint
  from public.pumpy_usage
  where user_id = p_user
    and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;
revoke all on function public.pumpy_usage_totals(uuid) from public, anon, authenticated;
grant execute on function public.pumpy_usage_totals(uuid) to service_role;

-- Dials. Read by the function with the same 5-minute TTL as the model ids.
insert into public.app_config (key, value) values
  ('pumpy.plans', '{"free":{"day":150,"month":1500},"plus":{"day":400,"month":5000},"pro":{"day":1000,"month":15000},"staff":{"day":null,"month":null}}'),
  ('pumpy.per_minute', '6'),
  ('pumpy.turn_max_credits', '40'),
  ('pumpy.history_turns', '10'),
  ('pumpy.snapshot_max_workouts', '60')
on conflict (key) do nothing;
