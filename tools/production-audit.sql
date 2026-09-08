-- Read-only metadata/counters; never print credentials or user content.
select jsonb_build_object(
 'tables_without_rls',(select coalesce(jsonb_agg(tablename),'[]') from pg_tables where schemaname='public' and not rowsecurity),
 'client_security_definers',(select coalesce(jsonb_agg(p.proname),'[]') from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
 'budget',public.ai_budget_status(),
 'database_bytes',pg_database_size(current_database()),
 'queue',(select jsonb_object_agg(status,n) from (select status,count(*) n from ingest_jobs group by status) x),
 'oldest_queued_seconds',(select extract(epoch from now()-min(created_at)) from ingest_jobs where status='queued'),
 'unknown_ai_calls',(select count(*) from ai_reservations where state='unknown' and created_at>now()-interval '1 day'),
 'stale_uploads',(select count(*) from storage.objects where bucket_id='uploads' and created_at<now()-interval '2 hours')
) as audit;
