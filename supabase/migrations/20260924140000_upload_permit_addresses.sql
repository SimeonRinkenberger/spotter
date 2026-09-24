-- Upload permits that hold for as long as their signed address can write.
--
-- The Share Extension's video door gets a signed upload address from the server
-- (it has no session to write to storage with). Storage decides that address's
-- lifetime itself: two hours, whatever the sign request asks for. The permit
-- model assumed the object and the permit end together — the server deletes the
-- object after the read and marks the permit released — but a live address can
-- write again once its path is empty. So:
--
--   * `address_until` records when the address stops working. A permit whose
--     address is still live keeps counting, released or not, against the
--     person's two and the product's sixteen.
--   * The person's own objects in the bucket (not the phone's contact sheets)
--     count too: two there already is 'pending', whatever the permits say.
--   * `issue_upload_permit` takes the address lifetime as an optional fourth
--     argument. Callers that pass three (the app's own session uploads, which
--     storage checks against the permit's fifteen-minute window, and every
--     deployed function before this one) are answered exactly as before.
--
-- Idempotent: the column is added if missing and the function is replaced.

alter table public.upload_permits add column if not exists address_until timestamptz;

drop function if exists public.issue_upload_permit(uuid, text, bigint);

create or replace function public.issue_upload_permit(
  p_user uuid, p_path text, p_bytes bigint, p_address_seconds integer default null
) returns text language plpgsql security definer set search_path=public as $$
begin
  perform 1 from ai_guard_policy where singleton for update;
  if p_path not like p_user::text || '/%' or p_bytes<1 or p_bytes>26214400 then return 'invalid'; end if;
  if p_address_seconds is not null and (p_address_seconds<1 or p_address_seconds>86400) then return 'invalid'; end if;
  -- Held: not yet released and under two hours old, or its address can still write.
  if (select count(*) from upload_permits where user_id=p_user and kind='media'
        and ((not released and created_at>now()-interval '2 hours') or address_until>now()))>=2 then return 'pending'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads'
        and left(name, 37)=p_user::text || '/' and name not like '%/pack/%')>=2 then return 'pending'; end if;
  if (select count(*) from upload_permits where kind='media'
        and ((not released and created_at>now()-interval '2 hours') or address_until>now()))>=16 then return 'busy'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads' and name not like '%/pack/%')>=16 then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes,kind,address_until)
    values(p_path,p_user,p_bytes,'media',
      case when p_address_seconds is null then null else now()+make_interval(secs => p_address_seconds) end);
  return 'ok';
end $$;
revoke all on function public.issue_upload_permit(uuid,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.issue_upload_permit(uuid,text,bigint,integer) to service_role;
