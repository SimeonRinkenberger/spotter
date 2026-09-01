-- Per-platform save quality metrics.
--
-- saves_log already gets one row per save for rate limiting, so recording what the
-- scrape actually produced costs nothing extra: no additional fetch, no additional
-- model call. The point is that a platform quietly degrading — TikTok's oEmbed
-- starting to answer 400, Instagram login-walling its og: tags — shows up as a
-- shift in these columns before a user thinks to report it.
--
-- Every column is nullable or defaulted: rows written before this migration stay
-- valid, and the edge function falls back to the legacy insert shape if this has
-- not been applied yet.

alter table public.saves_log
  add column if not exists platform        text,
  -- which scraper rungs actually contributed a field ("oembed", "og,embed-captioned",
  -- "cache", "none"). A source going dark is a change in this mix.
  add column if not exists meta_source     text,
  add column if not exists caption_found   boolean,
  add column if not exists caption_chars   integer,
  add column if not exists thumb_found     boolean,
  add column if not exists author_found    boolean,
  add column if not exists exercises_found integer,
  -- true when any step failed or the caption came back empty
  add column if not exists degraded        boolean;

-- The query this exists to serve: recent success rates per platform.
create index if not exists saves_platform_time
  on public.saves_log (platform, created_at desc);

-- Readable rollup so checking on a platform is one select rather than a hand-written
-- aggregate. security_invoker keeps it under the caller's own permissions; saves_log
-- has RLS on with no policies, so this stays service-role-only like the table itself.
create or replace view public.save_health
with (security_invoker = on) as
select
  platform,
  date_trunc('day', created_at)                                   as day,
  count(*)                                                        as saves,
  count(*) filter (where cached)                                  as from_cache,
  round(100.0 * count(*) filter (where caption_found)   / nullif(count(*), 0)) as pct_caption,
  round(100.0 * count(*) filter (where thumb_found)     / nullif(count(*), 0)) as pct_thumb,
  round(100.0 * count(*) filter (where author_found)    / nullif(count(*), 0)) as pct_author,
  round(100.0 * count(*) filter (where exercises_found > 0) / nullif(count(*), 0)) as pct_exercises,
  count(*) filter (where degraded)                                as degraded
from public.saves_log
where platform is not null
group by platform, date_trunc('day', created_at);
