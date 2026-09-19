-- ---------- push_devices: the same two reminders, delivered by APNs ----------
--
-- Spotter still sends exactly two notifications and still will not send a third.
-- This table changes nothing about that policy: it is `push_subscriptions` with
-- the Web Push identity (endpoint + the subscriber's ECDH keys) swapped for the
-- APNs one (a device token and the environment that token belongs to). Every
-- preference column, every ledger column and every grant is deliberately the
-- same shape, because the sender runs ONE decision function over both tables and
-- a column that differed would be a rule that differed.
--
-- Why a second table rather than nullable columns on the first. The identity is
-- the whole point of the row: Web Push is keyed by an endpoint URL that the push
-- service issued and APNs by a hex token that Apple issued, and the two are
-- dropped for different reasons (404/410 from the endpoint's own origin versus
-- 410/BadDeviceToken from Apple). Folding them together would mean a `check`
-- constraint saying "exactly one of these five columns is null", a unique index
-- over a coalesce, and a sender that asks which kind of row it is holding on
-- every line. Two narrow tables and one shared `decide()` says it once.
--
-- One row per INSTALL, not per user: the phone and the iPad are two tokens and
-- two separate grants of permission, exactly as a phone and a laptop are two
-- browsers upstairs. iOS also reissues a token (a restore from backup, a long
-- enough gap between launches), so the client re-reads its token at boot and
-- moves the preferences across when it has changed.
--
-- Nothing secret lives here. A device token is an address, useless without the
-- APNs signing key, which lives in function secrets and never in a table.

create table if not exists public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Lowercase hex, exactly as `didRegisterForRemoteNotificationsWithDeviceToken`
  -- hands the bytes over. Unique for the same reason `endpoint` is: it is the
  -- address Apple told us to use, and two rows for one device is two pushes.
  token        text not null unique,
  platform     text not null default 'ios',
  -- The bundle id the token was issued for. APNs binds a token to a topic, so a
  -- token minted against the dev bundle is `BadDeviceToken` on the App Store one
  -- — storing it means that mistake is visible in a query rather than in a
  -- silent 400 an hour later.
  bundle       text,
  -- Which APNs host will accept it. A Debug build talks to the sandbox and a
  -- shipped build to production, and sending to the wrong one is the single most
  -- common way a correct payload never arrives.
  env          text not null default 'sandbox' check (env in ('sandbox', 'production')),
  -- The IANA zone the app reported. Every "is it 17:00 for this person yet"
  -- question is answered against this and nothing else.
  tz           text not null default 'UTC',
  remind_plan  boolean not null default false,
  remind_risk  boolean not null default false,
  -- Minutes past local midnight. 1050 = 17:30, the same default the browser rows
  -- carry, so a user with both does not get two different times.
  remind_at    smallint not null default 1050,

  -- The caps, written by the sender only (see the grant below).
  last_sent_at timestamptz,
  sent_week    int not null default 0,
  week_key     text,
  risk_week    text,

  -- What shipped. A reminder that stopped arriving for everybody on one build is
  -- a question you can only answer if the row remembers which build it was.
  app_version  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_devices_user on public.push_devices (user_id);
-- What the hourly job reads: only the rows that asked for something. Same shape
-- and same reason as push_subs_live.
create index if not exists push_devices_live on public.push_devices (remind_at)
  where remind_plan or remind_risk;

alter table public.push_devices enable row level security;

-- (select auth.uid()) rather than auth.uid(): the initplan-safe form the schema
-- standardised on in 20260902030000_rls_initplan.sql.
create policy "own device select" on public.push_devices
  for select using (user_id = (select auth.uid()));
create policy "own device insert" on public.push_devices
  for insert with check (user_id = (select auth.uid()));
create policy "own device update" on public.push_devices
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own device delete" on public.push_devices
  for delete using (user_id = (select auth.uid()));

-- The app owns its preferences; it does not own the ledger that rate-limits it.
-- Identical reasoning to push_subscriptions: clearing last_sent_at from a
-- debugger would only spam the person doing it, but a cap you can erase is not a
-- cap. The grant is exactly the client's upsert payload and nothing more.
revoke update on public.push_devices from authenticated;
grant update (user_id, token, platform, bundle, env, tz, remind_plan, remind_risk, remind_at,
              app_version, updated_at)
  on public.push_devices to authenticated;

-- ---------- the hourly tick, now watching both tables ----------
--
-- Same job, same name, same schedule: cron.schedule() on an existing name
-- replaces the command, which is how 20260906120000 installed it in the first
-- place. The only change is the guard. It used to read "somebody has a browser
-- subscription"; a project whose only subscribers were native installs would
-- have sat there evaluating one index lookup an hour and making no request,
-- which is the failure mode this feature would have shipped with.
--
-- The worker_url derivation and its `like` guard are unchanged and load-bearing:
-- replace() on a URL that does not contain the worker's path returns it
-- unchanged, and an hourly POST to /api/worker/tick carrying a push body would
-- quietly drain the ingest queue instead.

select cron.schedule('spotter-push-tick', '0 * * * *', $cron$
  select net.http_post(
    url     := replace((select value from public.app_config where key = 'worker_url'),
                       '/api/worker/tick', '/api/push/tick'),
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-worker-secret', (select value from public.app_config where key = 'worker_secret')),
    body    := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 10000
  )
  where exists (select 1 from public.app_config
                 where key = 'worker_url' and value like '%/api/worker/tick')
    and (exists (select 1 from public.push_subscriptions where remind_plan or remind_risk)
      or exists (select 1 from public.push_devices where remind_plan or remind_risk));
$cron$);
