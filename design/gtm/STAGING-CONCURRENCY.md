# Staging correctness: the PR #20 migrations under real multi-connection concurrency

Gate: "Staging correctness" in `design/GTM-RELEASE-READINESS.md`.
Harness: `tools/staging/concurrency-check.mjs` (see `tools/staging/README.md`).
Run: `node tools/staging/concurrency-check.mjs` from the repo root, 17 Sept 2026.

**Result: no invariant violation. 1,050 assertions over 205 randomized rounds, twice, identically.**

## Why this run says something PGlite could not

`tools/reader-completion-db-check.mjs`, `tools/pumpy-confirm-db-check.mjs` and
`tools/ai-attempt-db-check.mjs` run the same migrations in PGlite: one connection, one backend.
`Promise.all` there interleaves cooperatively, so a row lock wait cannot happen, a `SELECT ... FOR
UPDATE` cannot block and re-read the newer row version after the lock is released, and a deadlock
cannot occur. Those three are exactly the mechanisms the reader fence relies on.

This harness runs the same SQL in a throwaway `postgres:15-alpine` container over twelve separate
TCP connections. Every scenario parks its workers on the first row or advisory lock the function
under test takes, then releases the barrier so they race for real. The `parked` column below is the
number of backends observed asleep on a lock at the moment the barrier lifted — it is the harness
checking itself, because a scenario that never contends passes vacuously, and the harness reports
zero contention as a violation rather than a pass.

## Scenarios

| # | Scenario | Rounds | Assertions | Result | Parked | SQLSTATEs | What a failure would have meant for a user |
|---|---|---|---|---|---|---|---|
| 1 | Two workers complete the same job at once (one stale generation; and two live invocations of the same claim) | 20 | 130 | pass | 2 of 2 | none | Two reads merged into one card: half the exercises from one pass, half from another, or a double preview charge |
| 2 | Reader completion racing the owner's own edit, and racing a Pumpy append confirmation | 40 | 200 | pass | 2 of 2 | none | The user renames a workout or fixes an exercise, the model finishes a second later, and the correction silently disappears |
| 3 | Sweeper reclaims a job (generation++) while the old worker is mid-completion | 20 | 90 | pass | 1 of 1 | none | A timed-out job gets handed to a new worker, then the old worker wakes and overwrites the new read — the card the user sees is the one that was already abandoned |
| 4 | Five concurrent confirmations of the same Pumpy proposal (same prepared identity, and five different ones) | 20 | 120 | pass | 5 of 5 | none | Tapping "yes" twice on a slow connection creates the workout twice, or two conflicting receipts in the chat |
| 5 | Preview reservations: eight concurrent taps against the four-a-month cap (5a), and the UTC month boundary (5b) | 40 | 140 | pass | 8 of 8 | none | A Basic account gets five or more premium reads in a month — AI spend the owner never agreed to — or loses a month's allowance at midnight UTC |
| 6 | Account switch: user B completes user A's job concurrently with A | 20 | 80 | pass | 2 of 2 | none | One account's workout written into another account's library |
| 7 | AI attempt accounting: ten parallel settlements (7a), forced metadata failure beside live settlements (7b), ten parallel admissions against the daily guard (7c) | 45 | 290 | pass | 5-10 of 10 | `23514` x40, all deliberately injected by 7b | A charge attributed to the wrong reservation, or a failed attempt rolling its reservation back so the retry is a free provider call, or concurrent admissions spending past $0.50/day |

Totals: 205 rounds, 1,050 assertions, 0 violations. Repeated end-to-end twice with identical
results (`evidence/concurrency-run-1.txt`, `evidence/concurrency-run-2.txt` in the session
scratchpad; exit code 0).

## Postgres errors observed

Across both full runs: **no deadlocks (`40P01`), no serialization failures (`40001`), no lock
timeouts (`55P03`), no statement timeouts (`57014`)**. The only SQLSTATE seen was `23514`
(check violation) forty times, every one of them the constraint scenario 7b installs on purpose to
prove that a failed metadata write leaves the reservation held. Workers run with
`lock_timeout='10s'` and `statement_timeout='30s'`, so a lock cycle would have surfaced as an error
rather than a hang.

This is a real result, not an absence of testing: scenarios 2b and 7 deliberately cross lock
orders (`confirm_pumpy_proposal` takes `pumpy_messages` → `profiles` → `workouts`, while
`finish_ingest_job` takes `profiles` → `ingest_jobs` → `workouts`), and no cycle formed because
both paths reach `profiles` before `workouts`. That ordering is load-bearing and should not be
changed casually.

## Two throughput facts, not correctness failures

- **Every AI settlement in the project serializes on one row.** `ai_reserve`, `ai_settle` and
  `ai_record_attempt` all begin with `... from ai_guard_policy where singleton for update`. Ten
  parallel settlements took ~4.8s of the run wall clock because they queue behind each other. At
  beta volume this is free; it is a single global lock on the path of every paid call, so it is
  worth remembering before raising `max_calls`.
- **A wrong-account caller still takes a row lock on the victim's job.** `finish_ingest_job`
  executes `select ... from ingest_jobs where id=p_job for update` before it compares `user_id`, so
  a caller with the wrong account briefly blocks the rightful worker. It always returns `stale` and
  writes nothing (scenario 6 asserts this 80 times), so it is not a correctness or disclosure
  problem, only contention.

## Divergences between the three PGlite checks (the brief asked for these)

They are not one shim; they are two.

1. `reader-completion-db-check.mjs` and `pumpy-confirm-db-check.mjs` share a byte-identical base
   shim. The Pumpy check then adds `app_config`, `pumpy_threads`, `pumpy_messages`, `plan`,
   `profiles.limits` and fifteen `corrections` columns on top.
2. `ai-attempt-db-check.mjs` shares nothing with them. It shims `ai_guard_policy` as a single
   `singleton boolean primary key` column, where the real table in `20260908150000` has
   `daily_usd`, `monthly_usd`, `max_calls`, `max_jobs` and `user_monthly_usd` as well. **No PGlite
   check exercises `ai_reserve`'s budget arithmetic at all.** This harness uses the real policy
   table and adds scenario 7c to cover it.
3. The shimmed `video_previews` primary key is `(user_id, shortcode, month)`; the shipping table in
   `20260917120000` declares `(user_id, month, shortcode)`. The uniqueness is equivalent, the index
   column order is not.
4. The shimmed `video_previews` has no `references auth.users(id) on delete cascade` and no RLS or
   grants; the shipping one has all three.

## What this run does NOT cover

- **RLS.** No shim applies the policies, so nothing here proves policy behaviour under concurrency.
  The `has_function_privilege` assertions in the PGlite checks remain the only grant coverage.
- **`publish_ingest_cache`'s dynamic SQL beyond three columns.** The function allowlists twenty
  cache columns and builds `format('%I')` identifiers from them, but the shimmed `video_cache` only
  has `shortcode`, `card`, `basic_card`, `basic_v`. The other sixteen paths are untested here and in
  PGlite. Closing this needs the real `video_cache` shape in the shim, which the three checks own.
- **The `preserve_visual_cache` trigger** from `20260917120000`: the checks take only the
  `reserve_video_preview` slice of that migration, so the trigger that protects a premium cache
  entry from a simultaneous basic save is not exercised on any connection count.
- **The real month rollover.** `reserve_video_preview` reads `now()` and is declared
  `set search_path=public`; `pg_catalog` is still searched first, so `public.now()` cannot shadow it
  and the shipping function is not clock-controllable. Scenario 5b therefore runs a wrapper built by
  textually replacing the single `now()` in the migration's own body with a parameter — the advisory
  lock, the existence probe and the `>= 4` cap are untouched, and the harness asserts the
  substitution count so a future edit cannot silently desynchronise it. **Verified by proxy, not
  directly.** Giving `reserve_video_preview` an optional clock parameter would make it directly
  testable; that is a source change, not a test change, and was out of scope for this brief.
- **PostgreSQL 15 vs production's 17.6.1.166.** The brief specified `postgres:15-alpine`. The
  locking semantics used here (READ COMMITTED re-check after a lock release, advisory locks,
  `for update` ordering) are unchanged between 15 and 17, but this run is not on the production
  engine version. See `design/gtm/RESTORE-DRILL.md` for why that gap matters elsewhere.

## Verdict for PR #20

Nothing found in these three migrations blocks the merge. The reader fence, the Pumpy transactional
confirmation and the AI attempt ledger all hold their invariants when the callers genuinely collide.
