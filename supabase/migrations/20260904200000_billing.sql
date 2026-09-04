-- Spotter — paid plans: the entitlement layer, and the caps that hang off it.
--
-- Three tables and one trigger. The shape is deliberately source-agnostic: a
-- subscription bought on the web through Stripe and one bought later through the
-- App Store write the SAME row with a different `source`, and the derivation to
-- `profiles.plan` neither knows nor cares which it was. `profiles.plan` stays the
-- single thing every cap check in the edge function reads, exactly as it does for
-- Pumpy's credits today — nothing anywhere asks Stripe a question on a hot path.
--
-- The other rule that shapes this file: the edge function's `syncStripeCustomer`
-- is the ONLY writer of a `subscriptions` row. It fetches the customer's
-- subscriptions from Stripe and overwrites the row wholesale. Webhook payloads
-- are a signal that something changed, never the state itself, because Stripe
-- does not guarantee event ordering and says so out loud. That is why there is no
-- clever per-event SQL here: there is one row, one writer, one trigger.

-- ---------- who is who in Stripe ----------

-- One Stripe Customer per user, created BEFORE the first Checkout Session rather
-- than by Checkout itself. Letting Checkout mint the customer is the classic
-- duplicate-customer bug: a second checkout makes a second Customer and the
-- webhook can no longer answer "which user is this". The unique index is what
-- makes the webhook's customer -> user lookup O(1) and unambiguous.
create table if not exists public.billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);
alter table public.billing_customers enable row level security;   -- no policies: service role only

-- ---------- the subscription ----------

-- One row per user. `status` is the Stripe status verbatim rather than a
-- vocabulary of our own, so Apple and Google map INTO it later instead of forcing
-- a second state machine. `external_id` is sub_… for Stripe, the original
-- transaction id for Apple, and null for a comp.
create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  source               text not null check (source in ('stripe','apple','google','manual')),
  external_id          text unique,          -- sub_… / original_transaction_id / null for manual
  plan                 text not null check (plan in ('plus','pro')),
  status               text not null,        -- Stripe status verbatim; manual rows use 'active' or 'canceled'
  price_lookup_key     text,
  "interval"           text check ("interval" in ('month','year')),
  cancel_at_period_end boolean not null default false,
  current_period_end   timestamptz,
  trial_end            timestamptz,
  payment_failed_at    timestamptz,          -- set while status is past_due/unpaid, cleared otherwise
  updated_at           timestamptz not null default now(),
  raw                  jsonb                 -- trimmed last-synced object, for support
);
alter table public.subscriptions enable row level security;

-- Readable by its owner so Settings can render "renews Oct 4" straight from
-- PostgREST without a round trip through the function. Deliberately no insert,
-- update or delete policy: the row is written by the service role and by nobody
-- else, because a client that could write it could write itself a plan.
do $$ begin
  create policy "own subscription read" on public.subscriptions
    for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;

grant select on public.subscriptions to authenticated;
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- ---------- the webhook ledger ----------

-- Stripe re-delivers events and does not promise to deliver them once. The id is
-- the primary key, so claiming an event is an insert that either wins or does
-- not; `processed_at` separates a true duplicate (already done, answer 200) from
-- an earlier attempt that failed before finishing (no processed_at, so do it
-- again). `error` is what a support question gets answered from.
create table if not exists public.billing_events (
  id           text primary key,     -- Stripe event id
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
alter table public.billing_events enable row level security;   -- no policies: service role only

-- ---------- per-user cap override ----------

-- The same idea and the same shape as `pumpy_limits`: a plan picks the numbers, a
-- per-user override beats the plan field by field, and null means unlimited. This
-- is how the owner comps a friend a bigger allowance without inventing a plan.
-- {"library":int|null,"saves":int|null,"extract":int|null,"media":int|null,
--  "uploads":int|null,"helper":int|null}
alter table public.profiles add column if not exists limits jsonb;

-- ---------- plan derivation ----------

-- Entitled = trialing | active | past_due. `past_due` is the Smart Retries grace
-- window and keeping access through it is the standard SaaS courtesy; `unpaid` is
-- where Stripe itself says to revoke, because by then the retries are spent.
-- `canceled`, `incomplete`, `incomplete_expired` and `paused` are not entitled.
--
-- Never touches a 'staff' profile: comps are the owner's and billing does not get
-- to take one away.
--
-- Fires AFTER DELETE too, and that is deliberate rather than an oversight: the
-- select then finds no row, `entitled` comes back null, coalesce makes it false
-- and the plan drops to 'free'. A deleted row IS the "no subscription" state —
-- please do not "fix" this by dropping `delete` from the trigger's event list.
create or replace function public.apply_subscription_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid; entitled boolean; newplan text;
begin
  uid := coalesce(new.user_id, old.user_id);
  select (s.status in ('trialing','active','past_due')) into entitled
    from public.subscriptions s where s.user_id = uid;
  newplan := case when coalesce(entitled,false)
                  then (select plan from public.subscriptions where user_id = uid)
                  else 'free' end;
  update public.profiles set plan = newplan
    where id = uid and plan <> 'staff' and plan is distinct from newplan;
  return null;
end $$;

do $$ begin
  create trigger subscriptions_apply_plan
    after insert or update or delete on public.subscriptions
    for each row execute function public.apply_subscription_plan();
exception when duplicate_object then null; end $$;

-- ---------- dials ----------

-- Caps per plan, read by the function on the same 5-minute cache as the model ids
-- and Pumpy's credits. null = unlimited. Numbers from R-BILL-1: the free tier has
-- to stay genuinely useful (logging, Workout Mode, Plan, Progress and the muscle
-- map are never metered at all), so what is metered here is only the part that
-- costs money to produce — an extraction, a video read, an upload, a coaching
-- answer. `pro` is seeded but unsold: it is the price-raise valve, and the day it
-- is sold nothing in the function changes.
--
-- `library` is the exception to "per day" and the main free gate: it is a STOCK,
-- how many workouts an account may hold at once. R-BILL-1's finding is that a
-- shelf converts where a rate does not — a daily ceiling teaches people to save
-- less, a full shelf is a decision about whether the library is worth keeping.
-- It is checked only where a new row would be created (a save, an upload, a
-- workout Pumpy proposes) and never on reading, logging, editing or deleting.
insert into public.app_config (key, value) values
  ('limits.plans',
   '{"free":{"library":20,"saves":30,"extract":10,"media":2,"uploads":1,"helper":25},' ||
   '"plus":{"library":null,"saves":200,"extract":60,"media":15,"uploads":10,"helper":60},' ||
   '"pro":{"library":null,"saves":500,"extract":150,"media":50,"uploads":25,"helper":600},' ||
   '"staff":{"library":null,"saves":null,"extract":null,"media":null,"uploads":null,"helper":null}}'),
  -- Days of free trial on a new subscription, applied to the ANNUAL price only
  -- (the free tier is the monthly plan's trial). 0 switches trials off entirely.
  ('billing.trial_days', '7'),
  -- Stripe Tax. Off at launch: Illinois does not tax cloud-only SaaS and every
  -- economic-nexus threshold is far away, so turning calculation on would add an
  -- untestable code path that collects nothing. Flip this the day a registration
  -- exists — the checkout code already reads it.
  ('billing.tax', 'false')
on conflict (key) do nothing;
