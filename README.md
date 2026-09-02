# Spotter

Save a fitness video from TikTok, Instagram or YouTube. Spotter reads the exercises, sets
and reps out of the caption, gives you a real workout card, then walks you through it one
move at a time and logs what you lifted.

**Live app:** https://simeonrinkenberger.github.io/spotter/

<img src="docs/icon.png" width="88" alt="">

## What it does

- **Save** — paste a link, or share to it from your phone with a one-step iOS Shortcut.
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
| `LIMIT_HELPER` | 300 | `/api/explain` and `/api/swap` |
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

## Saving from your phone

Settings in the app shows a personal save address containing your own key. `POST` to it with
a JSON body:

```json
{ "url": "https://...", "html": "<optional: the page, already fetched>", "caption": "optional: the text you can see" }
```

`url` is the only required field. `html` is capped at 2,000,000 characters (413 above that)
and `caption` at 6,000. Anything supplied is parsed with no network call at all, and only the
fields still missing afterwards are looked for online.

### Recipe 1 — the simple one

1. **Receive** URLs from the share sheet
2. **Get Contents of URL** — your address, Method `POST`, Request Body JSON,
   one field `url` set to the Shortcut Input
3. **Show Result**

### Recipe 2 — the one to build (recommended)

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
