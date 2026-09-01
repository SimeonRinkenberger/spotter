-- Spotter — asynchronous ingest, and a ceiling under the spend.
--
-- Ingest used to hold an HTTP request open for 5-15 seconds while it scraped a
-- page, called a model and uploaded a thumbnail. That is fine at two users and
-- fatal at two thousand: a thousand concurrent saves means a thousand long-lived
-- requests sitting against the edge function's concurrency limit, and every one of
-- them is a request the platform could have finished in 200ms.
--
-- So the save becomes two things: a row the user can see immediately, and a job
-- somebody else finishes. Everything below exists to make that safe under
-- concurrency — one job per video however many people save it at once, a claim
-- that two workers cannot both win, a retry schedule that gives up rather than
-- looping, and a sweeper for the worker that dies mid-job.

-- ---------- extensions ----------
-- pg_net gives Postgres an HTTP client so cron can poke the worker; pg_cron is the
-- backstop for the low-latency kick that ingest fires. Both ship with Supabase but
-- neither is installed by default.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- runtime config ----------
-- The cron job needs the worker's URL and shared secret. They do NOT belong in a
-- migration: this repository is public. They are inserted out of band into this
-- table, which has RLS on and no policies, so only the service role and postgres
-- (which is what cron runs as) can read it.

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;  -- no policies: service role only

-- ---------- the queue ----------

create table if not exists public.ingest_jobs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- whoever first asked for this video. The job serves everyone who saves it.
  user_id      uuid not null references auth.users(id) on delete cascade,
  url          text not null,
  shortcode    text not null,
  platform     text not null,
  kind         text,

  -- queued -> running -> done, or -> failed (will retry) -> dead (will not)
  status       text not null default 'queued',
  -- Where a retry picks up. The expensive parts are ordered meta -> card -> thumb;
  -- a job that already scraped the caption should not scrape it again just because
  -- the model timed out, so each completed step is persisted with its result.
  step         text not null default 'meta',
  meta         jsonb,
  card         jsonb,

  attempts     int not null default 0,
  max_attempts int not null default 4,
  run_after    timestamptz not null default now(),

  -- who holds the claim, and since when. locked_at is what the sweeper reads to
  -- decide a worker has died.
  locked_by    text,
  locked_at    timestamptz,

  last_error   text,
  finished_at  timestamptz
);

-- The concurrency guarantee. Two users saving the same new video at the same
-- instant must produce ONE extraction, not two: the video_cache lookup that
-- normally prevents the second call has not been written yet when they race.
-- Partial, so the same video can be re-saved later once the first job has finished.
create unique index if not exists ingest_jobs_one_active_per_video
  on public.ingest_jobs (shortcode)
  where status in ('queued', 'running');

-- The claim query's index: ready work, oldest first.
create index if not exists ingest_jobs_ready
  on public.ingest_jobs (run_after)
  where status = 'queued';

create index if not exists ingest_jobs_running
  on public.ingest_jobs (locked_at)
  where status = 'running';

alter table public.ingest_jobs enable row level security;  -- no policies: service role only

-- ---------- what the user sees while the job runs ----------

alter table public.workouts
  -- ready | processing | failed. Existing rows default to ready, so the two real
  -- workouts in this database are untouched by this migration.
  add column if not exists ingest_status text not null default 'ready',
  add column if not exists ingest_error  text,
  add column if not exists ingest_job_id uuid;

create index if not exists workouts_pending
  on public.workouts (shortcode)
  where ingest_status = 'processing';

-- Realtime: the frontend subscribes to its OWN workouts rows, filtered by user_id,
-- rather than to a globally readable card table. Subscribing every viewer to a
-- shared table makes Realtime authorize every change against every subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workouts'
  ) then
    alter publication supabase_realtime add table public.workouts;
  end if;
end $$;

-- ---------- metering ----------
-- saves_log was already the rate limiter for /api/ingest. Two other routes spend
-- money and were counted by nothing at all: reprocess re-runs the whole extraction,
-- and the explain/swap helpers each make a model call. They go in the same ledger
-- with a kind, so one table answers "what has this user spent today".

alter table public.saves_log
  add column if not exists kind   text not null default 'save',   -- save | reprocess | helper
  add column if not exists job_id uuid;

create index if not exists saves_user_kind_time
  on public.saves_log (user_id, kind, created_at desc);

-- The worker fills in the quality metrics once it knows them, and finds its rows
-- by the job that produced them.
create index if not exists saves_job on public.saves_log (job_id) where job_id is not null;

-- ---------- the spend ledger ----------
-- The circuit breaker in the extraction chain trips on failures. Nothing trips on
-- money, which is the failure mode that does not announce itself: a launch-day
-- traffic spike costs real dollars and every individual call looks fine. So every
-- model call records what it is estimated to have cost, and the chain reads the
-- day's total before it is allowed to reach for a paid tier.

create table if not exists public.ai_cost_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid,
  provider      text not null,          -- openai | anthropic | gemini | groq
  model         text not null,
  purpose       text not null,          -- extract | vision | reprocess | explain | swap
  input_tokens  int,
  output_tokens int,
  -- estimated, not billed: token counts come from the provider when it reports
  -- them and from a chars/4 approximation when it does not.
  est_cost_usd  numeric(12,6) not null default 0,
  ok            boolean not null default true
);
create index if not exists ai_cost_time on public.ai_cost_log (created_at desc);
alter table public.ai_cost_log enable row level security;  -- no policies: service role only

-- One number, read on the hot path before every paid call, so it must be cheap.
-- The index above makes it a range scan over one day.
create or replace function public.ai_spend_today() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(est_cost_usd), 0)::numeric
    from public.ai_cost_log
   where created_at >= (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc');
$$;

-- ---------- enqueue ----------
--
-- Everything a save has to do atomically, in one round trip:
--   * create the user's own workouts row, or find the one already there
--   * join the existing job for this video, or create the only one
--   * write the rate-limit row that charges the extraction
--
-- Doing this in the edge function instead means a check-then-insert with a gap in
-- the middle, and the gap is exactly where a double-tap or two users sharing the
-- same reel land.
create or replace function public.enqueue_ingest(
  p_user      uuid,
  p_url       text,
  p_shortcode text,
  p_platform  text,
  p_kind      text,
  p_title     text
) returns table (workout_id uuid, job_id uuid, already boolean, job_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_workout uuid;
  v_job     uuid;
  v_new_job boolean := false;
begin
  -- Idempotency, first layer: unique (user_id, shortcode) on workouts. A repeated
  -- save of the same URL by the same user cannot create a second row, so it cannot
  -- create a second job or a second charge either.
  insert into public.workouts (user_id, url, shortcode, platform, kind, title, ingest_status)
  values (p_user, p_url, p_shortcode, p_platform, p_kind, p_title, 'processing')
  on conflict (user_id, shortcode) do nothing
  returning id into v_workout;

  if v_workout is null then
    select id into v_workout from public.workouts
     where user_id = p_user and shortcode = p_shortcode;
    return query select v_workout, null::uuid, true, false;
    return;
  end if;

  -- Idempotency, second layer: one active job per video across all users. The loop
  -- is not decoration — between the select and the insert another transaction can
  -- commit its own job, and the partial unique index turns that into a
  -- unique_violation we recover from by joining the job that won.
  loop
    select id into v_job from public.ingest_jobs
     where shortcode = p_shortcode and status in ('queued', 'running')
     limit 1;
    exit when v_job is not null;
    begin
      insert into public.ingest_jobs (user_id, url, shortcode, platform, kind)
      values (p_user, p_url, p_shortcode, p_platform, p_kind)
      returning id into v_job;
      v_new_job := true;
      exit;
    exception when unique_violation then
      null;  -- somebody else just created it; go round and pick theirs up
    end;
  end loop;

  update public.workouts set ingest_job_id = v_job where id = v_workout;

  insert into public.saves_log (user_id, shortcode, cached, kind, platform, job_id)
  values (p_user, p_shortcode, false, 'save', p_platform, v_job);

  return query select v_workout, v_job, false, v_new_job;
end $$;

-- ---------- claim ----------
--
-- FOR UPDATE SKIP LOCKED is the whole reason this is a database queue and not a
-- table someone polls: N workers can call this simultaneously and each gets a
-- disjoint set, with no advisory locks and no coordinator. security definer
-- because the table is service-role-only and this is the only sanctioned way in.
create or replace function public.claim_ingest_jobs(p_worker text, p_limit int default 4)
returns setof public.ingest_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select id from public.ingest_jobs
     where status = 'queued' and run_after <= now()
     order by run_after, created_at
     limit greatest(1, least(p_limit, 20))
     for update skip locked
  )
  update public.ingest_jobs j
     set status     = 'running',
         locked_by  = p_worker,
         locked_at  = now(),
         attempts   = j.attempts + 1,
         updated_at = now()
    from c
   where j.id = c.id
  returning j.*;
end $$;

-- ---------- unstick ----------
--
-- A worker can die between claiming a job and finishing it — an isolate recycled,
-- a deploy mid-flight, an OOM. The row is then 'running' with nobody running it,
-- and without this it stays that way forever while the user's card spins.
create or replace function public.sweep_ingest_jobs(p_stale_seconds int default 300)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with s as (
    update public.ingest_jobs
       set status      = case when attempts >= max_attempts then 'dead' else 'queued' end,
           run_after   = now() + (interval '20 seconds' * power(3, least(attempts, 4))),
           locked_by   = null,
           locked_at   = null,
           last_error  = coalesce(last_error, 'worker vanished while holding the claim'),
           finished_at = case when attempts >= max_attempts then now() else null end,
           updated_at  = now()
     where status = 'running'
       and locked_at < now() - make_interval(secs => p_stale_seconds)
    returning 1
  )
  select count(*) into n from s;

  -- A dead job must surface to the person waiting on it, not just to the logs.
  update public.workouts w
     set ingest_status = 'failed',
         ingest_error  = coalesce(w.ingest_error, 'Spotter could not read this video.')
    from public.ingest_jobs j
   where j.id = w.ingest_job_id
     and j.status = 'dead'
     and w.ingest_status = 'processing';

  return n;
end $$;

-- ---------- grants ----------
-- Default EXECUTE on a new function is granted to PUBLIC, which here would mean
-- any signed-in browser could claim jobs or mint workouts rows for other users.
-- Revoke, then grant only to the role the edge function actually authenticates as.

revoke all on function public.enqueue_ingest(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_ingest_jobs(text, int)                        from public, anon, authenticated;
revoke all on function public.sweep_ingest_jobs(int)                              from public, anon, authenticated;
revoke all on function public.ai_spend_today()                                    from public, anon, authenticated;

grant execute on function public.enqueue_ingest(uuid, text, text, text, text, text) to service_role;
grant execute on function public.claim_ingest_jobs(text, int)                        to service_role;
grant execute on function public.sweep_ingest_jobs(int)                              to service_role;
grant execute on function public.ai_spend_today()                                    to service_role;

-- ---------- cron: the backstop ----------
--
-- The primary driver is the kick ingest fires the moment a job is enqueued, which
-- is what makes a card fill in seconds rather than a minute. Cron exists for when
-- that kick is lost: the isolate died before the request left, the worker 500'd,
-- a job went back on the queue with a backoff and nothing is going to poke it.
--
-- The `where exists` matters: with an empty queue this job evaluates two index
-- lookups and makes no HTTP request at all.

select cron.schedule('spotter-worker-tick', '* * * * *', $cron$
  select net.http_post(
    url     := (select value from public.app_config where key = 'worker_url'),
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-worker-secret', (select value from public.app_config where key = 'worker_secret')),
    body    := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 8000
  )
  where exists (select 1 from public.app_config where key = 'worker_url')
    and exists (select 1 from public.ingest_jobs where status = 'queued' and run_after <= now());
$cron$);

-- Unsticking is pure SQL, so it must not depend on the edge function being
-- reachable at all — that is the failure it exists to survive.
select cron.schedule('spotter-unstick-jobs', '*/5 * * * *', $cron$
  select public.sweep_ingest_jobs();
$cron$);
