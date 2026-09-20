-- Refresh tokens are required to disconnect Sign in with Apple on account erasure.
-- Clients cannot read or write this table, including their own token rows.
create table public.apple_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index apple_auth_tokens_user_idx on public.apple_auth_tokens(user_id);
alter table public.apple_auth_tokens enable row level security;
revoke all on public.apple_auth_tokens from public, anon, authenticated;
grant all on public.apple_auth_tokens to service_role;
