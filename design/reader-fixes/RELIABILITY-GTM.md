# Reader reliability changes — September 17, 2026

Implemented locally; not deployed. No paid model calls, external writes, or production model changes were made for this work.

## Changes

- `20260917130000_reader_completion_fence.sql` introduces monotonic `claim_generation`. The ordinary retry counter is not a fence: budget pauses decrement it. Generation advances whenever a job is claimed again.
- Worker completion, failure/refund, stage changes, and shared-cache publication verify account, job, current owner, running status, and generation inside a database transaction. Completion also verifies the workout still points to that job and checks current plan/preview eligibility. Checkpoints use the same generation in their update filter. Lease age alone does not invalidate a worker: reclaim by the sweeper does.
- Queue attachment and completion serialize on the account profile; active-job selection locks the job row. This closes selecting an active job and attaching a workout after that job finishes. Repeated retry requests join the existing job without another quota-log reservation. Legacy processing rows pointing to a done job can be requeued.
- A worker completes/releases only the preview reservation from the job's creation month, created no later than that job. A September job finishing in October cannot charge the October reservation. Successful cached previews reserve and commit the workout in one transaction; failure rolls the reservation back. An implicit cached request cannot silently consume a new month's preview.
- Exercise corrections and accepted Pumpy additions store a private `user_workout_override`. A database trigger protects it across background, synchronous reread, and cached-preview paths. Deletions, renamed movements, intentional null doses, and an intentionally empty exercise list survive. Optimistic edit revision checks reject concurrent stale personal updates. Historical correction rows/edited markers seed the override conservatively.
- Owner-authenticated title/category edits have separate `user_title_override`/`user_category_override`, so renaming or recategorizing a workout does not freeze its exercise list. Existing rename history causes the current saved title to be protected; this migration does not reconstruct already-lost historical titles.
- Shared caches receive source output only, never personal overrides. The merge helper additionally gives explicitly edited exercises precedence over non-empty new model values.

## Deliberate limitation

This is a conservative personal-list snapshot, not field-level patch replay. After a user edits exercises, rereads can update shared source evidence and other metadata, but do not automatically replace the personal exercise list. That prevents silent losses and deletion resurrection at the cost of not applying fresh exercise-list improvements automatically. Explain this in the reread experience before spending on rereads of edited workouts. A later review-and-apply source changes UI/field-level patch system should replace the conservative snapshot only with equivalent deletion, repeated-exercise, and conflict tests. Never silently discard the overlay to make rereads look effective.

## Verification

- `node tools/reader-completion-db-check.mjs`: executes the shipping migration and production reservation function in PGlite/PostgreSQL. Covers stale/same-worker generations, budget pause/reclaim, account isolation, duplicate completion, edits/renames/deletions committed while a read is running, direct-write protection, stale personal edits, entitlement changes, preview month boundaries, superseded jobs, cache/stage fencing, failure cleanup, cached-preview transactional rollback, duplicate import/retry quota handling, and server-only completion permission.
- `node tools/reader-db-check.mjs`: existing four-preview quota, repeat idempotency, account/RLS isolation, UTC reset, separate Basic/Plus cache and downgrade checks.
- `deno run --allow-read tools/merge-harness.ts`: 57 checks, including explicit 2×7 versus fresh 3×12 and intentionally empty rest.
- `node tools/reread-harness.mjs`: busy state, duplicate-click, success/error cleanup, queued response, navigation.
- `deno run --allow-read tools/ingest-coverage-harness.ts`: 10 coordinator coverage checks with fenced cache publication; unexpected exceptions fail the harness.
- `deno check --cached-only supabase/functions/spotter/index.ts`: passed after these changes.
- Reader-access fixture updated to test RPC handoff; its Pumpy helper fixture is maintained alongside the parallel Pumpy-context change.

PGlite executes real SQL but is not a multi-connection production PostgreSQL load test. Promise-based repeated requests here verify idempotent outcomes, not every possible network/transaction schedule. Before broad launch, test actual concurrent queue/finish/sweeper and entitlement-webhook interleavings in staging, including transaction deadlock/retry behavior.

## Deployment and rollback gates

1. Review the migration together with edge code; do not ship code before the new RPCs/columns exist. Run existing migration/access/reader checks and the Pumpy acceptance transaction checks.
2. In an approved deployment window, quiesce new worker claims and drain old workers before applying migration and switching edge code. An old worker does not know the fence. Back up the affected tables and record migration status.
3. Verify real Basic/Plus/preview paths, edit-during-read, cancel/restore purchase, midnight UTC, stale claim, duplicate import and repeated retry in staging. Re-enable claims only after smoke checks.
4. Preserve overlay and generation columns on rollback. A rollback to old edge code alone is unsafe: old correction/Pumpy handlers do not advance overrides, so their naked block updates may be ignored. Use a rollback build that retains these persistence contracts, or pause affected mutation routes. Do not drop the preservation trigger to hide that incompatibility.
5. Monitor rejected stale commits, processing rows attached to terminal jobs, preview reservations without eligible completion, edit-conflict responses, and transaction failures. A rejected stale commit is expected fencing; unexplained volume is an operational incident.

## Remaining readiness evidence

No production data repair, store purchase verification, full-device account-switch testing, live deployment smoke, multi-connection stress test, or proof of total GTM readiness is claimed. Concurrent accepted coach proposals are a separate transaction/idempotency workstream. Provider cost/availability and human-reviewed exercise accuracy remain separate release gates.
