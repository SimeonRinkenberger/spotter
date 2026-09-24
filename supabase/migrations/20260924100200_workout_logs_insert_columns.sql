-- strava_activity_id is the function's to write, on INSERT as well as UPDATE.
--
-- 20260905000000_strava.sql took UPDATE of the column away from the browser;
-- INSERT still carried it through the table-wide grant. A column can only be
-- held back from an INSERT by granting the others one by one, so the
-- table-level INSERT goes and every column the app has ever sent comes back.
--
-- Checked before revoking: the session insert in app.ts (finishWorkout) sends
-- user_id, workout_id, workout_title, started_at, completed_at,
-- duration_seconds and entries, and so does every commit that carried iOS
-- builds 5, 6 and 7 (275fbd7 through 6074e07); none sends strava_activity_id,
-- not even as null, and the native shells never write workout_logs. `id` and
-- `notes` keep their grant although nothing sends them today. anon never had a
-- row it could insert (the policy needs auth.uid()), so it gets none.
revoke insert on public.workout_logs from anon, authenticated;
grant insert (id, user_id, workout_id, workout_title, started_at, completed_at,
  duration_seconds, entries, notes) on public.workout_logs to authenticated;
