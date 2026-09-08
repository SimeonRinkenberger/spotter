> Update: deployment was authorized and migrations/backend/web were released on September 8. The text below records the pre-release checkpoint. See [production review](../../../production-readiness/2026-09-08/REVIEW.md) for live results and subsequent fixes.

# Budget and abuse protection change — ready locally

No production migration, deployment, Git push, subscription change, or phone installation was performed. Live checkout prices were read using the existing test account: Plus $6.99/month or $39.99/year; founding first year $29.99. Pro is not currently offered. This supersedes the assumption that the app currently charges $50/year.

## Economics and approved budget

The owner approved **$0.50/day and $10/calendar month for the entire app's AI**, not per account and not a spending target. This is at most $120/year under the configured monthly allowance. Hosting, storage, network traffic, payment fees and taxes are separate. Actual spend can be much lower.

The new beta policy also reserves against monthly per-account AI allowances: Free $0.05, Plus $0.50, Pro/staff $1.00. Plus's allowance is $6/year, about 15% of its current regular $39.99 price before other expenses. These are configurable budget settings in ai_guard_policy; they are separate from plan event quotas and must be reflected in launch fair-use messaging. They are not subscription price changes. At scale, raise the project budget against collected revenue and measured successful-import costs, rather than simply removing the guard.

## Implemented

- Shared SQL dollar reservations before generation. Outstanding and unknown calls count toward daily/monthly budgets. Settlements are idempotent; missing accounting fails closed. Expiring a concurrency lease does not refund an uncertain charge.
- Explicit model prices for Luna and configured Gemini 3.6 Flash, including the scheduled end of Google's current promotional rate. Unknown models/providers cannot silently inherit zero prices. Existing current-month cost and coaching-credit records are carried forward on migration.
- Three generating calls project-wide; two ingest jobs project-wide and one active ingest job per account. Provider 429/5xx responses set shared cooldowns. Work is also bounded by a $0.25 per-source rolling-day allowance. Budget/concurrency pauses retain checkpoints and do not consume job failure attempts.
- Atomic HTTP admission: one active AI request/account and six starts/minute, plus daily action/credit reservations. Coaching reservations survive streaming headers and client disconnects. Admission leases and generation deadlines are bounded.
- Daily extraction/save quotas also enforced by a database trigger inside the existing enqueue/requeue transaction. Ready rereads reserve their extraction-log row before calling a provider, then update that row with metrics. A rejected enqueue rolls back both workout and job creation.
- Luna stays the text/image default. Routine extract/reprocess calls disable reasoning and reduce the default JSON output cap to 4,000. Text fallback is one configured Gemini model; the Anthropic/Groq text fallback cascade and Gemini alias rotation are removed from active routing. The prior image-reader/resume fixes are retained.
- Gemini runs a countTokens preflight for the exact request before reserving input/output cost. Static file input is used; no agentic video/tool mode is enabled. Input framing has a conservative allowance. Unknown-duration audio uses this token-counted reader; unbounded duration-priced transcription calls are refused. This changes the previous Groq audio path and requires live quality/latency evaluation.
- Uploaded files require an exact-path, expiring server permit before Storage accepts them. A permit consumes the account's upload attempt allowance. Four outstanding beta upload slots and a 25 MiB bucket limit bound outstanding upload exposure. Users cannot directly read/delete/reupload these temporary files; server cleanup releases slots.
- The frontend requests permits before uploading while retaining upload progress. Old installed clients need the rebuilt app to upload files after the policy change.
- Direct client creation of workout rows and updates to extraction-owned fields are removed; title/category/notes/favorite edits remain. Transactional library limits and title/notes size constraints protect those writes.
- New guard logs have retention cleanup. Account deletion erases admission/permit rows and anonymizes reservations without refunding project spend.
- Fixed the previously failing native activation check: known URL/plain-text UTIs are accepted explicitly alongside type-conformance matching. URL/text accompanied by thumbnails remains supported; image/movie-only payloads remain excluded. This follows Apple's [extension activation guidance](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html).

## Validation

All guard tests run against mocks or isolated PostgreSQL/PGlite, with no paid provider calls or production writes:

- 42 SQL checks, including budget oversubscription, expired/unknown reservations, monthly/user limits, shared worker claims, credit reservations, Storage RLS and actual enqueue-transaction rollback.
- 19 provider transport checks, including stream settlement/cancellation, rejected unknown models, failed accounting and token-count preflight.
- 9 actual HTTP-admission/stream-lifetime checks, including the disconnect race fixed during this work.
- Vision 204/204, ingest coverage 10/10, streaming 117/117, media 60/60, merge 50/50 and confidence 90/90; normalization checks pass.
- Earlier image adapter 31/31 and stationary-reread harness pass.
- Deno type checking, rebuilt web/native assets, Capacitor asset copy and full ios:check pass. The former Swift activation assertion now passes.
- git diff --check passes.

Evidence is in this directory. To run the SQL harness, install @electric-sql/pglite in an isolated test directory and set PGLITE_MODULE to its dist/index.js, or use the documented harness default /private/tmp/spotter-guard-test. This tests PostgreSQL transactions and policies in-process; it is not a multi-host load test.

## Coordinated rollout

1. Review the new migration and backend/client changes together; preserve unrelated existing workspace edits when preparing the release. Do not indiscriminately push the whole dirty working tree.
2. Apply **20260908150000_cost_and_abuse_guards.sql**, deploy the guarded backend, and publish/install the rebuilt client in a coordinated beta update. The migration tightens direct Storage/workout permissions; old uploaded-file clients cannot upload until updated. The new backend intentionally refuses paid work if its guard RPCs are missing. A brief AI/upload pause is preferable to an unguarded fallback.
3. Verify production /api/limits reports 0.50/10, inspect the deployed SQL grants/policies, and verify cached saves and ordinary personal edits remain available.
4. Run one bounded live reread of the original carousel; check all pages, exact alternatives/sets and billed usage. Test one short audio-only file and one mixed video to validate Gemini token preflight, extraction quality and latency. These calls remain subject to the new budget.
5. Validate sharing and uploading on the user's phone. Web/native asset packaging and Swift fixtures do not establish real-device behavior.

Do not roll back by simply restoring the old unguarded backend with production keys. If a smoke test fails, pause generation through the database policy while repairing the issue; existing saved workouts remain readable.

## Remaining launch work

The controls bound AI spending and common save/upload abuse; they do not constitute a full security or capacity certification. Signup/CAPTCHA/IP protections, provider invoice reconciliation, provider account limits, hosting capacity and realistic multi-host load testing still need operational verification. Grouped-image reads, transcript/frame alternatives and deterministic fast paths remain evaluation candidates, not untested production optimizations.

References: [Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [token-count request contract](https://ai.google.dev/api/tokens), [static versus agentic video tokenization](https://ai.google.dev/gemini-api/docs/generate-content/tokens).
