-- Spotter — make the prompt cache visible in the spend ledger.
--
-- OpenAI serves a repeated prompt prefix out of its own cache and charges a
-- fraction of the input price for it. Pumpy's system prompt is written
-- static-first precisely so that this applies, but the ledger could not see it:
-- every input token was priced at the full rate, so est_cost_usd overstated the
-- bill, and nothing anywhere said what fraction of the prompt was being cached.
--
-- One column and one rollup fix both.

alter table public.ai_cost_log add column if not exists cached_tokens int not null default 0;

comment on column public.ai_cost_log.cached_tokens is
  'Of input_tokens, how many the provider reports it served from its prompt cache (OpenAI usage.prompt_tokens_details.cached_tokens; Anthropic usage.cache_read_input_tokens). A subset of input_tokens, never an addition. 0 when the provider reports nothing, which is every provider except those two and every call that missed the cache.';

-- The readable rollup: one row per day, provider and purpose, so "what is this
-- costing and how much of it is cached" is a select rather than a hand-written
-- aggregate. security_invoker keeps the view under the caller's own permissions;
-- ai_cost_log has RLS enabled with no policies at all, so this stays
-- service-role-only exactly like the table it reads. The explicit revoke/grant
-- below is belt and braces over Supabase's default grants on new objects.
--
-- cache_pct is the number to watch: input tokens served from cache, as a whole
-- percentage of all input tokens. Null for a bucket with no input tokens.
--
-- The day boundary is pinned to UTC rather than left to the session's timezone,
-- so `day` means exactly what ai_spend_today() and the DAILY_SPEND_USD ceiling
-- mean by a day. Two numbers on the same dashboard disagreeing about where
-- midnight is would be a bug nobody would find.
create or replace view public.ai_cost_daily
with (security_invoker = on) as
select
  date_trunc('day', created_at at time zone 'utc') as day,
  provider,
  purpose,
  count(*)              as calls,
  sum(input_tokens)     as input_tokens,
  sum(cached_tokens)    as cached_tokens,
  sum(output_tokens)    as output_tokens,
  sum(est_cost_usd)     as est_cost_usd,
  round(100.0 * sum(cached_tokens) / nullif(sum(input_tokens), 0)) as cache_pct
from public.ai_cost_log
group by date_trunc('day', created_at at time zone 'utc'), provider, purpose;

revoke all on table public.ai_cost_daily from public, anon, authenticated;
grant select on table public.ai_cost_daily to service_role;
