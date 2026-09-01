// Battery for the exercise-name normalizer. Run: node tools/test-normalize.mjs
// Exits non-zero on any failure, so it can gate a deploy.
import { canonicalize, CATALOG, CATALOG_CONFLICTS, MATCH_FLOOR } from "../supabase/functions/spotter/catalog.ts";

// [input, expected canonical id or null]
const CASES = [
  // the defect from the handoff, verbatim
  ["Bulgarian Split Squat", "bulgarian-split-squat"],
  ["Bulgarian Split Squats", "bulgarian-split-squat"],
  ["bulgarian split squat", "bulgarian-split-squat"],
  ["DB Bulgarians", "bulgarian-split-squat"],
  ["Bulgarians", "bulgarian-split-squat"],
  ["dumbbell bulgarian split squats", "bulgarian-split-squat"],
  ["Rear Foot Elevated Split Squat", "bulgarian-split-squat"],
  ["RFE Split Squats", "bulgarian-split-squat"],
  ["BSS", "bulgarian-split-squat"],
  ["Bulgarian Split Squat (each side)", "bulgarian-split-squat"],
  ["▶️ Bulgarian Split Squat — 3x10", "bulgarian-split-squat"],

  // abbreviations
  ["DB Bench Press", "dumbbell-bench-press"],
  ["BB Row", "bent-over-row"],
  ["KB Swings", "kettlebell-swing"],
  ["RDLs", "romanian-deadlift"],
  ["OHP", "overhead-press"],
  ["DL", "deadlift"],
  ["TTB", "toes-to-bar"],
  ["HSPU", "handstand-push-up"],
  ["TGU", "turkish-get-up"],

  // plurals, word order, punctuation, casing
  ["push-ups", "push-up"],
  ["Pushups", "push-up"],
  ["PUSH UPS", "push-up"],
  ["Press Ups", "push-up"],
  ["Pull Ups", "pull-up"],
  ["pullups", "pull-up"],
  ["Chin-Ups", "chin-up"],
  ["Goblet Squats", "goblet-squat"],
  ["Lateral Raises", "lateral-raise"],
  ["Side Raise", "lateral-raise"],
  ["Dumbbell Lateral Raise", "lateral-raise"],
  ["Skull Crushers", "skull-crusher"],
  ["Russian Twists", "russian-twist"],
  ["Mountain Climbers", "mountain-climber"],
  ["Bicycle Crunches", "bicycle-crunch"],
  ["Jumping Jacks", "jumping-jack"],
  ["Burpees", "burpee"],
  ["Box Jumps", "box-jump"],
  ["Hip Thrusts", "hip-thrust"],
  ["Face Pulls", "face-pull"],
  ["Tricep Pushdowns", "tricep-pushdown"],
  ["Walking Lunges", "walking-lunge"],
  ["Reverse Lunges", "reverse-lunge"],
  ["Step-Ups", "step-up"],
  ["Wall Sits", "wall-sit"],
  ["Dead Bugs", "dead-bug"],
  ["Bird Dogs", "bird-dog"],

  // shorthand and per-side noise the model likes to append
  ["Single Arm Row", "dumbbell-row"],
  ["1 Arm Row", "dumbbell-row"],
  ["One Arm Dumbbell Row", "dumbbell-row"],
  ["Split Stance Lunges", "split-squat"],
  ["Bent Over Rows", "bent-over-row"],
  ["Swings", "kettlebell-swing"],
  ["Romanian Deadlift x 10 reps", "romanian-deadlift"],
  ["Reverse Lunge (each leg)", "reverse-lunge"],
  ["Alternating Dumbbell Curl", "dumbbell-curl"],
  ["Plank Hold 60 seconds", "plank"],
  ["Air Squats", "bodyweight-squat"],
  ["Jump Rope 3 minutes", "jump-rope"],
  ["Hollow Rocks", "hollow-hold"],
  ["Farmers Walk", "farmers-carry"],
  ["Med Ball Slams", "medicine-ball-slam"],
  ["Wall Balls", "wall-ball"],

  // must NOT match anything — combos, junk, and made-up movements
  ["Curl + Press", null],
  ["Horizontal Press + Twist", null],
  ["Quantum Flux Grinder", null],
  ["Zorblatt Thrombulator", null],
  ["asdkjhasd", null],
  ["Rest 60 seconds", null],
  ["Complete 3 rounds", null],
  ["", null],
  ["Cable Machine Thingamajig", null],
];

let pass = 0;
const fails = [];
for (const [input, want] of CASES) {
  const m = canonicalize(input);
  const got = m ? m.id : null;
  if (got === want) pass++;
  else fails.push({ input, want, got, conf: m ? m.confidence : null, method: m ? m.method : null });
}

console.log("catalog entries:", CATALOG.length, "· match floor:", MATCH_FLOOR);
if (CATALOG_CONFLICTS.length) {
  console.log("\nCATALOG CONFLICTS (" + CATALOG_CONFLICTS.length + "):");
  for (const c of CATALOG_CONFLICTS) console.log("  ", c);
}
console.log("\n" + pass + "/" + CASES.length + " cases pass");
for (const f of fails) {
  console.log("  FAIL " + JSON.stringify(f.input) + " -> " + f.got +
    (f.conf ? " (" + f.method + " " + f.conf + ")" : "") + "  want " + f.want);
}

// The three variants named in the brief must land on ONE id.
const trio = ["DB Bulgarians", "Bulgarian Split Squats", "bulgarian split squat"]
  .map((s) => { const m = canonicalize(s); return { s, id: m && m.id, conf: m && m.confidence, method: m && m.method }; });
console.log("\nvariant convergence:");
for (const t of trio) console.log("  " + JSON.stringify(t.s).padEnd(28) + " -> " + t.id + " (" + t.method + " " + t.conf + ")");
const converged = new Set(trio.map((t) => t.id)).size === 1 && trio[0].id;
console.log("  all three map to one id:", converged ? "yes (" + trio[0].id + ")" : "NO");

const bad = fails.length || CATALOG_CONFLICTS.length || !converged;
process.exit(bad ? 1 : 0);
