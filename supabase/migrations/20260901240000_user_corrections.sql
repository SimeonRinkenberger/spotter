-- Spotter — user corrections as structured data.
--
-- Confidence scoring landed in the previous migration, and its weights are
-- declared rather than tuned, because there is nothing to tune them against. A
-- correction is the missing half: the model said "3 x 12 Bulgarians", the user
-- changed it to "3 x 10", and that pair is one labelled example. Enough of them
-- and the Phase 2 gate stops being an argument and becomes a measurement.
--
-- Three properties this table is built for:
--
--   1. It is a log, not a state. The workout row already holds the current value;
--      what is worth keeping is the *transition*, with everything needed to group
--      it later — platform, field, the model that produced the original, and the
--      score that model earned on that card at the moment it was corrected. None
--      of those can be reconstructed after the fact: reprocess overwrites
--      extracted_by and confidence in place.
--   2. It is per-user data with owner-only reads. Corrections say what someone
--      trains and how often they disagree with the machine; that is theirs.
--   3. It never feeds back into video_cache. One user editing their copy must not
--      rewrite the card every other user receives. Using corrections in aggregate
--      to improve extraction is a Phase 2+ decision and deliberately not this one.

create table if not exists public.corrections (
  id bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Which card, and which video. set null rather than cascade: deleting a saved
  -- workout should not delete the evidence that the extractor got it wrong, and
  -- the shortcode below still identifies the video. Corrections do go when the
  -- account goes, via user_id.
  workout_id uuid references public.workouts(id) on delete set null,
  shortcode  text,
  platform   text,

  -- edit  — a field of an existing exercise changed
  -- add   — the user supplied an exercise the extractor missed entirely
  -- delete— the user removed something that is not a real exercise
  --
  -- add and delete are the two most informative kinds and the easiest to lose:
  -- neither leaves a trace in the card afterwards.
  kind  text not null check (kind in ('edit', 'add', 'delete')),
  -- 'exercise' for a whole-exercise add or delete; otherwise the field that moved.
  -- Constrained on purpose — a typo'd field name would silently split the very
  -- grouping this table exists to support. Widening it later is one alter.
  field text not null check (field in ('name', 'sets', 'reps', 'duration_seconds', 'exercise')),

  -- model output -> user correction, as scalars, so the interesting question is a
  -- group by rather than a jsonb walk. Null on the side that did not exist.
  old_value text,
  new_value text,

  -- Name normalization is a distinct failure mode from bad sets and reps: the
  -- model can name the movement perfectly and still miss the catalog, and it can
  -- also produce a name that matches the wrong catalog entry. Recording the
  -- canonical id either side separates "the extractor read it wrong" from "the
  -- catalog could not place it".
  old_canonical_id text,
  new_canonical_id text,

  -- The complete exercise object either side. The scalars above answer the
  -- grouping questions; this is what an evaluation harness replays.
  old_exercise jsonb,
  new_exercise jsonb,

  -- Where in the card. Nullable so a future card-level correction (category,
  -- title) fits the same table without a shape change.
  block_index    int,
  exercise_index int,
  -- Denormalized so a correction reads without joining back to a workout row that
  -- has since been edited again, or deleted.
  exercise_name  text,

  -- The state of the extraction at the moment it was corrected. This is the part
  -- that cannot be recovered later.
  extracted_by      text,
  confidence        numeric(4,3),
  evidence_source   text,
  evidence_verified boolean,
  card_version      int
);

create index if not exists corrections_user_time on public.corrections (user_id, created_at desc);
-- The Phase 2 question, indexed: where do corrections cluster.
create index if not exists corrections_cluster   on public.corrections (platform, field, kind);
create index if not exists corrections_shortcode on public.corrections (shortcode);

-- ---------- row level security ----------
--
-- Reads are owner-only, the same rule as workouts. Writes have no policy at all,
-- which means only the service role can insert: corrections are written by the
-- edge function, because it is the only place that can see the value the model
-- actually produced and resolve a corrected name against the catalog. A client
-- allowed to insert directly could also fabricate the labelled set, and this
-- table's entire worth is that it is a faithful record.

alter table public.corrections enable row level security;

do $$ begin
  create policy "own corrections select" on public.corrections
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

revoke insert, update, delete on public.corrections from authenticated, anon;

-- ---------- reporting ----------
--
-- "Where do corrections cluster — which platform, which field, which confidence
-- band, which model." That sentence is the whole point of the table, so it gets
-- to be one select rather than a hand-written aggregate each time.
--
-- The bands are the product's own thresholds, not arbitrary quantiles: below 0.45
-- the detail sheet shows a strong caveat, below 0.70 a quiet one, above it says
-- nothing. If corrections cluster in the band where the UI stays silent, the
-- weights are wrong in a way that matters to users — which is exactly the finding
-- this view exists to surface.

drop view if exists public.correction_hotspots;
create view public.correction_hotspots
with (security_invoker = on) as
select
  platform,
  field,
  kind,
  case
    when confidence is null  then 'unscored'
    when confidence < 0.45   then 'low (<0.45)'
    when confidence < 0.70   then 'mid (0.45-0.70)'
    else                          'high (>=0.70)'
  end                                        as confidence_band,
  extracted_by,
  count(*)                                   as corrections,
  count(distinct workout_id)                 as cards,
  count(distinct shortcode)                  as videos,
  -- A correction on an exercise whose evidence WAS located and verified is the
  -- expensive kind: the score said this one was checkable and it was still wrong.
  count(*) filter (where evidence_verified)  as despite_verified,
  round(avg(confidence), 3)                  as avg_confidence,
  max(created_at)                            as last_seen
from public.corrections
group by 1, 2, 3, 4, 5
order by corrections desc, platform, field;

-- save_health gains the denominator side of the same question. Corrections
-- counted on their own mislead: a platform with more saves collects more
-- corrections without being any worse. Saves and corrections belong on one row.
drop view if exists public.save_health;
create view public.save_health
with (security_invoker = on) as
with s as (
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
  group by 1, 2
), c as (
  select
    platform,
    date_trunc('day', created_at) as day,
    count(*)                      as corrections,
    count(distinct workout_id)    as cards_corrected
  from public.corrections
  where platform is not null
  group by 1, 2
)
select
  s.*,
  coalesce(c.corrections, 0)     as corrections,
  coalesce(c.cards_corrected, 0) as cards_corrected
from s left join c using (platform, day);

-- weak_cards is "which cached cards are worth re-running when a better model
-- appears". A card users keep correcting is worth re-running whatever it scored,
-- so corrections join the ordering and widen the filter. This reads corrections
-- in aggregate for triage; it does not write anything back into video_cache.
drop view if exists public.weak_cards;
create view public.weak_cards
with (security_invoker = on) as
select
  vc.shortcode,
  vc.platform,
  vc.confidence,
  vc.extracted_by,
  vc.v as card_version,
  jsonb_array_length(coalesce(vc.card -> 'blocks', '[]'::jsonb)) > 0 as has_blocks,
  coalesce(c.corrections, 0) as corrections,
  coalesce(c.correctors, 0)  as users_correcting,
  vc.updated_at
from public.video_cache vc
left join (
  select shortcode, count(*) as corrections, count(distinct user_id) as correctors
  from public.corrections
  where shortcode is not null
  group by shortcode
) c on c.shortcode = vc.shortcode
where vc.confidence is null or vc.confidence < 0.55 or coalesce(c.corrections, 0) > 0
order by coalesce(c.corrections, 0) desc, vc.confidence nulls first, vc.updated_at;
