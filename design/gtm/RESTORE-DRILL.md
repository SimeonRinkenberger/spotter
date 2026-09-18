# Backup-restore drill — 17 September 2026

Gate: "Operational readiness" / "Staging correctness" in `design/GTM-RELEASE-READINESS.md`.
Project: `mtzevoxxpsktmrbbuxva`, PostgreSQL **17.6.1.166**, region us-east-2.
Everything below was done read-only against production (`supabase db dump`, `supabase db query`).
The data dump never left the session scratchpad, was never committed, and was deleted at the end.

## Headline

**The dump pair that `supabase db dump` produces does not restore the user accounts.** Everything in
`public` comes back perfectly. Nothing outside it does, because the schema dump contains no `auth`
or `storage` DDL while the data dump contains `auth` and `storage` rows shaped for the exact GoTrue
and Storage versions running in production. Restored into a stock Supabase PostgreSQL 17 image with
no hand-written shims, **all eight `auth`/`storage` data blocks failed** — 0 of 8 users, 0 of 191
refresh tokens, 0 of 118 storage objects — leaving 45 workouts and 8 profiles owned by accounts that
no longer exist, rows that RLS (`auth.uid() = user_id`) would show to nobody.

## What was dumped

| File | Command | Size | Wall clock |
|---|---|---|---|
| `schema.sql` | `supabase db dump --linked -f …` | 94.8 KB | 24.5 s (includes a one-time pull of `public.ecr.aws/supabase/postgres:17.6.1.166`) |
| `data.sql` | `supabase db dump --linked --data-only -f …` | 988 KB | 12.3 s |

`schema.sql` covers **`public` only**: 32 tables, 26 functions, 34 policies, 6 triggers, plus six
`CREATE EXTENSION` lines. It contains no `CREATE TABLE` for any `auth` or `storage` object, and does
not define `auth.uid()`, although the policies it creates call it forty times.

`data.sql` carries 35 `INSERT` blocks: 27 `public` tables, 6 `auth` tables (`users`, `identities`,
`sessions`, `refresh_tokens`, `mfa_amr_claims`, `flow_state`) and 2 `storage` tables (`buckets`,
`objects`). pg_dump itself warns on the way out that a `--data-only` dump may not restore without
`--disable-triggers`, and that a full dump would avoid the problem.

Also worth knowing before an incident: the dump confirmed which of the PR #20 migrations are live.
`20260917120000` (reader quality previews, `video_previews`, `reserve_video_preview`) **is applied**
to production; `20260917130000`, `20260917140000` and `20260917150000` are **not** — no
`user_workout_override`, `claim_generation`, `finish_ingest_job`, `confirm_pumpy_proposal` or
`attempt_meta` appears anywhere in the production schema.

## Restore A — `postgres:15-alpine`, as the brief specified

Container `spotter-restore-pg` on 127.0.0.1:54330, stopped and removed afterwards.

**Timing: 0.94 s total** (0.35 s shims, 0.48 s `schema.sql`, 0.11 s `data.sql` with
`session_replication_role='replica'`). The database is ~2,300 rows; restore time is not the
constraint and will not be for a long while.

Shims required — every one of these is a step someone would have to invent at 3 a.m.:

1. **Roles.** `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin`,
   `supabase_storage_admin`, `dashboard_user`, `supabase_admin`. The dump grants to them constantly
   and creates none of them.
2. **Schemas.** `auth`, `storage`, `extensions`, `vault`, `graphql_public`.
3. **Extensions.** `pgcrypto` and `uuid-ossp` exist in the stock image. `pg_cron`, `pg_net`,
   `pg_stat_statements` and `supabase_vault` do not, and their `CREATE EXTENSION` lines had to be
   stripped from the dump with `sed`. Nothing in `public` calls them, so nothing else broke.
4. **Ten `auth`/`storage` enum types** (`auth.aal_level`, `auth.code_challenge_method`,
   `auth.factor_type`, `storage.buckettype`, …), rebuilt from the production catalog.
5. **Thirty-five `auth`/`storage` tables**, likewise rebuilt from the production catalog, because
   the schema dump has none of them and 18 `public` foreign keys point at `auth.users`.
6. **`auth.uid()`, `auth.role()`, `auth.jwt()`** and a primary key on `auth.users`. Without
   `auth.uid()` every `CREATE POLICY` in the dump fails.

Errors that remained even with all six shims in place:

- **16 × `unrecognized privilege type "MAINTAIN"`.** `MAINTAIN` is a PostgreSQL 17 privilege. A
  PG17 dump restored onto PG15 silently drops those sixteen `GRANT` statements, so the restored
  database has *different permissions* from production. This is the concrete reason a PG15 target is
  not a valid recovery target for this project.
- **2 × `publication "supabase_realtime" does not exist`** — the dump alters a publication it never
  creates.
- **1 × `unrecognized configuration parameter "transaction_timeout"`** — another PG17-only setting
  in the dump header.
- **1 × `relation "auth.refresh_tokens_id_seq" does not exist`** — a sequence my catalog-rebuilt
  shim did not reproduce.

## Restore B — a stock Supabase PostgreSQL 17 image, no shims at all (not required by the brief, but it is the honest test)

`public.ecr.aws/supabase/postgres:17.6.1.166` — the same image the CLI had just pulled, and the same
major version as production. Fresh container `spotter-restore-clean`, no shim script, stopped and
removed afterwards. (Gotcha for whoever repeats this: the image boots a temporary server for initdb
and then restarts, so `pg_isready` goes green against an instance that is about to be discarded.
Wait for the container healthcheck instead.)

**Timing: 0.93 s** (0.79 s schema, 0.14 s data).

`schema.sql` applied with **zero shims and zero errors**. The image already ships the roles, the
`auth`/`storage`/`extensions`/`vault` schemas, `auth.uid()` and every extension the dump asks for.
All six shim classes from restore A exist only because `postgres:15-alpine` is not a Supabase image.

`data.sql` then failed on **every non-`public` block**:

```
ERROR:  relation "auth.flow_state" does not exist
ERROR:  relation "auth.identities" does not exist
ERROR:  relation "auth.sessions" does not exist
ERROR:  relation "auth.mfa_amr_claims" does not exist
ERROR:  relation "storage.buckets" does not exist
ERROR:  relation "storage.objects" does not exist
ERROR:  column "email_confirmed_at" of relation "users" does not exist
ERROR:  column "parent" of relation "refresh_tokens" does not exist
```

Two different failures, one cause. The tables that do not exist are created by the GoTrue and
Storage *services* at runtime, not by the database image — a blank image has neither. The two that
exist but reject their columns are the version gap: the image's baked `auth` schema is **7 GoTrue
migrations** deep with a 21-column `auth.users`, while production is **82 migrations** deep with a
34-column `auth.users`. The dump's `INSERT` column lists are written against production's shape, so
they cannot be applied to a target on a different GoTrue version — and `supabase db dump --data-only`
**omits `auth.schema_migrations` (82 rows) and `storage.migrations` (68 rows)** entirely, so the
restored target cannot even be told which version it is supposed to be.

Result: every `public` table restored; `auth` and `storage` restored nothing. Hand-building the
thirty-five `auth`/`storage` tables from the production catalog, as restore A did, clears the six
"relation does not exist" failures but not the two column mismatches — `auth.users` and
`auth.refresh_tokens` stay empty either way.

## Count comparison

67 tables compared between production and restore A (the shimmed `postgres:15-alpine` target, which
is the only one of the two that got `auth` data in at all). **59 matched exactly.** The eight that
did not:

| Table | Production (17:05) | Restored | Explanation |
|---|---|---|---|
| `auth.schema_migrations` | 82 | 0 | not in the dump |
| `storage.migrations` | 68 | 0 | not in the dump |
| `auth.users` | 9 | 8 | live drift — the dump ran at 17:01 |
| `public.profiles` | 9 | 8 | live drift |
| `auth.identities` | 10 | 9 | live drift |
| `auth.sessions` | 36 | 34 | live drift |
| `auth.mfa_amr_claims` | 36 | 34 | live drift |
| `auth.refresh_tokens` | 193 | 191 | live drift |

The drift is real and was verified, not assumed: counting the rows inside `data.sql` gives exactly
the restored numbers (8 users, 8 profiles, 9 identities, 34 sessions, 191 refresh tokens), and a
second production poll twenty minutes later returned 10 users and 10 profiles. An account was
created after the dump — almost certainly another agent's throwaway login during this GTM wave. **No
row present in the dump failed to restore in pass A.** The restore is faithful to the dump; the
question is only how stale the dump is.

## The honest recovery window

The brief states the project is on the Supabase **free plan, which has no automated backups**. I did
not independently verify the plan tier — `supabase projects list` does not report it and I did not
open the dashboard. Taking it as given:

- **The only backup that exists is a dump someone remembers to take by hand.** Recovery point
  objective is therefore "however long ago the last manual dump was", which today is *this drill*.
  Before today it was nothing.
- **Recovery time is not the problem.** Restoring 2,300 rows takes under a second, and provisioning a
  fresh Supabase project plus re-deploying the edge function is the dominant cost — call it 30–60
  minutes of hands-on work.
- **Account loss is the problem.** With the dump pair as it stands, a restore returns the library and
  loses the logins, which for a multi-user app is close to total loss: every row in `public` is keyed
  to a `user_id` that no longer authenticates.

## Options for the owner (a decision, not a recommendation I can make)

1. **Dump the auth and storage schemas too.** `supabase db dump --linked --data-only --schema
   auth,storage,public` and a second schema dump with `--schema auth,storage` would capture what is
   missing, including the migration ledgers. Cheapest fix; keeps the free plan; still needs a target
   running the same GoTrue version, so it is a same-project restore, not a cross-project one.
2. **Supabase Pro.** Daily automated backups (and PITR as a paid add-on) remove the "someone
   remembered" failure mode entirely and are the only supported path for restoring `auth` intact.
   This is a monthly cost against a pre-revenue app and is the owner's call.
3. **A cadence for the manual dump, whatever else is chosen.** Given the current write rate — ~2,300
   rows total, a handful of new accounts a week — a **weekly** dump caps the loss at one week of
   library and logging, and a dump before every migration caps the loss around a schema change to
   zero. Both are one command and under 40 seconds. Daily would be defensible the moment real users
   arrive; it is not warranted yet at this volume.

Whatever is chosen, the drill should be repeated after the change and the restore proved to bring
back a *usable* database, not just a populated one. Today's answer to "can we restore?" is "the
workouts, yes; the people, no."

## Housekeeping

All three containers (`spotter-restore-pg`, `spotter-restore-pg17`, `spotter-restore-clean`) were
stopped and removed, as was the concurrency harness container `spotter-staging-pg`.
`schema.sql` and `data.sql` were deleted from the scratchpad; nothing derived from them, and no row
values, are in this repository. Running the drill pulled the
`public.ecr.aws/supabase/postgres:17.6.1.166` image (1.76 GB) as a side effect of `supabase db dump`
— it was left in place because any future dump or restore needs it.
