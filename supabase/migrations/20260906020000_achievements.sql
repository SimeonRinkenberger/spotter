-- ---------- achievements: the trophy case, and the freeze ledger ----------
--
-- Everything the ring and the streak show is computed from workout_logs on the
-- client, and deliberately so: a live count that changes when a session is
-- deleted is the honest one. An AWARD is the opposite kind of fact. It has to be
-- stable (editing a log must not un-earn it), it needs an earned_at to order the
-- case and to say "earned 3 Sept", and the finish celebration has to know which
-- award is NEW — which is a question about the past, not the present.
--
-- A spent streak freeze is stored here too, as kind = 'freeze' with
-- key = 'freeze:2026-W36'. A freeze is an event with a date, which is exactly
-- what a row here is; a second table would be a second policy set and a second
-- thing to keep in step for nothing.

create table if not exists public.achievements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- 'first' | 'sessions' | 'streak' | 'pr' | 'volume' | 'plan' | 'month'
  -- | 'comeback' | 'time' | 'freeze'
  kind       text not null,
  -- 'sessions:100', 'pr:c:barbell-back-squat', 'freeze:2026-W36'
  key        text not null,
  earned_at  timestamptz not null default now(),
  -- {"value":100,"unit":"lb","name":"Goblet Squat"}
  meta       jsonb not null default '{}'::jsonb,
  -- idempotent: re-running the evaluator over the same history costs nothing
  unique (user_id, key)
);
create index if not exists achievements_user_earned
  on public.achievements (user_id, earned_at desc);

alter table public.achievements enable row level security;

-- (select auth.uid()) rather than auth.uid(): the initplan-safe form the schema
-- standardised on in 20260902030000_rls_initplan.sql, so the function is
-- evaluated once per statement instead of once per row.
create policy "own achievements select" on public.achievements
  for select using (user_id = (select auth.uid()));
create policy "own achievements insert" on public.achievements
  for insert with check (user_id = (select auth.uid()));
-- Deliberately no update and no delete policy: an award, once earned, is a fact.
-- Client insert is allowed on purpose. There is no leaderboard, so forging your
-- own trophy harms nobody, and it keeps the finish moment instant with no round
-- trip. If a leaderboard ever ships, insert becomes service-role only and the
-- evaluator moves into the edge function; the table shape does not change.
