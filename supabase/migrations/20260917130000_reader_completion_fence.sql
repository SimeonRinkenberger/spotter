-- Personal corrections must survive every reread path, including deletions.
-- Conservative first implementation: retain the edited exercise list as a whole.
-- New evidence remains in the shared source cache, never mixed with this overlay.
alter table public.workouts add column if not exists user_workout_override jsonb,
  add column if not exists user_title_override jsonb,
  add column if not exists user_category_override jsonb,
  add column if not exists user_edit_revision bigint not null default 0;
update public.workouts w set user_workout_override=jsonb_build_object(
  'blocks',w.blocks,'muscle_groups',w.muscle_groups,'equipment',w.equipment,
  'has_full_workout',w.has_full_workout)
where exists(select 1 from public.corrections c where c.workout_id=w.id and c.field<>'title')
  or jsonb_path_exists(coalesce(w.blocks,'[]'::jsonb),'$[*].exercises[*] ? (@.edited_by_user == true)');
update public.workouts w set user_title_override=jsonb_build_object('title',w.title)
where exists(select 1 from public.corrections c where c.workout_id=w.id and c.field='title');

create or replace function public.preserve_workout_corrections() returns trigger
language plpgsql set search_path=public as $$
begin
  -- Native/web title renames use the owner's authenticated database session;
  -- extractor writes use service role. Keep the rename independent of blocks.
  if auth.uid()=new.user_id and new.title is distinct from old.title then
    new.user_title_override := jsonb_build_object('title',new.title);
  end if;
  if auth.uid()=new.user_id and new.category is distinct from old.category then
    new.user_category_override := jsonb_build_object('category',new.category);
  end if;
  if new.user_title_override is not null then new.title := new.user_title_override->>'title'; end if;
  if new.user_category_override is not null then new.category := new.user_category_override->>'category'; end if;
  if new.user_workout_override is distinct from old.user_workout_override then
    new.user_edit_revision := old.user_edit_revision + 1;
  end if;
  if new.user_workout_override is not null then
    if jsonb_typeof(new.user_workout_override->'blocks') <> 'array' then
      raise exception 'Invalid personal workout override';
    end if;
    new.blocks := new.user_workout_override->'blocks';
    new.muscle_groups := array(select jsonb_array_elements_text(new.user_workout_override->'muscle_groups'));
    new.equipment := array(select jsonb_array_elements_text(new.user_workout_override->'equipment'));
    new.has_full_workout := (new.user_workout_override->>'has_full_workout')::boolean;
  end if;
  return new;
end $$;
-- Dropped first because the rest of this file is `create or replace` /
-- `add column if not exists`: a re-push after a partly applied migration must
-- die on the real problem, not on a trigger that already exists.
drop trigger if exists preserve_workout_corrections on public.workouts;
create trigger preserve_workout_corrections before update on public.workouts
for each row execute function public.preserve_workout_corrections();

-- Retry budgets may decrement attempts. A separate monotonic generation fences
-- claims even when the same worker reclaims a budget-paused job.
alter table public.ingest_jobs add column if not exists claim_generation bigint not null default 0;
create or replace function public.bump_ingest_claim_generation() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.status='running' and (old.status is distinct from new.status
    or old.locked_at is distinct from new.locked_at or old.locked_by is distinct from new.locked_by) then
    new.claim_generation := old.claim_generation + 1;
  end if;
  return new;
end $$;
drop trigger if exists bump_ingest_claim_generation on public.ingest_jobs;
create trigger bump_ingest_claim_generation before update on public.ingest_jobs
for each row execute function public.bump_ingest_claim_generation();

-- Completion is a single transaction. A monotonic claim generation means
-- reclaims by the same worker ID are fenced too. Never accept caller-selected
-- recipients or a preview from a later month/another job.
create or replace function public.finish_ingest_job(
  p_job uuid,p_user uuid,p_worker text,p_generation integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  j public.ingest_jobs;
  v public.workouts;
  current_plan text;
  preview_month date;
  preview_ok boolean;
  n integer;
begin
  perform 1 from profiles where id=p_user for update;
  select * into j from ingest_jobs where id=p_job for update;
  if not found or j.user_id is distinct from p_user or j.status<>'running'
    or j.locked_by is distinct from p_worker or j.claim_generation is distinct from p_generation then
    return jsonb_build_object('status','stale','filled',0);
  end if;
  -- Entitlement writes serialize on the profile row already held above.
  select plan into current_plan from profiles where id=p_user;
  preview_month := date_trunc('month',j.created_at at time zone 'UTC')::date;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,917));
  -- The month match is the whole rule: a September job must not charge an October
  -- reservation. `created_at<=j.created_at` was ALSO here, and it is wrong — the
  -- reservation is written at index.ts:9107 and requeue_ingest may then hand back
  -- a job row that ALREADY existed, so the job is older than the reservation it is
  -- doing the work for. preview_ok came out false, a premium payload returned
  -- access_changed, failJob requeued, and the refund in fail_ingest_job carried the
  -- same predicate — so the preview was consumed, the read was paid for on every
  -- attempt, and the card ended failed. Same shape across a UTC month boundary.
  select exists(select 1 from video_previews where user_id=p_user
    and shortcode=j.shortcode and month=preview_month)
    into preview_ok;
  if p_payload->>'read_quality'='premium'
    and not(coalesce(current_plan in ('plus','pro','staff'),false) or preview_ok) then
    return jsonb_build_object('status','access_changed','filled',0);
  end if;
  select * into v from jsonb_populate_record(null::public.workouts,p_payload);
  update workouts set url=v.url,platform=v.platform,kind=v.kind,author=v.author,
    title=v.title,caption=v.caption,thumb_url=v.thumb_url,category=v.category,
    muscle_groups=v.muscle_groups,equipment=v.equipment,difficulty=v.difficulty,
    duration_minutes=v.duration_minutes,calories=v.calories,blocks=v.blocks,tags=v.tags,
    has_full_workout=v.has_full_workout,read_quality=v.read_quality,read_plan=v.read_plan,
    source_url=v.source_url,confidence=v.confidence,extracted_by=v.extracted_by,
    ingest_status='ready',ingest_error=v.ingest_error,media_stage=null
  where ingest_job_id=p_job and user_id=p_user and ingest_status='processing';
  get diagnostics n = row_count;
  if preview_ok then
    if n>0 and v.read_quality='premium' then
      update video_previews set completed=true where user_id=p_user
        and shortcode=j.shortcode and month=preview_month;
    else
      delete from video_previews where user_id=p_user and shortcode=j.shortcode
        and month=preview_month and not completed;
    end if;
  end if;
  update ingest_jobs set status='done',step='done',finished_at=now(),updated_at=now(),
    locked_by=null,locked_at=null,meta=null,card=null where id=p_job;
  return jsonb_build_object('status','done','filled',n);
end $$;
revoke all on function public.finish_ingest_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ingest_job(uuid,uuid,text,integer,jsonb) to service_role;

-- Failure has the same fence: a paused/stale worker cannot clear a newer job's
-- progress or refund another month's preview after releasing its own claim.
create or replace function public.fail_ingest_job(
  p_job uuid,p_user uuid,p_worker text,p_generation integer,p_dead boolean,
  p_budget boolean,p_keep boolean,p_error text,p_user_message text,p_run_after timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare j public.ingest_jobs;
begin
  perform 1 from profiles where id=p_user for update;
  select * into j from ingest_jobs where id=p_job for update;
  if not found or j.user_id is distinct from p_user or j.status<>'running'
    or j.locked_by is distinct from p_worker or j.claim_generation is distinct from p_generation then return false; end if;
  update workouts set media_stage=null,
    ingest_status=case when p_dead then case when p_keep then 'ready' else 'failed' end else ingest_status end,
    ingest_error=case when p_dead or p_budget then p_user_message else ingest_error end
  where ingest_job_id=p_job and user_id=p_user and ingest_status='processing';
  if p_dead then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text,917));
    -- Month only, for the same reason finish_ingest_job drops it: a refund that
    -- skips the reservation it was queued for leaves the user charged a preview
    -- for a card that ended failed.
    delete from video_previews where user_id=p_user and shortcode=j.shortcode and not completed
      and month=date_trunc('month',j.created_at at time zone 'UTC')::date;
  end if;
  update ingest_jobs set status=case when p_dead then 'dead' else 'queued' end,
    run_after=p_run_after,attempts=case when p_budget then greatest(0,attempts-1) else attempts end,
    locked_by=null,locked_at=null,last_error=p_error,
    finished_at=case when p_dead then now() else null end,updated_at=now() where id=p_job;
  return true;
end $$;
revoke all on function public.fail_ingest_job(uuid,uuid,text,integer,boolean,boolean,boolean,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fail_ingest_job(uuid,uuid,text,integer,boolean,boolean,boolean,text,text,timestamptz) to service_role;

-- Cache publication must also reject a reclaimed worker. Build identifiers only
-- from this explicit column allowlist; JSON values remain bound SQL parameters.
create or replace function public.publish_ingest_cache(
  p_job uuid,p_user uuid,p_worker text,p_generation integer,p_cache jsonb,p_patch boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare j public.ingest_jobs; cols text; assignments text;
begin
  perform 1 from profiles where id=p_user for update;
  select * into j from ingest_jobs where id=p_job for update;
  if not found or j.user_id is distinct from p_user or j.status<>'running'
    or j.locked_by is distinct from p_worker or j.claim_generation is distinct from p_generation then return false; end if;
  if p_cache->>'shortcode' is distinct from j.shortcode then raise exception 'Cache/job mismatch'; end if;
  if exists(select 1 from jsonb_object_keys(p_cache) k where k<>all(array[
    'shortcode','url','platform','kind','author','caption','thumb_url','read_quality','read_plan',
    'card','v','updated_at','confidence','extracted_by','media_tried','media_source','media_text',
    'pack','pack_v','basic_card','basic_v'])) then raise exception 'Unexpected cache field'; end if;
  select string_agg(format('%I',k),',' order by k),
    string_agg(format('%1$I=excluded.%1$I',k),',' order by k) filter(where k<>'shortcode')
    into cols,assignments from jsonb_object_keys(p_cache) k;
  if p_patch then
    execute format('update public.video_cache set (%s)=(select %s from jsonb_populate_record(null::public.video_cache,$1)) where shortcode=$2',cols,cols)
      using p_cache,j.shortcode;
    return true;
  end if;
  execute format('insert into public.video_cache(%s) select %s from jsonb_populate_record(null::public.video_cache,$1)
    on conflict(shortcode) do update set %s',cols,cols,assignments) using p_cache;
  return true;
end $$;
revoke all on function public.publish_ingest_cache(uuid,uuid,text,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_ingest_cache(uuid,uuid,text,integer,jsonb,boolean) to service_role;

create or replace function public.stage_ingest_job(
  p_job uuid,p_user uuid,p_worker text,p_generation integer,p_stage text
) returns boolean language plpgsql security definer set search_path=public as $$
declare j public.ingest_jobs;
begin
  perform 1 from profiles where id=p_user for update;
  select * into j from ingest_jobs where id=p_job for update;
  if not found or j.user_id is distinct from p_user or j.status<>'running'
    or j.locked_by is distinct from p_worker or j.claim_generation is distinct from p_generation then return false; end if;
  update workouts set media_stage=p_stage where user_id=p_user and ingest_job_id=p_job and ingest_status='processing';
  return true;
end $$;
revoke all on function public.stage_ingest_job(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.stage_ingest_job(uuid,uuid,text,integer,text) to service_role;

-- A no-model preview delivery has the same atomic quota/delivery requirement.
create or replace function public.complete_cached_preview(
  p_workout uuid,p_user uuid,p_payload jsonb,p_explicit boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.workouts; v public.workouts; current_plan text;
  m date := date_trunc('month',now() at time zone 'UTC')::date;
begin
  select plan into current_plan from profiles where id=p_user for update;
  select * into w from workouts where id=p_workout and user_id=p_user for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if w.ingest_status='processing' then return jsonb_build_object('status','processing'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,917));
  if not coalesce(current_plan in ('plus','pro','staff'),false) then
    if not coalesce(p_explicit,false) and not exists(select 1 from video_previews where user_id=p_user and shortcode=w.shortcode and month=m) then
      return jsonb_build_object('status','access_changed');
    end if;
    if not reserve_video_preview(p_user,w.shortcode) then return jsonb_build_object('status','limit'); end if;
  end if;
  select * into v from jsonb_populate_record(null::public.workouts,p_payload);
  update workouts set title=v.title,blocks=v.blocks,category=v.category,
    muscle_groups=v.muscle_groups,equipment=v.equipment,difficulty=v.difficulty,
    duration_minutes=v.duration_minutes,calories=v.calories,tags=v.tags,
    has_full_workout=v.has_full_workout,confidence=v.confidence,extracted_by=v.extracted_by,
    read_quality='premium',read_plan=coalesce(v.read_plan,'plus'),
    ingest_status='ready',ingest_error=null,media_stage=null
  where id=p_workout and user_id=p_user returning * into w;
  update video_previews set completed=true where user_id=p_user and shortcode=w.shortcode and month=m;
  return jsonb_build_object('status','ok','workout',to_jsonb(w));
end $$;
revoke all on function public.complete_cached_preview(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.complete_cached_preview(uuid,uuid,jsonb,boolean) to service_role;

-- Serialize attaching a workout with completion for the same account. The
-- active job row remains locked until the attachment commits; a done job can
-- never be selected and then attached after its completion.
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
  perform 1 from public.profiles where id=p_user for update;
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
     limit 1 for update;
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
  perform 1 from public.profiles where id=p_user for update;
  select id, url, shortcode, platform, kind, ingest_status, ingest_job_id into w
    from public.workouts
   where id = p_workout and user_id = p_user;
  if w.id is null then return; end if;   -- not this user's row: say nothing

  -- A simultaneous retry joins the existing request without another quota row.
  if w.ingest_status='processing' then
    select id into v_job from public.ingest_jobs where id=w.ingest_job_id
      and user_id=p_user and status in ('queued','running') for update;
    if v_job is not null then return query select p_workout,v_job,false; return; end if;
  end if;

  -- Same find-or-create as enqueue_ingest, and same reason for the loop: the
  -- partial unique index is what makes concurrent retries collapse into one job.
  loop
    select id into v_job from public.ingest_jobs
     where user_id = p_user and shortcode = w.shortcode and status in ('queued', 'running')
     limit 1 for update;
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


revoke all on function public.enqueue_ingest(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_ingest(uuid,text,text,text,text,text) to service_role;
revoke all on function public.requeue_ingest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.requeue_ingest(uuid,uuid) to service_role;
