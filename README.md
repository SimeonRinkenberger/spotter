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
  balance, and a session history.

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
                        └─ POST /api/worker/vision ──► one carousel slide, own isolate

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
workout and is not one.

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

### Source layout

| Path | What |
|---|---|
| `supabase/functions/spotter/index.ts` | The whole backend: URL parsing, scrapers, AI chain, extraction, routes |
| `supabase/functions/spotter/catalog.ts` | Canonical exercise catalog + the name normalizer (source of truth) |
| `supabase/functions/spotter/evidence.ts` | Evidence attachment, chapter parsing, unit repair, the confidence score |
| `supabase/functions/spotter/net.ts` | Outbound request guard: private-address filter, per-hop redirect checks |
| `supabase/functions/spotter/style.ts` | Design tokens and every component style |
| `supabase/functions/spotter/markup.ts` | Page head, landing page, app shell, sheets |
| `supabase/functions/spotter/app.ts` | All app logic: auth, library, Workout Mode, plan, progress |
| `supabase/functions/spotter/page.ts` | Stitches the three together for the function |
| `build.mjs` | Same stitch, writing `docs/index.html` for GitHub Pages |
| `supabase/migrations/` | Schema, RLS policies, profile trigger, storage bucket, exercise catalog, ingest queue |
| `tools/` | Catalog migration generator, normalizer + confidence test batteries, one-time backfill |

The three frontend modules are `String.raw` templates, so they must never contain a
backtick or `${`. `build.mjs` fails loudly if they do.

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

Cache hits count only against `LIMIT_SAVES`, so saving videos other people already saved is
effectively free.

**A ceiling on the day's bill.** Every model call records an estimated cost in
`ai_cost_log` from the provider's own token counts. Once the day's total crosses
`DAILY_SPEND_USD` (default `5`), providers that carry a price are switched off and
extraction falls through to the free path — a thinner card, never a failed save. A provider
is "paid" iff a price is configured for it (`PRICE_OPENAI_IN` / `_OUT`, and the same for
`ANTHROPIC`, `GEMINI`, `GROQ`), so putting a key on a paid plan is a config change, not a
code change. `GET /api/limits` reports `spend_today`, `spend_limit` and `paid_enabled`.

### Platform notes

| Platform | Caption source | Status |
|---|---|---|
| Instagram | og: tags via the `facebookexternalhit` UA, plus the `/embed/captioned/` page | Works. Carousel slides are read with vision only when the caption yields nothing. |
| TikTok | oEmbed, then `/embed/v2`, then the watch page's rehydration blob, then og: tags | Works. Verified 200 on real videos from Supabase's datacenter IPs. og: tags never carry the caption and are only trusted for thumbnail and handle. |
| YouTube | oEmbed for title/author/thumb, Data API v3 for the description | The description **needs an API key**. Verified 2026-09: from a datacenter IP the watch page returns 429, the WEB player endpoint returns `LOGIN_REQUIRED`, ANDROID/iOS clients fail attestation, and both embedded-player clients error. Set `YOUTUBE_API_KEY` (or enable YouTube Data API v3 on the same Google project as `GEMINI_API_KEY`, which is used as a fallback). |
| Any web page | og: tags plus page text | Works. |

## Self-hosting

1. Create a Supabase project and `supabase link --project-ref <ref>`.
2. `supabase db push`.
3. Auth → Providers → Email on. Leave "Confirm email" **off** until you configure custom
   SMTP: the built-in mailer allows only a couple of messages an hour, which stalls signups.
4. Set the function secrets you want:
   `GEMINI_API_KEY`, `GROQ_API_KEY`, optionally `OPENAI_API_KEY` + `OPENAI_MODEL`
   (paid primary), `ANTHROPIC_API_KEY` + `CLAUDE_MODEL`, `YOUTUBE_API_KEY`,
   `ALLOWED_ORIGINS`, `LIMIT_EXTRACT`, `LIMIT_SAVES`, `LIMIT_HELPER`, `DAILY_SPEND_USD`.
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

## Saving from your phone

Settings in the app shows a personal save address containing your own key. Build a Shortcut:

1. **Receive** URLs from the share sheet
2. **Get Contents of URL** — your address, Method `POST`, Request Body JSON,
   one field `url` set to the Shortcut Input
3. **Show Result**

Share any reel to it and the workout is in your library before you put the phone down.
The key is not your password, but it can save to your account — rotate it in Settings if it
leaks.

## Licence

MIT — see [LICENSE](LICENSE).
