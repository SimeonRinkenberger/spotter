-- Spotter — evaluate auth.uid() once per statement, not once per row.
--
-- Every owner policy reads `user_id = auth.uid()`. Written that way, Postgres
-- may call auth.uid() for every row it scans; wrapped as `(select auth.uid())`
-- the planner treats it as an InitPlan and evaluates it once. Same predicate,
-- same answer, one call instead of thousands on a big library. This is the
-- `auth_rls_initplan` advisor finding, applied to every owner policy at once so
-- no table is the odd one out. Nothing about who can see what changes.

-- profiles
alter policy "own profile read"   on public.profiles using (id = (select auth.uid()));
alter policy "own profile update" on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workouts
alter policy "own workouts select" on public.workouts using (user_id = (select auth.uid()));
alter policy "own workouts insert" on public.workouts with check (user_id = (select auth.uid()));
alter policy "own workouts update" on public.workouts
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own workouts delete" on public.workouts using (user_id = (select auth.uid()));

-- workout_logs
alter policy "own logs select" on public.workout_logs using (user_id = (select auth.uid()));
alter policy "own logs insert" on public.workout_logs with check (user_id = (select auth.uid()));
alter policy "own logs update" on public.workout_logs
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own logs delete" on public.workout_logs using (user_id = (select auth.uid()));

-- plan
alter policy "own plan select" on public.plan using (user_id = (select auth.uid()));
alter policy "own plan insert" on public.plan with check (user_id = (select auth.uid()));
alter policy "own plan delete" on public.plan using (user_id = (select auth.uid()));

-- corrections
alter policy "own corrections select" on public.corrections using (user_id = (select auth.uid()));

-- collections
alter policy "own collections select" on public.collections using (user_id = (select auth.uid()));
alter policy "own collections insert" on public.collections with check (user_id = (select auth.uid()));
alter policy "own collections update" on public.collections
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own collections delete" on public.collections using (user_id = (select auth.uid()));

-- collection_items (the insert check still verifies BOTH ends belong to the caller)
alter policy "own items select" on public.collection_items using (user_id = (select auth.uid()));
alter policy "own items insert" on public.collection_items with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.collections c
               where c.id = collection_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.workouts w
               where w.id = workout_id and w.user_id = (select auth.uid()))
);
alter policy "own items delete" on public.collection_items using (user_id = (select auth.uid()));

-- pumpy
alter policy "own threads select"  on public.pumpy_threads  using (user_id = (select auth.uid()));
alter policy "own threads delete"  on public.pumpy_threads  using (user_id = (select auth.uid()));
alter policy "own messages select" on public.pumpy_messages using (user_id = (select auth.uid()));
