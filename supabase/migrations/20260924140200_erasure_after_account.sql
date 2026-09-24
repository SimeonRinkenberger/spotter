-- Erasure at third parties waits for the account deletion to finish.
--
-- The outbox (20260924100500) writes a request down before it is attempted. It
-- is written while the account still exists, because the grant it needs (a
-- Strava token pair, a Stripe customer id) is read from rows that go with the
-- account. A deletion can still stop after that point — the ledgers or the auth
-- delete can fail — and the person then keeps their account. Their third-party
-- records must not be erased on a retry schedule regardless.
--
--   * `account` names the Spotter account an erasure belongs to. A row whose
--     account is still in auth.users is not claimed; it becomes due the moment
--     the account is gone. A row whose deletion never finished is withdrawn
--     after a day (the account is alive and its records are its own).
--   * `erasure_enqueue` takes the account as an optional fourth argument.
--     Callers that pass three (erasure.ts after the auth delete, and every
--     deployed function before this one) behave as before; a re-queue never
--     clears an account already recorded.
--   * A Strava grant stored for an athlete (a new connection, or a refresh)
--     withdraws any pending Strava erasure for that athlete: deauthorizing
--     revokes every grant the athlete gave Spotter, including the new one.
--
-- Idempotent.

alter table public.erasure_outbox add column if not exists account uuid;

drop function if exists public.erasure_enqueue(text, text, jsonb);

create or replace function public.erasure_enqueue(p_provider text, p_subject text,
  p_detail jsonb default '{}'::jsonb, p_account uuid default null)
returns bigint
language sql security definer set search_path = public, pg_catalog as $$
  insert into public.erasure_outbox (provider, subject, detail, account)
  values (p_provider, p_subject, coalesce(p_detail, '{}'::jsonb), p_account)
  on conflict (provider, subject) do update
    set detail = excluded.detail, next_at = now(),
        account = coalesce(excluded.account, public.erasure_outbox.account)
  returning id;
$$;

create or replace function public.erasure_claim(p_limit int default 10)
returns setof public.erasure_outbox
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  -- A deletion that stopped before the auth row went, and was not retried within
  -- a day: the account lives on, so there is nothing to erase for it.
  delete from public.erasure_outbox o
   where o.account is not null and o.created_at < now() - interval '1 day'
     and exists (select 1 from auth.users u where u.id = o.account);

  return query
  with due as (
    select o.id from public.erasure_outbox o
    where o.next_at <= now()
      and (o.account is null or not exists (select 1 from auth.users u where u.id = o.account))
    order by o.next_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.erasure_outbox o set next_at = now() + interval '15 minutes'
  from due where o.id = due.id
  returning o.*;
end $$;

create or replace function public.erasure_forget_relinked_strava() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.athlete_id is not null then
    delete from public.erasure_outbox where provider = 'strava' and subject = new.athlete_id::text;
  end if;
  return new;
end $$;

drop trigger if exists erasure_forget_relinked_strava on public.strava_tokens;
create trigger erasure_forget_relinked_strava after insert or update on public.strava_tokens
for each row execute function public.erasure_forget_relinked_strava();

revoke all on function public.erasure_enqueue(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.erasure_claim(int) from public, anon, authenticated;
revoke all on function public.erasure_forget_relinked_strava() from public, anon, authenticated;
grant execute on function public.erasure_enqueue(text, text, jsonb, uuid) to service_role;
grant execute on function public.erasure_claim(int) to service_role;
