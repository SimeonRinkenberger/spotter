-- Spotter — one demonstration video per movement, remembered.
--
-- The Explain sheet used to draw the movement from a CC-BY-SA illustration. It now
-- offers a short YouTube clip instead, found through the YouTube Data API. That
-- lookup is the reason this table exists: search.list costs 100 units of the free
-- 10,000/day quota — a hundred times what videos.list costs — so an uncached
-- feature would run the whole project dry in a hundred sheet opens. Every answer,
-- including "nothing good came back", is written here and reused.
--
-- key is the catalog's canonical_id when the exercise has one, so every spelling
-- of a bench press shares a single lookup, and a flattened form of the name when
-- it does not (lowercased, accents folded, punctuation collapsed to spaces).
--
-- A hit is kept forever: a good form video does not go stale, and if one is taken
-- down the embed says so more clearly than we could. A miss is kept for seven days
-- and then retried, because the miss is usually about what YouTube had indexed
-- that afternoon rather than about the movement.
--
-- Nothing here is anybody's data — it is a shared, global cache of public video
-- ids, and the row says nothing about who asked for it.

create table if not exists public.exercise_videos (
  key        text primary key,
  video_id   text,
  title      text,
  channel    text,
  query      text,
  fetched_at timestamptz not null default now(),
  miss       boolean not null default false
);

-- Written and read only by the edge function, like video_cache and saves_log: RLS
-- on with zero policies, which denies every anon and authenticated request and
-- leaves the service role — which bypasses RLS — as the only way in.
alter table public.exercise_videos enable row level security;  -- no policies: service role only
