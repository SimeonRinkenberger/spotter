-- Spotter — the curated demonstration-clip table.
--
-- One row is "this YouTube clip demonstrates this canonical exercise". The rows
-- are written offline by tools/demo-videos.mjs from the creator allow-list in
-- tools/demo-sources.json; the seed lives in its own dated migration next to this
-- one so the schema and the data can move at different speeds.
--
-- key is an exercise_catalog id, never a free-form name: a clip attached to a
-- string would drift the moment the model spelled the exercise differently, which
-- is the whole reason canonical ids exist.
--
-- Read by /api/demo-video at request time (order by tier, rank; limit 4), which is
-- why there is no join and no free-text lookup here — the sheet's answer is one
-- index scan and no YouTube quota.
--
-- Service role only: this is reference data, written by a tool on the owner's
-- laptop and read by the edge function with its own key. RLS on with no policies
-- is that statement, made in the one place the database enforces it.

create table if not exists public.exercise_demo_videos (
  key        text not null,                 -- exercise_catalog.id (canonical id), never a free-form name
  video_id   text not null,                 -- 11-char YouTube id
  title      text not null,                 -- cleaned title as shown to the user ("Front Squat")
  channel    text not null,                 -- display label ("Renaissance Periodization")
  channel_id text not null,
  source     text not null,                 -- slug from tools/demo-sources.json
  tier       int  not null default 2,       -- 1 best; ties broken by rank
  secs       int,                           -- clip length, null if unknown
  rank       int  not null default 0,       -- 0 = the one to show first for this key
  method     text not null default 'exact', -- exact | confirmed | manual
  primary key (key, video_id)
);
alter table public.exercise_demo_videos enable row level security;  -- no policies: service role only
