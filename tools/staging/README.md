# Staging correctness harness

`node tools/staging/concurrency-check.mjs` (run from the repo root, after `npm install`) starts a
throwaway `postgres:15-alpine` container called `spotter-staging-pg` on `127.0.0.1:54329` with a
password generated at run time and passed through the environment rather than the command line,
rebuilds the schema shim that `tools/reader-completion-db-check.mjs`, `tools/pumpy-confirm-db-check.mjs`
and `tools/ai-attempt-db-check.mjs` use (those three stay the source of truth for table shapes),
applies the real migrations `20260917120000`, `20260917130000`, `20260917140000` and `20260917150000`,
and then replays seven concurrency scenarios over twelve genuinely separate connections — twenty
randomized rounds each, every round parked on a real row or advisory lock so the workers are inside
the function at the same time. It prints a summary table (including a `parked` column that proves the
race happened; a scenario that never contended is reported as a violation, not a pass), records every
SQLSTATE it saw, exits non-zero on any invariant violation, and stops and removes the container on the
way out. Requires only Docker and the `postgres:15-alpine` image — it makes no network calls, no AI
calls, and never touches the live Supabase project. `STAGING_ROUNDS=3` shortens a run, `STAGING_PORT`
moves the port, and `STAGING_KEEP=1` leaves the container up for poking at with `psql`. It is
deliberately not part of `npm run gtm:check`, because CI has no Docker daemon; run it before shipping
a migration that changes locking, and see `design/gtm/STAGING-CONCURRENCY.md` for what each scenario
means for a user when it fails.
