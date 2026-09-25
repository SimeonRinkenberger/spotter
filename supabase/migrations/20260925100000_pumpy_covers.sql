-- Pumpy's covers: every card Pumpy makes gets one of the owner's drawings, chosen
-- when the card is made and kept on the card, so no two of a person's Pumpy
-- cards share a picture until every drawing is in use.
--
--   pumpy_cover_keys()        the ONE list of drawings, in the order of the files
--                             in docs/assets/pumpy/covers/ (tools/pumpy-covers-check.mjs
--                             holds this list, app.ts's PUMPY_COVERS and the files
--                             to each other). New drawings are appended; a key is
--                             never removed or reordered while a build ships it.
--   pumpy_cover_fallback(id)  what a card made before this column existed shows:
--                             a hash of its id into the first 35 keys. app.ts
--                             computes the same thing (pumpyCoverFallback), so the
--                             picker below knows what those older cards look like.
--   pumpy_cover_pick(user)    uniform among the drawings none of that person's
--                             Pumpy cards shows; once all are shown, uniform among
--                             the least shown.
--   workouts.pumpy_cover      nullable; set only by confirm_pumpy_proposal. No
--                             backfill: an older card keeps its fallback.
--
-- Builds 5-8 never read the column (builds 5-7 select *, which simply carries one
-- more field; build 8 selects its own list without it) and keep drawing the three
-- category pictures. Idempotent. Deploy before the function that ships alongside.

create or replace function public.pumpy_cover_keys() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array[
    'ab-wheel-rollout','agility-ladder','back-extension','barbell-squat','bear-crawl',
    'biceps-curl','box-step-up','boxing-bag','chest-press-machine','deadlift',
    'dumbbell-lunge','elliptical','farmers-carry','goblet-squat','hamstring-curl',
    'incline-bench-press','jump-rope','jumping-jack','kettlebell-swing','landmine-press',
    'leg-extension','medicine-ball-slam','pec-deck-fly','pull-up','resistance-band-lateral-walk',
    'rowing-erg','side-plank','sled-push','stair-climber','stationary-bike',
    'tire-flip','treadmill','triceps-dip','wall-sit','yoga-warrior'
  ]::text[]
$$;

create or replace function public.pumpy_cover_fallback(p_id uuid) returns text
language sql immutable parallel safe set search_path = '' as $$
  select (public.pumpy_cover_keys())[1 + (('x' || left(replace(p_id::text, '-', ''), 8))::bit(32)::bigint % 35)::int]
$$;

alter table public.workouts add column if not exists pumpy_cover text;
-- The check reads the list at write time, so a key appended later is accepted
-- without touching this constraint. Nothing but the definer function below writes
-- the column: INSERT and UPDATE on workouts were revoked from the browser roles on
-- 8 Sept (20260908150000) and only title, category, notes and favorite granted
-- back, so a new column is writable by nobody else. The column revokes say so
-- explicitly, and hold even on a database where the table grant came back.
alter table public.workouts drop constraint if exists workouts_pumpy_cover_known;
alter table public.workouts add constraint workouts_pumpy_cover_known
  check (pumpy_cover is null or pumpy_cover = any (public.pumpy_cover_keys()));
revoke insert (pumpy_cover), update (pumpy_cover) on public.workouts from anon, authenticated;

-- Every row a person owns counts, whatever its cover: a stored key it knows, or
-- the fallback that card shows today. A library's worth of rows, read through
-- the (user_id, ...) indexes.
create or replace function public.pumpy_cover_pick(p_user uuid) returns text
language sql volatile set search_path = '' as $$
  with keys as (select unnest(public.pumpy_cover_keys()) as k),
  shown as (
    select case when w.pumpy_cover = any (public.pumpy_cover_keys()) then w.pumpy_cover
                else public.pumpy_cover_fallback(w.id) end as k
    from public.workouts w
    where w.user_id = p_user and w.platform = 'pumpy'
  ),
  tally as (
    select keys.k, count(shown.k) as n from keys left join shown on shown.k = keys.k group by keys.k
  )
  select k from tally where n = (select min(n) from tally) order by random() limit 1
$$;

-- The key list must stay callable by the browser roles: the check above runs on
-- every UPDATE of a workouts row, including the title and favourite writes the
-- app makes, and a check calls its function as the person writing.
grant execute on function public.pumpy_cover_keys() to anon, authenticated, service_role;
revoke all on function public.pumpy_cover_fallback(uuid) from public, anon, authenticated;
grant execute on function public.pumpy_cover_fallback(uuid) to service_role;
revoke all on function public.pumpy_cover_pick(uuid) from public, anon, authenticated;
grant execute on function public.pumpy_cover_pick(uuid) to service_role;

-- 20260917140000's function, with the cover chosen and written. Nothing else in
-- it changes.
create or replace function public.confirm_pumpy_proposal(
  p_user uuid, p_message bigint, p_accept boolean, p_prepared jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.pumpy_messages;
  receipt public.pumpy_messages;
  w public.workouts;
  planned public.plan;
  p jsonb;
  d jsonb;
  ex jsonb;
  items jsonb := '[]'::jsonb;
  answer jsonb;
  summary jsonb;
  decision text;
  plan_name text;
  message text;
  target uuid;
  block_count int;
  exercise_index int := 0;
  cover text;
begin
  select * into m from pumpy_messages where id=p_message and user_id=p_user and role='assistant' for update;
  if not found or m.meta->'proposal' is null then
    return jsonb_build_object('status','not_found','message','Proposal not found.');
  end if;
  -- The idempotency key is the message AND the decision, not the message alone.
  -- A repeat of the same decision is a lost HTTP response being retried, and the
  -- stored receipt is the right answer. Accept after decline is a SECOND decision
  -- on a resolved proposal: returning the decline receipt with 200 told the user
  -- "No problem — nothing was changed." when they had just asked to change it.
  -- That one is a conflict, and it carries the receipt so the client still has
  -- the message the thread already holds.
  if m.meta->'confirm_response' is not null then
    if coalesce((m.meta->>'confirm_accept')::boolean, m.meta->>'status'='done') is distinct from p_accept then
      return m.meta->'confirm_response'||jsonb_build_object('status','conflict','message',
        case when m.meta->>'status'='declined' then 'That one was already declined.'
        else 'That one was already accepted.' end);
    end if;
    return m.meta->'confirm_response';
  end if;
  if m.meta->>'status' is distinct from 'pending' then
    return jsonb_build_object('status','conflict','message','That proposal was already resolved.');
  end if;
  if p_accept is null then raise exception 'Missing confirmation decision'; end if;
  p := m.meta->'proposal';
  if not p_accept then
    decision := 'declined';
    message := 'No problem — nothing was changed.';
    answer := jsonb_build_object('status','ok');
  else
    -- Serialize accepts with subscription changes and other accepts by this user.
    select plan into plan_name from profiles where id=p_user for update;
    if not found or coalesce(plan_name,'free') not in ('plus','pro','staff') then
      return jsonb_build_object('status','limit','kind','pumpy','upgrade',true,
        'message','Pumpy coaching and workout creation are included with Spotter Plus.');
    end if;
    decision := 'done';
    if p->>'kind'='create_workout' then
      if jsonb_typeof(p->'blocks') is distinct from 'array'
        or jsonb_array_length(p->'blocks') not between 1 and (case when m.meta->>'method'='deterministic_combine' then 1000 else 12 end)
        or char_length((p->'blocks')::text)>60000 then
        raise exception 'Invalid workout blocks';
      end if;
      for d in select value from jsonb_array_elements(p->'blocks') loop
        if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'exercises') is distinct from 'array' then
          raise exception 'Invalid exercise block';
        end if;
        for ex in select value from jsonb_array_elements(d->'exercises') loop
          if jsonb_typeof(ex) is distinct from 'object' or nullif(btrim(ex->>'name'),'') is null then raise exception 'Invalid exercise'; end if;
        end loop;
      end loop;
      if not exists(select 1 from jsonb_array_elements(p->'blocks') b where jsonb_array_length(b->'exercises')>0) then
        raise exception 'Workout needs an exercise';
      end if;
      target := (p_prepared->>'id')::uuid;
      if target is null then raise exception 'Missing prepared workout identity'; end if;
      -- The existing guard_workout_library trigger enforces the current cap in
      -- this insert transaction, including limits changed since proposal creation.
      -- The cover is chosen here, after the profile row lock above, so two accepts
      -- by one person run one after the other and the second sees the first's card.
      cover := public.pumpy_cover_pick(p_user);
      begin
      insert into workouts(id,user_id,url,shortcode,platform,kind,author,title,caption,category,
        muscle_groups,equipment,difficulty,duration_minutes,blocks,tags,has_full_workout,extracted_by,ingest_status,pumpy_cover)
      values(target,p_user,'spotter://pumpy/'||target,'pumpy-'||target,'pumpy','coach','Pumpy',p->>'title',p->>'summary',p->>'category',
        array(select jsonb_array_elements_text(p->'muscle_groups')),array(select jsonb_array_elements_text(p->'equipment')),
        p->>'difficulty',(p->>'duration_minutes')::int,p->'blocks',array['pumpy'],true,'pumpy:'||case when m.meta->>'method'='deterministic_combine' then 'deterministic_combine' else coalesce(m.meta->>'model','unknown') end,'ready',cover)
      returning * into w;
      exception when raise_exception then
        if sqlerrm='Library limit reached' then
          return jsonb_build_object('status','limit','kind','library','message','Your library is full. Remove a workout and try again.');
        end if;
        raise;
      end;
      select coalesce(sum(jsonb_array_length(b->'exercises')),0) into block_count from jsonb_array_elements(p->'blocks') b;
      message := format('Saved "%s" to your library — %s exercises. It is in the Library tab now.',p->>'title',block_count);
      summary := jsonb_build_object('workout_id',w.id,'created',true);
      answer := jsonb_build_object('status','ok','workout',to_jsonb(w),'created',true,'plan',null);
    elsif p->>'kind'='append_exercises' then
      select * into w from workouts where id=(p->>'workout_id')::uuid and user_id=p_user for update;
      if not found then return jsonb_build_object('status','conflict','message','That workout is no longer in your library.'); end if;
      if w.ingest_status='processing' then
        return jsonb_build_object('status','conflict','message','Wait until this workout finishes reading, then try again.');
      end if;
      if w.user_edit_revision is distinct from (p_prepared->>'expected_revision')::bigint
        or coalesce(w.blocks,'null'::jsonb) is distinct from p_prepared->'base_blocks' then
        return jsonb_build_object('status','conflict','message','This workout changed. Please try the proposal again.');
      end if;
      if jsonb_typeof(p_prepared->'blocks') is distinct from 'array' then raise exception 'Missing prepared blocks'; end if;
      block_count := jsonb_array_length(p_prepared->'blocks');
      update workouts set user_workout_override=jsonb_build_object('blocks',p_prepared->'blocks',
          'muscle_groups',p_prepared->'muscle_groups','equipment',p_prepared->'equipment','has_full_workout',true),
        blocks=p_prepared->'blocks',muscle_groups=array(select jsonb_array_elements_text(p_prepared->'muscle_groups')),
        equipment=array(select jsonb_array_elements_text(p_prepared->'equipment')),has_full_workout=true
        where id=w.id and user_id=p_user returning * into w;
      for ex in select value from jsonb_array_elements(p->'exercises') loop
        insert into corrections(user_id,workout_id,shortcode,platform,kind,field,old_value,new_value,
          old_canonical_id,new_canonical_id,old_exercise,new_exercise,block_index,exercise_index,exercise_name,extracted_by,confidence)
        values(p_user,w.id,w.shortcode,w.platform,'add','exercise',null,ex->>'name',null,ex->>'canonical_id',null,
          ex||jsonb_build_object('added_by','pumpy','added_by_pumpy',true),block_count-1,exercise_index,ex->>'name',w.extracted_by,w.confidence);
        exercise_index := exercise_index+1;
      end loop;
      message := format('Added %s exercise(s) to "%s".',jsonb_array_length(p->'exercises'),w.title);
      summary := jsonb_build_object('workout_id',w.id,'created',false);
      answer := jsonb_build_object('status','ok','workout',to_jsonb(w),'created',false,'plan',null);
    elsif p->>'kind'='plan_days' then
      if jsonb_typeof(p->'days') is distinct from 'array' or jsonb_array_length(p->'days') not between 1 and 42 then
        raise exception 'Invalid plan days';
      end if;
      for d in select value from jsonb_array_elements(p->'days') loop
        -- Lock the owned workout against deletion for the remainder of this commit.
        perform 1 from workouts where id=(d->>'workout_id')::uuid and user_id=p_user for key share;
        if not found then raise exception 'A planned workout is no longer in your library'; end if;
        if exists(select 1 from plan where user_id=p_user and day=(d->>'day')::date and workout_id=(d->>'workout_id')::uuid) then continue; end if;
        insert into plan(user_id,day,workout_id) values(p_user,(d->>'day')::date,(d->>'workout_id')::uuid) returning * into planned;
        items := items||jsonb_build_array(to_jsonb(planned));
      end loop;
      message := case when jsonb_array_length(items)>0 then format('Planned %s day(s). Have a look at the Plan tab.',jsonb_array_length(items))
        else 'Those days were already planned — nothing to add.' end;
      summary := jsonb_build_object('plan_rows',jsonb_array_length(items),'days',(select jsonb_agg(value->'day') from jsonb_array_elements(p->'days')));
      answer := jsonb_build_object('status','ok','workout',null,'created',false,'plan',items);
    else raise exception 'Unknown proposal kind';
    end if;
    insert into pumpy_messages(thread_id,user_id,role,content,meta) values(m.thread_id,p_user,'tool',p->>'kind',
      jsonb_build_object('executed',p->>'kind','proposal_message_id',p_message,'result',summary));
  end if;
  insert into pumpy_messages(thread_id,user_id,role,content) values(m.thread_id,p_user,'assistant',message) returning * into receipt;
  answer := answer||jsonb_build_object('messages',jsonb_build_array(to_jsonb(receipt)));
  -- `confirm_accept` is the decision stored next to its receipt: `status` already
  -- implies it, but the repeat check above should not have to infer the question
  -- from the answer.
  update pumpy_messages set meta=m.meta||jsonb_build_object('status',decision,'result',summary,
    'confirm_response',answer,'confirm_accept',p_accept) where id=m.id;
  update pumpy_threads set updated_at=now() where id=m.thread_id and user_id=p_user;
  return answer;
end $$;
revoke all on function public.confirm_pumpy_proposal(uuid,bigint,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_pumpy_proposal(uuid,bigint,boolean,jsonb) to service_role;
