# Release runbook — PR #20 release candidate to production

Written 17 September 2026 by the senior session. This is the exact order of operations for shipping the
`gtm-release-candidate` branch. Each step is one command; never chain a migration with a deploy (the
permission classifier refuses the pair, and the pair is also the unsafe order to get wrong). Owner steps are
marked **OWNER**. Everything else the senior session runs from the main checkout on `main`.

## Preconditions
- PR #20 green on both `verify` and `native-parity`; independent review (`briefs/GTM-REVIEW-PR20.md`) has no
  open blocker; staging concurrency harness (`design/gtm/STAGING-CONCURRENCY.md`) reports no invariant violation.
- Production audit shows an idle queue: `supabase db query --linked --file tools/production-audit.sql` →
  `queue` has no `queued`/`running`, `unknown_ai_calls` 0.
- Nobody is mid-save. Pick a quiet minute; the whole window is under five minutes.

## Sequence
1. **OWNER** merges PR #20 (squash). Then, in the main checkout:
   `git checkout main` · `git pull --ff-only` · confirm `git log -1` is the squash commit.
2. Pause the cron worker tick so no new claim starts while the fence lands (the tick is the only scheduler;
   saves also self-kick the worker via `/api/worker/tick`, which is why step 3 waits for zero jobs):
   `supabase db query --linked --file tools/release/pause-worker.sql`
   (`select cron.alter_job(jobid, active := false) from cron.job where jobname = 'spotter-worker-tick';`)
3. Confirm no job is queued or running (re-run the audit). If any are running, wait for them — the edge
   deadline is 8 s per tick — then re-check. Do not proceed with a running job.
4. Apply the three migrations in file order (one command; the CLI applies them in sequence):
   `supabase db push --yes`
   Expect exactly `20260917130000`, `20260917140000`, `20260917150000` in the applied list. Then
   `supabase migration list` must show all three with a remote timestamp.
5. Deploy the edge function (no `--no-verify-jwt` flag; `config.toml` carries `verify_jwt = false`):
   `supabase functions deploy spotter`
   Then `supabase functions list` → `spotter` version > 180.
6. Resume the worker tick:
   `supabase db query --linked --file tools/release/resume-worker.sql`
   (`select cron.alter_job(jobid, active := true) from cron.job where jobname = 'spotter-worker-tick';`)
7. Smoke test with a throwaway (tag `rel`), never a real account:
   - `python3 tools/throwaway.py ensure rel`
   - `python3 tools/throwaway.py api rel GET limits` → 200, plan `free`, caps present.
   - `python3 tools/throwaway.py api rel POST ingest '{"url":"https://www.tiktok.com/@thewodfather/video/7679960172495785246"}'`
     → 202; within ~60 s `rest rel GET "workouts?select=ingest_status,extracted_by"` shows `ready` (this
     video is in the global cache — no AI spend).
   - A Pumpy confirm round-trip on a fixture proposal (see `tools/pumpy-confirm-db-check.mjs` for the shape).
   - `python3 tools/throwaway.py delete rel`.
   - Re-run the production audit: `unknown_ai_calls` 0, queue idle.
8. Refresh the native shells from main (their public folders are gitignored):
   `npm run ios:sync` · `npm run android:sync` · `npm run parity:check`. **OWNER** rebuilds in Xcode /
   Android Studio when he next cuts a store build. Server support for manifest v3 is now live, so v3 clients
   may ship.
9. Record the release: append the function version, migration list and smoke evidence to `HANDOFF.md`.

## Rollback (compatible pair only)
- **Edge only** (bad route, bad prompt, latency): redeploy the previous main commit's function from a
  checkout of `509bc99`: `git worktree add /tmp/rb 509bc99` → `cd /tmp/rb && supabase functions deploy spotter`.
  The migrations stay. Old code's correction handlers do NOT advance `user_workout_override`, so while rolled
  back, corrections on a card that is being re-read may be ignored by the preservation trigger. Acceptable for
  hours, not days — fix forward.
- **Never** drop the preservation trigger, `claim_generation`, or the override columns to make old code
  "work"; that is how user edits get lost. No destructive schema rollback.
- If a migration fails midway, `supabase db push` stops at the failing file; nothing after it is applied.
  Do not deploy the new function in that state (it fails closed on missing RPCs). Fix the file, re-push.
- Keep AI admission paused (cron tick inactive) during any rollback, and resume only after the smoke test.

## After release (same day)
- Apply the allowance/guard values from `design/gtm/ALLOWANCES.md` §5 only after the owner approves them.
- Merge and deploy the ops-alerts branch (its own migration + `ops.ts`) following the same steps; the owner
  then enables reminders on his phone so a staff push subscription exists.
- Merge the signup branch; **OWNER** creates the Turnstile site + Resend domain and runs
  `supabase config push` per the README steps it adds.
