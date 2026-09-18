-- NOTE: `supabase db query --linked --file` prints only the LAST statement's rows. Run this file with psql to see
-- every section, or run one section at a time.
-- Spotter — the weekly operating review.
--
--   supabase db query --linked --file tools/ops/scorecard.sql
--
-- Run it from the repo root on Monday. Every block prints this week and last
-- week side by side, because a single week's number is almost never a decision
-- and the difference between two of them usually is.
--
-- Read-only: nothing here writes, and no block selects a caption, a transcript,
-- a chat message, an email or any other per-user content. Counts, dollars and
-- percentages only. Staff comps and spotter-tw-% fixtures are excluded inside
-- the views themselves, so there is nothing to remember here.
--
-- Weeks are ISO, Monday-start, UTC — the same boundary as the AI budget day, so
-- two numbers on this page can never disagree about where midnight is.

--
-- ================ 1. paid accounts and net recognized revenue ================
-- Annual cash is spread straight-line; a $50 year is $0.96 of this week.
-- CURRENT STATE ONLY: past weeks cannot be reconstructed from these tables.
-- unpriced_accounts > 0 means a store product id is missing from ops_price_book.
select source, status, "interval", accounts, entitled_accounts, trialing_accounts,
       unpriced_accounts, gross_recognized_usd, net_recognized_usd, prices_verified
from public.ops_revenue_week
order by source, "interval", status;

--
-- ================ 2. signups and activation ================
-- Activated = the account has at least one card the reader finished.
select week_start, signups, activated_users, pct_of_week_signups, activated_cumulative
from public.ops_activation_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc;

--
-- ================ 3. who trained ================
select week_start, users_started, sessions_started, users_completed, sessions_completed
from public.ops_started_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc;

--
-- ================ 4. did they come back ================
-- By cohort: of the accounts whose FIRST session was in week_start,
-- how many ever trained again in a later ISO week. The last row or two are
-- always low simply because those cohorts have not had a later week yet.
select week_start, cohort_users, returned_later, pct_returned, active_three_weeks
from public.ops_return_week
order by week_start desc
limit 8;

--
-- ================ 5. imports and corrections ================
-- Usable = ready AND has exercises. critical_corrected_24h is a PROXY:
-- exercise added, deleted or renamed within a day. It misses wrong sets/reps,
-- wrong block structure, late corrections, and cards nobody bothered to fix.
select week_start, imports, ready_imports, usable_imports, failed_imports, pct_usable,
       corrected_24h, critical_corrected_24h, pct_critical_of_ready
from public.ops_imports_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc;

--
-- ================ 6. entitlement / edit / concurrency incidents ================
-- Per design/reader-fixes/RELIABILITY-GTM.md. job_reclaimed is expected when a
-- worker dies; unexplained volume in any row is an operational incident.
-- Rejected stale commits and edit-conflict responses are NOT here: they are
-- return values, not rows. Read the function logs for those.
select week_start, signal, incidents
from public.ops_incidents_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc, incidents desc;

--
-- ================ 7. cost per delivered workout ================
-- Numerator is the guard's authoritative charge, coalesce(charged, reserved).
-- Denominator is every card delivered, INCLUDING cache hits that cost nothing —
-- that is the number that says whether the cache is doing its job.
select week_start, purpose, attempts, delivered_workouts, ai_usd, usd_per_delivered
from public.ops_cost_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc, ai_usd desc;

--
-- ================ 8. what the free tier costs the payers ================
select week_start, free_usd, paid_usd, system_usd, free_users_with_cost,
       payers, free_subsidy_per_payer_usd
from public.ops_subsidy_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc;

--
-- ================ 9. how long a save took ================
-- queue = waiting for a worker (capacity). total = what the user experienced.
select week_start, jobs, p50_total_seconds, p95_total_seconds,
       p50_queue_seconds, p95_queue_seconds, max_total_seconds
from public.ops_latency_week
where week_start >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by week_start desc;

--
-- ================ 10. the week in alerts ================
select day, key, level, detail, created_at, acked_at
from public.ops_alerts
where day >= date_trunc('week', now() at time zone 'UTC')::date - 7
order by day desc, level desc, key;
