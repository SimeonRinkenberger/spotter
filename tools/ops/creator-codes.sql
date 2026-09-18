-- Spotter — creator codes: every code, its numbers, and what is owed.
--
--   supabase db query --linked --file tools/ops/creator-codes.sql
--
-- Run it from the repo root. One statement on purpose: `supabase db query`
-- prints only the last result set in a file, so the whole table is one select.
-- Read-only, and no per-user content: the only free text here is the creator's
-- name and the payout contact the owner wrote down for them.
--
-- owed_usd is the number to pay. It is earned minus paid, where earned is the
-- sum of the ledger (refunds included, as negative rows) and paid is the sum of
-- creator_payouts. Record a payout with tools/ops/creator-payout.sql and this
-- number moves; nothing else changes it.
--
-- subscribers is "referred accounts on a paid plan right now", a current-state
-- number. signups and first_payments are for ever.

select code, creator_name, active, contact,
       commission_bps / 100.0            as pct,
       commission_months                 as months,
       signups, subscribers, first_payments, redemptions_30d,
       last_redeemed_at::date            as last_redeemed,
       round(earned_cents / 100.0, 2)    as earned_usd,
       round(paid_cents / 100.0, 2)      as paid_usd,
       round(owed_cents / 100.0, 2)      as owed_usd,
       max_redemptions,
       expires_at::date                  as expires,
       created_at::date                  as minted
from public.creator_code_stats
order by owed_cents desc, created_at;
