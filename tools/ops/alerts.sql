-- Spotter — what is currently wrong, and what has been wrong lately.
--
--   supabase db query --linked --file tools/ops/alerts.sql
--
-- This is the "my phone buzzed, what was it" query, and the "did anything fire
-- while I was away" query. `ops_alert_check()` writes at most one row per key
-- per UTC day, so an empty first block genuinely means nothing has gone wrong
-- today — not that the check is quiet.
--
-- Read-only. `detail` is content-free by construction: counts, minutes,
-- percentages and provider names, never a user's content or an email address.
--
-- To acknowledge one, after actually looking at it:
--   update public.ops_alerts set acked_at = now() where key = '…' and day = current_date;

\echo
\echo ================ open, worst first ================
select key, day, level, detail,
       created_at,
       case when detail->>'notified' is null then 'not sent' else 'pushed' end as notification,
       round(extract(epoch from (now() - created_at)) / 60) as age_minutes
from public.ops_alerts
where acked_at is null
order by case level when 'critical' then 3 when 'warn' then 2 else 1 end desc,
         created_at desc;

\echo
\echo ================ the last fourteen days ================
\echo A key that appears every single day is either a real standing problem or a
\echo threshold that is set wrong. Both are worth ten minutes; neither is worth
\echo learning to ignore the notification.
select key, level, count(*) as days_fired, min(day) as first_day, max(day) as last_day,
       count(*) filter (where acked_at is not null) as acknowledged
from public.ops_alerts
where day >= current_date - 14
group by key, level
order by days_fired desc, key;

\echo
\echo ================ is the pager itself alive ================
\echo `spotter-ops-tick` should have run within the last fifteen minutes. If the
\echo cron row is missing, the migration was applied without the cron extension.
\echo If the last run is old or failed, nothing below is being evaluated at all
\echo and an empty alert list means nothing.
select j.jobname, j.schedule, j.active,
       r.status, r.start_time, r.end_time,
       left(coalesce(r.return_message, ''), 200) as last_message
from cron.job j
left join lateral (
  select status, start_time, end_time, return_message
  from cron.job_run_details d
  where d.jobid = j.jobid
  order by d.start_time desc
  limit 1
) r on true
where j.jobname in ('spotter-ops-tick','spotter-worker-tick','spotter-push-tick',
                    'spotter-unstick-jobs','spotter-store-expiry')
order by j.jobname;

\echo
\echo ================ who would hear about it ================
\echo Zero staff devices means the alerts are being recorded and told to nobody.
\echo The fix is one toggle: sign in as the staff account on the phone and turn
\echo reminders on, which is what creates the push_subscriptions row.
select count(*) as staff_devices
from public.push_subscriptions s
join public.profiles p on p.id = s.user_id
where p.plan = 'staff';
