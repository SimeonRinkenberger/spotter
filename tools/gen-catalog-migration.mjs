// Regenerates the exercise_catalog seed migration from catalog.ts, which is the
// single source of truth. Run: node tools/gen-catalog-migration.mjs
// The table is reference data, not user data: the seed is idempotent (upsert on
// id) so re-running the migration never drops or duplicates rows.
import { writeFileSync } from "node:fs";
import { CATALOG, CATALOG_CONFLICTS } from "../supabase/functions/spotter/catalog.ts";

const OUT = "supabase/migrations/20260901130000_exercise_catalog.sql";

const MUSCLES = ["chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "core", "glutes", "quads", "hamstrings", "calves", "full body"];
const EQUIPMENT = ["dumbbells", "barbell", "kettlebell", "resistance bands", "pull-up bar",
  "bench", "cables", "machine", "medicine ball", "jump rope", "box", "other"];

if (CATALOG_CONFLICTS.length) {
  console.error("refusing to generate: catalog has alias conflicts");
  for (const c of CATALOG_CONFLICTS) console.error("  " + c);
  process.exit(1);
}

const seenId = new Set();
for (const e of CATALOG) {
  if (seenId.has(e.id)) { console.error("duplicate id " + e.id); process.exit(1); }
  seenId.add(e.id);
  if (!/^[a-z0-9-]+$/.test(e.id)) { console.error("bad id " + e.id); process.exit(1); }
  for (const m of e.muscles) if (!MUSCLES.includes(m)) { console.error("bad muscle " + m + " on " + e.id); process.exit(1); }
  for (const q of e.equipment) if (!EQUIPMENT.includes(q)) { console.error("bad equipment " + q + " on " + e.id); process.exit(1); }
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const arr = (xs) => xs.length ? "array[" + xs.map(q).join(",") + "]::text[]" : "'{}'::text[]";

const rows = CATALOG.map((e) =>
  "  (" + [q(e.id), q(e.name), arr(e.aliases), arr(e.muscles), arr(e.equipment), e.unilateral ? "true" : "false"].join(", ") + ")"
).join(",\n");

const sql = `-- Spotter — controlled exercise catalog.
--
-- GENERATED FILE. Source of truth is supabase/functions/spotter/catalog.ts;
-- regenerate with: node tools/gen-catalog-migration.mjs
--
-- Reference data, not user data. Every signed-in user may read it; only the
-- service role writes it. The seed upserts on id, so re-running is safe and
-- never removes a row a saved workout might already point at.

create table if not exists public.exercise_catalog (
  id text primary key,
  display_name text not null,
  aliases text[] not null default '{}',
  muscle_groups text[] not null default '{}',
  equipment text[] not null default '{}',
  unilateral boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint catalog_id_slug check (id ~ '^[a-z0-9-]+$'),
  -- keep the catalog inside the vocabularies index.ts already ships, so derived
  -- values always survive pickFrom() and match what the UI renders
  constraint catalog_muscles_known check (muscle_groups <@ ${arr(MUSCLES)}),
  constraint catalog_equipment_known check (equipment <@ ${arr(EQUIPMENT)})
);

create index if not exists exercise_catalog_aliases on public.exercise_catalog using gin (aliases);

alter table public.exercise_catalog enable row level security;

do $$ begin
  create policy "catalog readable" on public.exercise_catalog for select to authenticated using (true);
exception when duplicate_object then null; end $$;

insert into public.exercise_catalog (id, display_name, aliases, muscle_groups, equipment, unilateral) values
${rows}
on conflict (id) do update set
  display_name  = excluded.display_name,
  aliases       = excluded.aliases,
  muscle_groups = excluded.muscle_groups,
  equipment     = excluded.equipment,
  unilateral    = excluded.unilateral,
  updated_at    = now();
`;

writeFileSync(OUT, sql);
console.log(OUT + " written — " + CATALOG.length + " entries, " + sql.length.toLocaleString() + " bytes");
