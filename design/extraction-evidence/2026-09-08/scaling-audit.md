# Workout-saving cost and scaling audit — 8 September 2026

## Conclusion

Keep Luna as the default text/image reader. The largest immediate risks are non-atomic usage checks, a soft global spend ceiling, unconstrained aggregate worker concurrency, and uploads accepted before application quota checks. No production deployment or configuration changes were made during this audit. Earlier image-reader and reread-button fixes remain local.

Evidence: source and migrations; read-only production app_config, ai_cost_daily, saves_log, ingest_jobs and profile-plan counts; deployed /api/limits under the existing test account. Provider billing consoles, current SQL grants/policies, signup protections, and actual provider rate-limit tiers were not independently verified. Source-based permission findings need a deployed-policy check before closing them. No load test or live model accuracy comparison was performed.

## Deployed settings and observed usage

| Daily allowance | Free | Plus | Pro |
| --- | ---: | ---: | ---: |
| Saves | 30 | 200 | 500 |
| Extractions | 10 | 60 | 150 |
| Media steps | 2 | 15 | 50 |
| Uploads | 1 | 10 | 25 |
| Helpers | 25 | 60 | 600 |

Free library cap: 20; Plus/Pro unlimited. Staff plan caps are unlimited. Profile-specific overrides can change allowances. These are separate event allowances, not a guaranteed maximum number of model calls or dollars. Automatic job retries and multiple slides consume multiple calls within an extraction.

Live /api/limits reports a $5/day project spend ceiling. Pumpy has six turns/minute, per-turn credit controls, and daily/monthly credits: Free 150/1,500; Plus 400/5,000; Pro 1,000/15,000. Those credit checks also precede recording and are not reservations.

September 1–8 ledger snapshot: OpenAI 113 calls, 136,714 input tokens, 28,238 output, 42,561 cached, estimated $0.053566. Gemini 42 recorded calls, 73,534 input and 18,051 output tokens, estimated $0. Groq two calls, estimated $0.000522. These are application records, not invoices; unrecorded failures and zero-priced providers make them incomplete cost evidence. Three profile rows and eight logged saves (one cached) are not representative production traffic. Six reprocess events also show why retry cost must be tracked separately from successful saves.

Live routing: text model gpt-5.6-luna; Gemini text/vision gemini-3.6-flash; Anthropic fallback Haiku 4.5; Groq fallback pool. vision.max_slides=3 is the single-image setting; carousel reads have a separate default and must not be mistaken for a universal three-page cap. Live media video escalation is enabled, max bytes 40,000,000 and timeout 150 seconds.

## Workflow and avoidable AI

1. Resolve source and look up the shared post cache. Suitable complete cards are reused across users. Thin cached cards can explicitly enqueue a media upgrade, so not every cache hit is free. The SQL queue coalesces active jobs for the same post and prevents duplicate user/post rows.
2. Fetch source metadata. A heuristic parser builds a fallback; any nonempty caption/transcript still goes through text AI when configured, even when the heuristic result exists. A reliable structured-input fast path is worth evaluating, but generic heuristics must not silently replace accurate extraction.
3. Read images when needed. Production still uses the old Gemini image path. The local fix uses Luna first, bounded Gemini fallback and saved page coverage. It avoids charging again for successful pages during automatic resume.
4. For thin video cards, try transcription and text extraction, then direct video understanding when needed. This can legitimately require multiple AI calls. Complete available transcripts should be combined with captions before extraction where possible; avoid a redundant caption-only call when media is already known to be necessary.
5. Validate/normalize, cache, save and notify. Completeness should be based on source evidence and page coverage, not merely valid JSON or an exercise-count threshold.

The current general OpenAI text adapter omits reasoning_effort and permits up to 8,000 output tokens for JSON (purpose-specific caps may reduce it). Luna defaults to medium reasoning. Evaluate none for routine extraction and low only where it improves measured accuracy; do not disable reasoning indiscriminately for coaching. The local image adapter already uses none and a 4,000-token output cap. Caps are not expected usage.

The general fallback chain is OpenAI → Anthropic → Gemini → Groq, potentially with model pools. Use a bounded transient retry/cooldown and at most one task-appropriate fallback. Do not pay for escalating authentication errors, inaccessible media or malformed source downloads. Add deadlines to the general text adapter; the image adapter already has them.

For carousels, test small ordered groups of images in a single Luna call. This may share instructions and preserve references such as “same reps for all movements,” but could increase omission rates. Compare with individual-slide reads using real labeled examples before changing the route. Transcript plus selected frames is another candidate; it is not equivalent to understanding motion in raw video. Avoid an extra AI classifier when source metadata can select the route.

## Launch blockers, in priority order

### 1. Reserve quotas and spending before work

index.ts countsFor (~6444), handleReprocess (~7973), spendToday (~988), paidAllowed (~1032), and pumpyMeter/handlePumpyChat (~10042/10112) read usage before work and write after. enqueue_ingest inserts a save log transactionally but does not atomically enforce the allowance inside that transaction. Concurrent distinct requests can all see available capacity. Ready-card rereads run inline and log at ~8118, allowing duplicate paid extraction across simultaneous API requests despite the frontend button guard.

Implement one database transaction that locks the user's allowance, checks remaining units, reserves work and enqueues it. Give every reread an idempotency key and one active job per target. Reconcile reservations on finish/failure with expiring leases for crashed workers. Apply this to coaching/helpers/media as well as new saves. Add short-window per-user limits and an ingress IP limit; signup/bot protections need separate verification because users can create multiple accounts.

The global spend check caches usage for 20 seconds per isolate, fails open if its read fails, and has no reservation. Multiple isolates can overshoot together. RecordCost failures are logged but do not stop work. Introduce a shared pessimistic dollar reservation based on maximum permitted inputs/outputs, reconcile against reported usage, and pause paid work when accounting is unavailable. Unknown outcome after timeout must not automatically refund all reserved cost. Add a monthly/project allowance, alerts, and explicit per-import ceilings.

### 2. Account for actual models and media

PRICES (~681) is keyed by provider rather than model. Gemini/Groq text rates default to zero, and isPaidProvider uses those configured prices to determine whether the ceiling applies. Live Gemini entries are zero. This does not establish whether Google's billing account is free or paid. A paid Gemini key with zero configured rates defeats useful metering and parts of the spend gate. Transcription has a separate duration-based cost and is recorded.

Use a model/version price catalog including media and cached-token rules. Never treat an unknown price as free. Record job ID, attempt, stage, duration, model, tokens, cache disposition and observed/estimated/unknown cost. Reconcile daily totals with provider usage. A dollar ceiling controls availability too: $5/day is too little for large all-carousel traffic, even when every user is legitimate.

### 3. Bound total concurrency

WORKER_BATCH=4 is a per-invocation default, not a project-wide cap. Every save can kick another worker; each job can fan out several image requests. claim_ingest_jobs uses SKIP LOCKED correctly to avoid duplicate claims, but does not limit total running jobs. Add provider-wide request/token budgets and a shared active-job lease limit, per-user fairness, queue backpressure, Retry-After-aware exponential backoff with jitter, and cooldowns on repeated 429/503. Queue pressure should delay reads rather than multiply attempts.

### 4. Enforce storage and database quotas at the boundary

20260902130000_uploads_bucket.sql permits authenticated inserts anywhere inside the user's own folder, with a bucket file ceiling of 100 MiB. The processing endpoint's 25 MiB default and daily upload allowance run later. Source policies contain no daily object/byte quota, allowing orphan uploads without submitting them for transcription. Cleanup after two hours limits retention, not incoming bytes or request load. Require an expiring, quota-reserved upload authorization before Storage accepts a file; align file limits and bound total outstanding bytes and objects per user.

20260901000000_init.sql permits own-workout insert/update through RLS. No later column restriction/quota policy for workouts was found in migrations. RLS prevents cross-user access but is not a library-size limit. Verify deployed grants and restrict ingest-owned fields/direct creation or enforce equivalent database quotas. Do not remove legitimate favorite/note/update operations accidentally.

### 5. Capacity and retention

The app subscribes to workout changes per signed-in client (app.ts ~990). Simultaneous connected clients, rather than total registrations, drive realtime capacity. Supabase Free includes 200 peak realtime connections, 500 MB database and 1 GB storage; these are not a plan for thousands of concurrent clients. Verify the launch plan and configure capacity/alerts. See [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

Edge functions have 256 MB memory, 2 seconds CPU per request and a 150-second response idle timeout. Paid plans increase worker wall time but do not remove the CPU limit. Media transforms/base64 work and retries can exhaust runtime before token costs become large. Keep substantial video processing in a bounded media worker if needed; retain the lightweight API/queue in Supabase. See [runtime limits](https://supabase.com/docs/guides/functions/limits).

Define retention/aggregation for completed jobs, raw metadata and usage logs. The source has orphan-upload and stuck-job cleanup, but no general time-based ledger/job retention was found. Measure DB growth, queue age, 429 rate, failure/partial rate, p95 latency and cost per successful unique import. Load-test bursty mixed media and a provider outage in staging, including concurrent quota exhaustion and duplicate rereads.

## Model choice and cost scenarios

[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) accepts text/images, not raw audio/video. Standard token prices are $0.20/M input, $0.02/M cached input, $1.20/M output. Keep it as default; input support does not prove extraction quality.

[Google's pricing](https://ai.google.dev/gemini-api/docs/pricing) lists Gemini 2.5 Flash-Lite at $0.10/M text/image/video input and $0.40/M output. It is cheaper on listed token rates, not proven better on these workouts. Gemini 3.1 Flash-Lite is $0.25/M text/image/video input and $1.50/M output, so it is not a blanket price improvement over Luna. Models tokenize images differently; compare complete successful imports, not just token prices. Verify lifecycle and run the same labeled evaluation before selecting an older alternative. No reason found to switch the default purely on a price table.

Illustrations, excluding cached-input discounts:

| Aggregate tokens per unique import | Cost/import | 10,000 unique imports | 100,000 unique imports |
| --- | ---: | ---: | ---: |
| 5,000 input + 1,000 output | $0.0022 | $22 | $220 |
| 30,000 input + 7,000 output | $0.0144 | $144 | $1,440 |

These are assumed token bundles, not measured text/carousel averages. For context, 1,000 active users × 20 saves/month × 50% requiring new extraction = 10,000 unique imports; 10,000 users under the same assumptions produce 100,000. Add transcription/video, fallback, retries, hosting, storage, retrieval and support. The production sample is too small to forecast the mix or shared-cache hit rate.

Recommended implementation order: atomic quota/job admission and spend reservations; accurate metering and bounded worker concurrency; upload authorization and deployed grants review; then cheaper prompt settings/grouped-image experiments with accuracy and cost evaluation. Keep the earlier local extraction reliability fixes in that release plan.
