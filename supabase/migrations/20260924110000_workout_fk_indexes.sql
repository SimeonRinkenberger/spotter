-- An index behind each foreign key that points at workouts.
--
-- Deleting a card (or an account, which deletes every card) makes Postgres find
-- the rows that reference it in each of these tables, to cascade or to set the
-- reference to null. Without an index on the referencing column that is a
-- sequential scan of the whole table, once per deleted card: nothing today
-- (every table is under 400 kB), a scan of about a million workout_logs rows per
-- card at ten thousand users. The Supabase performance advisor lists all five.
--
-- The three nullable references are indexed only where they are set: a
-- session, a correction or a Pumpy thread with no card is never looked up by
-- card, and `workout_id = $1` implies `workout_id is not null`, so the foreign
-- key's own lookups use the partial index. plan and collection_items are
-- NOT NULL, so theirs are plain. exercise_catalog.base_id (224 static rows) is
-- left alone, and no existing index is dropped.
--
-- Not CONCURRENTLY: migrations run in a transaction, and each table is small
-- enough today that the build is a moment's lock.

create index if not exists workout_logs_workout
  on public.workout_logs (workout_id) where workout_id is not null;

create index if not exists corrections_workout
  on public.corrections (workout_id) where workout_id is not null;

create index if not exists pumpy_threads_workout
  on public.pumpy_threads (workout_id) where workout_id is not null;

create index if not exists plan_workout
  on public.plan (workout_id);

create index if not exists collection_items_workout
  on public.collection_items (workout_id);
