-- A per-person, per-minute throttle on the save routes' FREE answers.
--
-- ai_admit (20260908150000) was the only per-minute limit on /api/ingest. Since
-- the save routes admit late (asked only before paid work, so a bad link or a
-- duplicate no longer spends the one-minute burst or the busy lease), the free
-- answers — a link that is not a post, a card already on the shelf, a cache
-- hit — had no per-minute bound at all, and a link that is not a post is
-- resolved first: up to four outbound redirect fetches to whatever public host
-- it names. One signed-in account could make the function fetch third-party
-- URLs at any rate.
--
-- request_tick is that bound, and only that: 30 requests a minute per person per
-- route, for /api/ingest, /api/ingest/prepare and /api/uploads/authorize. A
-- person sharing by hand never gets near it. It is not ai_admit: a tick is not an
-- admission, does not hold the busy lease, and counts against no daily cap, so
-- late admission (a seventh share in a minute, four of them bad links) stays as
-- it is. The edge function fails OPEN when this call fails — a throttle, not a
-- guard of money; ai_reserve and the daily caps still are.
--
-- Service-only: RLS on with no policy, no grants to the browser roles, and the
-- function executable by service_role alone. Rows go with the account (cascade)
-- and are pruned ten minutes after they are written. Idempotent.

create table if not exists public.request_ticks (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  route    text not null,
  at       timestamptz not null default now()
);
create index if not exists request_ticks_user_route_at on public.request_ticks (user_id, route, at);
create index if not exists request_ticks_at on public.request_ticks (at);

alter table public.request_ticks enable row level security;   -- no policies: service role only
revoke all on public.request_ticks from public, anon, authenticated;
grant all on public.request_ticks to service_role;

-- True when this request is inside the person's limit for the route (and is
-- counted), false when it is the (limit+1)th in the last minute (not counted, so
-- the window slides). Serialized per person by its own advisory lock — not
-- ai_admit's, so a tick never waits behind an admission. Each call also prunes
-- up to 100 rows older than ten minutes, anyone's, skipping rows another call is
-- already deleting: the table stays at about ten minutes of traffic without a
-- cron job and without two calls contending over the same old rows.
create or replace function public.request_tick(p_user uuid, p_route text, p_limit int)
returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare n int;
begin
  if p_user is null or p_route is null or p_limit is null or p_limit < 1 then
    raise exception 'request_tick: user, route and a positive limit are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 924));
  delete from public.request_ticks where id in (
    select id from public.request_ticks where at < now() - interval '10 minutes'
    order by at limit 100 for update skip locked);
  select count(*) into n from public.request_ticks
    where user_id = p_user and route = p_route and at > now() - interval '1 minute';
  if n >= p_limit then return false; end if;
  insert into public.request_ticks (user_id, route) values (p_user, p_route);
  return true;
end $$;
revoke all on function public.request_tick(uuid, text, int) from public, anon, authenticated;
grant execute on function public.request_tick(uuid, text, int) to service_role;
