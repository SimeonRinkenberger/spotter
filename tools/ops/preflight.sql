-- Spotter — is the ops scorecard actually wired up in production?
--
--   supabase db query --linked --file tools/ops/preflight.sql
--
-- Run it once before `supabase db push` to see what is missing, and again after
-- `supabase functions deploy spotter` to see that everything arrived. Read-only
-- aggregates and metadata: no writes, and not one row of anyone's content.
--
-- What each line means when it is wrong:
--
--   claim_generation_applied / attempt_meta_applied false
--       20260917130000 and 20260917150000 have not been applied yet. The
--       scorecard migration reads both (ops_incidents_week wants
--       ingest_jobs.claim_generation; ops_cost_week wants
--       ai_reservations.attempt_meta), so push them first — `supabase db push`
--       applies them in timestamp order on its own.
--
--   ops_objects_present < 12
--       The scorecard migration has not been applied, or only partly.
--
--   spotter-ops-tick missing from cron_jobs
--       Applied without the pg_cron extension present. Nothing is evaluating the
--       thresholds, so an empty ops_alerts table means nothing at all.
--
--   worker_url_shape not 'ends with /api/worker/tick'
--       The tick derives the ops route from this value and refuses to post if it
--       cannot. Alerts would still be recorded; nobody would be told.
--
--   staff_push_devices = 0
--       THE ONE THE OWNER FIXES HIMSELF. Alerts are being recorded and told to
--       nobody. Sign in as the staff account on the phone and turn reminders on;
--       that is what creates the push_subscriptions row this depends on.

select jsonb_pretty(jsonb_build_object(
  'claim_generation_applied', exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='ingest_jobs' and column_name='claim_generation'),
  'attempt_meta_applied', exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='ai_reservations' and column_name='attempt_meta'),
  'ops_objects_present', (select count(*) from pg_class
      where relname like 'ops\_%' and relnamespace='public'::regnamespace),
  'ops_objects_readable_by_clients', (select coalesce(jsonb_agg(relname order by relname),'[]')
      from pg_class where relname like 'ops\_%' and relnamespace='public'::regnamespace
        and (has_table_privilege('anon',oid,'select') or has_table_privilege('authenticated',oid,'select'))),
  'cron_jobs', (select coalesce(jsonb_agg(jobname order by jobname),'[]') from cron.job),
  'worker_url_shape', coalesce((select case when value like '%/api/worker/tick'
        then 'ends with /api/worker/tick' else 'UNEXPECTED SHAPE' end
      from public.app_config where key='worker_url'), 'NOT SET'),
  'worker_secret_set', exists(select 1 from public.app_config where key='worker_secret' and length(value) > 0),
  'staff_accounts', (select count(*) from public.profiles where plan='staff'),
  'staff_push_devices', (select count(*) from public.push_subscriptions s
      join public.profiles p on p.id=s.user_id where p.plan='staff'),
  'unpriced_store_products', (select coalesce(jsonb_agg(distinct e.product_id),'[]')
      from public.store_entitlements e
      where e.product_id is not null and not exists(select 1 from public.ops_price_book b
        where b.source=e.source and b.product_key=e.product_id)),
  'price_book_unverified', (select count(*) from public.ops_price_book where not verified),
  'open_alerts', (select count(*) from public.ops_alerts where acked_at is null)
)) as preflight;
