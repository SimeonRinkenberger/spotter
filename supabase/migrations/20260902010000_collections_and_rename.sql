-- Spotter — collections, and title renames captured as correction data.
--
-- Organization is COLLECTIONS, not folders: a workout can sit in several ("Leg
-- day", "Hotel gym", "Quick 10 min") and removing it from one does not touch the
-- others. Favourites already exist (workouts.favorite) and stay a flag on the row;
-- a collection is the general form of the same idea, so the two live side by side
-- in the library's chip row rather than one replacing the other.
--
-- Both tables are per-user with owner-only policies, the same pattern as
-- workouts. Nothing here is readable across users.

-- ---------- collections ----------

create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  name       text not null,
  emoji      text,
  sort_order int  not null default 0,
  constraint collections_name_len  check (length(btrim(name)) between 1 and 60),
  constraint collections_emoji_len check (emoji is null or length(emoji) <= 8)
);

-- Two "Leg day" collections for one person is a mistake, not a feature.
create unique index if not exists collections_user_name
  on public.collections (user_id, lower(btrim(name)));
create index if not exists collections_user_order
  on public.collections (user_id, sort_order, created_at);

-- ---------- membership ----------
--
-- user_id is denormalized so the owner check is a column compare rather than a
-- join on every read, and so the browser can load "all my memberships" in one
-- select. The insert policy still verifies that BOTH ends belong to the caller:
-- a row that claimed my user_id but pointed at somebody else's collection or
-- workout must be refused, and the column alone cannot do that.

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  workout_id    uuid not null references public.workouts(id)    on delete cascade,
  user_id       uuid not null references auth.users(id)         on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, workout_id)
);
create index if not exists collection_items_user on public.collection_items (user_id, workout_id);

-- ---------- row level security ----------

alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;

do $$ begin
  create policy "own collections select" on public.collections
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own collections insert" on public.collections
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own collections update" on public.collections
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own collections delete" on public.collections
    for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "own items select" on public.collection_items
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own items insert" on public.collection_items
    for insert with check (
      user_id = auth.uid()
      and exists (select 1 from public.collections c
                   where c.id = collection_id and c.user_id = auth.uid())
      and exists (select 1 from public.workouts w
                   where w.id = workout_id and w.user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own items delete" on public.collection_items
    for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ---------- renaming a workout is a correction ----------
--
-- A title the user changes is the same kind of fact as an exercise they fix:
-- the extractor said one thing, a person said another. It goes in the same
-- ledger under kind = 'rename', field = 'title', so the Phase 2 queries see it
-- without a second table.
--
-- The rename itself is a plain PATCH on workouts under RLS from the browser.
-- The ledger row is written by a trigger rather than by the client, for the
-- same reason handleCorrection reads the "before" from the stored row: the old
-- value has to be what was actually there, not what the browser says it was.
-- The trigger fires only when the updating identity IS the row's owner. The
-- worker and reprocess also write title, as the service role, where auth.uid()
-- is null — those are extractions, not corrections, and are skipped.

alter table public.corrections drop constraint if exists corrections_kind_check;
alter table public.corrections add constraint corrections_kind_check
  check (kind in ('edit', 'add', 'delete', 'rename'));

alter table public.corrections drop constraint if exists corrections_field_check;
alter table public.corrections add constraint corrections_field_check
  check (field in ('name', 'sets', 'reps', 'duration_seconds', 'exercise', 'title'));

create or replace function public.record_title_rename() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then return new; end if;
  if new.title is not distinct from old.title then return new; end if;
  insert into public.corrections
    (user_id, workout_id, shortcode, platform, kind, field,
     old_value, new_value, extracted_by, confidence)
  values
    (new.user_id, new.id, new.shortcode, new.platform, 'rename', 'title',
     old.title, new.title, new.extracted_by, new.confidence);
  return new;
end $$;

revoke all on function public.record_title_rename() from public, anon, authenticated;

drop trigger if exists workouts_title_rename on public.workouts;
create trigger workouts_title_rename
  after update of title on public.workouts
  for each row execute function public.record_title_rename();
