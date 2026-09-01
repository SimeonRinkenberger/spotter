-- Spotter — evidence, confidence, and model identifiers that live in config.
--
-- Extraction has always run once and been believed. That is fine while one person
-- is testing and useless as a basis for deciding anything: "the model said so" is
-- not a measurement, and the Phase 2 gate needs a number it can group by.
--
-- So every extracted exercise now carries evidence — which source it came from and,
-- where the source has positions, where in it — and every card carries a score
-- computed from observables about that evidence. Nothing here reads a model's
-- opinion of its own output. The score is a function of: does each exercise trace
-- back to something, does that something actually contain the sets and reps the
-- card claims, do two independent readers agree on how many exercises there are,
-- do the names exist in the controlled catalog, and is the total length physically
-- plausible.
--
-- The evidence itself rides inside blocks->exercises->evidence (jsonb, no
-- migration needed). What needs columns is the part that has to be queryable
-- without unnesting: the score, and which model produced it.

-- ---------- the score, where it can be grouped by ----------

alter table public.workouts
  -- 0.000 .. 1.000. Null on rows saved before this migration and on rows still
  -- being ingested — deliberately distinguishable from a genuine zero.
  add column if not exists confidence   numeric(4,3),
  -- "openai:gpt-5.6-luna", "groq:openai/gpt-oss-120b", "vision:gemini-3.6-flash",
  -- "heuristic". Recorded so a card produced by a weak model can be found and
  -- re-run when a better one ships, rather than being silently trusted forever.
  add column if not exists extracted_by text;

alter table public.video_cache
  add column if not exists confidence   numeric(4,3),
  add column if not exists extracted_by text;

alter table public.saves_log
  add column if not exists confidence     numeric(4,3),
  add column if not exists extracted_by   text,
  -- percentage of the card's exercises that carried evidence we could locate in a
  -- source text we hold. Kept beside the score because it is the single component
  -- most likely to explain a low one.
  add column if not exists evidence_pct   integer,
  -- true when YouTube chapter timestamps contributed evidence to this card. The
  -- open question this exists to answer is whether chapters help or whether they
  -- mostly produce plausible-but-wrong cards.
  add column if not exists chapters_used  boolean;

-- The Phase 2 query: how do scores distribute, per platform, over time.
create index if not exists saves_confidence
  on public.saves_log (platform, confidence)
  where confidence is not null;

create index if not exists workouts_weak
  on public.workouts (confidence)
  where confidence is not null;

-- ---------- rollups ----------

-- save_health gains the confidence columns. `create or replace view` refuses to
-- insert a column before an existing one — it reads that as renaming `degraded` —
-- so the view is dropped and rebuilt. Nothing depends on it but a human running a
-- select, which is what it is for.
drop view if exists public.save_health;
create view public.save_health
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
  round(avg(confidence), 3)                                       as avg_confidence,
  round(avg(evidence_pct))                                        as avg_evidence_pct,
  count(*) filter (where confidence < 0.5)                        as below_gate,
  count(*) filter (where chapters_used)                           as used_chapters,
  count(*) filter (where degraded)                                as degraded
from public.saves_log
where platform is not null
group by platform, date_trunc('day', created_at);

drop view if exists public.weak_cards;
-- Which cached cards are worth re-running when a better model appears. Ordered
-- worst first; a card with no exercises at all is a different problem from a card
-- with exercises nobody can trace, so has_exercises is exposed rather than filtered.
create view public.weak_cards
with (security_invoker = on) as
select
  shortcode,
  platform,
  confidence,
  extracted_by,
  v as card_version,
  jsonb_array_length(coalesce(card -> 'blocks', '[]'::jsonb)) > 0 as has_blocks,
  updated_at
from public.video_cache
where confidence is null or confidence < 0.55
order by confidence nulls first, updated_at;

-- ---------- model identifiers ----------
--
-- Gemini 2.0 was retired in June 2026 and 2.5 goes in October 2026: two forced
-- migrations inside four months, and both of them were edits to a TypeScript file
-- followed by a deploy. They should be an update statement.
--
-- app_config already exists (RLS on, no policies, service-role only) because the
-- cron job needed somewhere to read the worker secret from. Model ids are not
-- secrets, so they can be seeded here in the open. Precedence in the function is
-- app_config > environment variable > compiled-in default, and every lookup falls
-- back rather than failing: a database that cannot answer must not stop a save.
--
-- on conflict do nothing: re-running the migration must not stamp over a model
-- someone changed in production during a retirement.

insert into public.app_config (key, value) values
  ('model.openai',        'gpt-5.6-luna'),
  ('model.anthropic',     'claude-haiku-4-5-20251001'),
  ('model.gemini',        'gemini-3.6-flash'),
  -- rotation list for the free tier's per-model daily cap. Comma separated.
  ('model.gemini_pool',   'gemini-3.6-flash,gemini-3.6-flash-lite,gemini-3-flash-lite,gemini-3-flash,gemini-flash-latest'),
  -- vision is Gemini's remaining irreplaceable job, and it is worth being able to
  -- point it somewhere else without touching the text ladder.
  ('model.gemini_vision', 'gemini-3.6-flash'),
  ('model.groq',          'openai/gpt-oss-120b'),
  ('model.groq_pool',     'openai/gpt-oss-120b,llama-3.3-70b-versatile,meta-llama/llama-4-maverick-17b-128e-instruct,openai/gpt-oss-20b')
on conflict (key) do nothing;

-- ---------- vision limits, also config ----------
--
-- The incident these exist to prevent: an Instagram carousel save terminated the
-- worker isolate fourteen seconds after claiming its job. Base64-encoding a
-- multi-megabyte image is expensive, the edge runtime's CPU budget is finite, and
-- with a batch size above one the kill takes healthy jobs down with it.
--
-- The structural fix is in the function (vision now runs in its own sub-request,
-- so a CPU kill lands on an isolate holding nothing else). These are the dials
-- that decide how close it gets to the edge, and they belong somewhere they can
-- be turned down at three in the morning without a deploy.

insert into public.app_config (key, value) values
  ('vision.max_bytes',   '900000'),   -- per image, checked before and during download
  ('vision.max_slides',  '3'),        -- carousel slides examined per job, total
  ('vision.timeout_ms',  '20000')     -- how long the parent waits for one slide
on conflict (key) do nothing;
