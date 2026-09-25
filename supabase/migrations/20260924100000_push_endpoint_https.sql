-- A web push endpoint is an https URL, always.
--
-- The browser writes push_subscriptions itself (app.ts upserts the
-- PushSubscription it was handed), and every push service a browser can hand
-- out — FCM, Mozilla autopush, web.push.apple.com, WNS — issues https
-- endpoints. The sender (push.ts) refuses anything else before a request is
-- made; this is the same rule one layer down, so such a row cannot be stored.
--
-- Added NOT VALID and then validated, so the check of existing rows is its own
-- step (the one live row on 24 Sept 2026 is https). Re-runnable: the add is
-- skipped when the constraint exists and VALIDATE on a valid constraint is a
-- no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_subscriptions_endpoint_https'
      and conrelid = 'public.push_subscriptions'::regclass
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_https check (endpoint like 'https://%') not valid;
  end if;
end $$;

alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_https;
