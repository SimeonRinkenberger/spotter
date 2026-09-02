-- The media tier: what happened when Spotter went and read the video itself.
--
-- Everything before this migration reads TEXT — a caption, a description, a page
-- somebody's phone fetched. A caption that names no exercises is not a video that
-- contains none, so a card that comes out thin now escalates: transcribe what is
-- said, and if that is a soundtrack rather than a coach, read what is written on
-- the screen. Three facts have to be recorded for that to be affordable.
--
--   1. Whether this video has been read AT ALL (video_cache.media_tried). It is
--      what stops the second, third and hundredth person to save a viral clip
--      each paying to ask the same video the same question, and it is equally
--      what stops a video with nothing in it being re-read forever.
--   2. Which route produced it (media_source), on the global row and on the
--      per-step ledger row, so "the sound track worked" and "we had to stream the
--      video" are separable afterwards.
--   3. The words themselves (media_text), so a cache hit and a reprocess can
--      re-check the card's evidence against the text it was actually built from
--      instead of quietly losing it.
--
-- Plus one column on the user's own row: which of the two is happening right now,
-- so a pending card can say "Listening to the video…" rather than a generic line
-- that is wrong about what Spotter is doing.
--
-- Idempotent. Adds columns, adds no policies, and touches no existing row: every
-- column is nullable or defaulted, so the two real users' data is unchanged.

alter table public.video_cache
  -- false is the honest default for every row written before this: nobody had
  -- tried, because there was nothing to try with.
  add column if not exists media_tried  boolean not null default false,
  add column if not exists media_source text,
  -- The transcript, or the reading. Kept because it is what the card's evidence
  -- points at — a quote nobody can look up is not evidence — and for nothing else.
  add column if not exists media_text   text;

-- Which cached videos are worth going back to. Small and partial: the whole point
-- is that most rows are not thin, and the ones that are get asked once.
create index if not exists video_cache_unread
  on public.video_cache (updated_at desc)
  where media_tried = false;

-- The per-step ledger. saves_log already counts saves, reprocesses, helpers, chats
-- and uploads; 'media' joins them, one row per step that actually ran, which is
-- what LIMIT_MEDIA counts.
alter table public.saves_log
  add column if not exists media_source text;

-- What the user's own card says while a media step is running: null, 'listening'
-- or 'watching'. Cleared by finishJob and by failJob, so a card is never left
-- claiming that something is happening to it.
alter table public.workouts
  add column if not exists media_stage text;

-- ---------- the dials ----------
--
-- Model ids and size caps live in app_config rather than in code, on the same
-- five-minute timer as everything else, so turning the video tier off is an update
-- statement rather than a deploy. Inserted, never updated: a value somebody has
-- already tuned is not this migration's business.
insert into public.app_config (key, value) values
  -- The ceiling on anything streamed through the function. 40 MB comfortably holds
  -- a 60-second TikTok at full bitrate; anything larger is not a clip.
  ('media.max_bytes', '40000000'),
  -- How long one media step may take: a 60s upload and a 90s read are both normal.
  ('media.timeout_ms', '150000'),
  -- Tier 2. On, because it was measured working on 2026-09-02: the acceptance
  -- video's workout is written on the screen and nowhere else, and Gemini read all
  -- four movements off it with timestamps.
  ('media.video_enabled', 'true')
on conflict (key) do nothing;
