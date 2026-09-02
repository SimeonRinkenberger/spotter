-- Spotter — let a provider sign-in bring its own name into the profile.
--
-- Signing in with Google (and, after the first authorization, with Apple) puts a
-- name on the auth user: gotrue copies the id_token's claims into
-- raw_user_meta_data, where Google's OIDC "name" claim lands under both
-- "full_name" and "name". The signup trigger only ever looked at "display_name",
-- which nothing but a hand-rolled email signup ever sets, so every provider user
-- would have started life named after the local part of their email address —
-- and for an Apple private-relay address that is a random hex string.
--
-- Order is deliberate: an explicit display_name (what the app would send) beats a
-- provider's name, which beats the email local part, which beats nothing at all.
--
-- Idempotent: create or replace on an existing function keeps its owner, its
-- privileges and the on_auth_user_created trigger that points at it. Nothing else
-- about the function changes — same security definer, same search_path.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  provided text;
begin
  provided := nullif(btrim(coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  )), '');

  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      provided,
      -- Apple can hide the address behind a relay, but there is always an address.
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Athlete'
    )
  )
  -- Identity linking never inserts a second auth.users row, so this cannot fire
  -- today; it is here so that a future path which does can never 500 a signup.
  on conflict (id) do nothing;

  return new;
end $$;
