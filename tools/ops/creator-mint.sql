-- Spotter — mint a creator code.
--
--   1. Fill in the insert below and uncomment it.
--   2. supabase db query --linked --file tools/ops/creator-mint.sql
--   3. Create the matching App Store offer code and Google Play promo code,
--      spelled exactly like the code. The app never prices the discount; the
--      stores do. README, "Creator codes", has the steps.
--
-- The staff route does the same thing from a signed-in staff account:
--   POST /api/creator/codes {code, creator_name, contact, creator_email, ...}
--
-- What the columns mean:
--   code               3 to 20 letters and digits. Stored upper-case whatever is typed.
--   creator_name       shown to the referred person: "Maria's code applied".
--   creator_user_id    optional. The creator's own Spotter account, so Settings
--                      shows them their numbers. The subselect finds it by email;
--                      it is null, and harmless, when they have no account.
--   contact            how the creator gets paid. Owner's eyes only; it never
--                      reaches the app.
--   commission_bps     leave it out to take app_config creator.commission_bps (2000 = 20%).
--   commission_months  leave it out to take app_config creator.commission_months (12).
--   max_redemptions    null = unlimited.
--   expires_at         null = never.
--   note               anything worth remembering; owner's eyes only.
--
-- insert into public.creator_codes (code, creator_name, contact, creator_user_id, note)
-- values ('MARIA', 'Maria', 'paypal: maria@example.com',
--         (select id from auth.users where lower(email) = lower('maria@example.com')),
--         'YouTube, 40k. Agreed 18 Sep: 20% for 12 months, 10% off Plus for her people.');

-- The five newest codes, so a run after the insert shows that it landed.
select code, creator_name, creator_user_id is not null as has_account,
       commission_bps, commission_months, max_redemptions, expires_at, active, created_at
from public.creator_codes
order by created_at desc
limit 5;
