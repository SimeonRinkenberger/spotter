-- Store entitlements are independent of Stripe so one provider's cancellation
-- cannot revoke access purchased through another. Only the service role writes.
create table if not exists public.store_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default false,
  expires_at timestamptz,
  source text check (source in ('apple','google')),
  product_id text,
  observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.store_entitlements enable row level security;
create policy "read own store entitlement" on public.store_entitlements for select
  to authenticated using (user_id = (select auth.uid()));
grant select on public.store_entitlements to authenticated;
revoke insert, update, delete on public.store_entitlements from anon, authenticated;

create or replace function public.recompute_spotter_plan(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare next_plan text;
begin
  -- Serialize all providers against the same profile row.
  perform 1 from public.profiles where id = uid for update;
  select case when exists(select 1 from public.subscriptions where user_id=uid
      and status in ('active','trialing','past_due') and plan='pro') then 'pro'
    when exists(select 1 from public.subscriptions where user_id=uid
      and status in ('active','trialing','past_due'))
      or exists(select 1 from public.store_entitlements where user_id=uid and active
        and (expires_at is null or expires_at > now())) then 'plus'
    else 'free' end into next_plan;
  update public.profiles set plan=next_plan where id=uid and plan <> 'staff' and plan is distinct from next_plan;
end $$;
revoke all on function public.recompute_spotter_plan(uuid) from public,anon,authenticated;
grant execute on function public.recompute_spotter_plan(uuid) to service_role;

create or replace function public.apply_subscription_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_spotter_plan(coalesce(new.user_id,old.user_id));
  return null;
end $$;
revoke all on function public.apply_subscription_plan() from public,anon,authenticated;
create trigger store_entitlements_apply_plan after insert or update or delete
  on public.store_entitlements for each row execute function public.apply_subscription_plan();

create or replace function public.sync_store_entitlement(uid uuid, is_active boolean,
  expiry timestamptz, store text, product text, observed timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.profiles where id=uid for update;
  insert into public.store_entitlements(user_id,active,expires_at,source,product_id,observed_at)
    values(uid,is_active,expiry,store,product,observed)
    on conflict(user_id) do update set active=excluded.active,expires_at=excluded.expires_at,
      source=excluded.source,product_id=excluded.product_id,observed_at=excluded.observed_at,updated_at=now()
    where store_entitlements.observed_at <= excluded.observed_at;
end $$;
revoke all on function public.sync_store_entitlement(uuid,boolean,timestamptz,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_store_entitlement(uuid,boolean,timestamptz,text,text,timestamptz) to service_role;

-- Expiry remains enforced if a store notification is delayed or lost.
select cron.schedule('spotter-store-expiry','* * * * *',
  $$update public.store_entitlements set active=false,updated_at=now() where active and expires_at <= now()$$);
