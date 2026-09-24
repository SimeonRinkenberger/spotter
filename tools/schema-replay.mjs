// Every migration in supabase/migrations, in order, over a small Supabase shim, in
// PGlite. Shared by tools/security-db-check.mjs and tools/erasure-outbox-check.mjs.
//
// The shim is what Supabase provides and PGlite does not: the anon /
// authenticated / service_role roles, auth.uid() read from the request claim,
// stand-ins for storage, pg_cron and pg_net, the realtime publication, and
// Supabase's own `alter default privileges ... grant all to anon, authenticated`
// — without that last one every revoke in a migration would pass trivially.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function replaySchema({ onError } = {}) {
  const PGLITE = process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js';
  const { PGlite } = await import(pathToFileURL(PGLITE));
  const { pgcrypto } = await import(pathToFileURL(PGLITE.replace(/index\.js$/, 'contrib/pgcrypto.js')));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`set timezone='UTC';
  create extension pgcrypto;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create publication supabase_realtime;
  create schema auth; create schema storage; create schema cron; create schema net;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz not null default now(),
    last_sign_in_at timestamptz, email_confirmed_at timestamptz, is_anonymous boolean default false);
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  create table storage.buckets(id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid,
    created_at timestamptz not null default now(), updated_at timestamptz default now(), metadata jsonb);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]$$;
  create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$insert into cron.job(jobname, schedule, command) values (n, s, c)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid$$;
  create function cron.unschedule(n text) returns boolean language sql as $$delete from cron.job where jobname = n returning true$$;
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$select 1::bigint$$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);

  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    // pg_net / pg_cron are stood in for by the shim above; PGlite has neither.
    const sql = readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]*;/gi, '');
    try { await db.exec(sql); }
    catch (e) {
      await db.exec('rollback').catch(() => {});
      if (onError) onError(f, e); else throw new Error('migration ' + f + ' failed: ' + e.message);
    }
  }
  return { db, files };
}
