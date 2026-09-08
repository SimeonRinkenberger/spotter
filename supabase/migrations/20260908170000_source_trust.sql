-- Private input must not seed another account's active job or shared cache.
begin;
-- Refuse rollout if old cross-account jobs are still active; finish those first.
do $$ begin
 if exists(select 1 from workouts w join ingest_jobs j on j.id=w.ingest_job_id
  where j.status in ('queued','running') and w.user_id<>j.user_id) then
  raise exception 'Finish existing shared ingest jobs before tenant isolation rollout';
 end if;
end $$;
drop index if exists public.ingest_jobs_one_active_per_video;
create unique index ingest_jobs_one_active_per_user_video on public.ingest_jobs(user_id,shortcode)
 where status in ('queued','running');
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

  -- Idempotency, second layer: one active job per video per user. The loop
  -- is not decoration — between the select and the insert another transaction can
  -- commit its own job, and the partial unique index turns that into a
  -- unique_violation we recover from by joining the job that won.
  loop
    select id into v_job from public.ingest_jobs
     where user_id = p_user and shortcode = p_shortcode and status in ('queued', 'running')
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
     where user_id = p_user and shortcode = w.shortcode and status in ('queued', 'running')
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


-- Trigger functions are invoked by PostgreSQL, never directly by API clients.
revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.apply_subscription_plan() from public,anon,authenticated;
commit;
