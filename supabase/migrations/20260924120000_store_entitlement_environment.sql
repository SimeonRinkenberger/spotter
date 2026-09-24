-- Which store environment a Plus entitlement came from, and whether it renews.
--
-- Additive. `environment` lets ops count sandbox/TestFlight/App Review and Test
-- Store grants apart from paying ones once REVENUECAT_SANDBOX_POLICY lets them
-- unlock Plus; `will_renew` is false once the store reports auto-renew off (or a
-- renewal that could not be charged), so Settings says "ends" instead of
-- "renews". Both are null until the next sync of a row. `source` gains 'test'
-- for RevenueCat's Test Store, which only a QA-flagged account can activate.
--
-- Apply BEFORE deploying the spotter-purchases function that sends the two new
-- arguments. The old function's six-argument call still resolves against the
-- new signature (the two new arguments default to null), so applying this first
-- never breaks a sync; deploying the function first would.
alter table public.store_entitlements
  add column if not exists environment text
    check (environment in ('production','sandbox','test_store')),
  add column if not exists will_renew boolean;

alter table public.store_entitlements drop constraint if exists store_entitlements_source_check;
alter table public.store_entitlements add constraint store_entitlements_source_check
  check (source in ('apple','google','test'));

drop function if exists public.sync_store_entitlement(uuid,boolean,timestamptz,text,text,timestamptz);
create function public.sync_store_entitlement(uid uuid, is_active boolean,
  expiry timestamptz, store text, product text, observed timestamptz,
  environment text default null, will_renew boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.profiles where id=uid for update;
  insert into public.store_entitlements(user_id,active,expires_at,source,product_id,observed_at,environment,will_renew)
    values(uid,is_active,expiry,store,product,observed,environment,will_renew)
    on conflict(user_id) do update set active=excluded.active,expires_at=excluded.expires_at,
      source=excluded.source,product_id=excluded.product_id,observed_at=excluded.observed_at,
      environment=excluded.environment,will_renew=excluded.will_renew,updated_at=now()
    where store_entitlements.observed_at <= excluded.observed_at;
end $$;
revoke all on function public.sync_store_entitlement(uuid,boolean,timestamptz,text,text,timestamptz,text,boolean)
  from public,anon,authenticated;
grant execute on function public.sync_store_entitlement(uuid,boolean,timestamptz,text,text,timestamptz,text,boolean)
  to service_role;
