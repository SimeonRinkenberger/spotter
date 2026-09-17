-- Reading quality describes evidence, not the plan of the next viewer.
alter table public.workouts add column if not exists read_quality text not null default 'basic',
  add column if not exists read_plan text not null default 'unknown';
alter table public.video_cache add column if not exists read_quality text not null default 'basic',
  add column if not exists read_plan text not null default 'unknown',
  add column if not exists basic_card jsonb,
  add column if not exists basic_v integer;
update public.video_cache set read_quality = 'premium'
where pack is not null and pack->>'reader' <> 'none' and jsonb_array_length(coalesce(pack->'exercises','[]')) > 0;
update public.workouts w set read_quality = 'premium'
where exists (select 1 from public.video_cache c where c.shortcode=w.shortcode and c.read_quality='premium' and c.card->'blocks'=w.blocks);

update public.video_cache set basic_card=card,basic_v=v where read_quality='basic' and media_source is null;

-- A simultaneous basic save must never replace a completed visual reading.
create or replace function public.preserve_visual_cache() returns trigger language plpgsql set search_path=public as $$
begin
  if old.read_quality='premium' and new.read_quality<>'premium' then
    old.basic_card := new.basic_card;
    old.basic_v := new.basic_v;
    return old;
  end if;
  if old.read_quality='basic' and new.read_quality='premium' and old.media_source is null then
    new.basic_card := coalesce(new.basic_card,old.card);
    new.basic_v := coalesce(new.basic_v,old.v);
  end if;
  return new;
end $$;
create trigger preserve_visual_cache before update on public.video_cache
for each row execute function public.preserve_visual_cache();

create table public.video_previews (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  shortcode text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(user_id,month,shortcode)
);
alter table public.video_previews enable row level security;
grant select on public.video_previews to authenticated;
grant all on public.video_previews to service_role;
create policy previews_read_own on public.video_previews for select to authenticated using ((select auth.uid())=user_id);
-- Only the server may reserve. One lock per user serializes concurrent taps.
create or replace function public.reserve_video_preview(p_user uuid,p_shortcode text)
returns boolean language plpgsql security definer set search_path=public as $$
declare m date := date_trunc('month',now() at time zone 'UTC')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 917));
  if exists(select 1 from video_previews where user_id=p_user and month=m and shortcode=p_shortcode) then return true; end if;
  if (select count(*) from video_previews where user_id=p_user and month=m)>=4 then return false; end if;
  insert into video_previews(user_id,month,shortcode) values(p_user,m,p_shortcode);
  return true;
end $$;
revoke all on function public.reserve_video_preview(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_video_preview(uuid,text) to service_role;
-- Retire unused provider configuration; retain historical cost records.
delete from public.app_config where key like 'model.groq%';
