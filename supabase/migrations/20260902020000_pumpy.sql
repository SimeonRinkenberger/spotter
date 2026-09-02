-- Spotter — Pumpy, the coach: conversations, lightly persisted.
--
-- A thread is one conversation; a message is one turn in it. Three roles:
-- 'user' and 'assistant' are what the person sees, 'tool' is the provenance
-- trail — which tool Pumpy called with which arguments, and which proposal was
-- executed with what result. Proposals themselves ride in the assistant
-- message's meta ({proposal, status: pending | done | declined}), so the card
-- the user confirmed is the card that was written, byte for byte.
--
-- Owner-only reads; no client writes at all. Every row is written by the edge
-- function, because it is the only place that runs the model, executes the
-- tools against this user's rows, and can say truthfully what happened.

create table if not exists public.pumpy_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title      text,
  -- the workout the chat was opened from, if any. set null: the chat outlives it.
  workout_id uuid references public.workouts(id) on delete set null
);
create index if not exists pumpy_threads_user on public.pumpy_threads (user_id, updated_at desc);

create table if not exists public.pumpy_messages (
  id         bigint generated always as identity primary key,
  thread_id  uuid not null references public.pumpy_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  role       text not null check (role in ('user', 'assistant', 'tool')),
  content    text,
  meta       jsonb
);
create index if not exists pumpy_messages_thread on public.pumpy_messages (thread_id, id);
create index if not exists pumpy_messages_user   on public.pumpy_messages (user_id, id desc);

alter table public.pumpy_threads  enable row level security;
alter table public.pumpy_messages enable row level security;

do $$ begin
  create policy "own threads select" on public.pumpy_threads
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- Deleting a conversation is the user's call; its messages cascade.
  create policy "own threads delete" on public.pumpy_threads
    for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own messages select" on public.pumpy_messages
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

revoke insert, update on public.pumpy_threads  from authenticated, anon;
revoke insert, update, delete on public.pumpy_messages from authenticated, anon;
