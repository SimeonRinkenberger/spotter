-- Spotter — the weekly operating scorecard and the alert that wakes somebody up.
--
-- Two separate jobs live in this file and they fail differently, so it is worth
-- saying which is which before the SQL starts.
--
--   The VIEWS are the weekly review. They are read on Monday by a human, they are
--   allowed to be a little slow, and every one of them carries a `week_start` so
--   the review is one `where week_start = date_trunc('week', now())::date` across
--   the set. Nothing here is a real-time gauge.
--
--   `ops_alerts` + `ops_alert_check()` are the pager. They run every fifteen
--   minutes, they answer one question — "is something wrong right now" — and the
--   unique `(key, day)` is deliberate: an alert that fires once a day is read,
--   and an alert that fires every fifteen minutes is filtered into a folder.
--
-- Everything here is service-role only. These rows are the whole business in
-- aggregate; `authenticated` must not be able to read a single one of them, and
-- the revokes below are what enforces that rather than RLS, because a view does
-- not carry RLS of its own.
--
-- The views deliberately run with the VIEW OWNER's rights (no
-- `security_invoker = on`, unlike public.save_health and friends). They have to
-- read `auth.users` to exclude the owner's own throwaway fixtures, and no role a
-- client can reach is granted select on them, so owner's rights is the narrow
-- choice here rather than the loose one. Supabase's linter will call these
-- "security definer views"; that is expected and is why this comment exists.
--
-- Additive and re-runnable: every create is `or replace` / `if not exists`, the
-- seeds are `on conflict do nothing`, and `cron.schedule` upserts by job name.

-- ---------- the week, in one place ----------
--
-- ISO weeks, Monday-based, pinned to UTC. Every other date boundary in this
-- database (ai_spend_today, ai_cost_daily, video_previews.month) is UTC, and a
-- scorecard that quietly used Chicago's midnight would disagree with the budget
-- numbers on the same page by a few hours' worth of spend once a week.

create or replace function public.ops_week(ts timestamptz) returns date
language sql immutable as $$ select date_trunc('week', ts at time zone 'UTC')::date $$;
comment on function public.ops_week(timestamptz) is
  'Monday of the ISO week containing ts, in UTC. The single week boundary for every ops view.';

-- ---------- who counts ----------
--
-- Not a scorecard line: the shared exclusion filter, so "staff and test accounts
-- excluded everywhere" is one definition rather than eight copies of a join that
-- can drift apart. `plan = 'staff'` is the comp/owner marker, and the throwaway
-- fixtures tools/throwaway.py creates are all `spotter-tw-%@example.com`.
--
-- Left join from auth.users rather than an inner join on profiles: an account
-- whose profile row has not been created yet is still a signup, and dropping it
-- would understate exactly the number a launch week is watching.

create or replace view public.ops_included_accounts as
select
  u.id                                as user_id,
  coalesce(p.plan, 'free')            as plan,
  coalesce(p.created_at, u.created_at) as created_at
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.plan, 'free') <> 'staff'
  and coalesce(u.email, '') not like 'spotter-tw-%';

-- ---------- what a subscription is worth ----------
--
-- Nothing in this database stores an amount. `subscriptions` keeps Stripe's
-- status and lookup key, `store_entitlements` keeps a product id, and the money
-- lives in Stripe's and the stores' own systems. So the price book is a table
-- rather than a constant buried in a view: the owner corrects a number with one
-- UPDATE instead of a migration, and the view can say which accounts it could
-- not price instead of quietly reporting them as zero.
--
-- Seeded from tools/stripe-plans.json, which is the source of truth for what
-- stripe-setup.sh creates. NOTE: the live Stripe objects still say $39.99/yr
-- until the owner re-runs that script, so `spotter_plus_year` here is the
-- DECIDED price, not necessarily the charged one.
--
-- The fee columns are assumptions and are flagged as such. 290 bps + 30c is
-- Stripe's standard card rate; Managed Payments (merchant of record, on by
-- default for new accounts) charges more than that, and Apple/Google take 15%
-- under the small-business programs and 30% outside them. Correct these before
-- anyone quotes "net revenue" to somebody else.

create table if not exists public.ops_price_book (
  source          text not null check (source in ('stripe','apple','google','manual')),
  -- Stripe's price lookup key, or the store product identifier RevenueCat reports.
  product_key     text not null,
  "interval"      text not null check ("interval" in ('month','year')),
  gross_cents     int  not null check (gross_cents >= 0),
  fee_bps         int  not null default 0 check (fee_bps between 0 and 10000),
  fee_fixed_cents int  not null default 0 check (fee_fixed_cents >= 0),
  verified        boolean not null default false,
  note            text,
  primary key (source, product_key)
);
alter table public.ops_price_book enable row level security;   -- no policies: service role only

insert into public.ops_price_book(source, product_key, "interval", gross_cents, fee_bps, fee_fixed_cents, verified, note) values
  ('stripe','spotter_plus_month','month', 699, 290, 30, false, 'tools/stripe-plans.json. Fee is the standard card rate; Managed Payments differs.'),
  ('stripe','spotter_plus_year', 'year', 5000, 290, 30, false, 'GTM decision is $50/yr; live Stripe price is $39.99 until stripe-setup.sh is re-run.'),
  ('stripe','spotter_pro_month', 'month', 999, 290, 30, false, 'Pro is not sold. Present so a comp or a price-raise valve prices itself.'),
  ('stripe','spotter_pro_year',  'year', 5999, 290, 30, false, 'Pro is not sold.'),
  ('apple', 'plus_monthly',      'month', 699, 1500, 0, false, 'UNVERIFIED product id and fee. App Store Small Business Program is 15%; standard is 30%.'),
  ('apple', 'plus_annual',       'year', 5000, 1500, 0, false, 'UNVERIFIED product id and fee.'),
  ('google','plus_monthly',      'month', 699, 1500, 0, false, 'UNVERIFIED product id. Google Play lists $50/yr; fee is 15% on the first $1M.'),
  ('google','plus_annual',       'year', 5000, 1500, 0, false, 'UNVERIFIED product id and fee.')
on conflict (source, product_key) do nothing;

-- ================================================================
-- Scorecard views. One per line of the CEO plan's "Team process".
-- ================================================================

-- ---------- 1. paid accounts and net recognized revenue ----------
--
-- IMPORTANT LIMITATION, and the reason this view only ever has one week in it:
-- `subscriptions` and `store_entitlements` are CURRENT-STATE tables. There is no
-- history of who was entitled in August, so a past week cannot be reconstructed
-- from them and this view refuses to pretend otherwise. `week_start` is always
-- the current week. Keeping a week-by-week series means snapshotting this view
-- into a table on the weekly review, which is a decision for the owner, not a
-- number this file can invent.
--
-- Recognized, not collected: an annual payment is spread straight-line over the
-- term (CEO plan — "Separate annual cash collections from recognized revenue").
-- One week of a $50 year is $0.96, and that is the number the scorecard shows.
--
-- `unpriced_accounts` is the honesty column. A store product id the price book
-- has never seen contributes an account and no dollars, and says so, rather than
-- being counted at zero inside the revenue total.

create or replace view public.ops_revenue_week as
with entitled as (
  -- Stripe (and any manual comp) lives in subscriptions.
  select s.user_id, s.source, s.status, s."interval", s.plan, s.price_lookup_key as product_key
  from public.subscriptions s
  join public.ops_included_accounts a on a.user_id = s.user_id
  union all
  -- Store purchases never reach subscriptions; they land in store_entitlements.
  select e.user_id, e.source,
         case when e.active and (e.expires_at is null or e.expires_at > now()) then 'active' else 'expired' end,
         pb."interval", 'plus', e.product_id
  from public.store_entitlements e
  join public.ops_included_accounts a on a.user_id = e.user_id
  left join public.ops_price_book pb on pb.source = e.source and pb.product_key = e.product_id
  where e.source is not null
), priced as (
  select
    en.*,
    pb.gross_cents, pb.fee_bps, pb.fee_fixed_cents,
    case pb."interval" when 'year' then 365.25 when 'month' then 30.4375 end as term_days
  from entitled en
  left join public.ops_price_book pb
    on pb.source = en.source and pb.product_key = en.product_key
)
select
  public.ops_week(now())                                     as week_start,
  source,
  status,
  "interval",
  plan,
  count(*)                                                   as accounts,
  -- Entitled today = what the product actually grants access for. Same list as
  -- recompute_spotter_plan(), so "paid accounts" here and "who has Plus" agree.
  count(*) filter (where status in ('active','trialing','past_due')) as entitled_accounts,
  count(*) filter (where gross_cents is null)                 as unpriced_accounts,
  round(sum(
    case when status in ('active','trialing') and term_days is not null
      then gross_cents / 100.0 * 7.0 / term_days else 0 end), 2)  as gross_recognized_usd,
  round(sum(
    case when status in ('active','trialing') and term_days is not null
      then greatest(0, gross_cents * (1 - fee_bps / 10000.0) - fee_fixed_cents) / 100.0 * 7.0 / term_days
      else 0 end), 2)                                         as net_recognized_usd,
  -- A trial is entitled and recognizes nothing yet; showing it inside the same
  -- row as paying accounts is how a launch week talks itself into a revenue line.
  count(*) filter (where status = 'trialing')                 as trialing_accounts,
  bool_and(coalesce(pb_verified, false))                      as prices_verified
from (
  select p.*, (select verified from public.ops_price_book b
                where b.source = p.source and b.product_key = p.product_key) as pb_verified
  from priced p
) x
group by source, status, "interval", plan;

-- ---------- 2. activation ----------
--
-- Activated = the account has at least one workout the reader actually finished.
-- The week is the week they FIRST got one, so this is a series of activations and
-- not a running total that only ever goes up.

create or replace view public.ops_activation_week as
with firsts as (
  select w.user_id, min(w.created_at) as first_ready
  from public.workouts w
  join public.ops_included_accounts a on a.user_id = w.user_id
  where w.ingest_status = 'ready'
  group by w.user_id
), signups as (
  select public.ops_week(created_at) as week_start, count(*) as signups
  from public.ops_included_accounts
  group by 1
), acts as (
  select public.ops_week(first_ready) as week_start, count(*) as activated_users
  from firsts group by 1
)
select
  coalesce(a.week_start, s.week_start)                          as week_start,
  coalesce(a.activated_users, 0)                                as activated_users,
  coalesce(s.signups, 0)                                        as signups,
  sum(coalesce(a.activated_users, 0)) over (
    order by coalesce(a.week_start, s.week_start))              as activated_cumulative,
  -- Same-week ratio, not a cohort conversion: somebody who signs up on Sunday
  -- and activates on Tuesday lands in two different weeks here on purpose.
  case when coalesce(s.signups, 0) = 0 then null
       else round(100.0 * coalesce(a.activated_users, 0) / s.signups, 1) end as pct_of_week_signups
from acts a
full join signups s on s.week_start = a.week_start;

-- ---------- 3. weekly active ----------
--
-- "Users who started a workout in the last 7 days", as a weekly series. A session
-- is a workout_logs row; started_at is when the user pressed start, which is the
-- moment of intent and the one that should be counted.

create or replace view public.ops_started_week as
select
  public.ops_week(l.started_at)                       as week_start,
  count(distinct l.user_id)                           as users_started,
  count(*)                                            as sessions_started,
  count(*) filter (where l.completed_at is not null)  as sessions_completed,
  count(distinct l.user_id) filter (where l.completed_at is not null) as users_completed
from public.workout_logs l
join public.ops_included_accounts a on a.user_id = l.user_id
group by 1;

-- ---------- 4. return ----------
--
-- "Users with a second session in a later ISO week than their first." Read as a
-- cohort: week_start is the week of the account's FIRST session, and
-- returned_later is how many of that cohort ever trained again in a later week.
--
-- The cohort denominator is why this is the right shape. "How many people came
-- back this week" rises with the size of the app; "how many of the people who
-- started in week W came back" is the number that tells you whether the product
-- works, and it is the number the CEO plan asks for.

create or replace view public.ops_return_week as
with sessions as (
  select l.user_id, public.ops_week(l.started_at) as week
  from public.workout_logs l
  join public.ops_included_accounts a on a.user_id = l.user_id
), per_user as (
  select user_id, min(week) as first_week, max(week) as last_week, count(distinct week) as active_weeks
  from sessions group by user_id
)
select
  first_week                                            as week_start,
  count(*)                                              as cohort_users,
  count(*) filter (where last_week > first_week)        as returned_later,
  count(*) filter (where active_weeks >= 3)             as active_three_weeks,
  round(100.0 * count(*) filter (where last_week > first_week) / nullif(count(*), 0), 1) as pct_returned
from per_user
group by first_week;

-- ---------- 5. imports and corrections ----------
--
-- Usable import = ready AND has_full_workout. A card that came back "ready" with
-- no exercises on it is a delivered failure, and counting it as an import is how
-- a reader that is quietly degrading keeps looking fine.
--
-- Critical-correction proxy: the user added an exercise, deleted one, or renamed
-- one, within 24 hours of the import. Those are the three edits that mean the
-- extractor got the MOVEMENT wrong rather than a number attached to it.
--
-- WHAT THE PROXY MISSES, stated so nobody reads this column as "defect rate":
--   * wrong sets/reps/duration on a correctly named exercise (counted as
--     non-critical here, and for a workout card that can still be the whole bug);
--   * wrong order, wrong block structure, a circuit read as straight sets —
--     nothing in `corrections` records structure at all;
--   * a card so wrong the user deleted it or gave up instead of correcting it,
--     which is the worst outcome and leaves no row anywhere;
--   * anything corrected on day three, which is most corrections for a card
--     saved and not trained until the weekend. 24 h is the reaction window, not
--     the defect window.
--   * corrections made against a shared cached card by a different account.

create or replace view public.ops_imports_week as
with imports as (
  select w.id, w.user_id, w.created_at, w.ingest_status, w.has_full_workout
  from public.workouts w
  join public.ops_included_accounts a on a.user_id = w.user_id
), corr as (
  select c.workout_id,
         min(c.created_at) filter (where c.kind in ('add','delete')
                                      or (c.kind = 'edit' and c.field = 'name')) as first_critical,
         min(c.created_at) as first_any
  from public.corrections c
  where c.workout_id is not null
  group by c.workout_id
)
select
  public.ops_week(i.created_at)                                     as week_start,
  count(*)                                                          as imports,
  count(*) filter (where i.ingest_status = 'ready')                 as ready_imports,
  count(*) filter (where i.ingest_status = 'ready' and i.has_full_workout) as usable_imports,
  count(*) filter (where i.ingest_status = 'failed')                as failed_imports,
  count(*) filter (where c.first_any is not null
                     and c.first_any <= i.created_at + interval '24 hours') as corrected_24h,
  count(*) filter (where c.first_critical is not null
                     and c.first_critical <= i.created_at + interval '24 hours') as critical_corrected_24h,
  round(100.0 * count(*) filter (where i.ingest_status = 'ready' and i.has_full_workout)
        / nullif(count(*), 0), 1)                                   as pct_usable,
  round(100.0 * count(*) filter (where c.first_critical is not null
                     and c.first_critical <= i.created_at + interval '24 hours')
        / nullif(count(*) filter (where i.ingest_status = 'ready'), 0), 1) as pct_critical_of_ready
from imports i
left join corr c on c.workout_id = i.id
group by 1;

-- ---------- 6. entitlement / edit / concurrency incidents ----------
--
-- The signals named in design/reader-fixes/RELIABILITY-GTM.md, paragraph
-- "Monitor". One row per signal per week so a new signal is a new row rather
-- than a schema change and a broken dashboard.
--
-- Two of that paragraph's five signals are NOT here and cannot be, because
-- nothing persists them: a rejected stale commit and an edit-conflict response
-- are return values, not rows. `job_reclaimed` below is the closest honest
-- stand-in — it counts the jobs where a stale commit COULD be rejected, which is
-- the population, not the event. Counting the events themselves needs the edge
-- function's logs (or a future counter table); until then a spike in
-- `job_reclaimed` is the thing to look at, and "unexplained volume is an
-- operational incident" applies to it.

create or replace view public.ops_incidents_week as
-- A workout still marked processing whose job has already finished. The fence's
-- whole job is to make this impossible; a non-zero count is either legacy data or
-- a live bug.
select
  public.ops_week(w.created_at)            as week_start,
  'processing_on_terminal_job'::text       as signal,
  count(*)                                 as incidents
from public.workouts w
join public.ops_included_accounts a on a.user_id = w.user_id
join public.ingest_jobs j on j.id = w.ingest_job_id
where w.ingest_status = 'processing' and j.status in ('done','dead','failed')
group by 1
union all
-- A premium preview the account spent and never got a card for. This is the
-- entitlement leak that costs a user one of four monthly previews for nothing.
-- One hour, so a read in flight is not counted as a loss.
select
  public.ops_week(v.created_at),
  'preview_reserved_not_completed',
  count(*)
from public.video_previews v
join public.ops_included_accounts a on a.user_id = v.user_id
where not v.completed and v.created_at < now() - interval '1 hour'
group by 1
union all
-- Jobs claimed more than once. Expected when a worker dies and the sweeper does
-- its job; a spike means workers are dying.
select
  public.ops_week(j.created_at),
  'job_reclaimed',
  count(*)
from public.ingest_jobs j
join public.ops_included_accounts a on a.user_id = j.user_id
where j.claim_generation > 1
group by 1
union all
-- Reservations that never reached a terminal state. Every one is money held and
-- unaccounted for, and the guard keeps charging it conservatively until somebody
-- reconciles it.
select
  public.ops_week(r.created_at),
  'reservation_unsettled',
  count(*)
from public.ai_reservations r
where r.state = 'reserved' and r.created_at < now() - interval '1 hour'
group by 1
union all
-- Settled with no usage reported. The charge stands at the reserved estimate,
-- which is deliberately conservative, so this is an accuracy signal, not a leak.
select
  public.ops_week(r.created_at),
  'reservation_unknown',
  count(*)
from public.ai_reservations r
where r.state = 'unknown'
group by 1;

-- ---------- 7. cost per delivered workout ----------
--
-- Numerator: coalesce(charged_usd, reserved_usd) — the guard's authoritative
-- charge, never ai_cost_log's estimate, and never both.
--
-- Denominator: every card the user actually received that week, INCLUDING the
-- ones that cost nothing because they came out of the shared cache or were built
-- deterministically. That is the point of the metric. Dividing spend by only the
-- jobs that called a model would report the price of a cache miss and call it the
-- cost of a workout, and the cache is the main cost lever in this product.
--
-- Reservations are attributed to a week through the job they belong to
-- (attempt_meta->>'job_id'), so a retry that spans midnight lands in the same
-- bucket as the card it eventually delivered. A reservation with no job_id —
-- coaching, a pack read outside a job, an experiment — is bucketed by its own
-- week under its own purpose, which is why the 'all' row can exceed the sum of
-- the job-attributed ones.

create or replace view public.ops_cost_week as
with delivered as (
  select w.id, w.ingest_job_id, public.ops_week(w.created_at) as week_start
  from public.workouts w
  join public.ops_included_accounts a on a.user_id = w.user_id
  where w.ingest_status = 'ready'
), per_week as (
  select week_start, count(*) as delivered_workouts from delivered group by 1
), spend as (
  select
    coalesce(d.week_start, public.ops_week(r.created_at))     as week_start,
    coalesce(nullif(r.attempt_meta->>'purpose',''), 'unclassified') as purpose,
    sum(coalesce(r.charged_usd, r.reserved_usd))              as ai_usd,
    count(*)                                                  as attempts
  from public.ai_reservations r
  left join delivered d
    on d.ingest_job_id is not null
   and d.ingest_job_id::text = r.attempt_meta->>'job_id'
  -- Staff and throwaway spend is excluded the same way everything else is; a
  -- null user_id is a system reservation and stays in, because the business pays
  -- for it either way.
  where r.user_id is null
     or exists (select 1 from public.ops_included_accounts a where a.user_id = r.user_id)
  group by 1, 2
)
select
  s.week_start,
  s.purpose,
  coalesce(p.delivered_workouts, 0)                                 as delivered_workouts,
  round(s.ai_usd, 4)                                                as ai_usd,
  s.attempts,
  round(s.ai_usd / nullif(p.delivered_workouts, 0), 4)              as usd_per_delivered
from spend s
left join per_week p on p.week_start = s.week_start
union all
select
  s.week_start,
  'all',
  coalesce(p.delivered_workouts, 0),
  round(sum(s.ai_usd), 4),
  sum(s.attempts),
  round(sum(s.ai_usd) / nullif(p.delivered_workouts, 0), 4)
from spend s
left join per_week p on p.week_start = s.week_start
group by s.week_start, p.delivered_workouts
union all
-- Weeks that delivered cards and spent nothing are the good weeks. They must
-- still appear, or a fully-cached week looks like an outage.
select p.week_start, 'all', p.delivered_workouts, 0, 0, 0
from per_week p
where not exists (select 1 from spend s where s.week_start = p.week_start);

-- ---------- 8. free-user subsidy per payer ----------
--
-- What the free tier costs, divided by the people paying for it. The question
-- behind it is the one the CEO plan asks: at what point does another free user
-- stop being marketing and start being a bill.
--
-- Caveat worth knowing before quoting this: `profiles.plan` is the CURRENT plan,
-- not the plan at the time of the call. Somebody who upgraded on Friday has their
-- whole week counted as a payer's spend. With the account numbers a beta has that
-- is noise; at scale it needs the plan snapshotted onto the reservation.

create or replace view public.ops_subsidy_week as
with weeks as (
  select distinct public.ops_week(created_at) as week_start from public.ai_reservations
), spend as (
  select
    public.ops_week(r.created_at)                                      as week_start,
    sum(coalesce(r.charged_usd, r.reserved_usd))
      filter (where a.plan = 'free')                                   as free_usd,
    sum(coalesce(r.charged_usd, r.reserved_usd))
      filter (where a.plan in ('plus','pro'))                          as paid_usd,
    sum(coalesce(r.charged_usd, r.reserved_usd))
      filter (where r.user_id is null)                                 as system_usd,
    count(distinct r.user_id) filter (where a.plan = 'free')           as free_users_with_cost
  from public.ai_reservations r
  left join public.ops_included_accounts a on a.user_id = r.user_id
  where r.user_id is null or a.user_id is not null
  group by 1
), payers as (
  select count(*) as payers from public.ops_included_accounts where plan in ('plus','pro')
)
select
  w.week_start,
  coalesce(round(s.free_usd, 4), 0)                                    as free_usd,
  coalesce(round(s.paid_usd, 4), 0)                                    as paid_usd,
  coalesce(round(s.system_usd, 4), 0)                                  as system_usd,
  coalesce(s.free_users_with_cost, 0)                                  as free_users_with_cost,
  -- Payers is a today number, not a that-week number, for the same current-state
  -- reason ops_revenue_week carries. It is the denominator you have.
  p.payers,
  round(coalesce(s.free_usd, 0) / nullif(p.payers, 0), 4)              as free_subsidy_per_payer_usd
from weeks w
left join spend s on s.week_start = w.week_start
cross join payers p;

-- ---------- 9. ingest latency ----------
--
-- Two different waits, because they have two different fixes. `queue_seconds` is
-- how long a job sat before a worker touched it — that is capacity. `total` is
-- what the user experienced from save to card — that is the model and the
-- scrape. A p95 that moves while p50 does not is a tail, usually a retry.

create or replace view public.ops_latency_week as
select
  public.ops_week(j.created_at)                                            as week_start,
  count(*)                                                                 as jobs,
  round(percentile_cont(0.5) within group (
    order by extract(epoch from (j.finished_at - j.created_at)))::numeric, 1) as p50_total_seconds,
  round(percentile_cont(0.95) within group (
    order by extract(epoch from (j.finished_at - j.created_at)))::numeric, 1) as p95_total_seconds,
  round(percentile_cont(0.5) within group (
    order by extract(epoch from (coalesce(j.locked_at, j.finished_at) - j.created_at)))::numeric, 1) as p50_queue_seconds,
  round(percentile_cont(0.95) within group (
    order by extract(epoch from (coalesce(j.locked_at, j.finished_at) - j.created_at)))::numeric, 1) as p95_queue_seconds,
  round(max(extract(epoch from (j.finished_at - j.created_at)))::numeric, 1)  as max_total_seconds
from public.ingest_jobs j
join public.ops_included_accounts a on a.user_id = j.user_id
where j.status = 'done' and j.finished_at is not null
group by 1;

-- ---------- grants ----------
--
-- The whole business in aggregate. `anon` and `authenticated` are the two roles a
-- browser can hold, and neither gets select on any of it; the staff scorecard
-- route reads these with the service key instead.

revoke all on public.ops_price_book        from public, anon, authenticated;
revoke all on public.ops_included_accounts from public, anon, authenticated;
revoke all on public.ops_revenue_week      from public, anon, authenticated;
revoke all on public.ops_activation_week   from public, anon, authenticated;
revoke all on public.ops_started_week      from public, anon, authenticated;
revoke all on public.ops_return_week       from public, anon, authenticated;
revoke all on public.ops_imports_week      from public, anon, authenticated;
revoke all on public.ops_incidents_week    from public, anon, authenticated;
revoke all on public.ops_cost_week         from public, anon, authenticated;
revoke all on public.ops_subsidy_week      from public, anon, authenticated;
revoke all on public.ops_latency_week      from public, anon, authenticated;
revoke all on function public.ops_week(timestamptz) from public, anon, authenticated;

grant all    on public.ops_price_book        to service_role;
grant select on public.ops_included_accounts to service_role;
grant select on public.ops_revenue_week      to service_role;
grant select on public.ops_activation_week   to service_role;
grant select on public.ops_started_week      to service_role;
grant select on public.ops_return_week       to service_role;
grant select on public.ops_imports_week      to service_role;
grant select on public.ops_incidents_week    to service_role;
grant select on public.ops_cost_week         to service_role;
grant select on public.ops_subsidy_week      to service_role;
grant select on public.ops_latency_week      to service_role;
grant execute on function public.ops_week(timestamptz) to service_role;

-- ================================================================
-- The pager.
-- ================================================================

-- One row per (key, day). The unique index is the entire rate-limiting design:
-- the check runs every fifteen minutes and the insert simply loses when today's
-- alert already exists, so nothing has to remember what it sent. The cost is
-- real and worth naming — a condition that clears and returns later the same day
-- does not alert twice, so `acked_at` is the owner's reading mark and the day
-- boundary is UTC, which for Chicago means the day rolls over at 6 or 7 pm.
--
-- `detail` is content-free: counts, minutes, percentages, provider names. No
-- captions, no emails, no user ids that would turn an alert into a data export.

create table if not exists public.ops_alerts (
  id         bigint generated always as identity primary key,
  key        text not null,
  day        date not null,
  level      text not null check (level in ('info','warn','critical')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acked_at   timestamptz,
  unique (key, day)
);
create index if not exists ops_alerts_recent on public.ops_alerts (created_at desc);
alter table public.ops_alerts enable row level security;   -- no policies: service role only
revoke all on public.ops_alerts from public, anon, authenticated;
grant all on public.ops_alerts to service_role;

-- The check itself. Returns ONLY the rows it newly inserted, which is what makes
-- the cron job's "did anything happen" test a row count rather than a comparison
-- against state it would have to keep.
--
-- Security definer because it reads auth.users and storage.objects, neither of
-- which service_role reaches through this function's search_path otherwise, and
-- because the cron job runs as postgres either way.
--
-- Every threshold in here is a starting point, not a law. They are written as
-- literals rather than read from a settings table on purpose: the first version
-- of an alerting system should be readable in one screen, and tuning it is a
-- one-line migration once real traffic says which ones cry wolf.

create or replace function public.ops_alert_check() returns setof public.ops_alerts
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'UTC')::date;
begin
  return query
  with policy as (
    select daily_usd, monthly_usd from public.ai_guard_policy where singleton
  ), spend as (
    select
      coalesce(sum(coalesce(charged_usd, reserved_usd)) filter (
        where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'), 0) as day_usd,
      coalesce(sum(coalesce(charged_usd, reserved_usd)), 0)                                     as month_usd
    from public.ai_reservations
    where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  ), bands as (
    -- One key per band, so 60% is read once, 80% is read once, and 95% is the
    -- one that arrives at 3 am. A band that has already fired today loses the
    -- insert; a band crossed for the first time wins it.
    select b.pct, b.level from (values (60, 'info'), (80, 'warn'), (95, 'critical')) as b(pct, level)
  ), queue as (
    select
      count(*) filter (where status = 'queued')  as queued,
      count(*) filter (where status = 'running') as running,
      floor(extract(epoch from (now() - min(created_at))) / 60)::int as oldest_minutes
    from public.ingest_jobs
    where status in ('queued','running')
  ), recent_jobs as (
    select
      count(*) filter (where status in ('done','failed','dead')) as finished,
      count(*) filter (where status in ('failed','dead'))        as failed
    from public.ingest_jobs
    where coalesce(finished_at, updated_at) > now() - interval '1 hour'
  ), candidate(key, level, detail) as (
    -- The queue stalled. Ten minutes is several times the worst healthy read, so
    -- this is "nothing is draining it" rather than "one job is slow".
    select 'queue_stalled', 'critical',
           jsonb_build_object('oldest_minutes', q.oldest_minutes, 'queued', q.queued, 'running', q.running)
    from queue q where q.oldest_minutes >= 10
    union all
    -- Money held against work that never reported back.
    select 'reservations_unsettled', 'warn', jsonb_build_object('count', n, 'older_than', '1 hour')
    from (select count(*) as n from public.ai_reservations
           where state = 'reserved' and created_at < now() - interval '1 hour') r
    where r.n > 0
    union all
    select 'spend_day_' || b.pct, b.level,
           jsonb_build_object('used_usd', round(s.day_usd, 4), 'cap_usd', p.daily_usd,
                              'pct', round(100 * s.day_usd / nullif(p.daily_usd, 0), 1))
    from spend s, policy p, bands b
    where p.daily_usd > 0 and 100 * s.day_usd / p.daily_usd >= b.pct
    union all
    select 'spend_month_' || b.pct, b.level,
           jsonb_build_object('used_usd', round(s.month_usd, 4), 'cap_usd', p.monthly_usd,
                              'pct', round(100 * s.month_usd / nullif(p.monthly_usd, 0), 1))
    from spend s, policy p, bands b
    where p.monthly_usd > 0 and 100 * s.month_usd / p.monthly_usd >= b.pct
    union all
    -- A provider in cooldown means reads are failing or being refused right now.
    select 'provider_cooldown', 'warn',
           jsonb_build_object('providers', jsonb_agg(c.provider order by c.provider),
                              'until', max(c.until_at))
    from public.ai_provider_cooldowns c
    where c.until_at > now()
    having count(*) > 0
    union all
    -- Twenty signups in an hour is not growth at this stage; it is a script.
    select 'signup_spike', 'warn', jsonb_build_object('signups_last_hour', n)
    from (select count(*) as n from auth.users where created_at > now() - interval '1 hour') u
    where u.n > 20
    union all
    -- A failure rate, not a failure count, so a busy hour does not page and a
    -- quiet broken hour does. Five finished jobs is the floor for a percentage.
    select 'job_failure_rate', 'critical',
           jsonb_build_object('failed', j.failed, 'finished', j.finished,
                              'pct', round(100.0 * j.failed / nullif(j.finished, 0), 1))
    from recent_jobs j
    where j.finished >= 5 and 100.0 * j.failed / j.finished > 30
    union all
    -- A permit is minted for a 15-minute upload window. One still open an hour
    -- later means the app asked for an upload slot and never used it.
    select 'upload_permits_stale', 'info', jsonb_build_object('count', n)
    from (select count(*) as n from public.upload_permits
           where not released and created_at < now() - interval '1 hour') up
    where up.n > 0
    union all
    -- The uploads bucket is a hand-off, not storage. Anything a day old is a
    -- leak, and a leak in a private bucket is both a bill and a retention
    -- problem with somebody's video in it.
    select 'upload_objects_leaked', 'warn', jsonb_build_object('count', n)
    from (select count(*) as n from storage.objects
           where bucket_id = 'uploads' and created_at < now() - interval '24 hours') so
    where so.n > 0
    union all
    -- Jobs that have spent every retry they have. Each one is a user looking at
    -- a card that never filled in.
    select 'jobs_at_max_attempts', 'warn', jsonb_build_object('count', n)
    from (select count(*) as n from public.ingest_jobs
           where attempts >= max_attempts and status in ('queued','running','failed')) mj
    where mj.n > 0
  )
  insert into public.ops_alerts (key, day, level, detail)
  select c.key, d, c.level, c.detail from candidate c
  on conflict (key, day) do nothing
  returning *;
end $$;

comment on function public.ops_alert_check() is
  'Evaluates every operational threshold and inserts at most one ops_alerts row per key per UTC day. Returns only the rows it newly inserted.';

revoke all on function public.ops_alert_check() from public, anon, authenticated;
grant execute on function public.ops_alert_check() to service_role;

-- ---------- the tick ----------
--
-- Same mechanism as spotter-worker-tick (20260901190000_ingest_queue.sql) and
-- spotter-push-tick (20260906120000_push.sql): cron posts to the function with
-- the shared secret out of app_config, and the URL is DERIVED from the worker's
-- rather than stored a third time. One address to fix if the project moves, and
-- no new secret to forget.
--
-- Written as a DO block rather than as the one-line `select net.http_post(...)
-- where exists (...)` the other ticks use, and the reason is worth keeping.
--
-- The check has to run and record its alerts whether or not the notifier can be
-- reached. An alerting system that only remembers what happened while the
-- notifier was healthy forgets exactly the outages worth remembering. Expressed
-- as a single SELECT, `ops_alert_check()` would sit in a FROM clause next to an
-- `exists (select … from app_config …)` in the WHERE, and the planner is allowed
-- to evaluate that EXISTS as an InitPlan and put a one-time false filter above
-- the scan — which would mean the alert rows were never written at all on a
-- project where worker_url happened to be missing. Imperative order removes the
-- question: check first, record, then decide whether anyone can be told.
--
-- Fifteen minutes: the brief's interval, and the same number the notifier's
-- lookback window uses, so nothing falls between two ticks.
--
-- The `like '%/api/worker/tick'` guard is the one from the push tick and matters
-- for the same reason: replace() on a URL that does not contain the worker's
-- path returns it unchanged, and a POST of an ops body to /api/worker/tick would
-- quietly drain the ingest queue instead — a wrong job that looks like a right one.

do $migrate$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('spotter-ops-tick', '*/15 * * * *', $cron$
      do $tick$
      declare fired int; target text; secret text;
      begin
        select count(*) into fired from public.ops_alert_check();
        if fired = 0 then return; end if;

        select value into target from public.app_config where key = 'worker_url';
        select value into secret from public.app_config where key = 'worker_secret';
        if target is null or target not like '%/api/worker/tick' then
          raise warning 'ops tick: % alert(s) recorded but worker_url is not set; nobody was told', fired;
          return;
        end if;

        perform net.http_post(
          url     := replace(target, '/api/worker/tick', '/api/worker/ops-alert'),
          headers := jsonb_build_object('content-type', 'application/json',
                                        'x-worker-secret', secret),
          body    := jsonb_build_object('source', 'cron', 'fired', fired),
          timeout_milliseconds := 10000);
      end $tick$;
    $cron$);
  end if;
end $migrate$;
