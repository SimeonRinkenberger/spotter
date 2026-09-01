// One-time backfill: give exercises already in the database a canonical_id.
//
//   node tools/backfill-canonical.mjs            # dry run, prints what it would do
//   node tools/backfill-canonical.mjs --apply    # writes
//
// Strictly additive. It sets exactly one new key per exercise object and PATCHes
// exactly one column per row (workouts.blocks, workout_logs.entries). It never
// touches titles, categories, notes, ratings, favourites, muscle groups or
// equipment on an existing row — those may have been hand-edited by the user, and
// a backfill has no business overwriting them.
//
// video_cache is deliberately NOT backfilled: CARD_V went 4 -> 5, so those rows
// already read as a cache miss and get re-extracted with canonical ids on the next
// save. That is the mechanism the cache was built with.
import { readFileSync } from "node:fs";
import { canonicalize } from "../supabase/functions/spotter/catalog.ts";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SB = "https://" + env.PROJECT_REF + ".supabase.co";
const KEY = env.SERVICE_ROLE_KEY;
const H = { apikey: KEY, authorization: "Bearer " + KEY, "content-type": "application/json" };

async function get(path) {
  const r = await fetch(SB + "/rest/v1/" + path, { headers: H });
  if (!r.ok) throw new Error("select " + r.status + " " + (await r.text()));
  return r.json();
}
async function patch(path, body) {
  const r = await fetch(SB + "/rest/v1/" + path, {
    method: "PATCH",
    headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("patch " + r.status + " " + (await r.text()));
}

let mapped = 0, unmapped = 0, rowsChanged = 0;
const unmappedNames = [];

// ---------- workouts.blocks[].exercises[] ----------

const workouts = await get("workouts?select=id,title,blocks&order=created_at");
console.log("workouts: " + workouts.length + " rows\n");

for (const w of workouts) {
  const blocks = Array.isArray(w.blocks) ? w.blocks : [];
  let changed = false;
  const lines = [];

  for (const b of blocks) {
    for (const ex of (b?.exercises ?? [])) {
      if (!ex || typeof ex.name !== "string") continue;
      const m = canonicalize(ex.name);
      const id = m ? m.id : null;
      if (ex.canonical_id === id) continue;   // already correct
      ex.canonical_id = id;
      changed = true;
      if (id) { mapped++; lines.push("    " + JSON.stringify(ex.name).padEnd(34) + " -> " + id + "  (" + m.method + " " + m.confidence + ")"); }
      else { unmapped++; unmappedNames.push(ex.name); lines.push("    " + JSON.stringify(ex.name).padEnd(34) + " -> null"); }
    }
  }

  if (!changed) continue;
  rowsChanged++;
  console.log("  " + w.id + "  " + JSON.stringify(String(w.title).slice(0, 46)));
  for (const l of lines) console.log(l);
  if (APPLY) await patch("workouts?id=eq." + w.id, { blocks });
}

// ---------- workout_logs.entries[] ----------
// This is what the weight prefill and the personal-record grouping actually read,
// so history logged before the catalog existed would otherwise stay fragmented.

const logs = await get("workout_logs?select=id,workout_title,entries&order=started_at");
console.log("\nworkout_logs: " + logs.length + " rows");

let logRows = 0;
for (const l of logs) {
  const entries = Array.isArray(l.entries) ? l.entries : [];
  let changed = false;
  for (const e of entries) {
    if (!e || typeof e.name !== "string") continue;
    const m = canonicalize(e.name);
    const id = m ? m.id : null;
    if (e.canonical_id === id) continue;
    e.canonical_id = id;
    changed = true;
    if (id) mapped++; else { unmapped++; unmappedNames.push(e.name); }
  }
  if (!changed) continue;
  logRows++;
  console.log("  " + l.id + "  " + JSON.stringify(String(l.workout_title || "").slice(0, 40)) +
    "  " + entries.length + " entries");
  if (APPLY) await patch("workout_logs?id=eq." + l.id, { entries });
}

console.log("\n" + (APPLY ? "APPLIED" : "DRY RUN — nothing written (pass --apply)"));
console.log("  workout rows changed: " + rowsChanged + " / " + workouts.length);
console.log("  log rows changed:     " + logRows + " / " + logs.length);
console.log("  exercises mapped:     " + mapped);
console.log("  left null:            " + unmapped +
  (unmappedNames.length ? "  " + JSON.stringify(unmappedNames) : ""));
