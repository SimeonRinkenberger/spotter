-- B.2: goals and programs. Pumpy turns "bench 305" or "lose 10 lb" into dated weeks on
-- the calendar, and those weeks carry their numbers into Up next, Workout Mode and the
-- Lock Screen. Everything here is additive: builds 5-10 select * on plan and never read
-- the new column, and they never see the new table.
--
--   plan.prescription         what a program day asks of its goal lift (week, label,
--                             exercise, sets, reps, pct, the load worked out from the
--                             baseline, rpe, note, goal_id). The app recomputes the load
--                             from the latest estimated max before it prints one.
--   goals                     one row per goal; one active at a time; the person may
--                             read theirs and move it between active and ended (End goal,
--                             and its Undo). Nobody but the server inserts or deletes.
--   profiles.free_goal_thread Basic's one free program: the conversation the server gave
--                             it. Service-role only, so the client cannot reset it.
--   guard_workout_library     a Spotter Starter and a program's own workouts are not
--                             saves: never refused at the cap, never counted toward it.
--   confirm_pumpy_proposal    + kind "program": one transaction that ends the goal it
--                             replaces, makes its workouts, writes the goal and its days,
--                             and keeps what it wrote for Undo. Also says Workouts and
--                             Train where it used to say library and the Plan tab.
--   undo_pumpy_program        takes a program back within 15 minutes, restoring what it
--                             replaced.
-- Idempotent. Apply before the function deploy that ships alongside.

alter table public.plan add column if not exists prescription jsonb;
alter table public.plan drop constraint if exists plan_prescription_shape;
alter table public.plan add constraint plan_prescription_shape
  check (prescription is null or (jsonb_typeof(prescription) = 'object' and octet_length(prescription::text) <= 2000));

create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('lift', 'fat', 'muscle', 'consistency')),
  title       text not null check (char_length(title) between 1 and 60),
  exercise    text,
  target      numeric,
  dream       numeric,
  unit        text check (unit is null or unit in ('lb', 'kg')),
  baseline    numeric,
  start_day   date not null,
  end_day     date not null check (end_day >= start_day),
  weeks       int not null check (weeks between 1 and 12),
  verdict     text not null default 'realistic' check (verdict in ('realistic', 'stretch', 'too_fast')),
  program     jsonb not null default '{}'::jsonb
              check (jsonb_typeof(program) = 'object' and octet_length(program::text) <= 8000),
  status      text not null default 'active' check (status in ('active', 'ended', 'done', 'undone')),
  -- Not foreign keys: a goal outlives the conversation that made it (a thread can be
  -- deleted), and the free-program ledger below reads this column after that happens.
  thread_id   uuid,
  message_id  bigint,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create unique index if not exists goals_one_active on public.goals (user_id) where status = 'active';
create index if not exists goals_user on public.goals (user_id, created_at desc);
create index if not exists goals_thread on public.goals (user_id, thread_id);

alter table public.goals enable row level security;
revoke all on public.goals from anon, authenticated;
grant select on public.goals to authenticated;
grant update (status, ended_at) on public.goals to authenticated;
grant all on public.goals to service_role;
drop policy if exists "own goals select" on public.goals;
create policy "own goals select" on public.goals for select using (user_id = (select auth.uid()));
-- End goal and its Undo: between active and ended only. done and undone are the
-- server's words and a row carrying one stays as it is.
drop policy if exists "own goals end" on public.goals;
create policy "own goals end" on public.goals for update
  using (user_id = (select auth.uid()) and status in ('active', 'ended'))
  with check (user_id = (select auth.uid()) and status in ('active', 'ended'));

alter table public.profiles add column if not exists free_goal_thread uuid;
alter table public.profiles add column if not exists free_goal_at timestamptz;
-- UPDATE on profiles was narrowed to (display_name, settings) on 8 Sept and INSERT
-- revoked on 24 Sept, so no browser role can write these; said again so it holds on a
-- database where a table grant came back.
revoke update (free_goal_thread, free_goal_at) on public.profiles from anon, authenticated;

create or replace function public.guard_workout_library() returns trigger language plpgsql security definer set search_path=public as $$
declare cap int; plan_name text; overrides jsonb; plans jsonb;
begin
  -- A starter ships with the app, and a program's workouts belong to a plan Basic gets
  -- once: neither is a save, so neither is refused at the cap nor counted toward it.
  if new.kind in ('starter', 'program') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,582));
  if exists(select 1 from workouts where user_id=new.user_id and shortcode=new.shortcode) then return new; end if;
  select plan,limits into plan_name,overrides from profiles where id=new.user_id;
  select value::jsonb into plans from app_config where key='limits.plans';
  cap:=case when coalesce(overrides,'{}') ? 'library' then (overrides->>'library')::int
    when coalesce(plans->coalesce(plan_name,'free'),'{}') ? 'library' then (plans->coalesce(plan_name,'free')->>'library')::int
    when coalesce(plan_name,'free')='free' then 20 else null end;
  if cap is not null and (select count(*) from workouts where user_id=new.user_id
      and kind is distinct from 'starter' and kind is distinct from 'program')>=cap then
    raise exception 'Library limit reached' using errcode='P0001';
  end if;
  return new;
end $$;

-- 20260925100000's function, with programs. The other three kinds are unchanged apart
-- from their receipts' wording.
create or replace function public.confirm_pumpy_proposal(
  p_user uuid, p_message bigint, p_accept boolean, p_prepared jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.pumpy_messages;
  receipt public.pumpy_messages;
  w public.workouts;
  planned public.plan;
  old_goal public.goals;
  g public.goals;
  p jsonb;
  d jsonb;
  ex jsonb;
  t jsonb;
  wk jsonb;
  rx jsonb;
  refs jsonb := '{}'::jsonb;
  made jsonb := '[]'::jsonb;
  attached jsonb := '[]'::jsonb;
  removed jsonb := '[]'::jsonb;
  items jsonb := '[]'::jsonb;
  answer jsonb;
  summary jsonb;
  decision text;
  plan_name text;
  free_thread uuid;
  message text;
  target uuid;
  block_count int;
  exercise_index int := 0;
  cover text;
  today date;
begin
  select * into m from pumpy_messages where id=p_message and user_id=p_user and role='assistant' for update;
  if not found or m.meta->'proposal' is null then
    return jsonb_build_object('status','not_found','message','Proposal not found.');
  end if;
  -- The idempotency key is the message AND the decision (20260917140000): a repeat of
  -- the same decision gets its stored receipt; the other decision is a conflict.
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
    select plan, free_goal_thread into plan_name, free_thread from profiles where id=p_user for update;
    if not found then
      return jsonb_build_object('status','limit','kind','pumpy','upgrade',true,
        'message','Pumpy coaching and workout creation are included with Spotter Plus.');
    end if;
    -- Basic accepts exactly one thing: the program from the conversation the server gave
    -- its free plan, and only while that conversation has no live program.
    if coalesce(plan_name,'free') not in ('plus','pro','staff') then
      if p->>'kind' is distinct from 'program' then
        return jsonb_build_object('status','limit','kind','pumpy','upgrade',true,
          'message','Pumpy coaching and workout creation are included with Spotter Plus.');
      end if;
      if free_thread is distinct from m.thread_id
        or exists(select 1 from goals where user_id=p_user and thread_id=m.thread_id and status<>'undone') then
        return jsonb_build_object('status','limit','kind','goal','upgrade',true,
          'message','Your free plan is built. Spotter Plus keeps Pumpy building and adjusting plans with you.');
      end if;
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
          return jsonb_build_object('status','limit','kind','library','message','Workouts is full. Remove a workout and try again.');
        end if;
        raise;
      end;
      select coalesce(sum(jsonb_array_length(b->'exercises')),0) into block_count from jsonb_array_elements(p->'blocks') b;
      message := format('Saved "%s" to Workouts — %s exercises.',p->>'title',block_count);
      summary := jsonb_build_object('workout_id',w.id,'created',true);
      answer := jsonb_build_object('status','ok','workout',to_jsonb(w),'created',true,'plan',null);
    elsif p->>'kind'='append_exercises' then
      select * into w from workouts where id=(p->>'workout_id')::uuid and user_id=p_user for update;
      if not found then return jsonb_build_object('status','conflict','message','That workout is no longer in Workouts.'); end if;
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
        perform 1 from workouts where id=(d->>'workout_id')::uuid and user_id=p_user for key share;
        if not found then raise exception 'A planned workout is no longer in your library'; end if;
        if exists(select 1 from plan where user_id=p_user and day=(d->>'day')::date and workout_id=(d->>'workout_id')::uuid) then continue; end if;
        insert into plan(user_id,day,workout_id) values(p_user,(d->>'day')::date,(d->>'workout_id')::uuid) returning * into planned;
        items := items||jsonb_build_array(to_jsonb(planned));
      end loop;
      message := case when jsonb_array_length(items)>0 then format('Planned %s day(s). They are on Train now.',jsonb_array_length(items))
        else 'Those days were already planned — nothing to add.' end;
      summary := jsonb_build_object('plan_rows',jsonb_array_length(items),'days',(select jsonb_agg(value->'day') from jsonb_array_elements(p->'days')));
      answer := jsonb_build_object('status','ok','workout',null,'created',false,'plan',items);
    elsif p->>'kind'='program' then
      -- Every check before the first write, so a refusal changes nothing.
      today := coalesce(nullif(p_prepared->>'today','')::date, current_date);
      if jsonb_typeof(p->'weeks') is distinct from 'array' or jsonb_array_length(p->'weeks') not between 1 and 12
        or jsonb_typeof(p->'templates') is distinct from 'array' or jsonb_array_length(p->'templates') not between 1 and 6
        or nullif(p_prepared->>'goal_id','') is null then
        raise exception 'Invalid program';
      end if;
      if (p->>'start')::date < today - 3 then
        return jsonb_build_object('status','conflict','message','This plan starts in the past. Ask Pumpy to start it again.');
      end if;
      for t in select value from jsonb_array_elements(p->'templates') loop
        if coalesce((t->>'new')::boolean,false) then
          if jsonb_typeof(t->'create'->'blocks') is distinct from 'array' then raise exception 'Invalid program workout'; end if;
        else
          perform 1 from workouts where id=(t->>'workout_id')::uuid and user_id=p_user for key share;
          if not found then
            return jsonb_build_object('status','conflict','message','A workout in this plan is no longer in Workouts. Ask Pumpy to build it again.');
          end if;
        end if;
        refs := refs||jsonb_build_object(t->>'ref', t->>'workout_id');
      end loop;
      -- The goal this one replaces: ended, and its days from today on taken off, all
      -- kept in the receipt so Undo can put them back.
      select * into old_goal from goals where user_id=p_user and status='active' for update;
      if found then
        with gone as (
          delete from plan where user_id=p_user and day >= today and prescription->>'goal_id' = old_goal.id::text returning *
        ) select coalesce(jsonb_agg(to_jsonb(gone)),'[]'::jsonb) into removed from gone;
        update goals set status='ended', ended_at=now() where id=old_goal.id;
      end if;
      for t in select value from jsonb_array_elements(p->'templates') loop
        if coalesce((t->>'new')::boolean,false) then
          cover := public.pumpy_cover_pick(p_user);
          insert into workouts(id,user_id,url,shortcode,platform,kind,author,title,caption,category,
            muscle_groups,equipment,difficulty,duration_minutes,blocks,tags,has_full_workout,extracted_by,ingest_status,pumpy_cover)
          values((t->>'workout_id')::uuid,p_user,'spotter://pumpy/'||(t->>'workout_id'),'pumpy-'||(t->>'workout_id'),'pumpy','program','Pumpy',
            coalesce(t->'create'->>'title',t->>'title'),t->'create'->>'summary',t->'create'->>'category',
            array(select jsonb_array_elements_text(coalesce(t->'create'->'muscle_groups','[]'::jsonb))),
            array(select jsonb_array_elements_text(coalesce(t->'create'->'equipment','[]'::jsonb))),
            t->'create'->>'difficulty',(t->'create'->>'duration_minutes')::int,t->'create'->'blocks',array['pumpy','program'],true,
            'pumpy:'||coalesce(m.meta->>'model','unknown'),'ready',cover)
          returning * into w;
          made := made||jsonb_build_array(to_jsonb(w));
        end if;
      end loop;
      insert into goals(id,user_id,kind,title,exercise,target,dream,unit,baseline,start_day,end_day,weeks,verdict,program,status,thread_id,message_id)
      values((p_prepared->>'goal_id')::uuid,p_user,p->'goal'->>'type',left(p->'goal'->>'title',60),p->'goal'->>'exercise',
        (p->'goal'->>'target')::numeric,(p->'goal'->>'dream')::numeric,p->'goal'->>'unit',(p->'goal'->>'baseline')::numeric,
        (p->>'start')::date,(p->>'end')::date,jsonb_array_length(p->'weeks'),coalesce(p->>'verdict','realistic'),
        jsonb_build_object('days_per_week',p->'goal'->'days_per_week',
          'weeks',(select coalesce(jsonb_agg(jsonb_build_object('week',x->'week','label',x->'label')),'[]'::jsonb) from jsonb_array_elements(p->'weeks') x),
          'daily',p->'goal'->'daily','weigh_in_dow',p->'goal'->'weigh_in_dow','plate',p->'plate',
          'verdict_note',p->>'verdict_note','sources',coalesce(p->'sources','[]'::jsonb)),
        'active',m.thread_id,p_message)
      returning * into g;
      for wk in select value from jsonb_array_elements(p->'weeks') loop
        for d in select value from jsonb_array_elements(wk->'days') loop
          target := (refs->>(d->>'ref'))::uuid;
          if target is null then raise exception 'Invalid program day'; end if;
          -- A day with no prescription arrives as a JSON null, which coalesce does not
          -- catch and which || would turn into an array; it carries only the week.
          rx := (case when jsonb_typeof(d->'rx')='object' then jsonb_strip_nulls(d->'rx') else '{}'::jsonb end)
            ||jsonb_build_object('v',1,'goal_id',g.id,'week',(wk->>'week')::int,'label',wk->>'label','unit',p->>'unit');
          -- The same workout already planned that day by hand takes the program's
          -- numbers rather than a second copy of itself; Undo gives them back.
          select * into planned from plan where user_id=p_user and day=(d->>'day')::date and workout_id=target and prescription is null limit 1;
          if found then
            update plan set prescription=rx where id=planned.id returning * into planned;
            attached := attached||jsonb_build_array(planned.id);
          else
            insert into plan(user_id,day,workout_id,prescription) values(p_user,(d->>'day')::date,target,rx) returning * into planned;
          end if;
          items := items||jsonb_build_array(to_jsonb(planned));
        end loop;
      end loop;
      message := format('Planned %s: %s weeks, %s sessions. They are on Train now.',g.title,jsonb_array_length(p->'weeks'),jsonb_array_length(items));
      summary := jsonb_build_object('goal_id',g.id,
        'plan_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(items) x where not (attached ? (x->>'id'))),
        'attached_ids',attached,
        'workout_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(made) x),
        'replaced',case when old_goal.id is not null then jsonb_build_object('goal_id',old_goal.id,'rows',removed) else null end,
        'at',now());
      answer := jsonb_build_object('status','ok','workout',null,'created',false,'plan',items,
        'program',jsonb_build_object('goal',to_jsonb(g),'plan',items,'workouts',made,'attached',attached,
          'replaced',case when old_goal.id is not null then jsonb_build_object('goal_id',old_goal.id,'removed',jsonb_array_length(removed)) else null end),
        'undo',jsonb_build_object('message_id',p_message,'until',now()+interval '15 minutes'));
    else raise exception 'Unknown proposal kind';
    end if;
    insert into pumpy_messages(thread_id,user_id,role,content,meta) values(m.thread_id,p_user,'tool',p->>'kind',
      jsonb_build_object('executed',p->>'kind','proposal_message_id',p_message,'result',summary));
  end if;
  insert into pumpy_messages(thread_id,user_id,role,content) values(m.thread_id,p_user,'assistant',message) returning * into receipt;
  answer := answer||jsonb_build_object('messages',jsonb_build_array(to_jsonb(receipt)));
  update pumpy_messages set meta=m.meta||jsonb_build_object('status',decision,'result',summary,
    'confirm_response',answer,'confirm_accept',p_accept) where id=m.id;
  update pumpy_threads set updated_at=now() where id=m.thread_id and user_id=p_user;
  return answer;
end $$;
revoke all on function public.confirm_pumpy_proposal(uuid,bigint,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_pumpy_proposal(uuid,bigint,boolean,jsonb) to service_role;

-- Undo, for 15 minutes after a program lands: its days and its workouts go, its goal
-- reads undone (which also gives Basic's free conversation back), and whatever it
-- replaced comes back. A repeat returns the same receipt.
create or replace function public.undo_pumpy_program(p_user uuid, p_message bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.pumpy_messages;
  receipt public.pumpy_messages;
  r jsonb;
  answer jsonb;
  n_plan int := 0;
  n_w int := 0;
  n_back int := 0;
begin
  select * into m from pumpy_messages where id=p_message and user_id=p_user and role='assistant' for update;
  if not found or m.meta->'proposal'->>'kind' is distinct from 'program' then
    return jsonb_build_object('status','not_found','message','Nothing to undo.');
  end if;
  if m.meta->'undo_response' is not null then return m.meta->'undo_response'; end if;
  if m.meta->>'status' is distinct from 'done' then
    return jsonb_build_object('status','conflict','message','That plan was not built, so there is nothing to undo.');
  end if;
  r := m.meta->'result';
  if coalesce((r->>'at')::timestamptz, 'epoch'::timestamptz) < now() - interval '15 minutes' then
    return jsonb_build_object('status','conflict','message','That plan is past its undo. End the goal from Train instead.');
  end if;
  perform 1 from profiles where id=p_user for update;
  delete from plan where user_id=p_user
    and id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'plan_ids','[]'::jsonb)));
  get diagnostics n_plan = row_count;
  update plan set prescription=null where user_id=p_user
    and id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'attached_ids','[]'::jsonb)));
  delete from workouts where user_id=p_user and kind='program'
    and id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'workout_ids','[]'::jsonb)));
  get diagnostics n_w = row_count;
  update goals set status='undone', ended_at=now() where user_id=p_user and id=(r->>'goal_id')::uuid;
  if jsonb_typeof(r->'replaced') = 'object' then
    update goals set status='active', ended_at=null where user_id=p_user and id=(r->'replaced'->>'goal_id')::uuid
      and status='ended' and not exists(select 1 from goals x where x.user_id=p_user and x.status='active');
    insert into plan(id,user_id,created_at,day,workout_id,slot,prescription)
      select x.id, p_user, coalesce(x.created_at, now()), x.day, x.workout_id, coalesce(x.slot,'any'), x.prescription
      from jsonb_populate_recordset(null::public.plan, coalesce(r->'replaced'->'rows','[]'::jsonb)) x
      where exists(select 1 from workouts w where w.id=x.workout_id and w.user_id=p_user)
      on conflict (id) do nothing;
    get diagnostics n_back = row_count;
  end if;
  insert into pumpy_messages(thread_id,user_id,role,content)
    values(m.thread_id,p_user,'assistant','Undone — your calendar is back the way it was.') returning * into receipt;
  answer := jsonb_build_object('status','ok','goal_id',r->>'goal_id',
    'removed',jsonb_build_object('plan',n_plan,'workouts',n_w),
    'restored',case when jsonb_typeof(r->'replaced')='object' then jsonb_build_object('goal_id',r->'replaced'->>'goal_id','plan',n_back) else null end,
    'messages',jsonb_build_array(to_jsonb(receipt)));
  update pumpy_messages set meta=m.meta||jsonb_build_object('status','undone','undo_response',answer) where id=m.id;
  update pumpy_threads set updated_at=now() where id=m.thread_id and user_id=p_user;
  return answer;
end $$;
revoke all on function public.undo_pumpy_program(uuid,bigint) from public,anon,authenticated;
grant execute on function public.undo_pumpy_program(uuid,bigint) to service_role;
