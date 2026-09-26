-- B.2 review, bug 14: Undo of a program within its 15 minutes also takes the days that
-- were moved, re-dayed or swapped since the confirm (each of those is a delete and an
-- insert that carries the prescription under a new id, so the confirm's recorded ids
-- missed them and they stayed on the calendar with an undone goal's numbers). The
-- function is otherwise the one 20260926100000 made; additive, and nothing else changes.

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
  -- A hand-planned day that took the program's numbers only gives them back, and first,
  -- so the sweep below leaves it standing.
  update plan set prescription=null where user_id=p_user
    and id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'attached_ids','[]'::jsonb)));
  -- The program's own days, however they moved since: Move, Do it today and Swap are a
  -- delete and an insert that carry the prescription under a new id, so the ids the
  -- confirm recorded are not all of them — every row still wearing this goal is.
  delete from plan where user_id=p_user
    and (id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(r->'plan_ids','[]'::jsonb)))
      or prescription->>'goal_id' = r->>'goal_id');
  get diagnostics n_plan = row_count;
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
