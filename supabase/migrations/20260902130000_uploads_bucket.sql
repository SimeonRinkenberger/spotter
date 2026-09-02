-- Spotter — a private bucket for videos the user brought themselves.
--
-- Every automated way of reading a workout out of a video can be taken away from
-- us: an IP ban, a login wall, a platform that stops answering. One cannot. If the
-- creator says the workout out loud and writes nothing down, there is no caption
-- anywhere to fetch — so the user hands Spotter the video they already saved, and
-- Spotter listens to it.
--
-- Two rules shape everything below.
--
-- 1. Edge functions move URLs, never media bytes. The file goes from the phone
--    straight into this bucket through supabase-js under the policies here; the
--    function then hands the transcription service a signed URL that lives for
--    fifteen minutes. No video ever passes through the function.
--
-- 2. The object is temporary. It is deleted as soon as transcription returns,
--    whether that returned a transcript or an error, and an hourly sweep in the
--    worker deletes anything older than two hours as the backstop for a job that
--    died in between. Nothing here is storage; it is a hand-off.
--
-- The service role bypasses RLS entirely, and that is deliberately the only thing
-- that deletes: the delete policy below exists so a user can cancel their own
-- upload, but the guaranteed cleanup is the function's, done with the service key.

-- Private (public = false), so the only way to read an object is a signed URL the
-- service role minted. 100 MB is the bucket's own ceiling; the app enforces a
-- tighter 25 MB, which is the free-tier limit of the transcription endpoint —
-- UPLOAD_MAX_BYTES in index.ts is the number the user is actually held to, and
-- raising it to the dev tier's 100 MB is a one-line change that this ceiling
-- already allows.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads', 'uploads', false, 104857600,
  array[
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm'
  ]
)
on conflict (id) do nothing;

-- ---------- who may touch what ----------
--
-- The layout is uploads/<user id>/<uuid>.<ext>, and every policy says the same
-- thing about it: the first folder segment must be your own uid. That makes the
-- path itself the authorization, so a user cannot read, write or delete inside
-- anybody else's folder even knowing its exact name.
--
-- (select auth.uid()) rather than auth.uid(), like every other policy in this
-- database: the subselect is evaluated once per statement instead of once per row.
--
-- There is no UPDATE policy, on purpose. An object here is written once and then
-- deleted; being able to overwrite one would mean being able to swap the bytes
-- out from under a signed URL that has already been handed to a third party.

do $$
begin
  create policy "uploads: insert into your own folder"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'uploads'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "uploads: read your own folder"
    on storage.objects for select to authenticated
    using (
      bucket_id = 'uploads'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "uploads: delete your own folder"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'uploads'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
exception when duplicate_object then null;
end $$;
