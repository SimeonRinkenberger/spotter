-- The product-wide upload and contact-sheet ceilings keep room for Plus.
--
-- Both ceilings are shared by everybody: sixteen outstanding video uploads (and
-- sixteen objects in the bucket), twelve outstanding contact sheets. Signup is
-- open, so a handful of Basic accounts could hold all of it and every Plus
-- account would be told "busy". Basic accounts now stop a little short of each
-- ceiling — twelve of the sixteen video slots, nine of the twelve sheet rows
-- (room for one more save's three sheets) — and Plus accounts see the whole of
-- it. A save re-asking for the sheet set it already holds is not held back.
-- Per-person rules are unchanged. The plan is read from profiles, the same
-- Plus family the completion fence uses ('plus', 'pro', 'staff').
--
-- Replaces the two functions; changes no row. Idempotent.

create or replace function public.issue_upload_permit(
  p_user uuid, p_path text, p_bytes bigint, p_address_seconds integer default null
) returns text language plpgsql security definer set search_path=public as $$
declare ceiling int;
begin
  perform 1 from ai_guard_policy where singleton for update;
  if p_path not like p_user::text || '/%' or p_bytes<1 or p_bytes>26214400 then return 'invalid'; end if;
  if p_address_seconds is not null and (p_address_seconds<1 or p_address_seconds>86400) then return 'invalid'; end if;
  -- Held: not yet released and under two hours old, or its address can still write.
  if (select count(*) from upload_permits where user_id=p_user and kind='media'
        and ((not released and created_at>now()-interval '2 hours') or address_until>now()))>=2 then return 'pending'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads'
        and left(name, 37)=p_user::text || '/' and name not like '%/pack/%')>=2 then return 'pending'; end if;
  ceiling := case when exists(select 1 from profiles where id=p_user and plan in ('plus','pro','staff')) then 16 else 12 end;
  if (select count(*) from upload_permits where kind='media'
        and ((not released and created_at>now()-interval '2 hours') or address_until>now()))>=ceiling then return 'busy'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads' and name not like '%/pack/%')>=ceiling then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes,kind,address_until)
    values(p_path,p_user,p_bytes,'media',
      case when p_address_seconds is null then null else now()+make_interval(secs => p_address_seconds) end);
  return 'ok';
end $$;
revoke all on function public.issue_upload_permit(uuid,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.issue_upload_permit(uuid,text,bigint,integer) to service_role;

create or replace function public.issue_sheet_permits(p_user uuid,p_paths text[],p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
declare p text; n int; prefix text; ceiling int;
begin
  perform 1 from ai_guard_policy where singleton for update;
  n := coalesce(array_length(p_paths,1),0);
  if n<1 or n>3 then return 'invalid'; end if;
  if p_bytes<1 or p_bytes>614400 then return 'invalid'; end if;
  foreach p in array p_paths loop
    if p !~ ('^' || p_user::text || '/pack/[A-Za-z0-9_-]{1,64}/sheet-[1-3]\.jpg$') then return 'invalid'; end if;
  end loop;
  -- Everything in one call is one video's worth, so the folder of the first path
  -- names the whole set: '<uid>/pack/<shortcode>/'.
  prefix := substring(p_paths[1] from '^(.*/)[^/]+$');

  -- One save's worth of sheets outstanding per person — unless the outstanding
  -- ones are this save's, in which case this is the same hand-off asking again.
  if exists(
    select 1 from upload_permits
     where user_id=p_user and kind='sheet' and not released
       and created_at>now()-interval '1 hour'
       and path not like prefix || '%'
  ) then return 'pending'; end if;

  -- Basic stops at nine; Plus, and a save re-asking for the set it already
  -- holds (it adds no row), see the full twelve.
  ceiling := case when exists(select 1 from profiles where id=p_user and plan in ('plus','pro','staff'))
      or exists(select 1 from upload_permits where user_id=p_user and kind='sheet' and not released
                  and created_at>now()-interval '1 hour' and path like prefix || '%')
    then 12 else 9 end;
  if (select count(*) from upload_permits
        where kind='sheet' and not released and created_at>now()-interval '1 hour'
          and path not like prefix || '%')>=ceiling then return 'busy'; end if;

  insert into upload_permits(path,user_id,max_bytes,kind)
    select unnest(p_paths), p_user, p_bytes, 'sheet'
  on conflict (path) do update
    set expires_at = now()+interval '15 minutes',
        released   = false,
        max_bytes  = excluded.max_bytes
    where upload_permits.user_id = p_user;
  return 'ok';
end $$;
revoke all on function public.issue_sheet_permits(uuid,text[],bigint) from public,anon,authenticated;
grant execute on function public.issue_sheet_permits(uuid,text[],bigint) to service_role;
