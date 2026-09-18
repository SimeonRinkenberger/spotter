-- Spotter — creator codes: who sent a subscriber, what that is worth, and who
-- gets to see which of those numbers.
--
-- A creator code is a short word (`MARIA`) the owner mints for a video creator.
-- A person types it in the app, or arrives on a `?code=` link, or redeems the
-- matching App Store offer code / Play promo code without ever telling the app;
-- either way the account lands in `creator_referrals` once, and only once.
-- Every paid store transaction that account makes inside the code's window then
-- writes one `creator_earnings` row carrying the code's cut. Payouts are the
-- owner's, by hand, recorded in `creator_payouts`; "owed" is earned minus paid
-- and is never stored, only computed.
--
-- The discount itself is not priced here. The store prices the offer code; the
-- app only opens the store's redemption surface and prints what the offer is,
-- from the `creator.discount` row below. Absent or `null`, the app promises nothing.
--
-- What is deliberately NOT a column: the referred user's payment details, the
-- creator's tax status, or any per-user content. Counts, cents and timestamps.
--
-- Additive and re-runnable: every create is `if not exists` / `or replace`, the
-- policies and triggers are wrapped in `duplicate_object` guards, the seeds are
-- `on conflict do nothing`.

-- ---------- dials ----------
--
-- The defaults a new code is minted with, and the offer the app prints. Per-code
-- columns hold the real numbers, so changing these later moves only codes minted
-- after the change; a promise already made to a creator stays what it was.

insert into public.app_config (key, value) values
  ('creator.commission_bps', '2000'),
  ('creator.commission_months', '12'),
  ('creator.discount', '{"percent_off":10,"months":12}')
on conflict (key) do nothing;

-- A number out of app_config, or the fallback when the row is missing or is not
-- a plain integer. Used by the mint trigger so an ops SQL insert that names no
-- rate gets the dial rather than a not-null error.
create or replace function public.creator_config_int(p_key text, p_default int) returns int
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_config where key = p_key;
  if v is null or v !~ '^[0-9]{1,9}$' then return p_default; end if;
  return v::int;
end $$;
revoke all on function public.creator_config_int(text, int) from public, anon, authenticated;
grant execute on function public.creator_config_int(text, int) to service_role;

-- ---------- the codes ----------

-- `code` is stored upper-case and the check below is what the API and the mint
-- trigger both normalise towards, so `maria`, `Maria` and `MARIA` are one code.
-- `creator_user_id` is optional: a creator with no Spotter account still has a
-- code, they just cannot see their numbers in Settings. `contact` is the payout
-- handle and is for the owner's eyes only; the column grant further down is what
-- keeps it out of the creator's own read.
create table if not exists public.creator_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  creator_name      text not null check (char_length(creator_name) between 1 and 80),
  creator_user_id   uuid references auth.users(id) on delete set null,
  contact           text,
  commission_bps    int not null check (commission_bps between 0 and 10000),
  commission_months int not null check (commission_months between 1 and 120),
  max_redemptions   int check (max_redemptions is null or max_redemptions > 0),
  expires_at        timestamptz,
  active            boolean not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists creator_codes_creator_user_idx on public.creator_codes (creator_user_id);

-- Before insert or update: upper-case the code, fill a missing rate or window
-- from the dials, and stamp updated_at. A BEFORE trigger runs ahead of the
-- not-null checks, which is what lets the rate columns be not-null and still
-- optional at insert time.
create or replace function public.creator_codes_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.code := upper(trim(new.code));
  if new.creator_name is not null then new.creator_name := trim(new.creator_name); end if;
  if new.commission_bps is null then
    new.commission_bps := public.creator_config_int('creator.commission_bps', 2000);
  end if;
  if new.commission_months is null then
    new.commission_months := public.creator_config_int('creator.commission_months', 12);
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function public.creator_codes_prepare() from public, anon, authenticated;
do $$ begin
  create trigger creator_codes_prepare before insert or update on public.creator_codes
    for each row execute function public.creator_codes_prepare();
exception when duplicate_object then null; end $$;

-- ---------- who was sent by whom ----------

-- One row per account, ever. The primary key on user_id IS the "first code
-- wins" rule; nothing else has to remember it. `source` says how the code
-- arrived, and `store` is the one path that does not come from the app: the
-- store's own offer code, reported back by RevenueCat after the purchase.
-- `first_paid_at` is the first paid store transaction and starts the window.
create table if not exists public.creator_referrals (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  code_id       uuid not null references public.creator_codes(id),
  source        text not null check (source in ('app', 'link', 'signup', 'store')),
  redeemed_at   timestamptz not null default now(),
  first_paid_at timestamptz
);
create index if not exists creator_referrals_code_idx on public.creator_referrals (code_id);

-- ---------- the ledger ----------

-- One row per store transaction the app was told about, keyed by the store's
-- transaction id so a redelivered webhook is an insert that does nothing. A
-- refund is a second row with a negative gross and a negative commission,
-- keyed `rc:refund:<id>`, so the ledger is append-only and sums are honest.
-- `user_id` is set null when the account is deleted; the money was still paid.
create table if not exists public.creator_earnings (
  id               bigserial primary key,
  code_id          uuid not null references public.creator_codes(id),
  user_id          uuid references auth.users(id) on delete set null,
  source           text not null check (source in ('apple', 'google')),
  external_id      text not null unique,
  paid_at          timestamptz not null,
  gross_cents      int not null,
  currency         text not null default 'usd',
  commission_cents int not null,
  created_at       timestamptz not null default now()
);
create index if not exists creator_earnings_code_idx on public.creator_earnings (code_id);
create index if not exists creator_earnings_user_idx on public.creator_earnings (user_id);

-- What the owner has actually sent. Append-only by convention; a mistake is a
-- second row with a note, not an edit.
create table if not exists public.creator_payouts (
  id           bigserial primary key,
  code_id      uuid not null references public.creator_codes(id),
  amount_cents int not null check (amount_cents > 0),
  currency     text not null default 'usd',
  paid_at      timestamptz not null default now(),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists creator_payouts_code_idx on public.creator_payouts (code_id);

-- ---------- row level security ----------

alter table public.creator_codes     enable row level security;
alter table public.creator_referrals enable row level security;
alter table public.creator_earnings  enable row level security;   -- no policies: service role only
alter table public.creator_payouts   enable row level security;   -- no policies: service role only

-- A creator may read their own code row, minus `contact` and `note` (the column
-- grant below), and a person may read their own referral. Nobody signed in may
-- write any of it: a client that could insert a referral could pick its own
-- creator, and a client that could edit a code could raise its own rate.
do $$ begin
  create policy "own creator code read" on public.creator_codes
    for select to authenticated using (creator_user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own referral read" on public.creator_referrals
    for select to authenticated using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;

revoke all on public.creator_codes, public.creator_referrals,
              public.creator_earnings, public.creator_payouts
  from public, anon, authenticated;
grant select (id, code, creator_name, creator_user_id, commission_bps, commission_months,
              max_redemptions, expires_at, active, created_at, updated_at)
  on public.creator_codes to authenticated;
grant select on public.creator_referrals to authenticated;
grant all on public.creator_codes, public.creator_referrals,
             public.creator_earnings, public.creator_payouts to service_role;
grant usage, select on sequence public.creator_earnings_id_seq, public.creator_payouts_id_seq to service_role;

-- ---------- redeeming a code ----------

-- The one write path into creator_referrals. Atomic on purpose: the redemption
-- count is taken under a row lock on the code, so a code with one redemption
-- left cannot be redeemed twice by two phones at once, and the account is locked
-- with an advisory lock so two codes typed at once on one account cannot both
-- win. Every outcome is a status word rather than an exception so the route can
-- turn each into the right HTTP answer.
--
--   ok                 redeemed; the row carries the code and who it belongs to
--   bad_code           not 3 to 20 letters and digits
--   already_redeemed   this account has a code already (the row says which)
--   unknown_code       no such code
--   own_code           a creator redeeming their own code
--   code_closed        inactive, expired, or every redemption is spent
--   already_subscribed a subscription or a store entitlement already exists,
--                      so there is no "new subscriber" to attribute. Skipped
--                      when the source is 'store', because that event arrives
--                      after the purchase it describes.
--
-- A `store_entitlements` row that says nothing (never active, no expiry, no
-- product) is what a Restore with no purchases leaves behind, and it does not
-- make anybody a subscriber; only a row the store ever filled in counts.
create or replace function public.redeem_creator_code(uid uuid, p_code text, p_source text)
returns table (status text, code text, creator_name text, redeemed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  wanted text := upper(trim(coalesce(p_code, '')));
  c public.creator_codes%rowtype;
  have record;
  used int;
begin
  if p_source is null or p_source not in ('app', 'link', 'signup', 'store') then
    raise exception 'redeem_creator_code: unknown source %', p_source;
  end if;
  if wanted !~ '^[A-Z0-9]{3,20}$' then
    return query select 'bad_code'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('creator_referral:' || uid::text));

  select cc.code, cc.creator_name, cr.redeemed_at into have
    from public.creator_referrals cr
    join public.creator_codes cc on cc.id = cr.code_id
    where cr.user_id = uid;
  if found then
    return query select 'already_redeemed'::text, have.code, have.creator_name, have.redeemed_at;
    return;
  end if;

  select * into c from public.creator_codes cc where cc.code = wanted for update;
  if not found then
    return query select 'unknown_code'::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if c.creator_user_id is not null and c.creator_user_id = uid then
    return query select 'own_code'::text, c.code, c.creator_name, null::timestamptz;
    return;
  end if;

  select count(*) into used from public.creator_referrals cr where cr.code_id = c.id;
  if not c.active
     or (c.expires_at is not null and c.expires_at <= now())
     or (c.max_redemptions is not null and used >= c.max_redemptions) then
    return query select 'code_closed'::text, c.code, c.creator_name, null::timestamptz;
    return;
  end if;

  if p_source <> 'store' and (
       exists (select 1 from public.subscriptions s where s.user_id = uid)
    or exists (select 1 from public.store_entitlements e where e.user_id = uid
                 and (e.active or e.expires_at is not null or e.product_id is not null))) then
    return query select 'already_subscribed'::text, c.code, c.creator_name, null::timestamptz;
    return;
  end if;

  insert into public.creator_referrals (user_id, code_id, source) values (uid, c.id, p_source);
  return query select 'ok'::text, c.code, c.creator_name, now();
end $$;
revoke all on function public.redeem_creator_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.redeem_creator_code(uuid, text, text) to service_role;

-- ---------- recording a payment ----------

-- Called by the RevenueCat webhook for every paid store transaction. Returns a
-- word, never raises for the ordinary cases:
--
--   no_referral     the account was not sent by anybody; nothing to record
--   outside_window  paid after first_paid_at + commission_months; nothing owed
--   duplicate       this transaction id is already in the ledger
--   ok              one row written
--
-- The first payment sets `first_paid_at` and is itself inside the window. A
-- negative gross is a refund: it skips the window check (the refund of a
-- payment inside the window belongs to the same creator, whenever it lands)
-- and writes a negative row. The rate is the CODE's rate at the time of the
-- write, which is the rate the creator was promised.
create or replace function public.record_creator_earning(uid uuid, p_source text, p_external_id text,
  p_paid_at timestamptz, p_gross_cents int) returns text
language plpgsql security definer set search_path = public as $$
declare
  ref record;
  started timestamptz;
  paid timestamptz := coalesce(p_paid_at, now());
  wrote int;
begin
  if p_source is null or p_source not in ('apple', 'google') then
    raise exception 'record_creator_earning: unknown source %', p_source;
  end if;
  if p_external_id is null or trim(p_external_id) = '' then
    raise exception 'record_creator_earning: external id required';
  end if;
  if p_gross_cents is null then
    raise exception 'record_creator_earning: gross required';
  end if;

  select cr.code_id, cr.first_paid_at, cc.commission_bps, cc.commission_months into ref
    from public.creator_referrals cr
    join public.creator_codes cc on cc.id = cr.code_id
    where cr.user_id = uid
    for update of cr;
  if not found then return 'no_referral'; end if;

  started := ref.first_paid_at;
  if p_gross_cents >= 0 then
    if started is null then
      started := paid;
      update public.creator_referrals set first_paid_at = started where user_id = uid;
    end if;
    if paid >= started + make_interval(months => ref.commission_months) then
      return 'outside_window';
    end if;
  end if;

  insert into public.creator_earnings (code_id, user_id, source, external_id, paid_at, gross_cents, commission_cents)
    values (ref.code_id, uid, p_source, trim(p_external_id), paid, p_gross_cents,
            round(p_gross_cents * ref.commission_bps / 10000.0)::int)
    on conflict (external_id) do nothing;
  get diagnostics wrote = row_count;
  if wrote = 0 then return 'duplicate'; end if;
  return 'ok';
end $$;
revoke all on function public.record_creator_earning(uuid, text, text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.record_creator_earning(uuid, text, text, timestamptz, int) to service_role;

-- ---------- the numbers ----------

-- Per code, everything the owner wants on one line: the code's own columns plus
-- signups (referrals), subscribers (referred accounts on a paid plan right now),
-- what was earned, what was paid, and what is owed. Service role only: `contact`
-- is on it, and so is every creator's money.
create or replace view public.creator_code_stats as
select
  c.id, c.code, c.creator_name, c.creator_user_id, c.contact,
  c.commission_bps, c.commission_months, c.max_redemptions, c.expires_at,
  c.active, c.note, c.created_at, c.updated_at,
  coalesce(r.signups, 0)::int                                          as signups,
  coalesce(r.subscribers, 0)::int                                      as subscribers,
  coalesce(r.paying, 0)::int                                           as first_payments,
  coalesce(r.redemptions_30d, 0)::int                                  as redemptions_30d,
  r.last_redeemed_at,
  coalesce(e.earned_cents, 0)::bigint                                  as earned_cents,
  coalesce(p.paid_cents, 0)::bigint                                    as paid_cents,
  (coalesce(e.earned_cents, 0) - coalesce(p.paid_cents, 0))::bigint    as owed_cents,
  'usd'::text                                                          as currency
from public.creator_codes c
left join (
  select cr.code_id,
         count(*)                                                                as signups,
         count(*) filter (where pr.plan in ('plus', 'pro'))                       as subscribers,
         count(*) filter (where cr.first_paid_at is not null)                     as paying,
         count(*) filter (where cr.redeemed_at >= now() - interval '30 days')     as redemptions_30d,
         max(cr.redeemed_at)                                                      as last_redeemed_at
  from public.creator_referrals cr
  left join public.profiles pr on pr.id = cr.user_id
  group by cr.code_id
) r on r.code_id = c.id
left join (
  select code_id, sum(commission_cents) as earned_cents from public.creator_earnings group by code_id
) e on e.code_id = c.id
left join (
  select code_id, sum(amount_cents) as paid_cents from public.creator_payouts group by code_id
) p on p.code_id = c.id;

-- The creator's own view of the same numbers, one row per code their account
-- owns, without `contact`, `note` or anybody else's code. Security definer so it
-- can read the ledger the creator is otherwise locked out of; executable by the
-- service role only, because the route is what knows who is asking.
create or replace function public.creator_stats(uid uuid)
returns table (code text, active boolean, signups int, subscribers int,
               earned_cents bigint, paid_cents bigint, owed_cents bigint,
               commission_bps int, commission_months int)
language sql stable security definer set search_path = public as $$
  select s.code, s.active, s.signups, s.subscribers,
         s.earned_cents, s.paid_cents, s.owed_cents,
         s.commission_bps, s.commission_months
  from public.creator_code_stats s
  where s.creator_user_id = uid
  order by s.created_at
$$;
revoke all on function public.creator_stats(uuid) from public, anon, authenticated;
grant execute on function public.creator_stats(uuid) to service_role;

-- The staff mint route accepts an email rather than a uuid, because the owner
-- knows the creator's email and not their id. auth.users is not reachable over
-- PostgREST, so the lookup is a function. Service role only.
create or replace function public.creator_user_for_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(coalesce(p_email, '')))
  order by u.created_at
  limit 1
$$;
revoke all on function public.creator_user_for_email(text) from public, anon, authenticated;
grant execute on function public.creator_user_for_email(text) to service_role;

-- ---------- the scorecard line ----------

-- One row per ISO week since the first code was minted, zero-filled, so the
-- current week always has a row and `prev_*` is really last week and not the
-- last week anything happened. Same week boundary and the same exclusion of
-- staff and throwaway accounts as every other ops_*_week view; an earning whose
-- account has since been deleted keeps counting, because the money was paid.
-- `owed_now_usd` is current state, like ops_revenue_week, and is the number the
-- owner settles by hand.
create or replace view public.ops_creator_week as
with weeks as (
  select generate_series(
           (select public.ops_week(min(created_at)) from public.creator_codes)::timestamp,
           public.ops_week(now())::timestamp,
           interval '7 days')::date as week_start
), redeemed as (
  select public.ops_week(cr.redeemed_at)                          as week_start,
         count(*)                                                 as redemptions,
         count(*) filter (where cr.source = 'store')              as store_redemptions
  from public.creator_referrals cr
  join public.ops_included_accounts a on a.user_id = cr.user_id
  group by 1
), firsts as (
  select public.ops_week(cr.first_paid_at) as week_start, count(*) as first_payments
  from public.creator_referrals cr
  join public.ops_included_accounts a on a.user_id = cr.user_id
  where cr.first_paid_at is not null
  group by 1
), money as (
  select public.ops_week(e.paid_at)                        as week_start,
         round(sum(e.gross_cents) / 100.0, 2)              as gross_usd,
         round(sum(e.commission_cents) / 100.0, 2)         as commission_usd,
         count(*) filter (where e.gross_cents < 0)         as refunds
  from public.creator_earnings e
  where e.user_id is null
     or exists (select 1 from public.ops_included_accounts a where a.user_id = e.user_id)
  group by 1
), rows_ as (
  select w.week_start,
         coalesce(r.redemptions, 0)::int        as redemptions,
         coalesce(r.store_redemptions, 0)::int  as store_redemptions,
         coalesce(f.first_payments, 0)::int     as first_payments,
         coalesce(m.gross_usd, 0)               as gross_usd,
         coalesce(m.commission_usd, 0)          as commission_usd,
         coalesce(m.refunds, 0)::int            as refunds
  from weeks w
  left join redeemed r on r.week_start = w.week_start
  left join firsts   f on f.week_start = w.week_start
  left join money    m on m.week_start = w.week_start
)
select
  week_start, redemptions, store_redemptions, first_payments, gross_usd, commission_usd, refunds,
  coalesce(lag(redemptions)    over (order by week_start), 0) as prev_redemptions,
  coalesce(lag(first_payments) over (order by week_start), 0) as prev_first_payments,
  coalesce(lag(commission_usd) over (order by week_start), 0) as prev_commission_usd,
  (select round(coalesce(sum(owed_cents), 0) / 100.0, 2) from public.creator_code_stats) as owed_now_usd
from rows_;

revoke all on public.creator_code_stats from public, anon, authenticated;
revoke all on public.ops_creator_week   from public, anon, authenticated;
grant select on public.creator_code_stats to service_role;
grant select on public.ops_creator_week   to service_role;
