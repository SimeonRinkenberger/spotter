-- Finding 3's post-deploy check: did anybody correct a workout while the database
-- was ahead of the function?
--
-- Between `supabase db push` (step 4) and `supabase functions deploy` (step 5)
-- the preservation trigger is live and v180 is still serving. v180's
-- handleCorrection and Pumpy append_exercises patch `blocks` without touching
-- `user_workout_override`, so on any workout the migration backfilled an override
-- for — every workout that has ever been corrected — the trigger silently puts
-- the old exercise list back. PostgreSQL RETURNING reflects BEFORE-trigger values,
-- so the user gets a 200 and the reverted card, and watches their edit vanish
-- with no error.
--
-- Run this immediately after step 5 with the two timestamps you noted. A nonzero
-- count is not an outage: it is a list of people to reach, and their edit is gone
-- rather than wrong.
--
--   psql/db query:  \set push '2026-09-17 23:41:00+00'
--                   \set deploy '2026-09-17 23:42:10+00'
-- or edit the two literals below before running.
select count(*) as corrections_in_window,
       count(distinct workout_id) as workouts_affected,
       min(created_at) as first_at,
       max(created_at) as last_at
from public.corrections
where created_at between timestamptz '2026-01-01 00:00:00+00'   -- <push>
                     and timestamptz '2026-01-01 00:00:00+00';  -- <deploy>
