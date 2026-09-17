-- Spotter economics: the read-only aggregate that backs design/gtm/ALLOWANCES.md.
--
--   supabase db query --linked --file tools/ops/economics.sql
--
-- Run it from the repo root. It is ONE statement on purpose: `supabase db query`
-- returns only the last result set in a file, so every section is a row in one
-- union and the whole picture comes back in a single round trip.
--
-- Rules this file keeps, and that any edit to it must keep:
--   * SELECT only. Nothing here writes, and nothing here reads app_config keys
--     that could hold a secret (the `key in (...)` list is explicit, never a
--     wildcard over the whole table).
--   * Aggregates only. No captions, transcripts, packs, chat messages, emails,
--     titles, urls, shortcodes or work_keys are ever projected — work_key is
--     grouped on but never returned, because it carries a user id and a video id.
--   * `ai_reservations` is the authoritative money. `ai_cost_log` is a diagnostic
--     estimate of the SAME calls; the two are never added together.
--   * Reserved and charged are reported side by side. Admission spends the
--     RESERVE, so the reserve is what decides whether an advertised action is
--     allowed to happen; the charge is only what the invoice will say.

with
-- One work unit = one (account+video, UTC day). That is the grain the per-work
-- ceiling uses, and the grain a "video read" is sold in.
work_unit as (
  select work_key, (created_at at time zone 'UTC')::date as d,
         sum(coalesce(charged_usd, reserved_usd)) as usd,
         count(*) filter (where provider = 'gemini') as gem_calls,
         count(*) filter (where provider = 'openai') as luna_calls,
         sum(coalesce(charged_usd, reserved_usd)) filter (where provider = 'gemini') as gem_usd
  from public.ai_reservations
  where provider in ('openai', 'gemini')
    and work_key not like 'sys:eval:%'
    and model <> 'gpt-5.6-terra'
  group by 1, 2
),
preview_use as (select count(*) as n from public.video_previews group by user_id, month),
save_month as (
  select count(*) as n from public.saves_log
  where kind = 'save' and created_at >= date_trunc('month', now() at time zone 'UTC')
  group by user_id
),
pumpy_month as (
  select sum(credits) as c, count(*) as t from public.pumpy_usage
  where created_at >= date_trunc('month', now() at time zone 'UTC')
  group by user_id
)

-- 1. What the guards and the cap table actually say in production right now.
select 'policy' as section, 'ai_guard_policy' as dim, to_jsonb(p) as metric
from public.ai_guard_policy p
union all
select 'policy', 'app_config:' || key, to_jsonb(left(value, 400))
from public.app_config
where key in ('limits.plans', 'pumpy.plans', 'pumpy.turn_max_credits', 'pumpy.per_minute',
              'pack.model', 'pack.sheets_model', 'pack.enabled', 'pack.max_requeries',
              'model.openai', 'model.gemini', 'media.video_enabled', 'media.max_bytes', 'media.timeout_ms')

-- 2. Authoritative spend per call, by model. p50/p95 are only honest where n >= 10.
union all
select 'ledger_by_model', provider || ' / ' || model,
  jsonb_build_object(
    'rows', count(*),
    'settled', count(*) filter (where state = 'settled'),
    'reserved_open', count(*) filter (where state = 'reserved'),
    'unknown', count(*) filter (where state = 'unknown'),
    'sum_usd', round(sum(coalesce(charged_usd, reserved_usd))::numeric, 6),
    'charged_p50', round(percentile_cont(0.5) within group (order by charged_usd)
                         filter (where state = 'settled')::numeric, 6),
    'charged_p95', round(percentile_cont(0.95) within group (order by charged_usd)
                         filter (where state = 'settled')::numeric, 6),
    'charged_max', round(max(charged_usd)::numeric, 6),
    'settled_n', count(charged_usd) filter (where state = 'settled'),
    'first_day', min((created_at at time zone 'UTC')::date)::text,
    'last_day', max((created_at at time zone 'UTC')::date)::text)
from public.ai_reservations group by 2

-- 3. Admission spends the reserve, not the charge. This ratio is why a dollar
--    guard can refuse an action the app advertised: the LAST call of a save needs
--    a whole worst-case reservation of free headroom, not its eventual price.
union all
select 'reserve_vs_charge', provider || ' / ' || model,
  jsonb_build_object(
    'settled_n', count(*),
    'reserved_p50', round(percentile_cont(0.5) within group (order by reserved_usd)::numeric, 6),
    'reserved_p95', round(percentile_cont(0.95) within group (order by reserved_usd)::numeric, 6),
    'reserved_max', round(max(reserved_usd)::numeric, 6),
    'charged_p50', round(percentile_cont(0.5) within group (order by charged_usd)::numeric, 6),
    'charged_p95', round(percentile_cont(0.95) within group (order by charged_usd)::numeric, 6),
    'ratio_p50', round(percentile_cont(0.5) within group (order by reserved_usd / nullif(charged_usd, 0))::numeric, 2),
    'ratio_p95', round(percentile_cont(0.95) within group (order by reserved_usd / nullif(charged_usd, 0))::numeric, 2))
from public.ai_reservations
where state = 'settled' and charged_usd > 0 and provider in ('openai', 'gemini')
group by 2

-- 4. Cost per DELIVERED unit of work, which is what an allowance is denominated in.
union all
select 'per_work_day',
  case when gem_calls > 0 then 'video-read unit (one account+video+day)'
       else 'text-only unit (luna only)' end,
  jsonb_build_object(
    'units', count(*),
    'gem_calls_p50', percentile_cont(0.5) within group (order by gem_calls),
    'gem_calls_max', max(gem_calls),
    'luna_calls_p50', percentile_cont(0.5) within group (order by luna_calls),
    'usd_p50', round(percentile_cont(0.5) within group (order by usd)::numeric, 6),
    'usd_p95', round(percentile_cont(0.95) within group (order by usd)::numeric, 6),
    'usd_max', round(max(usd)::numeric, 6),
    'gem_share_of_sum', round((sum(coalesce(gem_usd, 0)) / nullif(sum(usd), 0))::numeric, 3),
    'usd_sum', round(sum(usd)::numeric, 6))
from work_unit group by 2

-- 5. Where the month went, day by day, against the $0.50/day global ceiling.
union all
select 'ledger_by_day', (created_at at time zone 'UTC')::date::text,
  jsonb_build_object('rows', count(*),
    'sum_usd', round(sum(coalesce(charged_usd, reserved_usd))::numeric, 6),
    'accounts', count(distinct user_id))
from public.ai_reservations group by 2

-- 6. Spend by plan. `staff` here is development traffic, not customer demand.
union all
select 'ledger_by_plan', coalesce(p.plan, '(no profile / system row)'),
  jsonb_build_object('accounts', count(distinct a.user_id), 'rows', count(*),
    'sum_usd', round(sum(coalesce(a.charged_usd, a.reserved_usd))::numeric, 6))
from public.ai_reservations a left join public.profiles p on p.id = a.user_id
group by 2

-- 7. DIAGNOSTIC ONLY. Same calls as section 2, estimated, but carrying the one
--    thing the reservation table cannot answer until 20260917150000 is applied:
--    which purpose the money was spent on. Never add this to section 2.
union all
select 'ai_cost_log_by_purpose (diagnostic)',
  coalesce(purpose, '(null)') || ' / ' || coalesce(provider, '?') || ' / ' || coalesce(model, '?'),
  jsonb_build_object('calls', count(*), 'ok', count(*) filter (where ok),
    'est_usd_sum', round(sum(est_cost_usd)::numeric, 6),
    'est_usd_p50', round(percentile_cont(0.5) within group (order by est_cost_usd)::numeric, 6),
    'est_usd_p95', round(percentile_cont(0.95) within group (order by est_cost_usd)::numeric, 6),
    'zero_cost_with_tokens', count(*) filter (
      where coalesce(est_cost_usd, 0) = 0 and coalesce(input_tokens, 0) + coalesce(output_tokens, 0) > 0),
    'first_day', min((created_at at time zone 'UTC')::date)::text,
    'last_day', max((created_at at time zone 'UTC')::date)::text)
from public.ai_cost_log
where created_at >= date_trunc('month', now() at time zone 'UTC')
group by 2

-- 8. Demand: what people actually do, and how much of it is free because it hit cache.
union all
select 'saves_log_by_kind', kind || ' / ' || (case when cached then 'cached' else 'uncached' end),
  jsonb_build_object('rows', count(*), 'accounts', count(distinct user_id),
    'with_media_source', count(*) filter (where media_source is not null),
    'degraded', count(*) filter (where degraded),
    'first_day', min((created_at at time zone 'UTC')::date)::text,
    'last_day', max((created_at at time zone 'UTC')::date)::text)
from public.saves_log group by 2
union all
select 'saves_log_cache_rate', 'save events, all time',
  jsonb_build_object('total', count(*) filter (where kind = 'save'),
    'cached', count(*) filter (where kind = 'save' and cached),
    'cache_pct', round(100.0 * count(*) filter (where kind = 'save' and cached)
                       / nullif(count(*) filter (where kind = 'save'), 0), 1))
from public.saves_log
union all
select 'saves_per_account_month', 'distribution',
  jsonb_build_object('accounts', count(*),
    'saves_p50', percentile_cont(0.5) within group (order by n),
    'saves_p95', percentile_cont(0.95) within group (order by n),
    'saves_max', max(n))
from save_month

-- 9. Latency and retries, which set the in-flight reserve and the failure allowance.
union all
select 'ingest_jobs', coalesce(status, '?') || ' / ' || coalesce(step, '-'),
  jsonb_build_object('rows', count(*),
    'p50_seconds', round(percentile_cont(0.5) within group (
      order by extract(epoch from (coalesce(finished_at, updated_at) - created_at)))::numeric, 1),
    'p95_seconds', round(percentile_cont(0.95) within group (
      order by extract(epoch from (coalesce(finished_at, updated_at) - created_at)))::numeric, 1),
    'attempts_max', max(attempts))
from public.ingest_jobs group by 2

-- 10. How much of the catalogue has a premium reading, i.e. how much is reusable.
union all
select 'video_cache', 'read_quality=' || coalesce(read_quality, '?'),
  jsonb_build_object('videos', count(*),
    'with_pack', count(*) filter (where pack is not null),
    'with_media_source', count(*) filter (where media_source is not null))
from public.video_cache group by 2

-- 11. Coaching, in the unit it is metered in (credits) and the unit it is sold in (answers).
union all
select 'pumpy_turns',
  coalesce(model, '(none)') || ' / ' || (case when short_circuit then 'short-circuit' else 'model turn' end),
  jsonb_build_object('turns', count(*), 'accounts', count(distinct user_id),
    'credits_p50', percentile_cont(0.5) within group (order by credits),
    'credits_p95', percentile_cont(0.95) within group (order by credits),
    'credits_max', max(credits),
    'est_usd_p50', round(percentile_cont(0.5) within group (order by est_cost_usd)::numeric, 6),
    'est_usd_p95', round(percentile_cont(0.95) within group (order by est_cost_usd)::numeric, 6),
    'in_tok_p50', percentile_cont(0.5) within group (order by input_tokens),
    'out_tok_p50', percentile_cont(0.5) within group (order by output_tokens),
    'calls_p50', percentile_cont(0.5) within group (order by calls))
from public.pumpy_usage group by 2
union all
select 'pumpy_per_account_month', 'distribution',
  jsonb_build_object('accounts', count(*),
    'credits_p50', percentile_cont(0.5) within group (order by c),
    'credits_p95', percentile_cont(0.95) within group (order by c),
    'credits_max', max(c), 'turns_max', max(t))
from pumpy_month

-- 12. Admission counters, per metered scope.
union all
select 'ai_actions_by_scope', scope,
  jsonb_build_object('actions', count(*), 'accounts', count(distinct user_id),
    'credits_sum', sum(credits), 'finished', count(*) filter (where finished))
from public.ai_actions group by 2

-- 13. The four promised free previews: how many are actually taken.
union all
select 'video_previews', month::text,
  jsonb_build_object('rows', count(*), 'accounts', count(distinct user_id),
    'completed', count(*) filter (where completed),
    'per_account_p50', (select percentile_cont(0.5) within group (order by n) from preview_use),
    'per_account_max', (select max(n) from preview_use))
from public.video_previews group by 2

-- 14. Population and entitlement.
union all
select 'profiles_by_plan', coalesce(plan, '(null)'),
  jsonb_build_object('accounts', count(*),
    'with_limit_override', count(*) filter (where limits is not null and limits::text <> '{}'),
    'with_pumpy_override', count(*) filter (where pumpy_limits is not null and pumpy_limits::text <> '{}'))
from public.profiles group by 2
union all
select 'subscriptions',
  coalesce(source, '?') || ' / ' || coalesce(status, '?') || ' / ' || coalesce(plan, '?')
    || ' / ' || coalesce(interval, '?'),
  jsonb_build_object('rows', count(*), 'price_lookup_keys', count(distinct price_lookup_key),
    'with_trial', count(*) filter (where trial_end is not null),
    'cancel_at_period_end', count(*) filter (where cancel_at_period_end))
from public.subscriptions group by 2
-- Whether any of those are REAL money. `raw` is a trimmed projection, so if
-- `livemode` is absent the database cannot answer it and the Stripe dashboard must.
union all
select 'stripe_mode', 'subscriptions.raw shape',
  jsonb_build_object('rows', count(*),
    'livemode_true', count(*) filter (where (raw ->> 'livemode')::boolean is true),
    'livemode_false', count(*) filter (where (raw ->> 'livemode')::boolean is false),
    'livemode_absent', count(*) filter (where raw is null or not (raw ? 'livemode')),
    'raw_keys', (select jsonb_agg(distinct k) from public.subscriptions s2,
                  lateral jsonb_object_keys(coalesce(s2.raw, '{}'::jsonb)) k),
    'lookup_keys', jsonb_agg(distinct coalesce(price_lookup_key, '(null)')))
from public.subscriptions

-- 15. The failure allowance in the funded-budget formula, measured rather than guessed.
union all
select 'failure_share', 'ai_cost_log, this month (diagnostic)',
  jsonb_build_object('calls', count(*), 'failed_calls', count(*) filter (where not ok),
    'usd_total', round(sum(est_cost_usd)::numeric, 6),
    'usd_failed', round(sum(est_cost_usd) filter (where not ok)::numeric, 6),
    'failed_pct_of_usd', round(100 * sum(est_cost_usd) filter (where not ok)::numeric
                               / nullif(sum(est_cost_usd), 0), 1))
from public.ai_cost_log where created_at >= date_trunc('month', now() at time zone 'UTC')
union all
select 'failure_share', 'ai_reservations (authoritative)',
  jsonb_build_object('rows', count(*),
    'unknown_rows', count(*) filter (where state = 'unknown'),
    'unknown_usd', round(coalesce(sum(reserved_usd) filter (where state = 'unknown'), 0)::numeric, 6),
    'open_reserved_rows', count(*) filter (where state = 'reserved'),
    'usd_total', round(sum(coalesce(charged_usd, reserved_usd))::numeric, 6))
from public.ai_reservations

-- 16. The headline: this month against the caps that are live today.
union all
select 'monthly_totals', 'this month to date (UTC)',
  jsonb_build_object(
    'reservations_sum_usd', round((select sum(coalesce(charged_usd, reserved_usd))
      from public.ai_reservations
      where created_at >= date_trunc('month', now() at time zone 'UTC'))::numeric, 6),
    'global_monthly_cap', (select monthly_usd from public.ai_guard_policy),
    'pct_of_monthly_cap', round(100 * (select sum(coalesce(charged_usd, reserved_usd))
      from public.ai_reservations
      where created_at >= date_trunc('month', now() at time zone 'UTC'))::numeric
      / nullif((select monthly_usd from public.ai_guard_policy), 0), 1),
    'worst_day_usd', (select round(max(s)::numeric, 6) from (
      select sum(coalesce(charged_usd, reserved_usd)) s from public.ai_reservations
      group by (created_at at time zone 'UTC')::date) d),
    'global_daily_cap', (select daily_usd from public.ai_guard_policy),
    'accounts_this_month', (select count(distinct user_id) from public.ai_reservations
      where created_at >= date_trunc('month', now() at time zone 'UTC') and user_id is not null))

order by 1, 2;
