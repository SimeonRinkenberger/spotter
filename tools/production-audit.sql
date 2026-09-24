-- Read-only metadata/counters; never print credentials or user content.
select jsonb_build_object(
 'tables_without_rls',(select coalesce(jsonb_agg(tablename),'[]') from pg_tables where schemaname='public' and not rowsecurity),
 'client_security_definers',(select coalesce(jsonb_agg(p.proname),'[]') from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
 'budget',public.ai_budget_status(),
 'database_bytes',pg_database_size(current_database()),
 'queue',(select jsonb_object_agg(status,n) from (select status,count(*) n from ingest_jobs group by status) x),
 'oldest_queued_seconds',(select extract(epoch from now()-min(created_at)) from ingest_jobs where status='queued'),
 'unknown_ai_calls',(select count(*) from ai_reservations where state='unknown' and created_at>now()-interval '1 day'),
 'stale_uploads',(select count(*) from storage.objects where bucket_id='uploads' and created_at<now()-interval '2 hours'),
 -- Security assertions (GTM hardening, 24 Sept 2026). Each one reads [] / 0 / false when the schema is as intended.
 'client_writes_on_service_tables',(select coalesce(jsonb_agg(t||':'||r||':'||p order by t,r,p),'[]') from
   unnest(array['ai_cost_log','app_config','billing_customers','billing_events','exercise_catalog','exercise_demo_videos',
     'exercise_videos','ingest_jobs','pumpy_usage','saves_log','video_cache','video_previews','erasure_outbox']) t,
   unnest(array['anon','authenticated']) r, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
   where to_regclass('public.'||t) is not null and has_table_privilege(r,('public.'||t)::regclass,p)),
 'client_truncate_tables',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_class c
   where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
     and (has_table_privilege('anon',c.oid,'TRUNCATE') or has_table_privilege('authenticated',c.oid,'TRUNCATE'))),
 'mutable_search_path_functions',(select coalesce(jsonb_agg(p.proname order by p.proname),'[]') from pg_proc p
   where p.pronamespace='public'::regnamespace and p.prokind='f'
     and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%')
     and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
 'workout_logs_strava_insert_by_client',has_column_privilege('authenticated','public.workout_logs','strava_activity_id','INSERT'),
 'foreign_workout_references',(select count(*) from plan x join workouts w on w.id=x.workout_id where w.user_id<>x.user_id)
   +(select count(*) from workout_logs x join workouts w on w.id=x.workout_id where w.user_id<>x.user_id),
 'push_endpoints_not_https',(select count(*) from push_subscriptions where endpoint not like 'https://%'),
 'push_endpoint_check_validated',(select coalesce(bool_and(convalidated),false) from pg_constraint where conname='push_subscriptions_endpoint_https'),
 'erasure_outbox_present',to_regclass('public.erasure_outbox') is not null
) as audit;
