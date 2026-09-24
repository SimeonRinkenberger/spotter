-- Browser roles keep exactly the writes the app makes.
--
-- Supabase grants every privilege on every new table to anon and authenticated,
-- and RLS then decides. Where a table has no policy for a command, "no policy"
-- is the only thing refusing it. For the tables below the app never makes that
-- write, so the grant goes too and the refusal no longer rests on a missing
-- policy alone. Proved from source: app.ts today and in every commit that
-- carried iOS builds 5, 6 and 7 writes these tables only as
--   profiles          update (display_name, settings) — already column-limited
--   plan              insert, delete
--   collection_items  insert, delete
--   achievements      insert … on conflict do nothing (upsert, ignoreDuplicates)
--   push_devices      upsert of user_id, token, bundle, env, tz, remind_plan,
--                     remind_risk, remind_at, app_version, updated_at
-- and the native shells never call PostgREST. A profile row is created by the
-- signup trigger (handle_new_user, security definer) and removed by the auth
-- row's cascade, neither of which runs as a browser role.
--
-- Idempotent: revokes and column grants only.

revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.plan from anon, authenticated;
revoke update on public.collection_items from anon, authenticated;
revoke update on public.achievements from anon, authenticated;

-- The sender's caps (last_sent_at, sent_week, week_key, risk_week) are written
-- by the hourly tick only; UPDATE was already limited to the app's columns
-- (20260918190000), and now INSERT is too.
revoke insert on public.push_devices from anon, authenticated;
grant insert (user_id, token, platform, bundle, env, tz, remind_plan, remind_risk, remind_at,
              app_version, updated_at)
  on public.push_devices to authenticated;
