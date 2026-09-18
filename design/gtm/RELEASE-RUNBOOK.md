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
- **Steps 4 and 5 are one action, not two.** Have both commands typed and ready before starting step 4, and
  run step 5 the moment step 4 returns. Between them the database is ahead of the function and **any
  correction a user makes is silently discarded** — see the box under step 5. Do not take a break, read
  output carefully, or answer a message between those two commands. If something forces a pause, finish
  step 5 first and investigate afterwards.
- Informational, not a gate: `select v, count(*) from public.video_cache group by v;` and the same for
  `pack_v`. The cutover no longer empties the cache — `MIN_USABLE_CARD_V = 10` and `MIN_USABLE_PACK_V = 1`
  mean every row v180 wrote is still served, with no model call and no preview consumed — so this is the
  before-picture for watching "(stale v10)" cache-hit log lines drain, not a spend estimate.

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
   **Note the wall-clock time (UTC) this returns.** Expect exactly `20260917130000`, `20260917140000`,
   `20260917150000` in the applied list.
5. **Immediately**, with no other step in between, deploy the edge function (no `--no-verify-jwt` flag;
   `config.toml` carries `verify_jwt = false`):
   `supabase functions deploy spotter`
   **Note the wall-clock time (UTC) this returns.** Then `supabase functions list` → `spotter` version > 180,
   and `supabase migration list` shows all three migrations with a remote timestamp.

   > **What is broken between 4 and 5, and why nothing can pause it.** The migration backfills a
   > `user_workout_override` for every workout that has ever been corrected, and the preservation trigger
   > then rewrites `blocks` from that override on every update. v180's `handleCorrection` and Pumpy's
   > `append_exercises` patch `blocks` without touching the override, so in this window a correction on an
   > already-corrected workout is **silently reverted**. PostgreSQL `RETURNING` reflects BEFORE-trigger
   > values, so the user gets a `200` and the reverted card and watches their edit disappear with no error.
   > Step 2 pauses the cron worker tick; nothing pauses `POST /api/workouts/:id/fix` or `/api/pumpy/confirm`,
   > and pausing them would need a deploy of its own. **The mitigation is that the window is seconds long.**
   > There is no "no corrections in this window" setting to switch on — there is only the discipline of
   > running 4 and 5 back to back at a quiet minute.

5a. Post-deploy check, straight away: edit the two timestamps in
   `tools/release/correction-window.sql` to the times noted in steps 4 and 5 and run
   `supabase db query --linked --file tools/release/correction-window.sql`.
   Expect `corrections_in_window` = 0. A nonzero count is not an outage and cannot be repaired from here:
   those edits are gone, not wrong. Note the affected workout count in `HANDOFF.md` so the owner can decide
   whether anyone needs telling.
6. Resume the worker tick:
   `supabase db query --linked --file tools/release/resume-worker.sql`
   (`select cron.alter_job(jobid, active := true) from cron.job where jobname = 'spotter-worker-tick';`)
7. Smoke test with a throwaway (tag `rel`), never a real account:
   - `python3 tools/throwaway.py ensure rel`
   - `python3 tools/throwaway.py api rel GET limits` → 200, plan `free`, caps present.
   - `python3 tools/throwaway.py api rel POST ingest '{"url":"https://www.tiktok.com/@thewodfather/video/7679960172495785246"}'`
     → 202; within ~60 s `rest rel GET "workouts?select=ingest_status,extracted_by"` shows `ready`. This
     video is in the global cache at `v = 10`, and this build serves from `MIN_USABLE_CARD_V = 10`, so it is
     a cache hit and spends nothing. Confirm it rather than assume it: the function log should carry
     `cache hit tiktok tt-7679960172495785246 (stale v10)`, and `ai_cost_log` should gain no row. If instead
     you see a paid read, stop — something moved the minimum, and the cutover cost model is wrong.
   - A Pumpy confirm round-trip on a fixture proposal (see `tools/pumpy-confirm-db-check.mjs` for the shape).
   - `python3 tools/throwaway.py delete rel`.
   - Re-run the production audit: `unknown_ai_calls` 0, queue idle.
8. Refresh the native shells from main (their public folders are gitignored):
   `npm run ios:sync` · `npm run android:sync` · `npm run parity:check`. **OWNER** rebuilds in Xcode /
   Android Studio when he next cuts a store build. Server support for manifest v3 is now live, so v3 clients
   may ship.
9. Record the release: append the function version, migration list and smoke evidence to `HANDOFF.md`.

## Rollback

**The rollback target is not v180.** Once the migrations are applied, v180 is a build that silently
discards user corrections and answers `200` with the reverted card — the same failure as the 4→5 window,
except it lasts as long as the rollback does and nobody can see it happening. It is the emergency stop, for
**minutes**, not the destination.

- **The real rollback is a new function build**: branch from the deployed RC commit, remove the offending
  change, and `supabase functions deploy spotter`. Everything in the RC that touched `blocks` — the
  correction handlers, Pumpy's `append_exercises`, the reread paths — goes through the override, so a build
  that keeps those and drops the bad route is compatible with the schema. Fix forward. A deploy takes about
  as long as a rollback does.
- **v180 for minutes only** (a route 500ing for everyone, and no fix-forward build ready): redeploy from a
  checkout of `509bc99`: `git worktree add /tmp/rb 509bc99` → `cd /tmp/rb && supabase functions deploy spotter`.
  Start the fix-forward build in parallel and treat the v180 minutes as an outage you are counting, not a
  state you are resting in. Note the start time — the same `tools/release/correction-window.sql` query over
  the rolled-back window tells you afterwards how many edits were lost.
- **Never** drop the preservation trigger, `claim_generation`, or the override columns to make old code
  "work"; that is how user edits get lost. No destructive schema rollback.
- If a migration fails midway, `supabase db push` stops at the failing file; nothing after it is applied.
  Do not deploy the new function in that state (it fails closed on missing RPCs). Fix the file, re-push —
  all three files are re-runnable, and `tools/reader-completion-db-check.mjs` applies `20260917130000` twice
  on every CI run to keep it that way.
- Keep AI admission paused (cron tick inactive) during any rollback, and resume only after the smoke test.

## OWNER actions this release depends on
- **Leave `app_config` key `billing.founding` absent.** It is the switch the function reads; absent means the
  $10 founding discount is not shown and not applied, which is what makes the $50 annual price real. Nothing
  seeds it. Then **delete the coupon `SPOTTER_FOUNDING_YEAR`** in Stripe → Products → Coupons, in the same
  session as the price change, so an old Checkout Session or a direct API call cannot redeem it either.
- Re-run `tools/stripe-setup.sh --live` for the $50 annual price. It also pushes the rewritten Plus product
  description; the old one advertised daily numeric allowances on the page customers buy from.
- Decide whether the `spotter` function gets a `REVENUECAT_API_KEY` secret. Account deletion now deletes the
  RevenueCat subscriber when one is set, and deleting a subscriber needs a **secret** RevenueCat key — the
  public SDK key `spotter-purchases` uses is refused. Without the secret, erasure leaves the subscriber
  behind and logs a 401.
- After `supabase db push`, confirm the claimed-job JSON carries `claim_generation` (one throwaway save,
  then the function log line `job done …`). A stale PostgREST schema cache would send `null` and every
  completion would be fenced out as `stale`.

## After release (same day)
- Apply the allowance/guard values from `design/gtm/ALLOWANCES.md` §5 only after the owner approves them.
- Merge and deploy the ops-alerts branch (its own migration + `ops.ts`) following the same steps; the owner
  then enables reminders on his phone so a staff push subscription exists.
- Merge the signup branch; **OWNER** creates the Turnstile site + Resend domain and runs
  `supabase config push` per the README steps it adds.
