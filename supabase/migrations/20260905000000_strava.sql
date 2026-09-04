-- Spotter — Strava. One table of tokens nobody but the function may see, and one
-- column on a session saying where it ended up.
--
-- Two things shape this file.
--
-- **The tokens are not the user's to hold.** A Strava access token is a bearer
-- credential that can write activities to somebody's Strava account for six
-- hours, and the refresh token can mint new ones for ever. A browser that could
-- SELECT this table could read both out of PostgREST with the user's own JWT, so
-- the table gets RLS with zero policies — the same treatment `video_cache` and
-- `saves_log` already have. Only the service role, i.e. the edge function, ever
-- sees a row. There is deliberately no "own tokens read" policy to soften later:
-- the client is told `connected: true` and an athlete id by the function, and
-- that is the whole of what it needs.
--
-- **Refresh tokens rotate.** Strava returns a NEW refresh token every time one is
-- spent and invalidates the old one immediately, so a lost write here is a
-- permanently broken connection, not a retry. `updated_at` and the compare-and-set
-- in `strava.ts` (update ... where refresh_token = the one we read) are what make
-- two isolates racing a refresh converge on one surviving token instead of two
-- half-written ones.
--
-- We are write-only against Strava and store nothing about the athlete beyond the
-- id we authenticated as. The API agreement forbids feeding Strava data to an AI
-- feature and caps caching at seven days; holding no athlete data at all is the
-- cheapest way to be permanently on the right side of both.

-- ---------- the connection ----------

create table if not exists public.strava_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  athlete_id    bigint,                      -- from the token response; the only athlete field kept
  access_token  text not null,
  refresh_token text not null,               -- overwritten on every refresh — Strava rotates it
  expires_at    timestamptz not null,        -- refresh when within 60 s of this
  scope         text,                        -- expect 'activity:write'; anything less is refused at the callback
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.strava_tokens enable row level security;   -- no policies: service role only

-- No grant to anon or authenticated either. RLS with no policy already answers
-- "no rows", but a table the client has no privilege on cannot even be probed for
-- its shape, and defence in depth costs one line.
revoke all on public.strava_tokens from anon, authenticated;

-- ---------- where a session ended up ----------

-- Null until the session has been pushed. It is the double-post guard as much as
-- it is the "View on Strava" link: `push` refuses when it is already set, so two
-- taps, two tabs or a retried request produce one Strava activity.
alter table public.workout_logs add column if not exists strava_activity_id bigint;

-- The existing "own logs select" policy already covers the new column — a select
-- policy is per row, not per column — so History reads it for free and nothing
-- here needs a new policy to make the link appear.
--
-- UPDATE is the half that needed thinking about. Supabase's default privileges
-- grant every column of every public table to `authenticated`, and
-- `own logs update` lets a user update their own rows, so before this line a
-- browser could have written itself any strava_activity_id it liked — pointing a
-- "View on Strava" link at a stranger's activity, or marking a session as already
-- sent so it could never be pushed. The app has never updated a workout_logs row
-- (it inserts one when a session finishes, selects them for History and Progress,
-- and deletes them; there is no edit-a-past-session screen), so the whole
-- privilege goes rather than being carved up column by column. The function
-- writes this column as the service role, which privileges do not apply to.
--
-- The policy is left in place on purpose: it is the thing that would make a
-- future `grant update (notes) on public.workout_logs to authenticated` work on
-- its own, one column at a time, the way `profiles` already does it.
revoke update on public.workout_logs from anon, authenticated;
