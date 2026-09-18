-- Spotter — record a payout to a creator.
--
--   1. Pay them, by hand, whatever way their `contact` says.
--   2. Fill in the insert below and uncomment it. amount_cents is what left
--      the bank, in USD cents: $28.20 is 2820.
--   3. supabase db query --linked --file tools/ops/creator-payout.sql
--
-- The staff route does the same thing from a signed-in staff account:
--   POST /api/creator/codes/MARIA/payouts {amount_cents, note}
--
-- Payouts are append-only. A mistake is a second row with a note that says so,
-- never an edit: the table has to add up to what actually left the bank.
--
-- insert into public.creator_payouts (code_id, amount_cents, note)
-- values ((select id from public.creator_codes where code = 'MARIA'), 2820, 'PayPal, 30 Sep 2026');

-- What is owed after the insert: every code with money on it, most owed first.
select code, creator_name, contact,
       round(earned_cents / 100.0, 2) as earned_usd,
       round(paid_cents / 100.0, 2)   as paid_usd,
       round(owed_cents / 100.0, 2)   as owed_usd
from public.creator_code_stats
where earned_cents <> 0 or paid_cents <> 0
order by owed_cents desc, created_at;
