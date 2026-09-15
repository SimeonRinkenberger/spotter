// Regenerates the exercise_catalog seed migration from catalog.ts, which is the
// single source of truth. Run: node tools/gen-catalog-migration.mjs
// The table is reference data, not user data: the seed is idempotent (upsert on
// id) so re-running the migration never drops or duplicates rows.
import { writeFileSync } from "node:fs";
import { CATALOG, CATALOG_CONFLICTS, PATTERNS } from "../supabase/functions/spotter/catalog.ts";

const OUT = "supabase/migrations/20260901130000_exercise_catalog.sql";
// The secondary-muscle column arrived after the seed had already shipped, so it
// gets its own migration rather than a rewrite of an applied one. Both files are
// generated from the same CATALOG, and the seed's upsert leaves secondary_muscles
// alone, so the two can be replayed in either order.
//
// This constant names the NEWEST secondary-state migration — the one that carries
// the current catalog.ts values. It is self-contained: it adds the column and the
// constraint if they are missing and upserts every row, skipping the ones already
// correct. When the secondary lists change again after this file has been applied,
// point this at a NEW timestamp rather than editing an applied migration.
// Applied already, frozen, do not regenerate: 20260902140000_catalog_secondary_muscles.sql
const OUT_SECONDARY = "supabase/migrations/20260902150000_catalog_secondary_fill.sql";
// The movement attributes — pattern, base and the standard version's nine fields.
// Same rule as the secondary fill: its own file, self-contained, idempotent, and
// pointed at a NEW timestamp whenever the values change after it has been applied.
const OUT_ATTRS = "supabase/migrations/20260915120000_catalog_movement_attributes.sql";

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
  // A muscle cannot be both the point of the movement and an afterthought, and a
  // repeat inside either list would double-count it on the body map.
  for (const m of e.secondary) {
    if (!MUSCLES.includes(m)) { console.error("bad secondary muscle " + m + " on " + e.id); process.exit(1); }
    if (e.muscles.includes(m)) { console.error("secondary " + m + " repeats a primary on " + e.id); process.exit(1); }
  }
  if (new Set(e.secondary).size !== e.secondary.length) { console.error("duplicate secondary on " + e.id); process.exit(1); }
  if (new Set(e.muscles).size !== e.muscles.length) { console.error("duplicate muscle on " + e.id); process.exit(1); }
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

// ---------- secondary muscles ----------

const secRows = CATALOG.map((e) => "  (" + q(e.id) + ", " + arr(e.secondary) + ")").join(",\n");

const secSql = `-- Spotter — secondary (assisting) muscles for the catalog, current values.
--
-- GENERATED FILE. Source of truth is supabase/functions/spotter/catalog.ts;
-- regenerate with: node tools/gen-catalog-migration.mjs
--
-- muscle_groups says what a movement is FOR; secondary_muscles says what it also
-- asks for. The body map paints the first at full strength and the second faint,
-- which is the only reason the distinction is stored rather than inferred.
--
-- Idempotent: the column is added only if absent, the constraint swallows its own
-- duplicate, and the update is a no-op once the values match.

alter table public.exercise_catalog
  add column if not exists secondary_muscles text[] not null default '{}';

do $$ begin
  alter table public.exercise_catalog
    add constraint catalog_secondary_known check (secondary_muscles <@ ${arr(MUSCLES)});
exception when duplicate_object then null; end $$;

update public.exercise_catalog as c
set secondary_muscles = v.sec, updated_at = now()
from (values
${secRows}
) as v(id, sec)
where c.id = v.id and c.secondary_muscles is distinct from v.sec;
`;

writeFileSync(OUT_SECONDARY, secSql);
const withSec = CATALOG.filter((e) => e.secondary.length).length;
console.log(OUT_SECONDARY + " written — " + withSec + " of " + CATALOG.length +
  " entries carry secondary muscles, " + secSql.length.toLocaleString() + " bytes");

// ---------- movement attributes ----------
//
// Three columns, mirroring the three new fields on every catalog row. `standard` is
// jsonb rather than nine columns because it IS the pack's nine-field overlay — the
// whole point is that a standard and a performance can be compared field by field,
// and a shape that drifts from `as_performed` would stop being comparable.

for (const e of CATALOG) {
  if (!PATTERNS.includes(e.pattern)) { console.error("bad pattern " + e.pattern + " on " + e.id); process.exit(1); }
  if (e.base && !seenId.has(e.base)) { console.error("base " + e.base + " on " + e.id + " is not an entry"); process.exit(1); }
  if (e.base === e.id) { console.error(e.id + " is its own base"); process.exit(1); }
  // A load position with nothing to load is how a barbell gets invented on an air
  // squat. catalog.ts refuses it at module load; refuse it here too, because this
  // file is what the database ends up believing.
  if (e.standard.load_position && !e.equipment.length) {
    console.error(e.id + " has a standard load position but no equipment"); process.exit(1);
  }
}

const jsonb = (o) => q(JSON.stringify(o)) + "::jsonb";
const attrRows = CATALOG.map((e) =>
  "  (" + [q(e.id), q(e.pattern), e.base ? q(e.base) : "null", jsonb(e.standard),
    arr(e.aliases), arr(e.equipment)].join(", ") + ")"
).join(",\n");

const attrSql = `-- Spotter — movement pattern, base movement and the standard version's attributes.
--
-- GENERATED FILE. Source of truth is supabase/functions/spotter/catalog.ts;
-- regenerate with: node tools/gen-catalog-migration.mjs
--
-- Why these three exist: a demo clip keyed by canonical id is the same movement,
-- but the creator may not have performed the standard version of it — hands on a
-- kettlebell rather than on the floor. \`standard\` is what a reader who only saw the
-- NAME would picture, so the difference between it and what the video showed can be
-- stated out loud instead of a different exercise being shown as if it were this one.
-- \`pattern\` and \`base\` are what let a clip be called similar honestly when it is not
-- the same movement at all.
--
-- Idempotent: columns added only if absent, the constraint swallows its own
-- duplicate, and the update is a no-op once the values match.

alter table public.exercise_catalog
  add column if not exists pattern text,
  add column if not exists base_id text,
  add column if not exists standard jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.exercise_catalog
    add constraint catalog_pattern_known check (pattern is null or pattern = any (${arr(PATTERNS)}));
exception when duplicate_object then null; end $$;

-- A base that names no row would be a dangling parent. Self-referencing, so it is
-- checked by the database rather than by whoever writes the next seed.
do $$ begin
  alter table public.exercise_catalog
    add constraint catalog_base_is_an_entry foreign key (base_id)
      references public.exercise_catalog (id) on delete set null;
exception when duplicate_object then null; end $$;

-- Aliases and equipment ride along. The seed migration above them was applied in
-- September and every later change to those two columns — the kettlebell spellings
-- of the sumo deadlift high pull and the push press, added when the pack learned to
-- read an implement off the frames — has only ever existed in catalog.ts. The edge
-- function matches against the in-memory copy so nothing broke, but a table that
-- disagrees with the module it was generated from is a trap for whoever reads it
-- next. Same \`is distinct from\` guard: for 222 of the 224 rows this writes nothing.
update public.exercise_catalog as c
set pattern = v.pattern, base_id = v.base_id, standard = v.standard,
    aliases = v.aliases, equipment = v.equipment, updated_at = now()
from (values
${attrRows}
) as v(id, pattern, base_id, standard, aliases, equipment)
where c.id = v.id
  and (c.pattern is distinct from v.pattern
    or c.base_id is distinct from v.base_id
    or c.standard is distinct from v.standard
    or c.aliases is distinct from v.aliases
    or c.equipment is distinct from v.equipment);
`;

writeFileSync(OUT_ATTRS, attrSql);
const withBase = CATALOG.filter((e) => e.base).length;
console.log(OUT_ATTRS + " written — " + CATALOG.length + " entries, " + withBase +
  " with a base movement, " + attrSql.length.toLocaleString() + " bytes");
