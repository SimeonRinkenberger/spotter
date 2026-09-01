-- Retrying a save that died, and one retry schedule instead of two.

-- ---------- requeue ----------
--
-- The ↻ button has always meant "read this video again". For a card that already
-- worked, that stays a synchronous reprocess with never-downgrade merging. For a
-- card whose job died, re-running it inline would be the one place in the system
-- that still blocks a request on a scrape and a model call — and it would skip the
-- backoff and the dead-letter cutoff that made the job stop in the first place.
-- So the retry goes back on the queue, and gets the same guarantees as the
-- original save: one job per video, and a limit on how many times it may fail.
create or replace function public.requeue_ingest(p_user uuid, p_workout uuid)
returns table (workout_id uuid, job_id uuid, job_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  w      record;
  v_job  uuid;
  v_new  boolean := false;
begin
  select id, url, shortcode, platform, kind into w
    from public.workouts
   where id = p_workout and user_id = p_user;
  if w.id is null then return; end if;   -- not this user's row: say nothing

  -- Same find-or-create as enqueue_ingest, and same reason for the loop: the
  -- partial unique index is what makes concurrent retries collapse into one job.
  loop
    select id into v_job from public.ingest_jobs
     where shortcode = w.shortcode and status in ('queued', 'running')
     limit 1;
    exit when v_job is not null;
    begin
      insert into public.ingest_jobs (user_id, url, shortcode, platform, kind)
      values (p_user, w.url, w.shortcode, w.platform, w.kind)
      returning id into v_job;
      v_new := true;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  update public.workouts
     set ingest_status = 'processing',
         ingest_error  = null,
         ingest_job_id = v_job
   where id = p_workout;

  insert into public.saves_log (user_id, shortcode, cached, kind, platform, job_id)
  values (p_user, w.shortcode, false, 'reprocess', w.platform, v_job);

  return query select p_workout, v_job, v_new;
end $$;

revoke all on function public.requeue_ingest(uuid, uuid) from public, anon, authenticated;
grant execute on function public.requeue_ingest(uuid, uuid) to service_role;

-- ---------- one backoff, not two ----------
--
-- The worker retries on 15s × 2^attempts; the SQL sweeper was on 20s × 3^attempts,
-- so a job that failed normally and a job whose worker vanished came back on
-- different schedules for no reason anyone could later reconstruct.
create or replace function public.sweep_ingest_jobs(p_stale_seconds int default 300)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with s as (
    update public.ingest_jobs
       set status      = case when attempts >= max_attempts then 'dead' else 'queued' end,
           run_after   = now() + (interval '15 seconds' * power(2, greatest(1, least(attempts, 6)))),
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

revoke all on function public.sweep_ingest_jobs(int) from public, anon, authenticated;
grant execute on function public.sweep_ingest_jobs(int) to service_role;
