-- Service-only tables: the browser roles keep SELECT and lose every write grant.
--
-- These tables are written by the edge function (service role), by definer
-- functions and by cron, never by a client. Until now the only thing standing
-- between anon/authenticated and a write was "RLS on, no policy". That still
-- holds; this makes it two things rather than one, so a future permissive
-- policy or a disabled RLS flag does not open a write by itself.
--
-- Proved from source before revoking: app.ts in main and in every commit that
-- carried iOS builds 5, 6 and 7 touches exactly one of these tables, with a
-- SELECT (exercise_catalog), and the native shells call only the edge
-- function, never PostgREST. SELECT grants are left exactly as they were.
--
-- TRUNCATE, REFERENCES and TRIGGER go from every public table: no client path
-- can use them (PostgREST never issues them) and TRUNCATE does not consult RLS.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_cost_log', 'app_config', 'billing_customers', 'billing_events',
    'exercise_catalog', 'exercise_demo_videos', 'exercise_videos', 'ingest_jobs',
    'pumpy_usage', 'saves_log', 'video_cache', 'video_previews'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    end if;
  end loop;

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
  end loop;
end $$;
