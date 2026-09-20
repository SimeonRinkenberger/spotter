import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE || '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js'));
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; create table auth.users(id uuid primary key);
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111');`);
await db.exec(readFileSync('supabase/migrations/20260919120000_apple_auth_tokens.sql','utf8'));
await db.exec(`set role service_role; insert into public.apple_auth_tokens(user_id,client_id,refresh_token)
values ('11111111-1111-4111-8111-111111111111','app.spotter.dev','test-private-token'); reset role;`);
for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  for(const sql of ["select * from public.apple_auth_tokens", "update public.apple_auth_tokens set revoked_at=now()", "delete from public.apple_auth_tokens", "insert into public.apple_auth_tokens(user_id,client_id,refresh_token) values ('11111111-1111-4111-8111-111111111111','app.spotter.dev','x')"])
    await assert.rejects(db.exec(sql),/permission denied/);
  await db.exec('reset role');
}
await db.exec("delete from auth.users where id='11111111-1111-4111-8111-111111111111'");
assert.equal((await db.query('select count(*)::integer as n from public.apple_auth_tokens')).rows[0].n,0);
await db.close();
console.log('PASS shipping Apple token migration: service-only access, anonymous and signed-in clients denied reads/writes, tokens cascade on account deletion.');
