-- Spotter — the Video Context Pack.
--
-- The owner watched a card built from his own save and named the gap: "if you
-- watch the video it actually looks a bit different than the description
-- suggests. like he is basically balancing on the kettle bell for the pushups …
-- we need a system of how to properly give ai as much context as it would need to
-- provide the most help for a video in the most token efficient way possible."
--
-- The card was not wrong about anything it said. It was wrong about everything it
-- did not say, because nothing in the pipeline had ever LOOKED at the video. So a
-- video is now read once into a compact structured record — what was said, what
-- was seen, what was written — and every AI call downstream reads a slice of it.
--
-- Three things have to exist in the database for that to be affordable and safe.
--
--   1. Somewhere to keep the pack (video_cache.pack). The cache is global and
--      keyed by shortcode, so the second person to save a viral clip inherits the
--      reading and pays nothing. pack_v is separate from the card's `v` because a
--      pack outlives several card versions and must not be thrown away with one.
--   2. Permission for the phone to hand us contact sheets. The native shells cut
--      frames on the device for free; the sheets go into the SAME temporary
--      uploads bucket as a video upload, under the same "the path is the
--      authorization" rule, and are deleted the moment the read returns.
--   3. Dials, so reading every video can be switched off without a deploy.
--
-- Idempotent. Adds columns and functions, changes no existing row's data.

-- ---------- 1. where a pack lives ----------

alter table public.video_cache
  -- The whole pack, verified before it was written. A pack that failed validation
  -- is never stored: a bad pack is believed by every call downstream and is
  -- inherited by everybody who saves the video next, which is strictly worse than
  -- having none at all.
  add column if not exists pack   jsonb,
  add column if not exists pack_v int;

-- Which cached videos have been read and which have not. Partial and small, like
-- video_cache_unread above it, and for the same reason: the interesting rows are
-- the minority.
create index if not exists video_cache_unpacked
  on public.video_cache (updated_at desc)
  where pack is null;

-- ---------- 2. contact sheets from the phone ----------

-- The bucket already refuses anything that is not audio or video. Sheets are
-- JPEGs, so the allowlist grows by exactly one type — appended rather than
-- rewritten, so a type somebody added by hand survives this migration.
update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['image/jpeg']
 where id = 'uploads'
   and not ('image/jpeg' = any(allowed_mime_types));

-- A permit's class. 'media' is the video or audio an upload consists of; 'sheet'
-- is a derived still. They are counted separately because they are limited
-- separately: one video at a time per person, but up to three sheets for one save.
alter table public.upload_permits
  add column if not exists kind text not null default 'media';

-- The original slot counter refused an upload while ANY object sat in the bucket,
-- four of them being the whole beta ceiling. Sheets would have spent that ceiling
-- on 1.8 MB of JPEG and locked out video uploads, so the media counter now ignores
-- them and the sheets get a ceiling of their own below. Nothing else changes: same
-- validation, same per-user rule, same two-hour hold.
create or replace function public.issue_upload_permit(p_user uuid,p_path text,p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
begin
  perform 1 from ai_guard_policy where singleton for update;
  if p_path not like p_user::text || '/%' or p_bytes<1 or p_bytes>26214400 then return 'invalid'; end if;
  if exists(select 1 from upload_permits where user_id=p_user and kind='media' and not released and created_at>now()-interval '2 hours') then return 'pending'; end if;
  if (select count(*) from upload_permits where kind='media' and not released and created_at>now()-interval '2 hours')>=4 then return 'busy'; end if;
  if (select count(*) from storage.objects where bucket_id='uploads' and name not like '%/pack/%')>=4 then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes,kind) values(p_path,p_user,p_bytes,'media');
  return 'ok';
end $$;
revoke all on function public.issue_upload_permit(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.issue_upload_permit(uuid,text,bigint) to service_role;

-- One call for the whole set, because the storage insert policy checks a permit
-- per object and three round trips to issue three permits would be three chances
-- to leave a half-authorized save behind.
--
-- The shape is fixed here rather than trusted from the caller: <uid>/pack/
-- <shortcode>/sheet-<n>.jpg, ascending n, at most three, at most 600 KB each. 600
-- KB is a 7x3 grid of 200 px cells with room to spare, and three of them is under
-- 2 MB — which is what makes this affordable to hold for the ninety seconds
-- between the upload finishing and the reader deleting the objects.
create or replace function public.issue_sheet_permits(p_user uuid,p_paths text[],p_bytes bigint)
returns text language plpgsql security definer set search_path=public as $$
declare p text; n int;
begin
  perform 1 from ai_guard_policy where singleton for update;
  n := coalesce(array_length(p_paths,1),0);
  if n<1 or n>3 then return 'invalid'; end if;
  if p_bytes<1 or p_bytes>614400 then return 'invalid'; end if;
  foreach p in array p_paths loop
    if p !~ ('^' || p_user::text || '/pack/[A-Za-z0-9_-]{1,64}/sheet-[1-3]\.jpg$') then return 'invalid'; end if;
  end loop;
  -- One save's worth of sheets outstanding per person. An abandoned set ages out
  -- in an hour rather than two: a still is cheap to cut again.
  if exists(select 1 from upload_permits where user_id=p_user and kind='sheet' and not released and created_at>now()-interval '1 hour') then return 'pending'; end if;
  if (select count(*) from upload_permits where kind='sheet' and not released and created_at>now()-interval '1 hour')>=12 then return 'busy'; end if;
  insert into upload_permits(path,user_id,max_bytes,kind)
    select unnest(p_paths), p_user, p_bytes, 'sheet'
  on conflict (path) do nothing;
  return 'ok';
end $$;
revoke all on function public.issue_sheet_permits(uuid,text[],bigint) from public,anon,authenticated;
grant execute on function public.issue_sheet_permits(uuid,text[],bigint) to service_role;

-- ---------- 3. the dials ----------
--
-- Inserted, never updated: a value somebody has already tuned is not this
-- migration's business. `pack.*` joins the prefixes the function's five-minute
-- config refresh already reads.
insert into public.app_config (key, value) values
  -- Read every video, not only the ones whose card came out thin. This is the
  -- whole point of the wave, and it is one update statement to undo.
  ('pack.enabled', 'true'),
  -- The video reader, and the model ai-guard prices for it. Switchable to
  -- gemini-3.1-flash-lite, which is also priced and also does video.
  ('pack.model', 'gemini-3.6-flash'),
  -- The sheets reader. Luna reads images; there is no video model involved when
  -- the phone did the cutting.
  ('pack.sheets_model', 'gpt-5.6-luna'),
  -- How many clipped re-queries one video may pay for when the channels disagree.
  ('pack.max_requeries', '2')
on conflict (key) do nothing;
