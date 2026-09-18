# The 12-video human-review screening set

17 September 2026. Built by BRIEF-GTM-L on branch `gtm-benchmark`. **No AI call was made, no video was saved in the
app, no browser pane was used, and nothing here has been reviewed by a human yet.**

This closes the unpaid half of the readiness gate *"AI quality: human-reviewed diverse benchmark… No model ranking
from one five-exercise video."* The paid screen in
`/Users/simeon/Desktop/CLAUDE COWORK/Spotter Profitability Study 2026-09-17/EXPERIMENT-5-DOLLAR.md` remains **unrun**
and still blocked on experiment-only provider access. Its prerequisite — twelve reviewed videos with ground truth and
acceptable alternatives — is what this document and `tools/pack-eval/screening/` provide, so the owner's review can
start tonight and the screen can execute the day access exists.

## What was produced

| File | What it is |
|---|---|
| `tools/pack-eval/screening/SET.json` | 16 candidates: the 12 proposed videos (`selection: primary`) plus 4 spares (`alternate`), each with its oEmbed verification evidence |
| `tools/pack-eval/screening/<id>.truth.json` | 16 ground-truth **templates** in the golden fixture's shape, extended with the source-claim contract |
| `tools/pack-eval/screening/pumpy-cases.json` | 12 paired Pumpy cases (6 pairs) plus 1 spare, with synthetic attachment fixtures |
| this file | review protocol, verification table, review-time estimate, scorer gap list |

## How every candidate was verified

The handoff rule is *never trust a video ID from a search-result summary*. Every id below was confirmed with a `curl`
GET against the platform's own oEmbed endpoint, and the title and author recorded in `SET.json` are the bytes that
endpoint returned — not a description of them.

- TikTok: `GET https://www.tiktok.com/oembed?url=<url>`, then a second GET of the watch page to read
  `__UNIVERSAL_DATA_FOR_REHYDRATION__` → `webapp.video-detail.itemInfo.itemStruct` for duration, caption and
  `video.subtitleInfos` — the same structure `supabase/functions/spotter/index.ts:3430-3486` parses.
- YouTube: `GET https://www.youtube.com/oembed?url=<watch url>&format=json`, then a second GET of the watch page for
  `lengthSeconds`, `playabilityStatus`, `captionTracks` and the storyboard spec.

Three things that verification turned up, each of which changes how the screen must be run:

1. **TikTok oEmbed answers HTTP 400 for `/photo/` carousel URLs.** The same id under `/video/` answers 200 and returns
   the carousel's caption and author. That alias is how `tt-7640241369507728661` was verified, and it is recorded in
   its `SET.json` entry rather than smoothed over.
2. **TikTok ASR WebVTT is free and server-fetchable; YouTube captions are not.** Four TikTok tracks were fetched with
   `curl` (watch-page cookies, watch-page referer) and their real quotes and times are already in the truth templates.
   Every YouTube attempt — the watch page's own `captionTracks[].baseUrl`, `/api/timedtext`, `video.google.com/timedtext`
   — returned **HTTP 200 with 0 bytes**. So for the six YouTube entries the reviewer transcribes the doses by hand, or
   the arm gets its transcript from the device path or a paid ASR tier. **This asymmetry must be held constant across
   arms** or a TikTok-vs-YouTube difference will be read as a model difference.
3. **YouTube storyboard sheets are a real free frame source.** One level-3 sheet was downloaded to prove it
   (31 KB `image/webp`). Density varies and it is recorded per entry: `yt-vei81-bZhG4`, `yt-oMCGYCvoEx4`,
   `yt-GjH9z0gK77k` and `yt-OwfPwsgHZ9U` give 320×180 every 5 s; `yt-dYfpbRGVARM` and `yt-6zIaiaeWRWQ` top out at
   10 s spacing, and `yt-dYfpbRGVARM` only at 160×90. That is the evidence budget, and on the sparse ones it is the
   reason a boundary must come back as an interval.

### The 16 candidates

| id | category | slot | platform | duration | lang | creator | oEmbed HTTP | verified at | frame source | free text evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| tt-7653268094387014926 | spoken_multi_exercise | primary | tiktok | 2m 07s | en | FitDad (@austinhaslam) | 200 | 2026-09-17 21:59:55 UTC | tiktok-mp4 | TikTok ASR VTT fetched |
| yt-vei81-bZhG4 | spoken_multi_exercise | primary | youtube | 13m 48s | en | THENX (@OFFICIALTHENXSTUDIOS) | 200 | 2026-09-17 22:00:04 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |
| tt-7069099722740485381 | silent_overlay | primary | tiktok | 23 s | en | steph \| fitness & wellness (@stephaniebesna) | 200 | 2026-09-17 21:59:56 UTC | tiktok-mp4 | no ASR track published |
| tt-7640241369507728661 | silent_overlay | primary | tiktok | n/a | en | greek bro (@greek.bro) | 400 → alias 200 | 2026-09-17 21:59:57 UTC | carousel | carousel — no video |
| tt-7190755101852650798 | circuit_repeated_movements | primary | tiktok | 15 s | en | Tyler Kidd (@tkoprogramming) | 200 | 2026-09-17 21:59:58 UTC | tiktok-mp4 | no ASR track published |
| tt-7616358140472478979 | circuit_repeated_movements | primary | tiktok | 44 s | es | Alba Moreno (@albariciosa) | 200 | 2026-09-17 21:59:59 UTC | tiktok-mp4 | no ASR track published |
| tt-7389428760753327403 | subtle_grip_equipment | primary | tiktok | 88 s | en | Tyler (@tylerpath) | 200 | 2026-09-17 21:59:59 UTC | tiktok-mp4 | TikTok ASR VTT fetched |
| tt-7280848752666004769 | subtle_grip_equipment | primary | tiktok | 16 s | en | Ana Katic (@anakaticfitness) | 200 | 2026-09-17 22:00:00 UTC | tiktok-mp4 | no ASR track published |
| tt-7269956760260103470 | conflicting_dose | primary | tiktok | 34 s | en | Adam Gooch (@asgooch) | 200 | 2026-09-17 22:00:01 UTC | tiktok-mp4 | TikTok ASR VTT fetched |
| yt-dYfpbRGVARM | long_sparse | primary | youtube | 30m 47s | en | BIGSIS Workout (@bigsisWorkout) | 200 | 2026-09-17 22:00:05 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |
| yt-oMCGYCvoEx4 | non_english | primary | youtube | 9m 24s | hi | Gaurav Jha Fitness (@gauravjhafitness) | 200 | 2026-09-17 22:00:06 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |
| tt-7622396641227656462 | fast_cut_occluded | primary | tiktok | 35 s | en | matttralli5 (@matttralli5) | 200 | 2026-09-17 22:00:02 UTC | tiktok-mp4 | TikTok ASR VTT fetched |
| tt-7473139273915501866 | silent_overlay | alternate | tiktok | 17 s | en | omar.fit_ (@omar.fit_) | 200 | 2026-09-17 22:00:03 UTC | tiktok-mp4 | no ASR track published |
| yt-GjH9z0gK77k | non_english | alternate | youtube | 12m 32s | es | gymvirtual (@gymvirtual) | 200 | 2026-09-17 22:00:08 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |
| yt-OwfPwsgHZ9U | spoken_multi_exercise | alternate | youtube | 11m 47s | en | Jessica Valant (@Jessicasvalant) | 200 | 2026-09-17 22:00:08 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |
| yt-6zIaiaeWRWQ | long_sparse | alternate | youtube | 36m 18s | en | MadFit (@MadFit) | 200 | 2026-09-17 22:00:10 UTC | youtube-storyboard | storyboard sheets; captions NOT server-fetchable |

All 16 are distinct creators, which satisfies the experiment doc's "there must be 12 distinct sources" even after the
owner drops four. Category coverage of the twelve primaries is exactly the doc's quota: two spoken multi-exercise, two
silent/overlay, two circuits with repeated movements, two subtle grip/equipment variations, one conflicting dose, one
long/sparse, one non-English, one fast-cut/occluded.

### Verified but not selected, and one rejection

- `https://www.youtube.com/watch?v=XohXs-8PQMc` (Penny Barnshaw, 34 min, timers only) passed oEmbed with HTTP 200 but
  the watch page answers `"playabilityStatus":{"status":"UNPLAYABLE"}` from this host, with no caption tracks and no
  storyboard spec. **Rejected**: an entry whose frames cannot be fetched cannot be an evidence-conditioned test case.
  It is a good example of why oEmbed alone is not sufficient verification.
- `https://www.tiktok.com/@isatnmlachi/photo/7618322223538998550`, the carousel referenced by `tools/media-harness.ts:164`,
  verifies fine — and its oEmbed title shows it is fan-fiction content, not a workout. **Rejected on content**, and a
  second reminder that a URL sitting in the repo is not a fitness fixture.
- `https://www.youtube.com/watch?v=kk1rnldcPPE` (Sunny Health & Fitness) verifies fine but is a manufacturer-owned
  channel. **Not selected**: the brief asks to flag anything that looks like paid-program content, and a brand channel
  demonstrating its own equipment is that in substance even without a disclosure overlay.
- `https://www.tiktok.com/@matttralli5/video/7441704058424921387` and
  `https://www.tiktok.com/@tylerpath/video/7226897278231907627` both verify and both fit their categories, but each
  duplicates a creator already in the set. **Not selected**, to keep the split by creator family clean.

### Credit, consent and what is not in this repo

Every selected post is public and is referenced by URL only. No media, and no full transcript of anyone's video, is
copied into this repo: the truth templates reproduce only the short dose-bearing and structure-bearing lines a reviewer
needs to check a claim, with their real times. The complete fetched TikTok tracks stay in the session scratchpad at
`/private/tmp/claude-501/-Users-simeon-Desktop-CLAUDE-COWORK/f83e3c45-9ece-4ff1-96cf-c461f42dfdcd/scratchpad/vtt/`.
Each entry records the creator handle and a credit line so consent can be handled before any published result names a
creator. `paid_program_flag` is set from caption text and the absence of a YouTube paid-promotion overlay only — it is
a screen, not a clearance.

## Review protocol

### Order of work

1. **Freeze before you look.** Read this protocol and the twelve `*.truth.json` files first. Anything written after a
   model output has been seen is a post-hoc adjustment, and EXPERIMENT-PLAN.md §6 requires a new holdout for one of
   those. In particular `acceptable_canonical_ids` must be written before any prediction is read.
2. **Watch each video once, end to end, without writing.** Then a second pass for the occurrence list, a third for
   attributes and boundaries.
3. **Occurrences in chronological order**, including repeats and both sides. A repeated demonstration is a separate
   occurrence even when the name matches. Number them `i: 0,1,2…` in order.
4. **Attributes to the specificity the source supports and no further.** Equipment, hand/foot support, grip, side,
   stance, load position, movement phase. "Unresolvable from source" is an allowed answer and is the right one more
   often than it feels like. A nearby kettlebell is not proof the hands touch it.
5. **Creator dose by field**, with the exact quote, its time, its scope, and whether it was said, written or both. A
   conflict between two sources is recorded as a conflict, not resolved by picking the likelier number.
6. **Visible count only where continuous evidence supports it.** Otherwise `unknown`. Never derive it from the
   prescribed reps, and never from a creator counting out loud — `tt-7269956760260103470` is in the set precisely
   because its transcript is somebody counting reps.
7. **Boundaries as intervals.** Record `t0`/`t1` as the boundary you would accept plus `uncertainty_s`, and state the
   convention you used (title card, setup, first movement) once, at the top of your notes, before the first video.
8. **Second reviewer, then adjudication.** EXPERIMENT-PLAN.md §3 asks for two independent reviewers on critical
   exercise/variation/dose/timestamp facts, adjudicated **before model identities are revealed**. If only one reviewer
   is available, say so in the results and treat every single-reviewer field as lower confidence — do not silently
   present it as adjudicated.

### Blinding

Review is blind to model and to cost. Store outputs under opaque labels (`arm-1 … arm-4`), keep the
label-to-configuration map out of the review file, and **store acceptable alternatives and adjudication notes before
computing any ranking**. Per EXPERIMENT-5-DOLLAR.md: "Review disagreements blind to model/cost; store acceptable
alternatives and adjudication notes before computing rankings." Do not let one arm see extra evidence retrospectively;
that is a different architecture and must be charged and reported as one.

### How to record acceptable alternatives

Three lists per occurrence, all written before any output is read:

- `canonical_id` — the single best catalog id, or `null`. `null` is correct when no catalog entry fits;
  `supabase/functions/spotter/catalog.ts` maps an unmatched name to null on purpose, because a wrong id silently
  merges two different lifts' personal records.
- `acceptable_canonical_ids` — every id that should score as correct, **including** `canonical_id` itself. This is the
  field the brief calls `acceptable_alternatives`; it is written under the name `tools/pack-eval/score.ts:53` already
  reads, so a reviewer's decision here actually changes a score instead of sitting inert in a file. Family-only answers
  go here when the subtype is unresolvable. From EXPERIMENT-5-DOLLAR.md: "do not require a diamond-push-up ID for any
  close-grip push-up."
- `variation_notes` — the conflations that are **not** acceptable, in words, with the reason. An unresolved subtle
  attribute is excluded from exact-subtype scoring but still counts as an ambiguity-handling test, and its
  exercise/equipment/attribution outcomes still count.

Negated words never become claims. "Use a kettlebell, not a barbell" is one equipment claim, kettlebell; `barbell` is
not a positive observation and not a second exercise.

### Critical correction — the definition, verbatim

From `/Users/simeon/Desktop/CLAUDE COWORK/Spotter Profitability Study 2026-09-17/CEO-OPERATING-PLAN.md`, Gate 2:

> Define critical correction before review: missing/invented exercise, wrong equipment or materially different
> variation, wrong creator dose, or a workout that cannot be used as presented. Minor wording changes are separate.
> Supported-input boundaries must be shown to users and fixed before measurement; do not exclude failures after seeing
> the outcome.

Use that wording, not a paraphrase, when classifying a defect. Minor wording is counted and reported separately and
never rolled into the critical-correction rate.

## Estimated owner review time

`EXPERIMENT-5-DOLLAR.md` budgets "approximately 2–4 hours for the screen plus adjudication". Bottom-up against the
footage that is actually in the set, one reviewer, screening depth (occurrence list, dose with provenance, equipment
and variation, boundary interval — not full golden-fixture prose):

| Group | Entries | Footage | Per entry | Subtotal |
|---|---|---|---|---|
| Short TikTok, ≤60 s | 6 | 167 s | ~12 min | 72 min |
| Longer TikTok, 60–130 s | 2 | 215 s | ~18 min | 36 min |
| Photo carousel | 1 | 6 slides | ~10 min | 10 min |
| YouTube, 9–14 min | 2 | 1392 s | ~45 min | 90 min |
| YouTube, 31 min, ~30 distinct movements | 1 | 1847 s | ~75 min | 75 min |
| **Twelve primaries, first pass** | **12** | **~60 min of footage** | | **~4 h 43 min** |

So the honest number is **4.5–5.5 hours for a single first pass over the twelve**, not 2–4. The gap is concentrated:
3,239 of the set's 3,621 seconds sit in three YouTube entries. A second reviewer doubles the first-pass cost;
adjudicating two passes adds roughly 1–1.5 hours on top.

**To land inside the 2–4 hour budget**, use a declared-window protocol instead of cutting videos:

- Review the nine TikTok entries and the carousel in full — about **2 hours**, and that is ten of the twelve.
- For the three long YouTube entries, declare a contiguous window **before watching** (a 5-minute window on
  `yt-vei81-bZhG4` and `yt-oMCGYCvoEx4`, and two 5-minute windows on `yt-dYfpbRGVARM` to catch its no-repeat spread),
  review only that window, and record the window in the truth file as the evidence scope — about **1–1.5 hours**.
- **Total ≈ 3–3.5 hours.** Every arm is then given exactly the declared window, and the un-reviewed remainder is
  excluded from recall denominators rather than counted as a miss. This is a legitimate evidence scope under
  EXPERIMENT-PLAN.md §3's "evidence sufficiency under each sparse representation", but only if the window is declared
  before any output exists and is reported alongside the numbers.

Pumpy: the twelve paired cases in `pumpy-cases.json` carry pre-registered expectations, so review is checking against a
written expectation rather than forming one — **about 45 minutes** for all twelve.

## Scorer gap list — `tools/pack-eval/score.ts`

**Nothing in the scorer was changed.** This is what it would have to gain to score this set. Line numbers are against
this worktree's `tools/pack-eval/score.ts` (882 lines).

### 1. Acceptable alternatives — supported for ids, absent everywhere else

- **Works today.** `FixtureExercise.acceptable_canonical_ids` (line 53) is consulted when aligning
  (line 296) and when checking the matched exercise (line 565); `CardExpectations.acceptable_canonical_ids`
  (line 74) is consulted for the card's own ids (line 640). Id-level alternatives need no change, which is why the
  truth templates use this exact field name.
- **Gap.** Equipment is exact sorted-array equality (lines 534, 539) with no way to say "either list is acceptable".
  `hand_placement`, `surface` and `load_position` go through word-overlap `coverage()` (lines 145, 543-551) and are
  **printed, never failed** — so a wrong grip cannot fail a build no matter how wrong it is. `provenance` is exact
  equality on every key (line 596).
- **Should change:** add `acceptable_equipment: string[][]` and a per-attribute acceptable list; give the attribute
  overlaps a failing threshold; and let an attribute the reviewer marked unresolvable be *skipped* rather than scored
  as 0 overlap. Six of the twelve primaries turn on a grip or support detail.

### 2. `unknown` demonstrated reps — half supported

- **Works today.** A null `reps_seen` is skipped, not failed (line 577 guards on `typeof fx.reps_seen === "number"`),
  consistent with the file's own rule 2 (lines 23-26): unknown is not the same as wrong.
- **Gap, and it is the important half.** There is no check that fails a pack which **asserts** a count where the truth
  says unknown. EXPERIMENT-PLAN.md §5 lists "unsupported count assertions" as its own metric. Today a pack can put
  `reps_seen: 5` on a video nobody counted and score clean — and `tt-7269956760260103470`'s transcript is a creator
  counting reps out loud, which is exactly the input that produces that failure.
- **Also.** `reps_prescribed` is strict numeric equality (line 572). It cannot express a range, a unit, `per_side`, or
  `to_failure` — all of which reader-v2's `value` object carries and all of which this set contains: the
  `4-8-12-16-20` ladder in `tt-7616358140472478979`, the `:30` hold in `tt-7653268094387014926`, and "each side" on
  five occurrences of `tt-7622396641227656462`.
- **Should change:** add `reps_seen_must_be_unknown` (or treat `reps_seen: null` in the fixture as an assertion that
  the pack's value must also be null), and replace the scalar `reps_prescribed` with the reader-v2 `value` shape.

### 3. Negation — literal, English-only, and wired to one check

- **Works today.** `hasAffirmedPhrase` (lines 436-448) exempts a mention negated by not/no/without/rather than/instead
  of within the five preceding tokens. Its own docstring is honest that it is not a semantic judge.
- **Gap.** It is called from exactly one place, the `must_not` loop (line 684). A negation in the **source** that
  should suppress an equipment claim in the pack's own `variant.equipment` is not covered at all: that comparison
  (lines 534-539) only sees the fixture's list, so a "not barbell" false positive fails only if the fixture author
  happened to write a `must_not` rule for it. The tokens are also English-only — `yt-6zIaiaeWRWQ` says "NO EQUIPMENT",
  but a Spanish "sin material" or a Hindi "बिना" would slip through silently on `tt-7616358140472478979` and
  `yt-oMCGYCvoEx4`.
- **Should change:** derive a forbidden-equipment list from negated source phrases and check it against
  `variant.equipment` directly; extend the negation tokens per fixture language. Until then, every screening fixture
  in a negation category must carry an explicit `must_not` rule, and the templates say so.

### 4. Interval timestamps — not supported at all

- **Today.** `t0`/`t1` are scalars (lines 56-57) compared with `Math.abs` against a single global
  `TIMESTAMP_SLACK_S = 1.5` (lines 194, 554-555, 559-568). There is no per-exercise uncertainty, no accepted interval,
  and no way to say "the boundary is unknown but lies between a and b".
- **Why it matters for this set.** A fixture that honestly cannot pin a boundary must write `null`, and a null drops
  that exercise out of the timestamp tally entirely (the `typeof fx.t0 === "number"` guard, lines 554-555). So the
  videos where timestamps are hardest — `yt-dYfpbRGVARM` at 10 s / 160×90 storyboard sampling, and the 35 s montage
  `tt-7622396641227656462` — would contribute *least* to the timestamp statistic. That is the exclusion bias
  EXPERIMENT-5-DOLLAR.md explicitly warns against: "Report timestamp errors only alongside missed-exercise counts and
  interval uncertainty so exclusions cannot improve scores."
- **Should change:** accept `t0`/`t1` as `{earliest, latest}` — reader-v2 already defines that `interval` shape — or as
  a scalar plus `uncertainty_s`; score distance to the accepted interval rather than to a point; and print the count of
  unbounded boundaries next to the median/p90 so an exclusion is visible.

### 5. Occurrence alignment ignores time and order

- **Today.** `align()` (lines 289-309) takes the **first free** pack exercise whose canonical id is acceptable, then
  falls back to name matching. Nothing consults `t0` or ordering.
- **Gap.** With repeated movements — both circuit entries, and the three same-named push-ups in the Pumpy `VARIANTS`
  fixture — round 1's clean can pair with round 2's clean and the report will still say zero missing.
  EXPERIMENT-PLAN.md §5: matching "should maximize compatible occurrence matches using human-approved
  families/variants, time, and order".
- **Should change:** among acceptable candidates, break ties by smallest `|t0 difference|`.

### 6. Source claims are not scored at anything

- **Today.** The `Fixture` type (lines 79-90) has no `source_claims`, no per-field provenance and no conflict status.
  `scoreProvenance` (line 470) only checks that a card built from an unavailable visual makes no visual claim — a real
  and valuable check, and the reason `tt-7640241369507728661` is marked `visual: "unavailable"`. Per-exercise
  `provenance` is a flat string map compared by equality (line 596).
- **Gap.** Prescribed-dose accuracy and attribution error — two of the metrics EXPERIMENT-PLAN.md §5 requires — have no
  scorer. Every `prescribed`, `source_claims` and `conflict` field in these sixteen templates is read by a human today
  and by nothing else.
- **Should change:** this is the largest piece of work in the list and it is the one the CEO plan already assigns
  ("Extraction owner: build the source-claim contract and repair the scorer alongside it"). It should be done **with**
  the contract, not bolted on after.

## What was verified, and what was not

Verified: all 16 ids exist and are public (oEmbed HTTP and returned title/author recorded per entry, timestamps in
`SET.json`); durations, caption text, TikTok subtitle-track availability, YouTube caption-track listing, playability
and storyboard specs (second GET of each watch page); four TikTok ASR WebVTT tracks actually downloaded; one YouTube
storyboard sheet actually downloaded; YouTube timedtext returns 0 bytes to a server on three separate endpoints;
`deno run --allow-read tools/pack-eval/score-test.ts` 40/40, `offline.ts` 3/3 fixtures, `fidelity-test.ts` 32/32 — all
after the new folder existed, and `offline.ts` reads only `tools/fixtures/eval/` (line 34), so
`tools/pack-eval/screening/` is not picked up by any eval tool.

Not verified: **nobody has watched any of these videos.** `has_speech` is a labelled guess from whether the platform
published an ASR track. Whether on-screen overlay text exists, what it says, what exercises are performed, in what
order, how many times, with what grip — all unknown, all `TODO_REVIEW`. The category fit of each candidate is an
inference from its caption and transcript text and is itself something the first review pass should confirm or reject;
that is what the four alternates are for.
