-- A plan day and a finished session may only point at the caller's own card.
--
-- Both INSERT policies checked the row's owner and nothing else, so the
-- workout a row names was taken on trust. collection_items has always checked
-- both sides ("own items insert", 20260902030000_rls_initplan.sql); plan and
-- workout_logs now do the same. workout_logs.workout_id is nullable (a session
-- outlives a deleted card through ON DELETE SET NULL) and a NULL stays allowed.
--
-- UPDATE is unaffected: plan has no UPDATE policy at all, and the only column
-- the browser may UPDATE on workout_logs is `entries`
-- (20260923120000_workout_logs_edit_entries.sql), so neither row can be
-- re-pointed after it is written. The other workout_id / collection_id columns
-- (corrections, pumpy_threads, collection_items) are written only by the
-- service role or already check ownership.
--
-- The app only ever sends ids from the caller's own library (workouts SELECT is
-- owner-only), and production held no row pointing at another account's card
-- when this was written, so no legitimate insert changes answer.
drop policy if exists "own plan insert" on public.plan;
create policy "own plan insert" on public.plan
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workouts w
      where w.id = plan.workout_id and w.user_id = (select auth.uid())
    )
  );

drop policy if exists "own logs insert" on public.workout_logs;
create policy "own logs insert" on public.workout_logs
  for insert with check (
    user_id = (select auth.uid())
    and (
      workout_logs.workout_id is null
      or exists (
        select 1 from public.workouts w
        where w.id = workout_logs.workout_id and w.user_id = (select auth.uid())
      )
    )
  );
