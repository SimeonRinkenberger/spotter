-- Upload permits: two outstanding per person, sixteen for the product.
--
-- The beta rule was one outstanding video per person and FOUR for the whole
-- product (20260908150000, 20260915100000). "Add the video" — the way a thin
-- Instagram reel gets read, decided 24 Sept — and the Share Extension's video
-- door both put a file in the bucket, so four people doing that at once would
-- have told the fifth that uploads are busy. The per-person figure rises to two
-- so the extension's door and the in-app button do not refuse each other; the
-- product ceiling rises to sixteen, 400 MB at the bucket's 25 MB cap, held at
-- most two hours by the same rule as before.
--
-- The dollar guard (ai_reserve) stays the control that binds: a permit is
-- storage, not a read, and no read is admitted without a reservation.
--
-- Same validation, same kind split (sheets keep their own ceiling), same
-- two-hour hold, same grants. Replaces one function; changes no row.

create or replace function public.issue_upload_permit(p_user uuid,p_path text,p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
begin
  perform 1 from ai_guard_policy where singleton for update;
  if p_path not like p_user::text || '/%' or p_bytes<1 or p_bytes>26214400 then return 'invalid'; end if;
  if (select count(*) from upload_permits where user_id=p_user and kind='media' and not released and created_at>now()-interval '2 hours')>=2 then return 'pending'; end if;
  if (select count(*) from upload_permits where kind='media' and not released and created_at>now()-interval '2 hours')>=16 then return 'busy'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads' and name not like '%/pack/%')>=16 then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes,kind) values(p_path,p_user,p_bytes,'media');
  return 'ok';
end $$;
revoke all on function public.issue_upload_permit(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.issue_upload_permit(uuid,text,bigint) to service_role;
