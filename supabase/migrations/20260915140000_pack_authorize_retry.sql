-- Spotter — let the phone ask for the same frames twice.
--
-- Found live on v159. The share extension authorises three contact sheets, starts
-- PUTting them, and loses the network on sheet two. It retries the whole
-- hand-off — which is the right thing for it to do, because it has the frames in
-- memory and nothing else does — and issue_sheet_permits answers 'pending',
-- because that user already has unreleased sheet permits less than an hour old.
--
-- Those permits are for the SAME video and the same three paths. Refusing them is
-- refusing the retry its own reservation. The per-user rule stays for what it was
-- written for — one save's worth of sheets outstanding at a time, so a client
-- cannot open ten hand-offs at once — and now ignores a re-ask for the prefix the
-- outstanding permits already belong to.
--
-- The insert becomes an upsert for the same reason: a permit issued eleven minutes
-- ago has four minutes left on it, which is not enough to upload three JPEGs over
-- a phone connection that has just proved unreliable. A retry gets a fresh clock
-- on the paths it already held, never on anybody else's.
--
-- Idempotent, and changes no other behaviour: same shape validation, same ceiling,
-- same two vocabularies of caller.

create or replace function public.issue_sheet_permits(p_user uuid,p_paths text[],p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
declare p text; n int; prefix text;
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

  if (select count(*) from upload_permits
        where kind='sheet' and not released and created_at>now()-interval '1 hour'
          and path not like prefix || '%')>=12 then return 'busy'; end if;

  insert into upload_permits(path,user_id,max_bytes,kind)
    select unnest(p_paths), p_user, p_bytes, 'sheet'
  on conflict (path) do update
    set expires_at = now()+interval '15 minutes',
        released   = false,
        max_bytes  = excluded.max_bytes
    -- Never hand somebody else's path back with a fresh clock on it. The path
    -- shape already pins the uid, so this can only ever be true; it is here
    -- because an upsert that did not say it would be one line from being wrong.
    where upload_permits.user_id = p_user;
  return 'ok';
end $$;
revoke all on function public.issue_sheet_permits(uuid,text[],bigint) from public,anon,authenticated;
grant execute on function public.issue_sheet_permits(uuid,text[],bigint) to service_role;
