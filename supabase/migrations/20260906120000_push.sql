-- ---------- push_subscriptions: two reminders, both opt-in ----------
--
-- Spotter sends exactly two notifications and never a third: the plan-day
-- reminder at a time the user picked, and the one that says the week is still
-- reachable. Both are off until somebody taps a real switch, both stop the
-- moment they are switched off, and the hard caps (one a day, three a week,
-- nothing for 24h after a finished session) live in the sender.
--
-- One row per browser, not per user: a phone and a laptop are two push
-- endpoints and two separate grants of permission, and revoking one must not
-- silence the other. `endpoint` is the identity the push service gave us, so it
-- is the unique key and the thing a 404/410 from that service tells us to drop.
--
-- The keys stored here are the SUBSCRIBER's public ECDH key (p256dh) and its
-- auth secret, which is what RFC 8291 encrypts the payload to. They are useless
-- to anyone but this project's VAPID key pair, which lives in function secrets
-- and never in a table.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  -- The IANA zone the browser reported. Every "is it 17:00 for this person yet"
  -- question is answered against this and nothing else, so a user who flies to
  -- Tokyo gets Tokyo's evening the next time the app opens and re-subscribes.
  tz           text not null default 'UTC',
  remind_plan  boolean not null default false,
  remind_risk  boolean not null default false,
  -- Minutes past local midnight. 1050 = 17:30. Stored to the minute although the
  -- job only ticks hourly: the column should not have to change the day the tick
  -- gets finer.
  remind_at    smallint not null default 1050,

  -- The caps, written by the sender only (see the grant below).
  last_sent_at timestamptz,
  sent_week    int not null default 0,
  week_key     text,
  -- The at-risk push is once per week, not once per day, so it needs its own
  -- mark: the Monday of the week it last went out for.
  risk_week    text,

  created_at   timestamptz not null default now()
);

create index if not exists push_subs_user on public.push_subscriptions (user_id);
-- What the hourly job reads: only the rows that asked for something.
create index if not exists push_subs_live on public.push_subscriptions (remind_at)
  where remind_plan or remind_risk;

alter table public.push_subscriptions enable row level security;

-- (select auth.uid()) rather than auth.uid(): the initplan-safe form the schema
-- standardised on in 20260902030000_rls_initplan.sql.
create policy "own push select" on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy "own push insert" on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy "own push update" on public.push_subscriptions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own push delete" on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));

-- The browser owns its preferences; it does not own the ledger that rate-limits
-- it. Same shape as profiles, where a user may write display_name and settings
-- but never their own ingest_key: clearing last_sent_at from a devtools console
-- would only spam the person doing it, but a cap you can erase is not a cap.
-- The four preference columns plus the three identity columns are exactly what
-- the client's upsert sends, so the grant is the payload and nothing more.
revoke update on public.push_subscriptions from authenticated;
grant update (user_id, endpoint, p256dh, auth, tz, remind_plan, remind_risk, remind_at)
  on public.push_subscriptions to authenticated;

-- ---------- the hourly tick ----------
--
-- Same mechanism as spotter-worker-tick (20260901190000_ingest_queue.sql): cron
-- posts to the function with the shared secret out of app_config, which is the
-- only table holding the URL and is service-role-only. The URL is derived from
-- the worker's rather than stored twice — one address to fix if the project ever
-- moves, and no second secret to forget.
--
-- On the hour, because that is the resolution a reminder needs; the sender picks
-- the hour nearest each row's remind_at. The `where exists` means a project with
-- nobody subscribed evaluates one index lookup an hour and makes no HTTP request
-- at all.

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
  where exists (select 1 from public.app_config where key = 'worker_url')
    and exists (select 1 from public.push_subscriptions where remind_plan or remind_risk);
$cron$);
