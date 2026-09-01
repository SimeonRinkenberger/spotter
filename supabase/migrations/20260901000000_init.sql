-- Spotter — initial schema.
-- Multi-user from day one: every user-owned table carries user_id and real RLS
-- policies, because the frontend talks to PostgREST directly with the user's JWT.
-- The two service-role-only tables (video_cache, saves_log) have RLS on and zero
-- policies, so they are unreachable except from the edge function.

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text,
  -- long-lived per-user key for the iOS Shortcut (Shortcuts can't refresh OAuth tokens)
  ingest_key text not null unique default encode(gen_random_bytes(16), 'hex'),
  settings jsonb not null default '{}'::jsonb
);

-- ---------- workouts: the user's library ----------

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  url text not null,
  shortcode text not null,
  platform text not null default 'instagram',
  kind text default 'reel',
  author text,
  title text,
  caption text,
  thumb_url text,
  category text not null default 'Other',
  muscle_groups text[] not null default '{}',
  equipment text[] not null default '{}',
  difficulty text,
  duration_minutes int,
  calories int,
  blocks jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  has_full_workout boolean not null default false,
  favorite boolean not null default false,
  rating int,
  notes text,
  source_url text,
  -- per-user, NOT global: two users must be able to save the same video
  unique (user_id, shortcode)
);
create index workouts_user_created on public.workouts (user_id, created_at desc);

-- ---------- video_cache: global extraction cache ----------
-- The main cost lever. When a second user saves a video someone already saved,
-- ingest copies this row instead of scraping and calling the AI.

create table public.video_cache (
  shortcode text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  url text not null,
  platform text not null,
  kind text,
  author text,
  caption text,
  thumb_url text,
  card jsonb not null,
  v int not null default 1        -- prompt version; bump CARD_V in index.ts to invalidate
);

-- ---------- workout_logs: one row per session ----------

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- set null, not cascade: history survives deleting the source video
  workout_id uuid references public.workouts(id) on delete set null,
  workout_title text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int,
  entries jsonb not null default '[]'::jsonb,
  notes text
);
create index logs_user_started on public.workout_logs (user_id, started_at desc);

-- ---------- plan: weekly schedule ----------

create table public.plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  day date not null,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  slot text not null default 'any'
);
create index plan_user_day on public.plan (user_id, day);

-- ---------- saves_log: rate limiting ----------

create table public.saves_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  shortcode text,
  cached boolean not null default false
);
create index saves_user_time on public.saves_log (user_id, created_at desc);

-- ---------- row level security ----------

alter table public.profiles     enable row level security;
alter table public.workouts     enable row level security;
alter table public.video_cache  enable row level security;  -- no policies: service role only
alter table public.workout_logs enable row level security;
alter table public.plan         enable row level security;
alter table public.saves_log    enable row level security;  -- no policies: service role only

create policy "own profile read"   on public.profiles for select using (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Users may edit their name and settings but never their own ingest_key
-- (rotation goes through the edge function, which is rate-limit aware).
revoke update on public.profiles from authenticated;
grant update (display_name, settings) on public.profiles to authenticated;

create policy "own workouts select" on public.workouts for select using (user_id = auth.uid());
create policy "own workouts insert" on public.workouts for insert with check (user_id = auth.uid());
create policy "own workouts update" on public.workouts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own workouts delete" on public.workouts for delete using (user_id = auth.uid());

create policy "own logs select" on public.workout_logs for select using (user_id = auth.uid());
create policy "own logs insert" on public.workout_logs for insert with check (user_id = auth.uid());
create policy "own logs update" on public.workout_logs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own logs delete" on public.workout_logs for delete using (user_id = auth.uid());

create policy "own plan select" on public.plan for select using (user_id = auth.uid());
create policy "own plan insert" on public.plan for insert with check (user_id = auth.uid());
create policy "own plan delete" on public.plan for delete using (user_id = auth.uid());

-- ---------- profile auto-creation ----------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- storage ----------
-- Thumbnails are keyed by shortcode globally (shared cache, like the video_cache
-- table) and served publicly; IG/TikTok CDN links expire, ours don't.

insert into storage.buckets (id, name, public) values ('thumbs', 'thumbs', true)
on conflict (id) do nothing;
