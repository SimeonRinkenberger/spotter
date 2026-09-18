-- Per-account monthly AI ceilings (design/gtm/ALLOWANCES.md section 5, statement 2).
-- Sized so the four promised free previews (p95 charge $0.0573 each + one worst-case Gemini reserve) can
-- never be refused, and a Plus month at the published allowances fits. Global daily/monthly caps unchanged.
-- Live value before this change: {"free":0.05,"plus":0.50,"pro":1.00,"staff":1.00}.
-- Run: supabase db query --linked --file tools/release/guard-allowances.sql
update public.ai_guard_policy
   set user_monthly_usd = '{"free":0.40,"plus":1.50,"pro":3.00,"staff":3.00}'::jsonb
 where singleton;
select daily_usd, monthly_usd, user_monthly_usd from public.ai_guard_policy;
