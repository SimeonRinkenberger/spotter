# Spotter

Save a fitness video from TikTok, Instagram or YouTube. Spotter reads the exercises, sets
and reps out of the caption, gives you a real workout card, then walks you through it one
move at a time and logs what you lifted.

**Live app:** https://simeonrinkenberger.github.io/spotter/

<img src="docs/icon.png" width="88" alt="">

## What it does

- **Save** — paste a link, share to Spotter from Android's share sheet, or, on iPhone, run a
  one-step Shortcut until the native share extension ships.
- **Extract** — the caption or description becomes a structured card: title, workout type,
  muscle groups, equipment, difficulty, duration, and exercise blocks with sets, reps,
  rest and circuit rounds.
- **Train** — full-screen Workout Mode, one exercise per screen, screen kept awake, with
  set-by-set logging of reps and weight (prefilled from the last time you did that move).
- **Plan** — drop saved workouts onto a week and see which days you actually trained.
- **Track** — weekly volume, per-exercise personal records (estimated 1RM), muscle-group
  balance, an anatomical muscle map of what you hit this week, and every logged session.
- **Organise** — favourites, and collections a workout can sit in several of ("Leg day",
  "Hotel gym", "Quick 10 min"). Rename any card.
- **Swap or modify** — no equipment, station busy, or it hurts: alternatives with an honest
  trade-off each, or ways to modify the movement and what to build up. Never a diagnosis.
- **Pumpy, the coach** — builds a workout from what you have saved and what you ask for,
  adds to one you have, plans your week, and says where something fits. It shows you every
  change and waits for you to confirm it.
- **Your account** — Settings is a grouped list: Account, Preferences, Save from your phone,
  Data & privacy, About. Change your name, your password and your email address; sign out from
  the first screenful; export everything you put in as one JSON file; delete the account and
  everything in it from inside the app. A forgotten password is reset by email from the sign-in
  card.

## Architecture

Two moving parts, no build step and no bundler.

```
Browser (GitHub Pages, docs/index.html)
  ├── supabase-js ──► PostgREST      reads + simple writes, protected by per-user RLS
  ├── supabase-js ──► Realtime       this user's OWN workouts rows, filtered by user_id
  └── fetch ────────► Edge Function  ingest, re-extract, AI helpers (needs secrets)
                        │
                        ├─ POST /api/ingest ──► enqueue, return in ~200ms
                        ├─ POST /api/worker/tick ──► claim jobs, extract in the background
                        │    └──► Instagram / TikTok / YouTube, then Gemini → Groq
                        ├─ POST /api/worker/vision ──► one carousel slide, own isolate
                        └─ POST /api/worker/probe ──► one-off measurement, wired into nothing

pg_cron ──every minute──► pg_net ──► /api/worker/tick     (backstop for a lost kick)
pg_cron ──every 5 min───► sweep_ingest_jobs()             (unstick a dead worker)
```

The frontend talks to the database directly under row-level security, so the edge function
only holds what genuinely needs a service role or an API key. Every user-owned table has a
`user_id` and owner-only policies; `video_cache` and `saves_log` have RLS on with **zero**
policies, making them reachable only from the function.

**Saves are asynchronous.** `POST /api/ingest` writes a pending `workouts` row plus a job
and returns in about 200ms; a worker claims the job with `FOR UPDATE SKIP LOCKED` and fills
the row in, and the browser picks up the finished card over Realtime. Extraction takes
10-80 seconds depending on the platform, and none of it is spent holding an HTTP request
open. A partial unique index on `ingest_jobs (shortcode) where status in ('queued','running')`
means a thousand people saving the same reel at the same moment produce **one** extraction.
Failures retry on a backoff and then dead-letter, which surfaces as a retryable card rather
than one that spins for ever. Cache hits skip the queue entirely and come back finished.

**Shared extraction cache.** Extractions are cached globally by video ID. The first person
to save a video pays for the scrape and the AI call; everyone after that gets the same card
instantly and for free. This is the main thing that makes a public app affordable on free
tiers.

**Controlled exercise names.** The model proposes a free-form exercise name; `catalog.ts`
maps it to a stable `canonical_exercise_id` from a seeded catalog (exact match, then alias,
then weighted token overlap above a confidence floor — no AI). The raw name is kept and
shown; the id is what the weight prefill and personal records group by, so "DB Bulgarians"
and "Bulgarian Split Squats" are one exercise rather than two. A name that does not clear
the floor gets a null id rather than a wrong one.

**Evidence, and a confidence score computed from it.** Every extracted exercise records
where it came from — caption, YouTube description, a chapter timestamp, or a carousel slide
read by vision — and, where the source has positions, the line and character offset. The
model is asked for a verbatim quote from the source; `evidence.ts` then checks whether that
quote is actually there, so an unfindable claim lowers the score instead of propping it up.
The card's `confidence` is a weighted function of five checkable things: does every exercise
carry evidence, do the sets and reps appear in the source text, do two independent readers
agree on the exercise count, does every name map to the catalog, and does the prescription
add up to the stated length. **No model is ever asked how sure it is.** The score and its
components are stored on the card, on the user's row and in `saves_log`, so
`select * from save_health` answers "how good are our extractions, by platform" without
re-running anything.

Evidence also does work rather than only being recorded: a caption reading "45 secs" against
a card claiming `duration_seconds: 2700` is corrected to 45 on the authority of the line it
was traced to, and an implausible duration the source cannot explain is dropped rather than
clamped to a smaller wrong number.

**Chapters are evidence, never a tier.** A YouTube description carrying `0:00 Warm up /
1:30 Goblet Squat` is parsed and handed to the extractor as a clearly-labelled source, with
each exercise's timestamp recorded. A card whose exercises trace *only* to chapter lines is
capped below the gate, because "Intro / Warm up / Outro" reads as a perfectly plausible
workout and is not one. The cap is not enough on its own — a distrusted card still lists
those headings as movements to perform — so an exercise that traces to a chapter line, is
named like furniture (`Warm up`, `Workout`, `Cool Down & Stretch`, `Outro`) and carries no
sets, reps or duration of its own is deleted rather than scored, and the count lands in the
card's components as `dropped_chapter_junk`. Anything written out in real caption or
description text is left alone however it is named: "Warm up set 3x10" is an instruction. The
one exception is the title line — the text handed to the matcher is `title + description`, so
a video called "20 MINUTE WORKOUT" would otherwise let the heading "Workout" cite the title
and survive as the card's only exercise.

**A reprocess never lowers the score either.** When a re-run comes back thinner, the merge
pulls blocks forward from the saved card — and blocks saved before evidence existed carry
none, so re-scoring them would measure the schema they were written under rather than the
card. The saved score is kept in that case (`merge_kept_old_score`), a card that predates
scoring stays unscored rather than being given a number, and where the old blocks do carry
evidence the better of the two scores wins.

**Vision runs in its own isolate.** Reading a carousel slide means base64-encoding an image,
which is expensive enough to exhaust the edge runtime's CPU budget — it killed a worker in
production, and with `WORKER_BATCH > 1` that kill takes healthy jobs down with it. The
worker now POSTs one slide at a time to `/api/worker/vision` on the same function, which is
a separate isolate with its own budget: if it dies, the parent sees a failed request, treats
it as "no workout on this slide", and its batch-mates never notice. Images are capped at
`vision.max_bytes` (900KB), enforced against `content-length` *and* while streaming, and
per-slide progress is checkpointed on the job so a retry resumes rather than repeats.

**Model ids live in `app_config`, not in code.** Gemini 2.0 was retired in June 2026 and 2.5
goes in October: a retirement should be an `update` statement, not a deploy. Precedence is
`app_config` > environment variable > compiled-in default, refreshed every five minutes, and
every lookup falls back rather than failing. `video_cache.extracted_by` records which model
produced each card, and `select * from weak_cards` lists the ones worth re-running when
something better ships.

**No fetching private addresses.** Every outbound request derived from a user link goes
through `net.ts`, which rejects loopback, link-local, RFC1918 and literal-IP hosts and
re-checks after **every** redirect hop.

**Collections, not folders.** `collections` and `collection_items` are per-user with
owner-only policies; a workout can be in any number of them and the membership insert
policy checks that both the collection and the workout belong to the caller. Renaming a
card is a plain PATCH on `workouts.title` under RLS; a trigger records it in `corrections`
(kind `rename`) with the title that was actually stored, and only when the updating
identity is the row's owner — a reprocess rewriting the title as the service role is not a
correction.

**The body diagram trusts only the catalog.** The front and back silhouettes are inline SVG
whose regions are keyed to the same twelve muscle groups the catalog uses. What lights up
is computed from `exercise_catalog.muscle_groups` through each exercise's `canonical_id`,
never from the card's free-text muscle list and never from a name, so a movement the
catalog does not know highlights nothing and the card says how many were left out.

**The demonstration is somebody's video, not a drawing.** The Explain sheet used to show a
CC-BY-SA line illustration from the wger catalog; a still frame cannot show a movement, so it
now offers a short YouTube clip instead. `POST /api/demo-video` answers from
`exercise_demo_videos` first: a curated shelf of demonstrations harvested from an allow-list of
fitness creators who publish plain per-exercise footage (`DEMO_CHANNELS` in `index.ts`,
`tools/demo-sources.json` for the seed tool), keyed by `canonical_id`, ordered by tier then rank
and returned four deep — the first as `video`, the rest as `alternates`, so the sheet can offer
the same movement filmed by somebody else. That path spends no quota, charges no helper and
writes nothing. Only a movement the shelf does not cover falls through to `exercise_videos` and
then to the YouTube Data API (`search.list`, embeddable and syndicated only, short, safe-search
strict, ten results, allow-listed channels preferred and clickbait titles demoted). That cache
is why the fallback is affordable: `search.list` costs 100 units of the free 10,000/day quota
against `videos.list`'s 1 — and since June 2026 has its own 100-calls-a-day ceiling — so an
uncached lookup budget is a hundred sheet opens a day for the entire project. A hit is kept
forever, a miss for seven days, and an uncached lookup is metered on the same `LIMIT_HELPER`
ceiling as `/api/explain`. The sheet leads with the creator's name and the clip length, shows a
facade — thumbnail plus play mark — and only builds the `youtube-nocookie` iframe when it is
tapped (with `loop=1&playlist=<id>` for clips of 45 s or less), tearing it down when the sheet
closes; under it a chip row swaps between the alternates with no network, and a "More on
YouTube" row links to the search, which is what the sheet offers when nothing was found. The
`demo_*` columns, the `demos` bucket and `tools/map-demos.mjs` are still there but nothing reads
them.

**The clips come from a short list of creators, not from search.** `search.list` has been capped
at 100 calls a day for the whole project since June 2026, and what it ranks first is a lottery, so
the demonstrations are a curated allow-list: eight channels that publish plain, per-exercise
footage — Renaissance Periodization and Functional Bodybuilding first, then Catalyst Athletics,
CrossFit, T-Nation and MuscleWiki, then Bodybuilding.com and Jeff Nippard — enumerated keylessly
from the owner's own machine by `tools/demo-videos.mjs` and matched to canonical catalog ids
offline, so a lookup at request time is one index scan and no quota. Only two things become a clip
without a person: a title that IS a catalog name or alias, and a title that contains one as a whole
phrase with nothing but neutral words ("standing", "cable", "machine") left over. Everything else —
"Wide Grip Bench Press", "Machine Glute Kickback" — goes to `tools/demo-videos-review.json` to be
confirmed or rejected by hand, and those decisions survive re-runs. Today that is 378 clips over
168 of the 224 catalog ids; the misses are cardio machines and yoga, which nobody on the list
demonstrates. Adding a creator is one entry in `tools/demo-sources.json` and one
`node tools/demo-videos.mjs run`, which refreshes the committed snapshots under
`tools/demo-videos/` and regenerates the seed migration.

**Substitutions carry a reason.** `POST /api/swap` takes `reason` (`no_equipment`,
`station_busy`, `pain`) and, for pain, a `body_area`. Candidates come from the catalog —
movements sharing a muscle group, filtered by the equipment to hand, or the muscles that
build up the sore area — and every suggestion is resolved back to a `canonical_id`. Pain
answers are modifications plus what to strengthen; the prompt forbids a diagnosis, a filter
drops any line that names one anyway, and the not-medical-advice line is written by the
server rather than left to the model.

**Pumpy runs server-side, over the user's own rows, and never writes without a confirm.**
The coach goes through the same `textGenerate()` front door as extraction, so it uses Luna
when the key exists and the free chain otherwise, under the same spend ceiling. Tool calling
is a JSON protocol on top of plain generation — the model answers `{say, tool, proposal}`,
tool results are appended to the transcript and the model is asked again, a few times at
most — which keeps every provider in the ladder usable. Each tool (`list_library`,
`get_workout`, `search_catalog`, `get_plan`, `get_logs_summary`) puts the caller's user id
in its query. Writes come back as a validated proposal (`create_workout`,
`append_exercises`, `plan_days`) that the user confirms in the app; only
`POST /api/pumpy/confirm` executes it, and a tool row in `pumpy_messages` records what ran.
A Pumpy-made workout carries `extracted_by: pumpy:<model>`; exercises it appends land in
`corrections` as adds tagged `added_by: pumpy`. Conversations persist in `pumpy_threads` /
`pumpy_messages` under owner-only RLS with no client writes.
`PUMPY_MARK` in `app.ts` is the placeholder art and its single swap point.
The tab itself is a column sized between the sticky header and the fixed tab
bar, so the composer sits on the tab bar whether the thread is empty or endless; a slim bar
above it opens the chat list — every thread the caller owns, newest first, with the workout it
was opened from and a two-tap delete that takes the messages with it — or starts a new one.
When a response carries a `pumpy` credit meter (`plan`, `day`, `month`, each cap possibly
null for unlimited), Settings shows the day and month counts and the composer adds a quiet
line once either allowance falls under a fifth; every field is optional and nothing new
appears while the server omits them.

**A turn is one model call, not three.** Every turn opens with a *snapshot* — an index of
the ready library (one line each: short id, title, category, minutes, equipment, ★,
collections, no exercise names), this week's plan, and one line of the last fortnight's
training. That is what `list_library` and `get_plan` used to be spent on, so the common
questions now answer in a single call. The prompt is built static-first — identity, rules,
tools, a catalog index and proposal schemas byte-identical on every request, then one fenced
dynamic block — so OpenAI's automatic prefix caching has something to cache. That index is
every one of the catalog's exercise names, compiled from `catalog.ts` and grouped by the
muscle it trains first, which both spells the movements for the model and carries the static
block past the 1,024 tokens a cache hit needs (~940 → ~1,880). The last step of a turn is
told it is the last before it spends the call, its tool call is ignored if it makes one
anyway, and an empty answer falls back to the exercises the turn already learned rather than
to "I lost my train of thought". `search_catalog` scores rather than filters — name and
aliases weigh 3, muscles 2, equipment 1, top 12, never empty for a real muscle or piece of
kit — and a comma-separated query returns the best match per name, so one call checks five
spellings. Workout ids reach the model as handles (`h3f9a1c`, the first six hex digits of
the uuid) and are resolved server-side;
stored proposals always carry the full uuid. "thanks" and its friends short-circuit to a
canned reply with no model call at all.

**Credits meter the coach.** One credit is 1,000 weighted tokens, `input + 4 × output`,
summed over every model call in a turn and rounded up, minimum one for any turn that reached
a model; a short-circuited turn is zero. It is provider-independent — a free Gemini answer
still spends credits, because credits meter the coach's work rather than the invoice. Every
turn writes one `pumpy_usage` row (calls, tokens, credits, estimated cost, model, thread),
and `pumpy_usage_totals()` reads the three numbers the gate needs in one round trip.

| Plan | Credits/day | Credits/month |
|---|---|---|
| `free` | 150 | 1,500 |
| `plus` | 400 | 5,000 |
| `pro` | 1,000 | 15,000 |
| `staff` | unlimited | unlimited |

`profiles.plan` picks the row; `profiles.pumpy_limits` (`{"day":…, "month":…}`, `null` =
unlimited) overrides it field by field. Both are read-only to clients — the column grant on
`profiles` covers `display_name` and `settings` only. Three more limits sit alongside:
`pumpy.per_minute` (6 turns/minute, counted over `pumpy_usage` so short-circuits count too),
`pumpy.turn_max_credits` (40 — past it the model gets one last call and has to answer with
what it has), and a hard 1,200-character cap on the incoming message. All of them, plus
`pumpy.history_turns` and `pumpy.snapshot_max_workouts`, live in `app_config` on the same
five-minute TTL as the model ids, so raising a cap is an update statement.

Every chat response — 200 and 429 alike — carries a `pumpy` object (`plan`, `day:{used,cap}`,
`month:{used,cap}`, `resets_day_at`, `resets_month_at`, `per_minute`), a 200 also carries
`usage` for the turn, and `GET /api/limits` returns the same `pumpy` object. A 429 names its
`scope`: `minute`, `day` or `month`. Guardrails are in the prompt and enforced after it:
Pumpy answers only about training, treats everything in the snapshot and tool results as
data rather than instructions, keeps under 90 words, and never diagnoses — any sentence
matching the diagnosis filter is dropped from the answer, and a message that mentions pain
gets the not-medical-advice line appended whether or not the model wrote it.

### Source layout

| Path | What |
|---|---|
| `supabase/functions/spotter/index.ts` | The whole backend: the provider registry, scrapers, transcription, AI chain, extraction, routes |
| `supabase/functions/spotter/catalog.ts` | Canonical exercise catalog + the name normalizer (source of truth) |
| `supabase/functions/spotter/evidence.ts` | Evidence attachment, chapter parsing, unit repair, the confidence score |
| `supabase/functions/spotter/net.ts` | Outbound request guard: private-address filter, per-hop redirect checks |
| `supabase/functions/spotter/style.ts` | Design tokens and every component style |
| `supabase/functions/spotter/markup.ts` | Page head, landing page, app shell, sheets |
| `supabase/functions/spotter/app.ts` | All app logic: auth, library, Workout Mode, plan, progress |
| `supabase/functions/spotter/page.ts` | Stitches the three together for the function |
| `build.mjs` | Same stitch, writing `docs/index.html` for GitHub Pages |
| `supabase/migrations/` | Schema, RLS policies, profile trigger, storage buckets, exercise catalog, ingest queue, corrections, collections, Pumpy |
| `tools/` | Catalog migration generator, normalizer + confidence test batteries, one-time backfill, `census.py` (hash the real users' rows before/after a change), `throwaway.py` (drive disposable accounts against the live deployment) |

The three frontend modules are `String.raw` templates, so they must never contain a
backtick or `${`. `build.mjs` fails loudly if they do.

**The provider registry.** Everything that knows how a video is obtained lives in one table
in `index.ts`, so nothing else has to. A provider declares how to recognise a link (`match`),
how to fetch its metadata (`fetchMeta`), how to read metadata out of HTML somebody else
fetched (`parseHtml`), and whether its cards belong in the global `video_cache` (`cacheable`).

| Provider | Addressed by | Cacheable |
|---|---|---|
| `instagram` / `tiktok` / `youtube` | a URL its `match` recognises | yes |
| `web` | any other public URL — the fallback | yes |
| `upload` | no URL at all: a file the user put in their own storage folder | **no** — `up-<uuid>` is one person's file, not a video anyone else can save |

`resolveShare` walks the registry's matchers, `fetchMeta` and `parseSuppliedHtml` dispatch
through `providerFor(platform)`, and the queue, the worker and the extraction ladder never
ask how the media was obtained. Adding a source is a new object in `PROVIDERS`.

### Deploying

```bash
node build.mjs && git add -A && git commit -m "..." && git push   # frontend
supabase functions deploy spotter --no-verify-jwt                  # backend
supabase db push                                                   # schema
node tools/test-normalize.mjs && node tools/test-confidence.mjs    # both batteries
```

Changing a model, or turning the vision size cap down, needs none of the above:

```sql
update public.app_config set value = 'gemini-4-flash' where key = 'model.gemini';
update public.app_config set value = '400000'         where key = 'vision.max_bytes';
```

## Extraction, and what it costs

Every save runs at most **one** AI call. The chain is OpenAI (GPT-5.6 Luna, if
`OPENAI_API_KEY` is set) → Anthropic → Gemini with model rotation → Groq. Underneath sits a keyless heuristic parser that
reads `3x10`-style lines, so a card is never empty even with every AI quota exhausted.

Per-user daily caps keep a public launch inside the free tiers, all overridable by env var:

| Cap | Default | Counts |
|---|---|---|
| `LIMIT_EXTRACT` | 60 | new saves **and** reprocesses — everything that runs the ladder |
| `LIMIT_SAVES` | 200 | every save, cache hits included |
| `LIMIT_HELPER` | 300 | `/api/explain`, `/api/swap` and an uncached `/api/demo-video` lookup |
| `LIMIT_CHAT` | 200 | Pumpy turns — a legacy backstop; credits are the real gate |
| `LIMIT_UPLOADS` | 10 | videos the user uploaded themselves — the most expensive save there is |
| `LIMIT_MEDIA` | 10 | media **steps** — one per tier that actually runs, so a full escalation costs two |

Cache hits count only against `LIMIT_SAVES`, so saving videos other people already saved is
effectively free.

**A ceiling on the day's bill.** Every model call records an estimated cost in
`ai_cost_log` from the provider's own token counts. Once the day's total crosses
`DAILY_SPEND_USD` (default `5`), providers that carry a price are switched off and
extraction falls through to the free path — a thinner card, never a failed save. A provider
is "paid" iff a price is configured for it (`PRICE_OPENAI_IN` / `_OUT`, and the same for
`ANTHROPIC`, `GEMINI`, `GROQ`), so putting a key on a paid plan is a config change, not a
code change. `GET /api/limits` reports `spend_today`, `spend_limit` and `paid_enabled`.

**What the prompt cache saves.** OpenAI serves a repeated prompt prefix out of its own
cache and charges a fraction of the input price for it, which is why Pumpy's system prompt
is written static-first: the ~900 stable tokens at the front are the part that can be
cached. Every ledger row now carries `cached_tokens` — the slice of `input_tokens` the
provider says came from cache, a subset and never an addition — and `est_cost_usd` bills
that slice at the cached rate, so the estimate no longer overstates a cached call. The
cached price is env-configurable (`PRICE_OPENAI_CACHED_IN`, default `0.02`;
`PRICE_ANTHROPIC_CACHED_IN`, default `0.10`) and both defaults **assume the standard
one-tenth-of-input discount** — they are not read from anywhere, so correct them from the
provider's price page if that ratio moves. Anthropic's cache is opt-in and this code sends
no `cache_control` breakpoints, so its figure is zero until someone adds them.

Read the hit rate off the `ai_cost_daily` view — one row per UTC day, provider and purpose,
with `calls`, the three token sums, `est_cost_usd` and `cache_pct` (cached input as a whole
percentage of all input). Service-role only, like `ai_cost_log` itself:

```sql
select * from public.ai_cost_daily order by day desc, est_cost_usd desc;
```

A healthy `cache_pct` for Pumpy is high and steady; a number that collapses means something
put a varying string in front of the static block and every call is now paying full price.
`GET /api/limits` surfaces the same figure for today as `cache_pct_today` (0-100, or `null`
when nothing has run yet).

### Reading the video itself

A caption that names no exercises is not a video that contains none. The workout is spoken,
or written on the screen, and until this wave both were invisible to Spotter. Two tiers now
go and get them, and both run **only** past a gate this application computes from the
finished card — never from the model's opinion of its own work:

```
!has_full_workout  ||  countExercises < 2  ||  confidence < 0.45
```

| Tier | What it does | Cost | Evidence it produces |
|---|---|---|---|
| 1 — transcript | Groq `whisper-large-v3-turbo`, `verbose_json`, one spoken phrase per line | $0.04/hour of audio, so ~$0.0004 for a 35-second clip | `transcript`, and located quotes in it are **verified**: it is a text we hold and can point at |
| 2 — video | Gemini (`model.gemini_vision`) reads what is demonstrated and written on screen, with timestamps | free tier today; ~3k input tokens per clip | `video`, never verified, and the card is capped at 0.55 exactly like a carousel |

Tier 2 runs only if tier 1 left the card thin. Both respect `paidAllowed()` and `LIMIT_MEDIA`,
both run in their own sub-request (`POST /api/worker/media`, worker secret) so a
multi-megabyte stream that kills an isolate kills nothing else, and the result goes into the
**global** `video_cache` — so a viral clip is read once for everybody.

**Where the media comes from, and why it is never a client field.** A media URL is read only
out of a provider's own parser. TikTok's watch page (desktop UA) carries the rehydration blob
naming `music.playUrl`, `video.playAddr` and `video.downloadAddr`; the same response sets the
cookies without which the CDN answers 403. Measured 2026-09-02:

* `music.playUrl` is the **sound**, not the video's audio. It is used only when the payload
  says `music.original` **and** the sound's duration matches the video's — then Groq fetches
  that URL itself and no bytes come near the function. On the acceptance clip the sound is
  57s against a 34s video and "transcribes" to song lyrics, which is exactly the trap.
* `video.playAddr` answers **403 bare and 206 with the watch page's cookies**, and Groq is on
  another IP with no cookies. So the function fetches it and pipes the response body straight
  into the request body — Groq's multipart upload for tier 1, Gemini's resumable Files API
  upload for tier 2. The bytes are counted as they pass and aborted at `media.max_bytes`;
  nothing is buffered, nothing is base64-encoded, nothing is stored.
* Gemini's uploaded file is deleted in a `finally`, on every outcome.
* **`thinkingConfig` must be omitted for video `fileData`.** Every text call in this codebase
  switches thinking off because Gemini 3.x otherwise spends the output budget reasoning; the
  same field makes a video request answer `400 INVALID_ARGUMENT`, on every model in the pool,
  with and without a `mimeType`.
* **Instagram has no tier.** Neither the crawler view, the `/embed/captioned/` page, nor the
  same pages fetched from a residential IP names a media URL — no `og:video`, no
  `og:video:secure_url`, no `video_url`, not one `.mp4` anywhere in 800 KB of HTML. The
  provider hook exists and returns nothing; the day that changes it is one function.

**What is stored.** `video_cache.media_tried` (asked once, ever), `media_source` (`tiktok:sound`
/ `tiktok:stream` / `video:gemini`) and `media_text` — the transcript, kept because the card's
evidence quotes point at it and a quote nobody can look up is not evidence. `saves_log` gets one
`kind = 'media'` row per step with the same `media_source`. `workouts.media_stage` is `listening`
or `watching` while a step runs and null otherwise, which is all the pending card's copy is.

**Triggering it by hand.** `POST /api/workouts/:id/media` — the "Read the video" button under a
thin card. Same caps, same queue, same one-job-per-video guarantee as the retry button. A
second user saving a video whose cached card is thin and whose `media_tried` is false gets the
upgrade queued for them automatically, once, and the row they write is what everybody after
them receives.

The dials live in `app_config`: `media.max_bytes` (40,000,000), `media.timeout_ms` (150,000)
and `media.video_enabled` (`true`). Turning tier 2 off is an update statement.

### Platform notes

| Platform | Caption source | Status |
|---|---|---|
| Instagram | og: tags via the `facebookexternalhit` UA, plus the `/embed/captioned/` page | Works. Carousel slides are read with vision only when the caption yields nothing. The crawler UA is not optional: measured 2026-09-02, a desktop or iOS Safari UA gets a login shell with no og: tags **from a residential IP too**, so a phone fetching the page must send the crawler UA. |
| TikTok | oEmbed, then `/embed/v2`, then the watch page's rehydration blob, then og: tags | Works. Verified 200 on real videos from Supabase's datacenter IPs. og: tags never carry the caption and are only trusted for thumbnail and handle. The **only** platform whose media Spotter can reach — see *Reading the video itself*. |
| YouTube | oEmbed for title/author/thumb, Data API v3 for the description | The description **needs an API key**. Verified 2026-09: from a datacenter IP the watch page returns 429, the WEB player endpoint returns `LOGIN_REQUIRED`, ANDROID/iOS clients fail attestation, and both embedded-player clients error. Set `YOUTUBE_API_KEY` (or enable YouTube Data API v3 on the same Google project as `GEMINI_API_KEY`, which is used as a fallback). |
| Any web page | og: tags plus page text | Works. |
| Anything, from a phone | the page HTML the caller POSTs, or a caption they paste | Works, and does not scrape at all. `POST /api/ingest {url, html}` runs the same platform parsers over HTML the phone fetched from a residential IP; `{url, caption}` skips parsing entirely. `meta_source` on `saves_log` records `phone-html` / `user-caption`, so `save_health` shows how much of the mix has moved off the server's own IP. |
| A video the user uploaded | the words spoken in it, transcribed | Works. The one path nobody can block, and the only one that reads a video with no written workout anywhere. `meta_source` records `transcript`. |

### Uploading a video (the spoken-only case)

Some creators say the whole workout and write nothing down. There is no caption to fetch
from anywhere, so the last rung of the ladder is the user handing over the video they saved.

**What is sent where.** The file goes from the browser straight into
`uploads/<user id>/<uuid>.<ext>` — a **private** bucket whose RLS policies let a user insert,
read and delete only inside their own first folder segment. The edge function is then posted
a path, not a file: `POST /api/ingest {"upload_path": "<uid>/<uuid>.m4a", "filename": "leg day.m4a"}`.
The worker mints a 15-minute signed URL and hands **that** to Groq's transcription endpoint
in its `url` field, so Groq fetches the media itself and no video byte ever passes through
the function — the standing rule that edge functions move URLs, never media, is not bent for
this. The object is deleted in a `finally`: on success, on failure, on a spend refusal. An
hourly sweep inside the worker tick deletes anything in the bucket older than two hours, as
the backstop for a job that died in between.

**Limits and cost.** 25 MB per file (`UPLOAD_MAX_BYTES`), which is Groq's free-tier ceiling;
their dev tier allows 100 MB, and the bucket's own `file_size_limit` is already set to 100 MB
so moving tiers is one constant. `LIMIT_UPLOADS` (default 10/day) is counted in `saves_log`
under `kind = 'upload'`, on top of `LIMIT_EXTRACT` and `LIMIT_SAVES`, which an upload also
spends. Transcription is billed by audio duration rather than tokens, so its ledger row
carries `est_cost_usd = seconds / 3600 × PRICE_GROQ_WHISPER_PER_HOUR` (default `0.04`, which
is `whisper-large-v3-turbo`; `whisper-large-v3` is `0.111`) with zero tokens and
`purpose = 'transcribe'`. `paidAllowed()` gates it exactly like a paid model call — when the
day's ceiling is reached the upload fails soft with "try tomorrow", **and the file is still
deleted**.

**Accepted formats.** `UPLOAD_EXTS` is mp4, mov, webm, m4v, mp3, m4a, wav, weba, kept in step with
the bucket's own `allowed_mime_types` (the enforcing copy) and with the client's picker. Groq's
published list does not name `mov`, which matters because iPhone camera-roll video is `.mov` —
so it was measured rather than assumed. Verified 2026-09-02 against the live endpoint: an object
stored at a path ending `.mov`, served through a signed URL, transcribed correctly. Groq does not
gate on that extension. Note the scope of the test: the bytes were MPEG-4 audio, so what is proven
is that `.mov` in the URL is not itself a refusal, not that every QuickTime container demuxes.
Both are ISO-BMFF, and dropping `mov` would break the most common phone video for no measured
reason, so it stays.

**One attempt, on purpose.** Because the object is deleted whatever happens, an upload job is
enqueued with `max_attempts = 1`: a second attempt would have nothing to read. The retries
that can actually help — a rate-limited or flaky transcription call — happen inside
`groqTranscribe` while the file still exists. A failed upload card therefore offers *Paste
the caption instead* and not *Try reading it again*, and `POST /reprocess` on one refuses
with a plain explanation rather than queueing a job that can only fail.

**What the card says.** The transcript becomes the card's caption, split one spoken segment
per line so the evidence indexer has real lines to quote rather than one long paragraph.
Every exercise located in it carries `evidence.source = "transcript"` — a new
`EvidenceSource`, treated as verified text like a caption, because it is text we hold. The
confidence score needed no new weights.

Silence does not come back as an error from Whisper. Measured 2026-09-02: one second of
silence returns HTTP 200 with the text **"Thank you."** and per-segment `no_speech_prob`
values low enough to pass for speech, so the model's own confidence cannot be the whole
test. A transcript shorter than `TRANSCRIPT_MIN_CHARS` (25) is therefore rejected outright —
nothing that prescribes a workout fits in twenty-five characters — with the probability rule
kept as a weaker second net for a longer stretch of near-silence. And because an upload has
neither a link nor a file left over, an upload whose extraction finds **no exercises at all**
fails the card rather than leaving an empty one; every URL-addressed provider still keeps its
empty card, because there the link is worth having on its own.

## The account

Settings is five titled groups, in the order the questions get asked — **Account**,
**Preferences**, **Save from your phone**, **Data & privacy**, **About** — which is the shape
Hevy, Strong, Fitbod and iOS Settings all use. Two deliberate deviations from those apps:

- **Sign out ends the Account group**, not the sheet. Every app looked at parks it at the very
  bottom; here that put it under the iPhone Shortcut how-to, where it could not be found. It is
  now in the first screenful at 375×812.
- **Rest between sets is not a setting.** How long to rest belongs to the program or to the
  video. Workout Mode takes the card's own `rest_seconds` — the exercise's first, then the
  block's at the end of a circuit lap — and only when the card says nothing does it fall back to
  `REST_FALLBACK` in `app.ts`, currently 90 seconds (the top of the ACSM hypertrophy band, and
  between what Hevy and Strong default to). Profiles saved before this still carry a
  `settings.rest`; it is ignored on read.

What each group holds:

| Group | Rows |
| --- | --- |
| Account | Email (tap to change — email accounts only), Sign-in method, Name, Password (email accounts only), Saved today, **Sign out** |
| Preferences | Weight unit, Timer sounds, Vibration (only where `navigator.vibrate` exists, so not on iOS) |
| Save from your phone | The ingest address, Copy, New key |
| Data & privacy | Export my data, Privacy policy, **Delete account** |
| About | What's new + version, Tell a friend, Something wrong? |

Rename, change password, change email, choose a new password after a reset, and confirm a
deletion all share **one** sheet (`#accountsheet`), dressed by `accSheet(cfg)` in `app.ts`.

### Forgot password

The sign-in face of the auth card shows **Forgot your password?**, which calls
`resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })`. Coming back
on the link fires `PASSWORD_RECOVERY`, and the "Choose a new password" sheet opens from it
(deferred a tick — supabase-js holds the auth lock through that callback). A `type=recovery` in
the URL hash is checked at boot as a fallback for browsers that restore the session before the
listener is attached.

> **Owner action.** The Pages URL `https://simeonrinkenberger.github.io/spotter/` must be listed
> under Dashboard → Authentication → **URL Configuration** → Redirect URLs, or the link in the
> email bounces to the Site URL instead. Mail also still goes through Supabase's built-in sender,
> which is rate-limited to a handful an hour and not for production — the reset copy says so out
> loud, and a real SMTP provider is needed before launch.

### Export my data

`Settings → Data & privacy → Export my data` reads `workouts`, `workout_logs`, `plan`,
`collections`, `collection_items`, `pumpy_threads` and `pumpy_messages` through supabase-js under
RLS, adds the profile's `display_name`, `created_at` and `settings`, and writes
`spotter-export-<date>.json`. On a device where `navigator.canShare({ files })` is true (an
iPhone, which has no downloads folder a person can point at) it goes to the share sheet;
everywhere else it is a download. The ingest key is left out on purpose: it works without a
password, and a file is a thing people forward.

### Delete account

`POST /api/account/delete`, Bearer token, resolved by the same `userFromBearer` gate as every
other route. Deleting the auth user cascades every table with an `on delete cascade` to
`auth.users`; the three that deliberately have no such key are handled first, while their rows
can still be found:

| Table | What happens | Why |
| --- | --- | --- |
| `saves_log` | deleted | a per-user rate-limit counter |
| `pumpy_usage` | deleted | per-user credits |
| `ai_cost_log` | `user_id` set to `null` | the project's spend ledger feeds the daily budget guard; deleting rows would hand today's ceiling back |

Objects under `uploads/<user id>/` are removed first (paged, best effort — the hourly orphan
sweep is the backstop), then `DELETE /auth/v1/admin/users/<id>` with the service role. In the app
it is the last control in Data & privacy, styled destructive, behind a sheet that names
everything that goes and asks for the word DELETE to be typed.

In-app account deletion is not optional for the App Store: guideline **5.1.1(v)** makes it a
condition of listing any app that creates accounts. Google Play additionally wants a publicly
reachable page describing it, which is `docs/privacy.html#delete`.

Deleting an account **cancels the Stripe subscription and deletes the Stripe customer first**,
before a single row goes. If Stripe cannot be reached the whole deletion stops with a 503 and
nothing is deleted, because an account that is gone but still charging a card every month is the
one outcome that must never happen.

## Plans and billing

Spotter sells one paid tier: **Plus, $6.99 a month or $39.99 a year**, with a 7-day trial on the
annual price only (a card is taken up front — the free tier is the monthly plan's trial). At
launch the first 200 annual subscribers pay **$29.99 for the first year**. Everything that made
Spotter worth using stays free for ever — logging, Workout Mode, the plan, progress, the muscle
map, collections and export are not metered and never will be.

**The free gate is the shelf, not the day.** A free account holds **20 workouts**; Plus is
unlimited. The five daily caps below exist to stop abuse and are set where an ordinary week never
touches them, because a daily ceiling teaches people to save *less*, which is the opposite of
what a library wants. The library cap is checked only where a new row would be created — a save,
an upload, a workout Pumpy proposes — and never on reading, logging, editing, planning or
deleting. Nothing already saved is ever taken away, including from an account that goes over the
number when a comp ends.

**Entitlement is one column.** `profiles.plan` (`free | plus | pro | staff`) is the only thing any
cap check reads — it already was, for Pumpy's credits. A `subscriptions` row derives it through
one trigger, `apply_subscription_plan()`, and that row carries a `source` (`stripe | apple |
google | manual`) so an App Store purchase later writes the same row and the derivation does not
change. A `staff` profile is never touched by billing: comps stay the owner's to give.

**Stripe is a signal, never the state.** Stripe does not promise to deliver events in order, and
two events about one subscription can share a timestamp — so no handler trusts a payload. Every
webhook, the return from a successful checkout, and the Settings refresh all call the same
`syncStripeCustomer(customerId)` in `supabase/functions/spotter/billing.ts`, which asks Stripe
what that customer has *now* and overwrites the row. Replaying an event rewrites an identical
row. Event ids are recorded in `billing_events` so a duplicate delivery is a 200 and a delivery
that failed halfway can still be retried.

Entitled is `trialing`, `active` or `past_due` — the last one being the grace window while Stripe
retries a failed card:

| Stripe `status` | Entitled | `profiles.plan` | What Settings shows |
| --- | --- | --- | --- |
| `trialing` | yes | plus/pro | `Plus · trial ends Oct 4` |
| `active` | yes | plus/pro | `Plus · renews Oct 4` |
| `active`, cancelling | yes | plus/pro | `Plus · ends Oct 4` |
| `past_due` | yes (grace) | plus/pro | `Plus · payment failed` + Update payment |
| `unpaid` | no | free | `Free` — retries are spent; Stripe's own advice is to revoke here |
| `canceled` | no | free | `Free` |
| `incomplete` | no | free | `Free` — the first payment did not settle within 23 hours |
| `incomplete_expired` | no | free | `Free` — terminal |
| `paused` | no | free | `Free` |

Two fields are read from places that are easy to get wrong. The renewal date lives on the
subscription **item** (`items.data[0].current_period_end`) — the field on the subscription itself
was removed in API version `2025-03-31.basil` and reading it gets `undefined` with no error. And
"cancels at the end of the period" is `cancel_at_period_end === true || cancel_at != null`,
because flexible billing mode signals it through the second one.

**Without a Stripe key nothing changes.** Every billing route answers
`503 {code: "not_configured"}`, except `GET /api/billing/prices`, which answers 200 with
`configured: false` so the app can say plans are coming soon. Ingest, the worker, Pumpy and the
caps do not know billing exists. That is the state the function deploys in, and the state a fork
of this repo runs in for ever.

### Setting up Stripe

```
./tools/stripe-setup.sh          # a sandbox / test key first
./tools/stripe-setup.sh --live   # the live account, once the test run checks out
```

It prompts for the secret key without echoing it, runs `tools/stripe-setup.mjs` (Node 20+, no npm
dependencies — plain `fetch` against `api.stripe.com`), then stores `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` as function secrets and redeploys. Add `--dry-run` to the `.mjs` directly
to see what it would do without changing anything.

Every step is idempotent, and by something a Dashboard rename cannot break: products by
`metadata.spotter_key`, prices by `lookup_key`, the portal configuration by `metadata.spotter`,
the webhook endpoint by its URL. Run it as often as you like. **The webhook signing secret is
returned only on the run that creates the endpoint** — Stripe never shows it again. If you lose
it, roll it in Workbench → Webhooks → Roll secret and run the script again to store the new one.

Portal configurations and webhook endpoints are **per mode**, so the test run and the live run
each create their own. Nothing else differs.

> **Owner action — six settings the API cannot touch.** The script prints these at the end; they
> are here so they are findable later.
>
> 1. Revenue recovery → Retries: Smart Retries on, 8 tries over 2 weeks, then **Cancel the
>    subscription**. Not "leave past-due" — Spotter treats `past_due` as entitled during the grace
>    window, so that setting would hand a non-payer the paid plan for ever.
> 2. Revenue recovery → Emails: failed-payment on, expiring-card on.
> 3. Settings → Billing → Subscriptions and emails: trial-ending reminder on, upcoming-renewal
>    emails on, free-trial messaging → "Link to a Stripe-hosted page". Stripe's own emails are the
>    entire dunning story; Spotter sends no billing email of its own.
> 4. Settings → Checkout and Payment Links → Subscriptions: **Limit customers to one
>    subscription** on (it needs the no-code portal login link enabled). The 409 the checkout
>    route returns is only the second layer.
> 5. Settings → Branding, plus a public business name and support email — they appear on Checkout,
>    in the portal and on every Stripe email.
> 6. Stripe Tax: **threshold monitoring only**. No registrations, no calculation. Illinois does not
>    tax cloud-only SaaS and every economic-nexus threshold is many times away, so calculation
>    would collect nothing and add a renewal-time failure mode. Monitoring is free at zero
>    registrations and is what will tell you when that stops being true.

Testing without the Stripe CLI: card `4242 4242 4242 4242` for the happy path,
`4000 0000 0000 0341` to make a *renewal* fail (it attaches fine and declines when charged),
`4000 0027 6000 3184` for 3-D Secure on a subscription. Renewals and dunning over time are
Dashboard **Simulations** (test clocks) — advance the clock an extra hour past the cycle date, or
the draft invoice will not have finalised yet. To test duplicate handling, resend a real event
from Workbench → Webhooks and check the second call answers `{"duplicate": true}`.

### Prices and caps are data

Nothing about the tiers is compiled in. Three files and one table, and none of them need a deploy
to change:

| What | Where | Notes |
| --- | --- | --- |
| Product names, amounts, intervals, trial length, the founding offer | `tools/stripe-plans.json` | The source of truth for what the setup script creates. Amounts in cents. |
| The caps per plan | `app_config.limits.plans` | Read on the same 5-minute cache as the model ids. `null` = unlimited. |
| Trial length the function applies | `app_config.billing.trial_days` | Annual only. Keep it equal to `trial_days` in the JSON. `0` switches trials off. |
| Stripe Tax | `app_config.billing.tax` | `false` at launch. The checkout code already reads it. |
| One person's caps | `profiles.limits` | A JSON override, field by field, beating the plan. |

Today's numbers:

| Cap | Free | Plus |
| --- | --- | --- |
| `library` workouts held (**not** per day) | 20 | unlimited |
| `saves` per day | 30 | 200 |
| `extract` new extractions per day | 10 | 60 |
| `media` video reads per day | 2 | 15 |
| `uploads` per day | 1 | 10 |
| `helper` explain/swap answers per day | 25 | 60 |

Pumpy's credits are a separate dial (`app_config.pumpy.plans`, `profiles.pumpy_limits`) and are
unchanged: free 150/day and 1,500/month, Plus 400/day and 5,000/month.

**Changing a price.** Edit the amount in `tools/stripe-plans.json` and run the setup script again.
Prices are immutable in Stripe, so it creates a new one, moves the `lookup_key` onto it with
`transfer_lookup_key` and deactivates the old — everybody already subscribed keeps the price they
bought. No code knows a price id.

**The founding offer** is a Stripe coupon with a fixed id, `SPOTTER_FOUNDING_YEAR`: $10 off, once,
200 redemptions, scoped to the Plus product. The setup script creates it; the function looks it up
by that id on the same five-minute cache as the prices and, while Stripe reports it valid, applies
it to every yearly checkout automatically. Nobody types a code. Stripe's own `max_redemptions`
counter is what closes the offer, so there is no number on our side to drift — `GET
/api/billing/prices` reports `founding: {first_year_amount, remaining}`, or `null` once it is gone.
**To end the offer, delete the coupon** in Products → Coupons; the paywall stops advertising it
within five minutes and checkout goes to full price. Coupons are immutable, so changing the
amount means deleting and re-creating. One consequence worth knowing: a Checkout Session may
carry a coupon *or* a promo-code box, never both, so while the offer runs the yearly checkout has
no "enter a code" field. Monthly keeps one. If Stripe refuses the coupon at session creation —
the 200th redemption landing mid-click — the function retries once at full price rather than
losing the sale.

**The `LIMIT_*` secrets still work**, and now mean the free plan only: `LIMIT_SAVES`,
`LIMIT_EXTRACT`, `LIMIT_MEDIA`, `LIMIT_UPLOADS`, `LIMIT_HELPER`. They predate plans and were the
caps for everybody, so the only honest reading of one today is "this is what an unpaid account
gets"; they must never reach into a paid plan. There is no `LIMIT_LIBRARY`: the shelf never
existed before plans did, so there is nothing for an environment variable to inherit — change it
in `limits.plans`. Precedence, loosest layer last:
compiled defaults → `LIMIT_*` (free only) → `app_config.limits.plans` → `profiles.limits`.

**Comping someone** is one row, and no Stripe involvement at all:

```sql
insert into public.subscriptions (user_id, source, plan, status)
values ('<user uuid>', 'manual', 'plus', 'active');
-- and to take it back:
delete from public.subscriptions where user_id = '<user uuid>';
```

The trigger moves `profiles.plan` either way. For a bigger allowance without a plan change, set
`profiles.limits` instead —
`update public.profiles set limits = '{"library": null, "saves": 500}' where id = '…';`, where
`null` means unlimited for that one field.
For yourself, `plan = 'staff'` is the blunt instrument — everything unlimited, and billing is
forbidden from overwriting it.

Terms of service and the payments section of the privacy policy are the frontend wave's to write
(`docs/terms.html`, `docs/privacy.html`); both want a look from an attorney before launch.

### What the person sees

Nothing, until Stripe is configured. With a key set, a free account sees one slim line above
the library grid — `12 of 20 saved · Plus` — which turns ember at sixteen and opens the plan
sheet; the save receipt adds `That is 16 of your 20 saved workouts.` from the same point on.
Everything else is a refusal answering for itself: any cap a paid plan would lift opens that
sheet with one line above the title naming the number, the reset and what Plus does about it,
while a cap no plan lifts keeps today's plain toast. Pumpy never gets a sheet thrown over him —
his ceiling arrives as a `See Plus` chip under the sentence he just said. The sheet is
`Spotter Plus`: six benefit rows built from the live caps, a yearly card pre-selected against a
monthly one, the founding price struck through against the standing one while the coupon is
alive, a computed trial date, `Not now`, and Terms · Privacy · Restore purchase. Buying leaves
for hosted Checkout and comes back through `docs/billing-return.html`, a static page that
exists because an installed iOS PWA opens Checkout in an in-app browser with storage of its
own; the app notices the return by itself and says `Welcome to Plus.` Settings › Plan carries
the state — `Free`, `Plus · free trial, ends 11 Sep`, `Plus · renews 4 Oct`, `Plus · ends 4 Oct`,
`Plus · payment failed`, `Staff` — what the day has used, and the buttons into the Stripe
portal. Without a Stripe key the sheet says plans are coming soon, Settings says `Free` with no
buttons under it at all, and the library page is the page it is today. The Terms of Use
(`docs/terms.html`) and the Payments section of the privacy policy were written in plain
language and have not been reviewed by a lawyer — do that before charging real money.

## Self-hosting

1. Create a Supabase project and `supabase link --project-ref <ref>`.
2. `supabase db push`.
3. Auth → Providers → Email on. Leave "Confirm email" **off** until you configure custom
   SMTP: the built-in mailer allows only a couple of messages an hour, which stalls signups.
4. Set the function secrets you want:
   `GEMINI_API_KEY`, `GROQ_API_KEY`, optionally `OPENAI_API_KEY` + `OPENAI_MODEL`
   (paid primary), `ANTHROPIC_API_KEY` + `CLAUDE_MODEL`, `YOUTUBE_API_KEY`,
   `ALLOWED_ORIGINS`, `LIMIT_EXTRACT`, `LIMIT_SAVES`, `LIMIT_HELPER`, `LIMIT_CHAT`,
   `DAILY_SPEND_USD`.
   Or run `./set-keys.sh`.
   Paid plans are optional and off by default: leave `STRIPE_SECRET_KEY` and
   `STRIPE_WEBHOOK_SECRET` unset and every billing route answers `not_configured` while
   everything else behaves exactly as it does with them. To switch them on, run
   `./tools/stripe-setup.sh` — see [Plans and billing](#plans-and-billing).
   Also set `WORKER_SECRET` to a long random string — it is what authenticates the worker
   route — and store the same value plus the worker URL in the `app_config` table so
   `pg_cron` can reach it:

   ```sql
   insert into public.app_config (key, value) values
     ('worker_url',    'https://<ref>.supabase.co/functions/v1/spotter/api/worker/tick'),
     ('worker_secret', '<the same WORKER_SECRET>')
   on conflict (key) do update set value = excluded.value;
   ```
5. `supabase functions deploy spotter --no-verify-jwt`.
6. Put your project URL and anon key at the top of `app.ts`, run `node build.mjs`, and
   serve `docs/` (GitHub Pages works: Settings → Pages → main branch, `/docs`).
7. Auth hardening. `supabase/config.toml` carries TOTP MFA
   (`[auth.mfa.totp] enroll_enabled/verify_enabled`), which `supabase config push` applies —
   those two keys are in the published
   [CLI config reference](https://supabase.com/docs/guides/local-development/cli/config).
   The other two things the Supabase advisors ask for are **not** in that reference at CLI
   2.116.0, and the CLI ignores keys it does not know rather than rejecting them, so they
   have to be set in the dashboard:

   - **Leaked-password protection** (checks new passwords against Have I Been Pwned; Pro plan
     and above): Dashboard → Authentication → **Sign In / Providers** → Email → turn on
     **Prevent use of leaked passwords** → Save.
   - **Password policy**: same page → set **Minimum password length** to at least 10 and
     **Required characters** to `Lowercase, uppercase letters and digits` or stronger → Save.

   Both are visible afterwards in Advisors → Security, which is where they were flagged.

### Sign in with Google / Apple

The sign-in card carries **Continue with Google** and **Continue with Apple** under the
email form. Neither button is painted until the matching provider is switched on for the
project: the page reads `GET {SUPABASE_URL}/auth/v1/settings` once at boot and shows a
button only where the `external` map says `true`. Until you do the steps below the sign-in
screen looks exactly as it did before, which is the intended resting state — nothing to
comment out, nothing to remember to remove.

Both buttons run the **in-page token flow** (`signInWithIdToken`), not a whole-page
redirect: an installed PWA on iOS that navigates out to a provider finishes the sign-in in
Safari, where the session lands in a storage the PWA cannot read. `signInWithOAuth` is kept
as the automatic fallback for when the provider script is blocked, when Google's One Tap
declines to show, or when the public client id below is still blank.

Two public identifiers have to reach the browser. They live in a single constant at the top
of `supabase/functions/spotter/app.ts`:

```js
var PUBLIC_AUTH = { google_client_id: "", apple_services_id: "" };
```

Neither is a secret — a Google web client id and an Apple Services ID are visible to anyone
who views source. The real secrets (Google's client secret, Apple's `.p8` key) only ever go
into Supabase.

#### 1. Google

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → OAuth consent screen** (newer consoles: **Google Auth Platform →
   Branding**). User type **External**. App name `Spotter`, your support email, and:
   - Authorized domain: `simeonrinkenberger.github.io`
   - Privacy policy: `https://simeonrinkenberger.github.io/spotter/privacy.html`
   Then **Audience → Publish app**, or the sign-in only works for accounts you list as test
   users.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins** (these are what the in-page token flow checks, and a
     missing one is the usual reason the Google prompt silently never appears):
     - `https://simeonrinkenberger.github.io`
     - `http://localhost:8000`
   - **Authorized redirect URIs** (the redirect fallback, and how Supabase completes the
     exchange):
     - `https://mtzevoxxpsktmrbbuxva.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**. Supabase Dashboard → **Authentication →
   Providers → Google** → enable, paste both, Save. The button appears on the next page load.
5. Paste the **Client ID** (only the id) into `PUBLIC_AUTH.google_client_id`, run
   `node build.mjs`, and commit `docs/index.html` with it. Without this step the button
   still works — it just takes the redirect fallback instead of the in-page flow.

#### 2. Apple

Sign in with Apple on the web needs a paid **Apple Developer Program** membership. Apple
also refuses `http://` and `localhost` return URLs, so this one cannot be tested locally at
all — it works on the deployed site or not at all.

1. [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/) →
   **Identifiers → App IDs → +**. Bundle ID e.g. `com.simeonrinkenberger.spotter`, and tick
   the **Sign in with Apple** capability.
2. **Identifiers → Services IDs → +**, e.g. `com.simeonrinkenberger.spotter.web`. *This
   identifier is the client id the browser uses* — not the App ID. Tick **Sign in with
   Apple**, then **Configure**:
   - Primary App ID: the App ID from step 1.
   - **Domains and Subdomains**: `simeonrinkenberger.github.io`
   - **Return URLs** — add **both**:
     - `https://mtzevoxxpsktmrbbuxva.supabase.co/auth/v1/callback` (redirect fallback)
     - `https://simeonrinkenberger.github.io/spotter/` (the in-page popup flow posts its
       result back to this exact origin; leave it out and the popup fails with
       `invalid_request`)
3. **Keys → +**, tick **Sign in with Apple**, Configure → pick the primary App ID, then
   **Download** the `.p8` file. Apple lets you download it **once**. Note the **Key ID** and
   your **Team ID** (top right of the developer account).
4. Turn the key into a client secret. It is a JWT signed with the `.p8`, and Apple caps its
   life at six months, so it has to be regenerated twice a year —
   [Supabase's Apple guide](https://supabase.com/docs/guides/auth/social-login/auth-apple)
   walks through generating it from the Team ID, Key ID, Services ID and `.p8`.
5. Supabase Dashboard → **Authentication → Providers → Apple** → enable:
   - **Client IDs**: the Services ID from step 2
   - **Secret Key**: the JWT from step 4
6. Paste the **Services ID** into `PUBLIC_AUTH.apple_services_id`, run `node build.mjs`,
   commit `docs/index.html`.

#### 3. What changes for the people using it

- Both buttons appear under the email form, separated by an "or" divider. On iPhone, iPad
  and Mac the Apple button is moved to the top of the pair, which is where Apple's
  guidelines and the platform's own habits put it.
- Signing in with a provider whose verified email already has a Spotter account **links to
  that account** rather than making a second one — Supabase matches on the verified address.
  So the two existing password accounts keep their libraries if their owners switch.
- Google supplies a name, and the signup trigger uses it for the profile display name
  (migration `20260902160000_oauth_profiles.sql`). Apple supplies a name **only on the very
  first authorization and never again**, so the page captures it at that moment and writes
  it to the profile — but only over the placeholder taken from the email address, never over
  a name someone chose.
- Apple's "Hide My Email" gives Spotter a private relay address. Everything works with it;
  the account is keyed on that address.
- Settings gains a **Sign-in method** row so it is obvious which one is in use.

#### Also worth knowing

- `supabase/config.toml` carries both provider blocks **commented out**, with the exact
  keys. The dashboard route above is the recommended one; if you would rather push config,
  uncomment them, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` /
  `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`, and run `supabase config push`. Do not uncomment
  them with empty ids — that switches the provider on with nothing behind it and the button
  appears anyway.
- Leave `skip_nonce_check` at `false`. Every id_token the page sends carries a nonce and
  gotrue is meant to check it.
- The Apple mark on the button is an inline SVG so the card paints without waiting on a
  third-party image. Apple asks that custom buttons use the artwork from
  [Apple Design Resources](https://developer.apple.com/design/resources/); if you ever
  submit an app that reuses this screen, swap the path in `markup.ts` for their file.

## Saving from your phone

Two routes that work today, and which one you get is decided by the phone rather than by
Spotter. A third — a native app with a real share extension — is the plan below.

### Android — the share sheet, no setup

Install Spotter from Chrome (**⋮ → Add to Home screen / Install app**), and it appears in the
Android share sheet next to the native apps. Share a reel to it and the save is already
running before the share sheet has finished closing; a video somebody else has already saved
comes back finished, from the shared cache.

That comes from one manifest member. It is written in both `docs/manifest.webmanifest` and
the copy the function serves at `GET /manifest.webmanifest`, and the two copies of *this block*
are kept identical:

```json
"share_target": {
  "action": "./?share",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

Three facts that shape the code on the other side of it, in `app.ts` under *the share sheet*:

- **The app must be installed.** An uninstalled PWA never appears in the share sheet; this is
  deliberate in the spec, so that visiting a page cannot put it in your share menu.
- **Android has no `url` field.** Its share system sends a link as text, so a shared URL
  usually arrives in `text` and occasionally in `title`. `captureShare` searches all three for
  the first `http(s)` URL rather than trusting `url`.
- **The `?share` marker is a hint, not a promise.** Per Web Share Target Level 2 the user agent
  *sets* the action URL's query to the shared params, which can drop anything the action already
  had. So a share is identified by the params themselves, and `?share` only helps when it
  survives.

The link is then taken off the address bar with `history.replaceState` — one share is one save,
and a reload cannot replay it — and saved through exactly the path a pasted link takes. If it
arrives while you are signed out it is held for the tab's session and saved straight after
sign-in. A failed save reopens the add sheet with the link still in it, because at that point
the link exists nowhere else on the device.

`action` is relative to the manifest's own URL, so it resolves to `/spotter/?share` on Pages
and to the function's own root when the function serves the page — inside `scope` in both,
which the spec requires. If Spotter ever fails to appear in an Android share sheet after a
clean reinstall, an absolute `action` is the first thing to try; at least one report
([Dec 2025](https://martin.hjartmyr.se/articles/pwa-web-share-target-android/)) blames the
relative form, though the spec and Chromium's own docs do not.

**iOS Safari does not implement Web Share Target** — WebKit bug
[194593](https://bugs.webkit.org/show_bug.cgi?id=194593) is still `NEW`, unassigned, last
commented 23 May 2026, seven years after it was filed. Nothing on the web platform puts a PWA
in the iPhone share sheet today. Hence the next two sections.

### iPhone — a Shortcut, until the app ships

Settings in the app shows a personal save address containing your own key. `POST` to it with
a JSON body:

```json
{ "url": "https://...", "html": "<optional: the page, already fetched>", "caption": "optional: the text you can see" }
```

`url` is the only required field. `html` is capped at 2,000,000 characters (413 above that)
and `caption` at 6,000. Anything supplied is parsed with no network call at all, and only the
fields still missing afterwards are looked for online.

#### Recipe 1 — the simple one

1. **Receive** URLs from the share sheet
2. **Get Contents of URL** — your address, Method `POST`, Request Body JSON,
   one field `url` set to the Shortcut Input
3. **Show Result**

#### Recipe 2 — the one to build (recommended)

1. **Receive** URLs from the share sheet
2. **Get Contents of URL** — the shared link, Method `GET`, no body
3. **Get Contents of URL** — your address, Method `POST`, Request Body JSON, two fields:
   `url` set to the Shortcut Input, and `html` set to the *Contents of URL* from step 2
4. **Show Result**

**Instagram needs one extra thing.** Measured 2026-09-02 from a residential IP: Instagram serves
og: tags only to a link-preview crawler. With Safari's own User-Agent the reel page comes back as
a 620KB login shell with no og: tags at all, from any IP. So on step 2, add a header
`User-Agent` = `facebookexternalhit/1.1` (Shortcuts: **Headers** on the Get Contents of URL
action). TikTok and YouTube need no header — the page a phone gets is already the whole page.

The difference is who fetches the page. In recipe 2 your phone does, over your home Wi-Fi or
your carrier — a residential IP, which platforms serve normally and do not rate-limit, and
which is why a YouTube watch page that answers 429 to the server arrives whole on a phone. The
server then never scrapes anything: it parses what you sent. Step 4 shows `Read from your
phone` when that path ran, and `Reading the video…` when it fell back to the old one.

Share any reel to it and the workout is in your library before you put the phone down.
The key is not your password, but it can save to your account — rotate it in Settings if it
leaks.

### Native app (planned)

The Shortcut is an interim, not the destination. The launch path is a thin native shell around
this same web app, so that "share to Spotter" is one tap on both phones and nobody is asked to
build anything.

**The shape of it.** [Capacitor](https://capacitorjs.com) wraps `docs/` as an iOS and an Android
app — the same HTML, CSS and JS, the same Supabase project, no second frontend to keep in step.
On top of that:

- **iOS Share Extension.** iOS only accepts shares into an *extension* target, never into the
  app itself, so the Xcode project gains a Share Extension alongside the app, an **App Group**
  the two can both read, and a custom URL scheme the extension uses to hand off. Community
  plugins already cover the wiring: [Cap-go/capacitor-share-target](https://github.com/Cap-go/capacitor-share-target)
  (MPL-2.0, free), [calvinckho/capacitor-share-extension](https://github.com/calvinckho/capacitor-share-extension),
  and Capawesome's [share-target](https://capawesome.io/docs/sdks/capacitor/share-target/)
  (paid, Insiders only). All three deliver the shared link into the web layer, where
  `handleSharedUrl` — the same function Android's share sheet reaches — takes it.
- **The extension can fetch the page itself.** An app extension may use `URLSession`, so the
  share extension can `GET` the shared link over the phone's own connection and post
  `{url, html}` exactly as Shortcut recipe 2 does. That is worth keeping: it is the residential
  IP that makes Instagram and YouTube answer honestly, and it is why the Shortcut beats the
  server's own fetch today. Extensions run under a short time budget, so the safe version posts
  `{url}` immediately and adds `html` only if the fetch returns in time — the server already
  treats `html` as optional and falls back on its own.
- **Android intent filter.** For completeness the Capacitor Android app declares an
  `ACTION_SEND` intent filter and routes it into the same function. The installed PWA already
  covers Android, so this is parity rather than need.

**What it costs.** Apple Developer Program **$99/yr** — required to run a Share Extension on a
real device beyond a 7-day free provisioning profile, and required for TestFlight and the App
Store. Google Play Console **$25 once**. Both figures current for 2026. No Apple account exists
yet, which is why this section is a plan and not a feature.

**What does not change.** The Supabase project, the edge function, the schema, RLS, the
extraction ladder — none of it. The native shell adds a share entry point and a store listing;
it does not add a backend. The PWA keeps working exactly as it does now, and stays the way in
for anyone on a desktop or unwilling to install anything.

### When nothing automated works

First, **Upload a video you saved** — the option under the link box in the add sheet. That is
the path for a creator who says the workout out loud and writes nothing, and it is the only
one no platform can take away; see *Uploading a video* above for what it sends where.

Failing that, open the card and either **Try reading it again** (on a card that failed) or **Paste the
caption to improve it** (in the caveat on a card Spotter could not verify). Both open a box:
copy the workout text off the post, paste it, tap **Read it**. It goes to
`POST /api/workouts/:id/reprocess` with `{ "caption": "…" }`. A card that had failed goes back
on the queue with your text already attached to the job; a card that merely scored badly is
re-read inline, and the never-downgrade merge still applies, so a paste can only make the card
better than it was.

## The muscle map

Two anatomical figures, front and back side by side, on a card's detail (**What this hits**)
and at the top of Progress (**What you've hit this week**). Every muscle Spotter has a word
for is its own shape on a neutral body; a shape is grey until something asks for it.

**Where the highlighting comes from.** Only from `exercise_catalog`, reached through each
exercise's `canonical_id`. Never from the card's free-text `muscle_groups`, never from an
exercise's name. A movement the catalog could not place lights nothing and the section says
so underneath ("n of m exercises are not in the catalog and are not shown"), because a guess
here would be a confident lie about the user's own training.

**Primary and secondary.** `muscle_groups` is what a movement is *for*; `secondary_muscles`
is what it also asks for — assisters and stabilisers. A goblet squat is quads, glutes and
core primary, hamstrings and forearms secondary. Both columns are generated from
`supabase/functions/spotter/catalog.ts`, the single source of truth; the generator refuses to
run if a muscle appears in both lists for one exercise. On a card the strongest claim wins:
primary anywhere on the card beats secondary anywhere on the card.

**Colour grammar.** One hue, two strengths: `--ember` at full opacity for primary, 45% for
secondary, and the untargeted neutral for the rest. Garmin Connect splits primary and
secondary as red and yellow, but Spotter's palette has exactly one accent and the body figure
is the densest accent surface in the app — a second hue would blow the "accent under ~10% of
a screen" budget on the one screen most likely to break it, and red on a body diagram reads as
injury. Red/yellow is also the worst pair for red-green colour blindness, where a single hue
varying in lightness survives. Primary additionally carries a thin `--ember-ink` rim, so the
split does not rest on colour alone (MuscleWiki hatches its primaries for the same reason).

**Weekly intensity.** Four fixed bands, not quantiles — a light week should look like a light
week rather than being stretched to fill the ramp. The score for a muscle is **sets logged**:
one per set for a muscle the movement is for, half per set for one it assists. `0.5–3.5 → step 1`,
`4–7.5 → step 2`, `8–13.5 → step 3`, `14+ → step 4`, painted at 26 / 50 / 74 / 100% opacity.
Sets come from `workout_logs.entries[].sets`, so only work actually logged counts.

**Full-body movements** (burpees, snatches, a sun salutation) never light a muscle from their
primary list — the word *full body* is not a region, and spreading a burpee over every region
paints the whole figure and says nothing. They reach the map only through their secondary list,
so a burpee shades chest, triceps, quads, glutes and core faintly rather than blanking the
figure, and a note under the map says that is what happened.

**Tapping.** Every muscle is a `role="button"` path with an `aria-label` and keyboard focus.
Tapping one names it under the figure: on a card, the exercises that hit it with the secondary
ones marked; on Progress, its sets this week. Tapping it again, or anywhere off a muscle,
clears it. The adductors are not one of Spotter's twelve muscle words, so they ride one step
below the quads on the front and the hamstrings on the back, and tapping them selects that
group.

**Artwork.** The front and back muscle maps are the male figures from
[react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter)
(MIT, © 2022 ELABBASSI Hicham). The path data is re-projected from its 724×1448 space onto a
181×362 viewBox, merged to one path per muscle group, rounded to a tenth of a unit and inlined
in `app.ts` — about 31 KB of path data, no runtime dependency and no network request.

## Licence

MIT — see [LICENSE](LICENSE).

The inlined body-map artwork is MIT, © 2022 ELABBASSI Hicham
([react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter));
its copyright notice is carried in the comment above the path data in
`supabase/functions/spotter/app.ts`.
