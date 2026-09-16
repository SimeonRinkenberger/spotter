// Spotter — the controlled exercise catalog.
//
// The model proposes a free-form exercise name; this module maps it to a stable
// canonical id. Everything that has to match across saves and across sessions —
// the Workout Mode weight prefill, the Progress tab's personal records — keys off
// that id instead of the raw string, so "DB Bulgarians", "Bulgarian Split Squats"
// and "bulgarian split squat" stop being three different exercises.
//
// This file is the single source of truth. The migration that seeds
// public.exercise_catalog is generated from it (tools/gen-catalog-migration.mjs),
// and the edge function matches against the in-memory copy so normalization costs
// no round trip and cannot fail on a network blip.
//
// No AI is involved: exact, then alias, then a token-overlap fallback with a
// confidence floor. A name that does not clear the floor maps to null. Guessing
// would be worse than not matching, because a wrong id silently merges two
// different lifts' personal records.

export type CatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  /** What the movement is for. The body map paints these at full strength. */
  muscles: string[];
  /** What it also asks for — assisters and stabilisers. Painted faint. */
  secondary: string[];
  equipment: string[];
  unilateral: boolean;
  /**
   * The movement pattern, which is the coarsest true thing about an exercise and
   * the only one two different movements can honestly share. It is what lets the
   * demo shelf say "a similar movement — same muscles" about a clip that is NOT
   * this exercise, instead of presenting it as the same thing.
   */
  pattern: Pattern;
  /**
   * The movement this one is a variation of, or null when it is itself the plain
   * version. A diamond push-up's base is the push-up; the push-up has none.
   */
  base: string | null;
  /**
   * What somebody who only read the NAME would picture — the attributes that
   * define the standard version, and nothing else. Same nine fields the pack's
   * `as_performed` overlay carries, so the two can be compared field by field.
   */
  standard: StandardVariant;
};

/**
 * The nine patterns. Coarse on purpose: a reader has to agree with it at a glance,
 * and a taxonomy with thirty branches is a taxonomy nobody can check.
 */
export type Pattern =
  | "push" | "pull" | "hinge" | "squat" | "lunge" | "carry" | "rotate" | "core" | "cardio";

export const PATTERNS: Pattern[] = [
  "push", "pull", "hinge", "squat", "lunge", "carry", "rotate", "core", "cardio",
];

export type Match = {
  id: string;
  entry: CatalogEntry;
  confidence: number;
  method: "exact" | "key" | "fuzzy";
};

// Codes keep the table below readable. Both vocabularies are exactly the ones
// index.ts already ships (MUSCLES / EQUIPMENT), so derived values always survive
// pickFrom() and the column's check constraint.
const MUSCLE_CODES: Record<string, string> = {
  ch: "chest", bk: "back", sh: "shoulders", bi: "biceps", tr: "triceps",
  fa: "forearms", co: "core", gl: "glutes", qu: "quads", ha: "hamstrings",
  ca: "calves", fb: "full body",
};
const EQUIP_CODES: Record<string, string> = {
  db: "dumbbells", bb: "barbell", kb: "kettlebell", rb: "resistance bands",
  pb: "pull-up bar", bn: "bench", cb: "cables", mc: "machine",
  mb: "medicine ball", jr: "jump rope", bx: "box", ot: "other",
};

// The standard version's attributes, written as `key:value` pairs joined by ";".
// Only the attributes that DEFINE the standard version are listed — a push-up says
// where the hands are and how wide, and says nothing about tempo, because a push-up
// has no standard tempo and inventing one would manufacture a delta on every clip.
//
// `equipment` and `unilateral` are not in here: they already have columns of their
// own two fields to the left, and one fact in two places is one fact that can
// disagree with itself.
const STD_KEYS: Record<string, keyof StandardVariant> = {
  hp: "hand_placement",
  su: "surface",
  gw: "grip_width",
  lp: "load_position",
  st: "stance",
  te: "tempo",
  rom: "range_of_motion",
};

// [id, display name, aliases (";"), primary muscle codes (","),
//  secondary muscle codes (","), equipment codes (","), unilateral,
//  pattern, base movement id ("" for none), standard attributes ("k:v;k:v")]
type Row = [string, string, string, string, string, string, 0 | 1, string, string, string];

const ROWS: Row[] = [
  // ---------- squat / knee dominant ----------
  ["back-squat", "Back Squat", "squat;squats;barbell squat;bb squat;barbell back squat;back squats;high bar squat;low bar squat", "qu,gl,ha,co", "bk", "bb", 0, "squat", "", "lp:on the back;su:feet on the floor;st:shoulder width;rom:hips below the knees"],
  ["front-squat", "Front Squat", "front squats;barbell front squat;bb front squat", "qu,gl,co", "bk,sh,ha", "bb", 0, "squat", "back-squat", "lp:in the front rack;su:feet on the floor;st:shoulder width;rom:hips below the knees"],
  ["goblet-squat", "Goblet Squat", "goblet squats;goblets;db goblet squat;dumbbell goblet squat;kb goblet squat;kettlebell goblet squat", "qu,gl,co", "ha,fa", "db,kb", 0, "squat", "bodyweight-squat", "lp:at the chest;su:feet on the floor;st:shoulder width;hp:held by the horns at the chest;rom:hips below the knees"],
  ["bodyweight-squat", "Bodyweight Squat", "air squat;air squats;bw squat;body weight squat;prisoner squat", "qu,gl", "ha,co", "", 0, "squat", "", "su:feet on the floor;st:shoulder width;rom:hips below the knees"],
  ["jump-squat", "Jump Squat", "jump squats;squat jump;squat jumps;jumping squat", "qu,gl,ca", "ha,co", "", 0, "squat", "bodyweight-squat", "su:feet on the floor;st:shoulder width;te:explosive out of the bottom"],
  ["sumo-squat", "Sumo Squat", "sumo squats;wide stance squat;plie squat", "qu,gl", "ha,co", "db,kb", 0, "squat", "bodyweight-squat", "lp:at the chest;su:feet on the floor;st:wide, toes turned out"],
  ["split-squat", "Split Squat", "split squats;static lunge;stationary lunge;split stance lunge;split stance squat", "qu,gl", "ha,co", "", 1, "lunge", "", "su:feet on the floor;st:split stance, both feet planted"],
  ["bulgarian-split-squat", "Bulgarian Split Squat", "bulgarians;bulgarian;bulgarian squat;bulgarian lunge;bulgarian split squats;bss;rear foot elevated split squat;rfe split squat;rear foot elevated lunge;elevated split squat", "qu,gl,ha", "co,ca", "bn", 1, "lunge", "split-squat", "su:rear foot on a bench;st:split stance"],
  ["pistol-squat", "Pistol Squat", "pistol squats;single leg squat;one legged squat", "qu,gl,co", "ha,ca", "", 1, "squat", "bodyweight-squat", "su:one foot on the floor;st:single leg, free leg held out"],
  ["cossack-squat", "Cossack Squat", "cossack squats;lateral squat;side squat", "qu,gl,ha", "co", "", 1, "squat", "bodyweight-squat", "su:feet on the floor;st:very wide, toes turned out"],
  ["box-squat", "Box Squat", "box squats", "qu,gl", "ha,bk,co", "bb,bx", 0, "squat", "back-squat", "lp:on the back;su:sitting back to a box;st:shoulder width"],
  ["overhead-squat", "Overhead Squat", "overhead squats;ohs", "qu,gl,sh,co", "bk,ha,tr", "bb", 0, "squat", "back-squat", "lp:locked out overhead;su:feet on the floor;gw:wide"],
  ["zercher-squat", "Zercher Squat", "zercher squats", "qu,gl,co", "bk,bi,fa", "bb", 0, "squat", "back-squat", "lp:in the crooks of the elbows;su:feet on the floor;st:shoulder width"],
  ["hack-squat", "Hack Squat", "hack squats;machine hack squat", "qu,gl", "ha,ca", "mc", 0, "squat", "", "su:back against the machine pad;st:feet on the platform"],
  ["sissy-squat", "Sissy Squat", "sissy squats", "qu", "co", "", 0, "squat", "bodyweight-squat", "su:feet on the floor;rom:knees travel forward, hips stay open"],
  ["wall-sit", "Wall Sit", "wall sits;wall squat;wall hold", "qu,gl", "co,ca", "", 0, "squat", "", "su:back against a wall;te:held;rom:thighs parallel to the floor"],
  ["leg-press", "Leg Press", "leg presses;machine leg press", "qu,gl,ha", "ca", "mc", 0, "squat", "", "lp:on the foot platform;su:back against the machine pad"],
  ["leg-extension", "Leg Extension", "leg extensions;quad extension;knee extension", "qu", "", "mc", 0, "squat", "", "lp:on the shin pad;su:seated in the machine"],
  ["lunge", "Lunge", "lunges;forward lunge;front lunge;dumbbell lunge;db lunge;barbell lunge;goblet lunge", "qu,gl,ha", "co,ca", "", 1, "lunge", "", "su:feet on the floor;st:stepping forward;rom:back knee toward the floor"],
  ["reverse-lunge", "Reverse Lunge", "reverse lunges;backward lunge;back lunge;rear lunge", "qu,gl,ha", "co,ca", "", 1, "lunge", "lunge", "su:feet on the floor;st:stepping back"],
  ["walking-lunge", "Walking Lunge", "walking lunges;travelling lunge;traveling lunge", "qu,gl,ha", "co,ca", "", 1, "lunge", "lunge", "su:feet on the floor;st:stepping forward each rep"],
  ["lateral-lunge", "Lateral Lunge", "lateral lunges;side lunge;side lunges", "qu,gl,ha", "co", "", 1, "lunge", "lunge", "su:feet on the floor;st:stepping out to the side"],
  ["curtsy-lunge", "Curtsy Lunge", "curtsy lunges;crossover lunge", "gl,qu", "ha,co", "", 1, "lunge", "lunge", "su:feet on the floor;st:stepping behind and across"],
  ["step-up", "Step Up", "step ups;stepup;stepups;box step up;bench step up", "qu,gl", "ha,ca,co", "bx", 1, "lunge", "", "su:one foot on a box;st:staggered"],
  ["thruster", "Thruster", "thrusters;squat to press;squat press;dumbbell thruster;db thruster;barbell thruster", "qu,gl,sh,tr", "co,bk", "db,bb", 0, "squat", "", "lp:in the front rack;su:feet on the floor;rom:squat to overhead lockout"],
  ["wall-ball", "Wall Ball", "wall balls;wall ball shot;medicine ball thruster", "qu,gl,sh", "tr,co", "mb", 0, "squat", "thruster", "lp:at the chest;su:feet on the floor;rom:squat, then throw to a target"],
  ["box-jump", "Box Jump", "box jumps;jump to box;box jump over", "qu,gl,ca", "ha,co", "bx", 0, "squat", "", "su:feet on the floor, landing on a box;te:explosive"],
  ["broad-jump", "Broad Jump", "broad jumps;standing long jump", "qu,gl,ca", "ha,co", "", 0, "squat", "", "su:feet on the floor;te:explosive"],
  ["skater-jump", "Skater Jump", "skater jumps;skaters;skater hops;speed skater;lateral skater", "gl,qu,ca", "ha,co", "", 1, "lunge", "", "su:one foot on the floor;te:bound side to side"],
  ["lateral-bound", "Lateral Bound", "lateral bounds;side bound", "gl,qu,ca", "ha,co", "", 1, "lunge", "skater-jump", "su:one foot on the floor;te:bound side to side"],
  ["tuck-jump", "Tuck Jump", "tuck jumps", "qu,ca,co", "gl,ha", "", 0, "squat", "", "su:feet on the floor;te:explosive"],
  ["calf-raise", "Calf Raise", "calf raises;standing calf raise;heel raise;calve raise", "ca", "", "", 0, "squat", "", "su:balls of the feet on the floor;rom:full stretch to full rise"],
  ["seated-calf-raise", "Seated Calf Raise", "seated calf raises", "ca", "", "mc", 0, "squat", "calf-raise", "su:seated with the pad across the knees"],
  ["tibialis-raise", "Tibialis Raise", "tib raise;tibialis anterior raise", "ca", "", "", 0, "squat", "", "su:heels on the floor, back to a wall"],

  // ---------- hinge / posterior chain ----------
  ["deadlift", "Deadlift", "deadlifts;conventional deadlift;barbell deadlift;bb deadlift;dead lift;dl", "bk,gl,ha,fa", "qu,co", "bb", 0, "hinge", "", "lp:in front of the thighs;su:load starts on the floor;st:hip width;gw:just outside the legs"],
  ["sumo-deadlift", "Sumo Deadlift", "sumo deadlifts;sumo dl", "gl,qu,bk", "ha,fa,co", "bb", 0, "hinge", "deadlift", "lp:in front of the thighs;su:load starts on the floor;st:wide, toes turned out;gw:inside the legs"],
  ["romanian-deadlift", "Romanian Deadlift", "romanian deadlifts;rdl;rdls;romanian dead lift;barbell rdl;bb rdl;dumbbell rdl;db rdl", "ha,gl,bk", "fa,co", "bb,db", 0, "hinge", "deadlift", "lp:in front of the thighs;su:load starts at the hips;rom:mid-shin, no floor contact"],
  ["single-leg-deadlift", "Single Leg Deadlift", "single leg deadlifts;single leg rdl;sl rdl;sldl;one leg deadlift;one legged deadlift;single leg romanian deadlift", "ha,gl,co", "bk,fa,ca", "db,kb", 1, "hinge", "romanian-deadlift", "lp:in front of the thighs;st:one foot on the floor"],
  ["stiff-leg-deadlift", "Stiff Leg Deadlift", "stiff legged deadlift;straight leg deadlift", "ha,gl,bk", "fa,co", "bb", 0, "hinge", "deadlift", "lp:in front of the thighs;su:load starts on the floor;rom:legs stay nearly straight"],
  ["trap-bar-deadlift", "Trap Bar Deadlift", "hex bar deadlift;trap bar dl", "qu,gl,bk,fa", "ha,co", "bb", 0, "hinge", "deadlift", "lp:at the sides;su:load starts on the floor;hp:handles at the sides"],
  ["deficit-deadlift", "Deficit Deadlift", "deficit deadlifts", "bk,gl,ha", "qu,fa,co", "bb", 0, "hinge", "deadlift", "lp:in front of the thighs;su:standing on a raised platform"],
  ["rack-pull", "Rack Pull", "rack pulls;block pull", "bk,fa", "gl,ha", "bb", 0, "hinge", "deadlift", "lp:in front of the thighs;su:load starts on the rack pins;rom:knee height to lockout"],
  ["good-morning", "Good Morning", "good mornings", "ha,gl,bk", "co", "bb", 0, "hinge", "", "lp:on the back;su:feet on the floor"],
  ["hip-thrust", "Hip Thrust", "hip thrusts;barbell hip thrust;bb hip thrust;glute thrust;hip thruster", "gl,ha", "qu,co", "bb,bn", 0, "hinge", "", "lp:across the hips;su:upper back on a bench"],
  ["glute-bridge", "Glute Bridge", "glute bridges;hip bridge;bridge;bridges", "gl,ha,co", "qu,bk", "", 0, "hinge", "", "su:back on the floor;rom:hips to full extension"],
  ["single-leg-glute-bridge", "Single Leg Glute Bridge", "one leg glute bridge;single leg bridge;single leg hip thrust", "gl,ha", "co", "", 1, "hinge", "glute-bridge", "su:back on the floor;st:one foot planted"],
  ["kettlebell-swing", "Kettlebell Swing", "kettlebell swings;kb swing;kb swings;swing;swings;russian swing;american swing;russian kettlebell swing", "gl,ha,bk,co", "sh,fa", "kb", 0, "hinge", "", "lp:between the legs;su:feet on the floor;hp:two hands on the handle;rom:bell to chest height"],
  ["kettlebell-deadlift", "Kettlebell Deadlift", "kb deadlift;suitcase deadlift", "gl,ha,bk", "qu,fa,co", "kb", 0, "hinge", "deadlift", "lp:between the feet;su:load starts on the floor"],
  ["back-extension", "Back Extension", "back extensions;hyperextension;hyperextensions;superman machine", "bk,gl,ha", "co", "mc", 0, "hinge", "", "su:hips on the pad, feet anchored"],
  ["reverse-hyper", "Reverse Hyper", "reverse hypers;reverse hyperextension", "gl,ha,bk", "co", "mc", 0, "hinge", "", "su:torso on the pad, legs hanging"],
  ["nordic-curl", "Nordic Curl", "nordic hamstring curl;nordics;nordic ham curl", "ha", "gl,co", "", 0, "hinge", "", "su:kneeling with the ankles anchored"],
  ["glute-ham-raise", "Glute Ham Raise", "glute ham raises;ghr;ghd raise", "ha,gl", "bk,co", "mc", 0, "hinge", "nordic-curl", "su:on the pad with the feet anchored"],
  ["leg-curl", "Leg Curl", "leg curls;hamstring curl;lying leg curl;seated leg curl;machine leg curl", "ha", "ca", "mc", 0, "hinge", "", "lp:on the ankle pad;su:lying or seated in the machine"],
  ["cable-pull-through", "Cable Pull Through", "pull through;pull throughs;rope pull through", "gl,ha", "bk,co", "cb", 0, "hinge", "", "lp:between the legs;su:feet on the floor, facing away from the stack"],
  ["jefferson-curl", "Jefferson Curl", "jefferson curls", "bk,ha", "co", "bb", 0, "hinge", "", "lp:in front of the thighs;su:standing on a raised platform"],
  ["power-clean", "Power Clean", "power cleans;clean;cleans", "qu,gl,bk,sh", "ha,fa,co", "bb", 0, "hinge", "", "lp:floor to the front rack;su:load starts on the floor"],
  ["hang-clean", "Hang Clean", "hang cleans;hang power clean", "qu,gl,bk,sh", "ha,fa,co", "bb", 0, "hinge", "power-clean", "lp:hips to the front rack;su:load starts at the hips"],
  ["squat-clean", "Squat Clean", "squat cleans;full clean", "fb", "qu,gl,ha,bk,sh", "bb", 0, "hinge", "power-clean", "lp:floor to the front rack;rom:received in a full squat"],
  ["clean-and-jerk", "Clean and Jerk", "clean jerk;clean and jerks", "fb", "qu,gl,bk,sh,tr", "bb", 0, "hinge", "power-clean", "lp:floor to overhead lockout;su:load starts on the floor"],
  ["snatch", "Snatch", "snatches;barbell snatch;power snatch", "fb", "qu,gl,bk,sh,tr", "bb", 0, "hinge", "", "lp:floor to overhead lockout;su:load starts on the floor;gw:wide"],
  ["push-jerk", "Push Jerk", "push jerks", "sh,tr,qu", "gl,co,bk", "bb", 0, "push", "", "lp:front rack to overhead lockout;su:feet on the floor;te:dip and drive"],
  ["split-jerk", "Split Jerk", "split jerks", "sh,qu", "tr,gl,co", "bb", 0, "push", "push-jerk", "lp:front rack to overhead lockout;st:split landing"],
  // The kettlebell version is the one people actually film: one bell between the
  // feet, wide stance, elbows finishing above the hands. Adding `kb` here is not a
  // cosmetic widening — it is what lets the pack's SEEN equipment break the tie
  // against the barbell entries, and it is what "deadlift with a high pull" over a
  // single bell has to land on for the demo clip to show the same movement.
  ["sumo-deadlift-high-pull", "Sumo Deadlift High Pull", "sdhp;sumo dl high pull;deadlift high pull;kettlebell sumo deadlift high pull;kb sumo deadlift high pull", "fb,sh,bk", "qu,gl,fa", "bb,kb", 0, "hinge", "sumo-deadlift", "lp:between the feet;su:load starts on the floor;st:wide, toes turned out;rom:floor to the collarbone, elbows high"],
  ["kettlebell-clean", "Kettlebell Clean", "kettlebell cleans;kb clean", "sh,bk,gl", "ha,fa,co", "kb", 1, "hinge", "power-clean", "lp:between the legs to the front rack;hp:one hand on the handle"],
  ["kettlebell-snatch", "Kettlebell Snatch", "kettlebell snatches;kb snatch", "sh,bk,gl", "ha,fa,co", "kb", 1, "hinge", "snatch", "lp:between the legs to overhead;hp:one hand on the handle"],
  ["turkish-get-up", "Turkish Get Up", "turkish get ups;turkish getup;tgu;get up", "fb,co,sh", "tr,gl,qu", "kb", 1, "core", "", "lp:locked out overhead;su:starts lying on the floor;hp:one hand on the handle"],

  // ---------- horizontal push ----------
  ["bench-press", "Bench Press", "bench presses;barbell bench press;bb bench press;flat bench press;flat bench;bench;bp", "ch,tr,sh", "fa,bk", "bb,bn", 0, "push", "", "lp:over the chest;su:back on a bench;gw:just outside shoulder width;rom:bar to the chest"],
  ["incline-bench-press", "Incline Bench Press", "incline bench;incline barbell press;incline barbell bench press", "ch,sh,tr", "fa,bk", "bb,bn", 0, "push", "bench-press", "lp:over the upper chest;su:back on an inclined bench;gw:just outside shoulder width"],
  ["decline-bench-press", "Decline Bench Press", "decline bench;decline barbell press", "ch,tr", "sh", "bb,bn", 0, "push", "bench-press", "lp:over the lower chest;su:back on a declined bench"],
  ["close-grip-bench-press", "Close Grip Bench Press", "close grip bench;narrow grip bench press;cgbp", "tr,ch", "sh,fa", "bb,bn", 0, "push", "bench-press", "lp:over the chest;su:back on a bench;gw:shoulder width or narrower"],
  ["dumbbell-bench-press", "Dumbbell Bench Press", "db bench press;db bench;dumbbell press;db press;dumbbell chest press;flat dumbbell press", "ch,tr,sh", "fa,co", "db,bn", 0, "push", "bench-press", "lp:over the chest;su:back on a bench;hp:one dumbbell in each hand"],
  ["incline-dumbbell-press", "Incline Dumbbell Press", "incline db press;incline dumbbell bench press;incline db bench press", "ch,sh,tr", "fa,co", "db,bn", 0, "push", "incline-bench-press", "lp:over the upper chest;su:back on an inclined bench"],
  ["dumbbell-floor-press", "Dumbbell Floor Press", "floor press;db floor press", "ch,tr", "sh,co", "db", 0, "push", "bench-press", "lp:over the chest;su:back on the floor;rom:upper arms stop at the floor"],
  ["push-up", "Push-Up", "push up;push ups;pushup;pushups;press up;press ups;pressups", "ch,tr,sh,co", "fa,gl", "", 0, "push", "", "su:hands on the floor;gw:shoulder width;st:feet together;rom:chest to the floor"],
  ["incline-push-up", "Incline Push-Up", "incline push ups;incline pushup;elevated push up;hands elevated push up", "ch,tr,sh", "co", "bn", 0, "push", "push-up", "su:hands on a bench, feet on the floor;gw:shoulder width"],
  ["decline-push-up", "Decline Push-Up", "decline push ups;decline pushup;feet elevated push up", "ch,sh,tr", "co", "bn", 0, "push", "push-up", "su:hands on the floor, feet on a bench"],
  ["diamond-push-up", "Diamond Push-Up", "diamond pushup;triangle push up;close grip push up;narrow push up", "tr,ch", "sh,co", "", 0, "push", "push-up", "su:hands on the floor;gw:hands touching under the chest;hp:index fingers and thumbs together"],
  ["wide-push-up", "Wide Push-Up", "wide grip push up;wide pushup", "ch,sh", "tr,co", "", 0, "push", "push-up", "su:hands on the floor;gw:wider than the shoulders"],
  ["pike-push-up", "Pike Push-Up", "pike push ups;pike pushup", "sh,tr", "ch,co", "", 0, "push", "push-up", "su:hands and feet on the floor, hips high;rom:crown of the head to the floor"],
  ["archer-push-up", "Archer Push-Up", "archer pushup", "ch,tr", "sh,co", "", 1, "push", "push-up", "su:hands on the floor;gw:very wide"],
  ["plyo-push-up", "Plyo Push-Up", "clapping push up;clap push up;explosive push up;plyometric push up", "ch,tr", "sh,co", "", 0, "push", "push-up", "su:hands on the floor;te:explosive, hands leave the floor"],
  ["chest-fly", "Chest Fly", "chest flies;dumbbell fly;db fly;dumbbell flyes;flyes;flys;pec fly", "ch,sh", "bi", "db,bn", 0, "push", "", "lp:over the chest;su:back on a bench;rom:arms stay nearly straight"],
  ["incline-dumbbell-fly", "Incline Dumbbell Fly", "incline fly;incline flyes;incline db fly", "ch,sh", "bi", "db,bn", 0, "push", "chest-fly", "lp:over the upper chest;su:back on an inclined bench"],
  ["cable-fly", "Cable Fly", "cable flies;cable flyes;cable crossover;crossover", "ch", "sh,bi", "cb", 0, "push", "chest-fly", "lp:out to the sides;su:standing between the stacks"],
  ["machine-chest-press", "Machine Chest Press", "chest press machine;seated chest press;chest press", "ch,tr,sh", "co", "mc", 0, "push", "bench-press", "lp:at chest height;su:back against the machine pad"],
  ["pec-deck", "Pec Deck", "pec deck fly;butterfly machine;machine fly", "ch", "sh", "mc", 0, "push", "chest-fly", "su:back against the machine pad"],
  ["dip", "Dip", "dips;parallel bar dip;chest dip;tricep dip;triceps dip;bar dips", "tr,ch,sh", "co", "", 0, "push", "", "su:hanging on parallel bars;rom:shoulders to elbow height"],
  ["ring-dip", "Ring Dip", "ring dips", "tr,ch,sh", "co,fa", "ot", 0, "push", "dip", "su:hanging on rings"],
  ["bench-dip", "Bench Dip", "bench dips;chair dip", "tr,ch", "sh", "bn", 0, "push", "dip", "su:hands on a bench behind you, feet on the floor"],
  ["landmine-press", "Landmine Press", "landmine presses;single arm landmine press", "sh,ch,tr", "co", "bb", 1, "push", "overhead-press", "lp:at the shoulder;st:staggered or split;hp:one hand on the bar end"],
  ["svend-press", "Svend Press", "plate squeeze press", "ch", "sh,tr", "ot", 0, "push", "", "lp:pressed out from the chest;hp:plates squeezed between the palms"],

  // ---------- vertical push / shoulders ----------
  ["overhead-press", "Overhead Press", "ohp;military press;barbell shoulder press;bb overhead press;strict press;standing press;overhead presses", "sh,tr,co", "bk,ch", "bb", 0, "push", "", "lp:at the shoulders;su:feet on the floor;rom:shoulders to full lockout"],
  ["seated-shoulder-press", "Seated Shoulder Press", "seated overhead press;seated barbell press", "sh,tr", "ch", "bb,bn", 0, "push", "overhead-press", "lp:at the shoulders;su:seated with a back support"],
  ["dumbbell-shoulder-press", "Dumbbell Shoulder Press", "shoulder press;shoulder presses;db shoulder press;dumbbell overhead press;db overhead press;seated dumbbell press", "sh,tr", "co", "db", 0, "push", "overhead-press", "lp:at the shoulders;hp:one dumbbell in each hand"],
  ["machine-shoulder-press", "Machine Shoulder Press", "shoulder press machine;seated machine shoulder press", "sh,tr", "ch,co", "mc", 0, "push", "overhead-press", "lp:at the shoulders;su:seated in the machine"],
  ["arnold-press", "Arnold Press", "arnold presses;arnolds", "sh,tr", "ch,co", "db", 0, "push", "dumbbell-shoulder-press", "lp:at the shoulders, palms facing in;te:rotate as you press"],
  // A push press is a dip and a drive, whatever is overhead at the end of it. The
  // bell — one in each hand, or one held by the horns in front of the chest — is as
  // common on video as the bar, and leaving `kb` off sent "kettlebell push press"
  // hunting through the barbell entries.
  ["push-press", "Push Press", "push presses;kettlebell push press;kb push press;dumbbell push press;db push press", "sh,tr,qu", "gl,co", "bb,db,kb", 0, "push", "overhead-press", "lp:at the shoulders;su:feet on the floor;te:dip and drive"],
  ["handstand-push-up", "Handstand Push-Up", "handstand push ups;handstand pushup;hspu", "sh,tr", "co,bk", "", 0, "push", "push-up", "su:hands on the floor, inverted against a wall"],
  ["lateral-raise", "Lateral Raise", "lateral raises;side raise;side lateral raise;lat raise;db lateral raise;dumbbell lateral raise;cable lateral raise", "sh", "bk", "db,cb", 0, "push", "", "lp:hanging at the sides;rom:up to shoulder height"],
  ["front-raise", "Front Raise", "front raises;dumbbell front raise;db front raise;plate front raise", "sh", "ch,co", "db", 0, "push", "lateral-raise", "lp:hanging in front of the thighs;rom:up to shoulder height"],
  ["rear-delt-fly", "Rear Delt Fly", "rear delt flies;reverse fly;reverse flyes;rear delt raise;rear fly;bent over rear delt fly", "sh,bk", "co", "db,cb", 0, "pull", "", "lp:hanging below the chest;su:bent at the hips"],
  ["upright-row", "Upright Row", "upright rows", "sh,bk,fa", "bi", "bb,db", 0, "pull", "", "lp:in front of the thighs;gw:shoulder width;rom:up to the collarbone"],
  ["face-pull", "Face Pull", "face pulls;rope face pull", "sh,bk", "bi", "cb", 0, "pull", "", "lp:at eye level;su:standing at the stack"],
  ["shrug", "Shrug", "shrugs;barbell shrug;dumbbell shrug;db shrug;trap shrug", "bk,fa", "sh", "bb,db", 0, "pull", "", "lp:hanging at arm's length;rom:straight up and down"],
  ["band-pull-apart", "Band Pull Apart", "band pull aparts;pull aparts", "sh,bk", "co,fa", "rb", 0, "pull", "", "lp:at chest height;gw:shoulder width"],
  ["arm-circles", "Arm Circles", "arm circle;shoulder circles", "sh", "bk", "", 0, "rotate", "", "su:standing, arms out to the sides"],

  // ---------- pull ----------
  ["pull-up", "Pull-Up", "pull up;pull ups;pullup;pullups;wide grip pull up", "bk,bi,fa", "co,sh", "pb", 0, "pull", "", "su:hanging from a bar;gw:just outside shoulder width;hp:palms facing away;rom:chin over the bar"],
  ["chin-up", "Chin-Up", "chin up;chin ups;chinup;chinups;underhand pull up", "bk,bi", "fa,co", "pb", 0, "pull", "pull-up", "su:hanging from a bar;gw:shoulder width;hp:palms facing you"],
  ["assisted-pull-up", "Assisted Pull-Up", "assisted pullup;band assisted pull up;machine assisted pull up", "bk,bi", "fa,sh", "pb,mc", 0, "pull", "pull-up", "su:hanging from a bar with a counterweight"],
  ["muscle-up", "Muscle-Up", "muscle up;muscle ups;bar muscle up", "bk,tr,ch", "bi,fa,co", "pb", 0, "pull", "pull-up", "su:hanging from a bar;rom:chest over the bar to lockout"],
  ["scapular-pull-up", "Scapular Pull-Up", "scap pull up;scapular pull ups;scap pulls", "bk", "sh,fa", "pb", 0, "pull", "pull-up", "su:hanging from a bar;rom:shoulders only, arms stay straight"],
  ["dead-hang", "Dead Hang", "dead hangs;bar hang;hang", "fa,bk", "sh", "pb", 0, "pull", "pull-up", "su:hanging from a bar;te:held"],
  ["lat-pulldown", "Lat Pulldown", "lat pulldowns;lat pull down;pulldown;wide grip pulldown;cable pulldown", "bk,bi", "fa,sh", "cb,mc", 0, "pull", "pull-up", "su:seated with the thighs under the pad;gw:just outside shoulder width"],
  ["straight-arm-pulldown", "Straight Arm Pulldown", "straight arm pull down;lat pushdown", "bk", "tr,co", "cb", 0, "pull", "", "su:standing at the stack;rom:arms stay straight"],
  ["bent-over-row", "Bent-Over Row", "bent over row;bent over rows;bentover row;barbell row;barbell rows;bb row;row;rows;pendlay row;bent over barbell row", "bk,bi,fa", "ha,co", "bb", 0, "pull", "", "lp:hanging at arm's length;su:bent at the hips;gw:shoulder width"],
  ["dumbbell-row", "Dumbbell Row", "dumbbell rows;db row;db rows;one arm row;single arm row;single arm dumbbell row;one arm dumbbell row;kroc row;gorilla row", "bk,bi", "fa,co", "db,bn", 1, "pull", "bent-over-row", "lp:hanging at arm's length;su:one hand and knee on a bench;hp:one dumbbell in the free hand"],
  ["seated-cable-row", "Seated Cable Row", "cable row;cable rows;seated row", "bk,bi", "fa,sh", "cb", 0, "pull", "bent-over-row", "lp:hanging at arm's length;su:seated with the feet on the platform"],
  ["chest-supported-row", "Chest Supported Row", "incline row;chest supported dumbbell row;seal row", "bk,bi", "fa,sh", "db,bn", 0, "pull", "bent-over-row", "lp:hanging at arm's length;su:chest on an inclined bench"],
  ["t-bar-row", "T-Bar Row", "t bar row;tbar row;t bar rows", "bk,bi", "fa,ha", "bb,mc", 0, "pull", "bent-over-row", "lp:hanging at arm's length;su:bent at the hips"],
  ["inverted-row", "Inverted Row", "inverted rows;body row;bodyweight row;australian pull up;ring row", "bk,bi", "fa,co", "pb", 0, "pull", "", "su:hanging under a bar, heels on the floor;rom:chest to the bar"],
  ["machine-row", "Machine Row", "seated machine row;hammer strength row", "bk,bi", "fa", "mc", 0, "pull", "bent-over-row", "lp:hanging at arm's length;su:chest against the machine pad"],
  ["renegade-row", "Renegade Row", "renegade rows;plank row;push up row", "bk,co,bi", "sh,fa", "db", 1, "pull", "bent-over-row", "lp:hanging at arm's length;su:hands on the dumbbells in a plank;hp:one hand rows, the other supports"],
  ["meadows-row", "Meadows Row", "landmine row", "bk,bi", "fa,co", "bb", 1, "pull", "bent-over-row", "lp:hanging at arm's length;st:staggered, side on to the bar"],
  ["pull-over", "Pull-Over", "pullover;pullovers;dumbbell pullover;db pullover;lat pullover", "bk,ch", "tr,co", "db", 0, "pull", "", "lp:behind the head;su:back on a bench;rom:overhead to over the chest"],
  ["high-pull", "High Pull", "barbell high pull;kettlebell high pull", "sh,bk", "fa,qu", "bb,kb", 0, "pull", "", "lp:in front of the thighs;rom:up to the collarbone, elbows high"],
  ["farmers-carry", "Farmer's Carry", "farmers carry;farmers walk;farmer carry;suitcase carry;loaded carry", "fa,co,bk", "sh,gl", "db,kb", 0, "carry", "", "lp:at the sides;hp:one implement in each hand;te:walk"],
  ["overhead-carry", "Overhead Carry", "overhead carries;waiter carry;overhead walk", "sh,co", "bk,fa", "kb,db", 0, "carry", "farmers-carry", "lp:locked out overhead;te:walk"],

  // ---------- arms ----------
  ["dumbbell-curl", "Dumbbell Curl", "dumbbell curls;curl;curls;bicep curl;bicep curls;biceps curl;db curl;standing dumbbell curl", "bi,fa", "sh", "db", 0, "pull", "", "lp:hanging at arm's length;su:standing;hp:one dumbbell in each hand"],
  ["barbell-curl", "Barbell Curl", "barbell curls;bb curl;straight bar curl", "bi,fa", "sh", "bb", 0, "pull", "dumbbell-curl", "lp:hanging at arm's length;gw:shoulder width"],
  ["ez-bar-curl", "EZ Bar Curl", "ez curl;ez bar curls", "bi,fa", "sh", "bb", 0, "pull", "barbell-curl", "lp:hanging at arm's length;hp:hands on the angled grips"],
  ["hammer-curl", "Hammer Curl", "hammer curls;db hammer curl;neutral grip curl", "bi,fa", "sh", "db", 0, "pull", "dumbbell-curl", "lp:hanging at arm's length;hp:palms facing in"],
  ["preacher-curl", "Preacher Curl", "preacher curls;scott curl", "bi", "fa", "bb,bn", 0, "pull", "barbell-curl", "lp:hanging at arm's length;su:upper arms on the preacher pad"],
  ["incline-dumbbell-curl", "Incline Dumbbell Curl", "incline curl;incline db curl", "bi", "fa", "db,bn", 0, "pull", "dumbbell-curl", "lp:hanging behind the body;su:back on an inclined bench"],
  ["concentration-curl", "Concentration Curl", "concentration curls", "bi", "fa", "db", 1, "pull", "dumbbell-curl", "lp:hanging at arm's length;su:seated, elbow against the inner thigh"],
  ["cable-curl", "Cable Curl", "cable curls;cable bicep curl;rope curl", "bi", "fa", "cb", 0, "pull", "dumbbell-curl", "lp:hanging at arm's length;su:standing at the stack"],
  ["spider-curl", "Spider Curl", "spider curls", "bi", "fa", "db,bn", 0, "pull", "dumbbell-curl", "lp:hanging straight down;su:chest on an inclined bench"],
  ["zottman-curl", "Zottman Curl", "zottman curls", "bi,fa", "sh", "db", 0, "pull", "dumbbell-curl", "lp:hanging at arm's length;te:rotate the palms at the top"],
  ["drag-curl", "Drag Curl", "drag curls", "bi", "fa,bk", "bb", 0, "pull", "barbell-curl", "lp:hanging at arm's length;rom:bar dragged up the torso"],
  ["reverse-curl", "Reverse Curl", "reverse curls;reverse grip curl", "fa,bi", "sh", "bb,db", 0, "pull", "barbell-curl", "lp:hanging at arm's length;hp:palms facing down"],
  ["wrist-curl", "Wrist Curl", "wrist curls;forearm curl", "fa", "", "db,bb", 0, "pull", "", "lp:hanging at arm's length;su:forearms on the thighs or a bench"],
  ["tricep-pushdown", "Tricep Pushdown", "tricep pushdowns;triceps pushdown;pushdown;rope pushdown;cable pushdown;tricep push down", "tr", "fa", "cb", 0, "push", "", "lp:at chest height;su:standing at the stack;gw:shoulder width"],
  ["overhead-tricep-extension", "Overhead Tricep Extension", "overhead triceps extension;tricep extension;triceps extension;french press;overhead extension", "tr", "sh,co", "db,cb", 0, "push", "", "lp:behind the head;rom:behind the head to lockout"],
  ["skull-crusher", "Skull Crusher", "skull crushers;skullcrusher;lying tricep extension;lying triceps extension", "tr", "fa", "bb,bn", 0, "push", "", "lp:over the forehead;su:back on a bench"],
  ["tricep-kickback", "Tricep Kickback", "tricep kickbacks;triceps kickback;db kickback", "tr", "sh", "db", 1, "push", "", "lp:hanging at arm's length;su:bent at the hips"],

  // ---------- core ----------
  ["plank", "Plank", "planks;forearm plank;front plank;plank hold;high plank;elbow plank", "co,sh", "gl,bk", "", 0, "core", "", "su:forearms or hands on the floor;te:held"],
  ["side-plank", "Side Plank", "side planks;side plank hold", "co", "sh,gl", "", 1, "core", "plank", "su:one forearm on the floor;te:held"],
  ["copenhagen-plank", "Copenhagen Plank", "copenhagen;copenhagen side plank", "co", "qu,gl", "bn", 1, "core", "side-plank", "su:one forearm on the floor, top foot on a bench;te:held"],
  ["plank-shoulder-tap", "Plank Shoulder Tap", "shoulder taps;plank shoulder taps;shoulder tap", "co,sh", "ch,gl", "", 0, "core", "plank", "su:hands on the floor"],
  ["hip-dip", "Hip Dip", "hip dips;plank hip dip;side plank hip dip", "co", "gl", "", 0, "core", "side-plank", "su:one forearm on the floor"],
  ["crunch", "Crunch", "crunches;ab crunch;abdominal crunch", "co", "", "", 0, "core", "", "su:back on the floor;rom:shoulder blades off the floor"],
  ["reverse-crunch", "Reverse Crunch", "reverse crunches", "co", "qu", "", 0, "core", "crunch", "su:back on the floor;rom:hips off the floor"],
  ["cable-crunch", "Cable Crunch", "kneeling cable crunch;rope crunch", "co", "bk", "cb", 0, "core", "crunch", "lp:rope held behind the head;su:kneeling at the stack"],
  ["sit-up", "Sit-Up", "sit up;sit ups;situp;situps;full sit up", "co", "qu", "", 0, "core", "", "su:back on the floor;rom:torso all the way to upright"],
  ["bicycle-crunch", "Bicycle Crunch", "bicycle crunches;bicycles;bicycle kicks", "co", "qu", "", 0, "core", "crunch", "su:back on the floor"],
  ["russian-twist", "Russian Twist", "russian twists;seated twist", "co", "sh", "mb", 0, "rotate", "", "lp:held at the chest;su:seated, feet off the floor"],
  ["leg-raise", "Leg Raise", "leg raises;lying leg raise;lying leg raises", "co", "qu", "", 0, "core", "", "su:back on the floor;rom:heels to the floor and back up"],
  ["hanging-leg-raise", "Hanging Leg Raise", "hanging leg raises;hanging leg lift", "co,fa", "qu,bk", "pb", 0, "core", "leg-raise", "su:hanging from a bar;rom:legs to hip height or above"],
  ["hanging-knee-raise", "Hanging Knee Raise", "hanging knee raises;knee raise;knee raises", "co,fa", "qu,bk", "pb", 0, "core", "hanging-leg-raise", "su:hanging from a bar"],
  ["toes-to-bar", "Toes to Bar", "toes to bars;ttb;t2b;toes 2 bar", "co,fa,bk", "sh,qu", "pb", 0, "core", "hanging-leg-raise", "su:hanging from a bar;rom:toes touch the bar"],
  ["v-up", "V-Up", "v up;v ups;vups;v sit up", "co", "qu", "", 0, "core", "sit-up", "su:back on the floor"],
  ["hollow-hold", "Hollow Hold", "hollow holds;hollow body hold;hollow rock;hollow rocks", "co", "qu", "", 0, "core", "", "su:back on the floor;te:held"],
  ["dead-bug", "Dead Bug", "dead bugs;deadbug", "co", "qu", "", 0, "core", "", "su:back on the floor"],
  ["bird-dog", "Bird Dog", "bird dogs;birddog", "co,bk,gl", "sh", "", 1, "core", "", "su:hands and knees on the floor"],
  ["mountain-climber", "Mountain Climber", "mountain climbers;mtn climbers", "co,sh,fb", "qu", "", 0, "core", "plank", "su:hands on the floor;te:fast alternating"],
  ["flutter-kick", "Flutter Kick", "flutter kicks", "co", "qu", "", 0, "core", "", "su:back on the floor"],
  ["scissor-kick", "Scissor Kick", "scissor kicks", "co", "qu", "", 0, "core", "flutter-kick", "su:back on the floor"],
  ["heel-tap", "Heel Tap", "heel taps;lying heel tap", "co", "", "", 0, "core", "crunch", "su:back on the floor"],
  ["ab-wheel-rollout", "Ab Wheel Rollout", "ab rollout;ab wheel;rollout;barbell rollout;ab roller", "co", "bk,sh", "ot", 0, "core", "", "su:kneeling on the floor;rom:out to full extension"],
  ["sit-through", "Sit Through", "sit throughs;bear sit through", "co,fb", "sh", "", 0, "core", "", "su:hands and feet on the floor"],
  ["windshield-wiper", "Windshield Wiper", "windshield wipers", "co", "bk", "", 0, "rotate", "", "su:back on the floor"],
  ["superman", "Superman", "supermans;supermen;superman hold", "bk,gl", "ha,sh", "", 0, "core", "", "su:face down on the floor"],
  ["pallof-press", "Pallof Press", "pallof presses;anti rotation press", "co", "sh,gl", "cb,rb", 0, "rotate", "", "lp:pressed out from the chest;su:standing side on to the stack"],
  ["dragon-flag", "Dragon Flag", "dragon flags", "co", "bk,gl", "bn", 0, "core", "", "su:back on a bench, hands gripping behind the head"],
  ["l-sit", "L-Sit", "l sit;l sits;l sit hold", "co,tr", "sh,qu", "", 0, "core", "", "su:supported on the hands;te:held"],
  ["side-bend", "Side Bend", "side bends;dumbbell side bend;oblique side bend", "co", "bk", "db", 1, "core", "", "lp:hanging at one side"],
  ["woodchop", "Woodchop", "woodchops;wood chop;cable woodchop;chop", "co", "sh,bk", "cb", 1, "rotate", "", "lp:at the stack;su:standing at the stack;rom:high to low across the body"],
  ["landmine-rotation", "Landmine Rotation", "landmine rotations;landmine twist", "co,sh", "bk", "bb", 0, "rotate", "", "lp:held at the chest;rom:side to side"],
  ["bear-crawl", "Bear Crawl", "bear crawls", "co,sh,fb", "qu", "", 0, "core", "", "su:hands and feet on the floor;te:crawl"],
  ["kettlebell-windmill", "Kettlebell Windmill", "windmill;windmills;kb windmill", "co,sh", "ha,gl", "kb", 1, "rotate", "", "lp:locked out overhead;st:wide, front foot turned out"],
  ["kettlebell-halo", "Kettlebell Halo", "halo;halos;kb halo", "sh,co", "tr,bk", "kb", 0, "rotate", "", "lp:at the chest;rom:circled around the head"],

  // ---------- cardio / conditioning ----------
  ["running", "Running", "run;runs;jog;jogs;jogging;steady state run", "fb,ca", "qu,ha,gl", "", 0, "cardio", "", "su:feet on the ground"],
  ["sprint", "Sprint", "sprints;sprint intervals;hill sprint", "fb,qu", "ha,gl,ca", "", 0, "cardio", "running", "su:feet on the ground;te:maximum effort"],
  ["treadmill-run", "Treadmill Run", "treadmill;treadmill running;incline treadmill walk", "fb,ca", "qu,ha,gl", "mc", 0, "cardio", "running", "su:on the treadmill belt"],
  ["cycling", "Cycling", "bike;biking;cycle;stationary bike;spin bike", "qu,ca,fb", "gl,ha", "mc", 0, "cardio", "", "su:seated on the bike"],
  ["assault-bike", "Assault Bike", "air bike;echo bike;fan bike", "fb", "qu,sh,bk,co", "mc", 0, "cardio", "cycling", "su:seated on the bike;hp:hands on the moving handles"],
  ["rowing-machine", "Rowing Machine", "rowing;indoor rowing;row erg;rower;erg;concept 2", "fb,bk", "qu,bi", "mc", 0, "cardio", "", "su:seated on the erg;hp:both hands on the handle"],
  ["ski-erg", "Ski Erg", "skierg;ski machine", "fb,bk", "tr,co", "mc", 0, "cardio", "", "su:standing at the erg;hp:both hands on the handles"],
  ["stair-climber", "Stair Climber", "stairmaster;stair master;stair stepper;stairs", "gl,qu,ca", "ha,co", "mc", 0, "cardio", "", "su:on the moving steps"],
  ["elliptical", "Elliptical", "cross trainer;elliptical machine", "fb", "qu,gl,ca,sh", "mc", 0, "cardio", "", "su:feet on the pedals"],
  ["jump-rope", "Jump Rope", "jump ropes;skipping;skipping rope;rope skipping", "ca,fb", "sh,fa", "jr", 0, "cardio", "", "su:feet on the floor;hp:one handle in each hand"],
  ["double-under", "Double Under", "double unders;dubs", "ca,fb", "sh,fa", "jr", 0, "cardio", "jump-rope", "su:feet on the floor;rom:rope passes twice per jump"],
  ["burpee", "Burpee", "burpees;burpee to jump", "fb", "ch,tr,qu,gl,co", "", 0, "cardio", "", "su:floor to standing;rom:chest to the floor, jump at the top"],
  ["devils-press", "Devil's Press", "devils press;devil press", "fb", "sh,qu,gl,co", "db", 0, "cardio", "burpee", "lp:floor to overhead lockout;hp:one dumbbell in each hand"],
  ["man-maker", "Man Maker", "man makers;manmaker", "fb", "sh,bk,ch,co", "db", 0, "cardio", "burpee", "lp:floor to overhead lockout;hp:one dumbbell in each hand"],
  ["jumping-jack", "Jumping Jack", "jumping jacks;star jump;star jumps", "fb,ca", "sh", "", 0, "cardio", "", "su:feet on the floor"],
  ["high-knees", "High Knees", "high knee;running in place high knees", "qu,ca,co", "ha,gl", "", 0, "cardio", "running", "su:feet on the floor"],
  ["butt-kicks", "Butt Kicks", "butt kickers;heel kicks", "ha,ca", "gl", "", 0, "cardio", "running", "su:feet on the floor"],
  ["battle-ropes", "Battle Ropes", "battle rope;battling ropes;rope slams", "sh,co,fb", "fa", "ot", 0, "cardio", "", "hp:one rope end in each hand;st:quarter squat"],
  ["sled-push", "Sled Push", "sled pushes;prowler push", "qu,gl,fb", "ca,co", "ot", 0, "carry", "", "hp:both hands on the uprights;te:drive forward"],
  ["sled-pull", "Sled Pull", "sled pulls;sled drag", "bk,ha,fb", "fa", "ot", 0, "carry", "", "hp:both hands on the strap or harness;te:walk backward or forward"],
  ["shuttle-run", "Shuttle Run", "shuttle runs;suicides;line drill", "fb,qu", "ha,ca", "", 0, "cardio", "running", "su:feet on the ground"],
  ["medicine-ball-slam", "Medicine Ball Slam", "medicine ball slams;ball slam;med ball slam;slam ball;slams", "fb,co,sh", "bk", "mb", 0, "cardio", "", "lp:overhead to the floor"],
  ["wall-walk", "Wall Walk", "wall walks", "sh,co", "tr,bk", "", 0, "cardio", "", "su:hands on the floor, feet walking up a wall"],
  ["inchworm", "Inchworm", "inchworms;inch worm;walkout;inchworm walkout", "fb,co,ha", "sh,ch", "", 0, "cardio", "", "su:hands and feet on the floor"],

  // ---------- glutes / hips / accessory ----------
  ["hip-abduction", "Hip Abduction", "abduction machine;hip abductor;seated hip abduction", "gl", "qu", "mc", 0, "hinge", "", "su:seated in the machine;rom:knees out against the pads"],
  ["hip-adduction", "Hip Adduction", "adduction machine;hip adductor;seated hip adduction", "qu", "ha", "mc", 0, "hinge", "", "su:seated in the machine;rom:knees in against the pads"],
  ["clamshell", "Clamshell", "clamshells;clam shell;banded clamshell", "gl", "", "rb", 1, "hinge", "", "su:lying on one side, knees bent"],
  ["fire-hydrant", "Fire Hydrant", "fire hydrants", "gl", "co", "", 1, "hinge", "", "su:hands and knees on the floor"],
  ["donkey-kick", "Donkey Kick", "donkey kicks;glute kickback;glute kickbacks;cable kickback", "gl", "ha", "", 1, "hinge", "fire-hydrant", "su:hands and knees on the floor"],
  ["banded-walk", "Banded Walk", "banded walks;monster walk;lateral band walk;banded lateral walk", "gl", "qu", "rb", 0, "hinge", "", "su:feet on the floor, band around the legs;st:quarter squat"],
  ["frog-pump", "Frog Pump", "frog pumps", "gl", "ha", "", 0, "hinge", "glute-bridge", "su:back on the floor, soles of the feet together"],
  ["side-lying-leg-raise", "Side Lying Leg Raise", "side leg raise;side lying leg lifts;lying side leg lift", "gl", "co", "", 1, "hinge", "", "su:lying on one side"],
  ["leg-swing", "Leg Swing", "leg swings", "ha,gl", "qu", "", 1, "hinge", "", "su:standing on one leg"],
  ["hip-circle", "Hip Circle", "hip circles", "gl", "co", "", 0, "hinge", "", "su:standing, hands on the hips"],

  // ---------- mobility / yoga ----------
  ["downward-dog", "Downward Dog", "downward facing dog;down dog;adho mukha svanasana", "sh,ha,ca", "bk,co", "", 0, "core", "", "su:hands and feet on the floor, hips high;te:held"],
  ["childs-pose", "Child's Pose", "childs pose;child pose;balasana", "bk", "sh", "", 0, "core", "", "su:kneeling, forehead to the floor;te:held"],
  ["cat-cow", "Cat-Cow", "cat cow;cat camel;cat cow stretch", "bk,co", "sh", "", 0, "rotate", "", "su:hands and knees on the floor"],
  ["cobra-stretch", "Cobra Stretch", "cobra pose;cobra;upward dog;upward facing dog", "bk,co", "ch,sh", "", 0, "core", "", "su:face down, hands under the shoulders"],
  ["pigeon-pose", "Pigeon Pose", "pigeon stretch;pigeon", "gl", "bk", "", 0, "hinge", "", "su:front shin on the floor;te:held"],
  ["hip-flexor-stretch", "Hip Flexor Stretch", "hip flexor stretches;couch stretch;kneeling hip flexor stretch", "qu,gl", "co", "", 1, "hinge", "", "su:half kneeling on the floor;te:held"],
  ["hamstring-stretch", "Hamstring Stretch", "seated hamstring stretch;standing hamstring stretch", "ha", "ca,bk", "", 0, "hinge", "", "su:seated or standing;te:held"],
  ["worlds-greatest-stretch", "World's Greatest Stretch", "worlds greatest stretch;greatest stretch;wgs", "fb", "gl,ha,co,sh", "", 1, "lunge", "", "su:deep lunge with a hand on the floor"],
  ["thread-the-needle", "Thread the Needle", "thread needle;thread the needle stretch", "bk,sh", "ch", "", 1, "rotate", "", "su:hands and knees on the floor"],
  ["sun-salutation", "Sun Salutation", "sun salutations;surya namaskar", "fb", "sh,ha,bk,co", "", 0, "core", "", "su:standing to the floor and back"],
];

function codesTo(map: Record<string, string>, csv: string, what: string): string[] {
  if (!csv) return [];
  return csv.split(",").map((c) => {
    const v = map[c.trim()];
    if (!v) throw new Error("catalog: unknown " + what + " code " + JSON.stringify(c));
    return v;
  });
}

/**
 * "lp:at the chest;su:feet on the floor" -> the nine-field overlay.
 *
 * A load position on an entry that carries no implement is a contradiction, not a
 * default: an air squat has nothing for a load to be positioned at, and saying
 * otherwise would put a barbell in the reader's head. So the table is refused
 * rather than quietly corrected — a wrong standard is how you get a delta on a
 * movement that was performed exactly as named.
 */
function standardFrom(id: string, spec: string, equipment: string[], uni: boolean): StandardVariant {
  const out: StandardVariant = {
    equipment: equipment.slice(),
    hand_placement: null, surface: null, grip_width: null, load_position: null,
    stance: null, unilateral: uni, tempo: null, range_of_motion: null,
  };
  for (const pair of spec.split(";")) {
    if (!pair.trim()) continue;
    const at = pair.indexOf(":");
    const key = at < 0 ? "" : pair.slice(0, at).trim();
    const value = at < 0 ? "" : pair.slice(at + 1).trim();
    const field = STD_KEYS[key];
    if (!field || !value) throw new Error("catalog: bad standard attribute " + JSON.stringify(pair) + " on " + id);
    if (field === "equipment" || field === "unilateral") continue;
    out[field] = value;
  }
  if (out.load_position && !equipment.length) {
    throw new Error("catalog: " + id + " has a standard load position but no equipment");
  }
  return out;
}

export const CATALOG: CatalogEntry[] = ROWS.map(([id, name, aliases, mus, sec, eq, uni, pat, base, std]) => {
  const equipment = codesTo(EQUIP_CODES, eq, "equipment");
  if (!(PATTERNS as string[]).includes(pat)) {
    throw new Error("catalog: unknown pattern " + JSON.stringify(pat) + " on " + id);
  }
  return {
    id,
    name,
    aliases: aliases ? aliases.split(";").map((a) => a.trim()).filter(Boolean) : [],
    muscles: codesTo(MUSCLE_CODES, mus, "muscle"),
    secondary: codesTo(MUSCLE_CODES, sec, "muscle"),
    equipment,
    unilateral: uni === 1,
    pattern: pat as Pattern,
    base: base || null,
    standard: standardFrom(id, std, equipment, uni === 1),
  };
});

// A base that names nothing is worse than no base: the sheet would offer a parent
// movement the shelf has never heard of. Checked at module load, where it is a
// deploy-time error rather than a silent gap in one exercise's sheet.
for (const e of CATALOG) {
  if (e.base && !CATALOG.some((o) => o.id === e.base)) {
    throw new Error("catalog: " + e.id + " has base " + e.base + ", which is not an entry");
  }
  if (e.base === e.id) throw new Error("catalog: " + e.id + " is its own base");
}

const BY_ID = new Map<string, CatalogEntry>(CATALOG.map((e) => [e.id, e]));

export function catalogById(id: string | null | undefined): CatalogEntry | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

// ---------- text normalization ----------

// Written out before tokenizing, so an abbreviation expands into real words that
// the rest of the pipeline (stopwords, stemming, scoring) can see.
const ABBREVIATIONS: Record<string, string> = {
  db: "dumbbell", dbs: "dumbbell", dumbell: "dumbbell", dumbells: "dumbbell",
  bb: "barbell", kb: "kettlebell", kbs: "kettlebell",
  bw: "bodyweight", bodywt: "bodyweight",
  ohp: "overhead press", rdl: "romanian deadlift", rdls: "romanian deadlift",
  sldl: "single leg deadlift", bss: "bulgarian split squat", dl: "deadlift",
  bp: "bench press", cgbp: "close grip bench press", rfe: "rear foot elevated",
  sl: "single leg", ttb: "toes to bar", t2b: "toes to bar",
  hspu: "handstand push up", tgu: "turkish get up", ghr: "glute ham raise",
  sdhp: "sumo deadlift high pull", mb: "medicine ball", wb: "wall ball",
  du: "double under", ohs: "overhead squat",
};
const ABBR_RE = new RegExp(
  "\\b(" + Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length).join("|") + ")\\b",
  "g",
);

// Dropped outright: they never distinguish one movement from another.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "to", "on", "in", "at",
  "into", "your", "you", "then", "from", "plus", "x", "ea", "each", "per",
  "rep", "reps", "set", "sets", "sec", "secs", "second", "seconds",
  "min", "mins", "minute", "minutes", "round", "rounds", "total",
  "exercise", "movement", "variation", "style",
]);

function normalizeText(s: string): string {
  let t = " " + s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
  t = t.replace(/\([^)]*\)/g, " ");                       // "(each side)"
  t = t.replace(/\d+\s*[x×]\s*\d+/g, " ");                // "3x10"
  t = t.replace(/\b\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|reps?|sets?)\b/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");                       // punctuation, emoji, dashes
  t = t.replace(/\b(?:1|one)\s+(arm|leg|side)\b/g, " single $1 ");
  t = t.replace(/\b(?:2|two)\s+(arm|leg)\b/g, " double $1 ");
  t = t.replace(/\b(?:each|per|every)\s+(?:side|leg|arm|hand)s?\b/g, " ");
  t = t.replace(/\bboth\s+sides?\b/g, " ");
  t = t.replace(/\b(?:alternating|alternate|alt)\b/g, " ");
  // Compound spellings, folded to one form BEFORE anything tokenizes.
  //
  // This is the fix for the bug that started this wave. "Close Grip Pushups" was
  // three tokens — close, grip, pushups — where the catalog alias is four —
  // close, grip, push, up. The exact and key stages both missed, fuzzy ran, and
  // "pushups" (a token nothing else in the catalog carries) dragged the score down
  // just far enough that `close-grip-bench-press` won at 0.74 against a floor of
  // 0.72. The explain sheet then showed a bench press demo for a push-up.
  //
  // Folding the joined and the plural-spaced forms onto the same two words makes
  // all four spellings — "pushup", "pushups", "push up", "push ups" — the same
  // string, so the exact stage answers and fuzzy never gets the chance to be
  // creative. `\s*` covers the joined form; `ups?` covers the plural.
  t = t.replace(/\b(push|pull|sit|step|chin|press)\s*ups?\b/g, "$1 up");
  t = t.replace(ABBR_RE, (m) => " " + ABBREVIATIONS[m] + " ");
  return t.replace(/\s+/g, " ").trim();
}

// Crude on purpose. Applied identically to catalog names and to model output, so
// "raise"/"raises" and "press"/"presses" collapse to the same key even though the
// stems themselves are not words.
function stem(w: string): string {
  let t = w;
  if (t.length > 4 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  while (t.length > 3 && (t.endsWith("s") || t.endsWith("e"))) t = t.slice(0, -1);
  return t;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeText(s).split(" ")) {
    if (!raw || /^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    const t = stem(raw);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function tokenKey(s: string): string {
  return tokenize(s).slice().sort().join(" ");
}

// ---------- indexes ----------

const exactIndex = new Map<string, string>();   // normalized surface form -> id
const keyIndex = new Map<string, string>();     // sorted stem key -> id
const entryTokenSets: { id: string; tokens: string[] }[][] = [];
const docFreq = new Map<string, number>();

export const CATALOG_CONFLICTS: string[] = [];

for (const e of CATALOG) {
  const surfaces = [e.name, ...e.aliases];
  const sets: { id: string; tokens: string[] }[] = [];
  const seenKeys = new Set<string>();
  const entryTokens = new Set<string>();

  for (const s of surfaces) {
    const norm = normalizeText(s);
    if (norm) {
      const prior = exactIndex.get(norm);
      if (prior && prior !== e.id) CATALOG_CONFLICTS.push("alias " + JSON.stringify(s) + ": " + prior + " vs " + e.id);
      else if (!prior) exactIndex.set(norm, e.id);
    }
    const toks = tokenize(s);
    if (!toks.length) continue;
    const k = toks.slice().sort().join(" ");
    if (!keyIndex.has(k)) keyIndex.set(k, e.id);
    else if (keyIndex.get(k) !== e.id) CATALOG_CONFLICTS.push("key " + JSON.stringify(k) + ": " + keyIndex.get(k) + " vs " + e.id);
    if (!seenKeys.has(k)) { seenKeys.add(k); sets.push({ id: e.id, tokens: toks }); }
    for (const t of toks) entryTokens.add(t);
  }
  for (const t of entryTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  entryTokenSets.push(sets);
}

const N = CATALOG.length;
// Squared IDF: generic modifiers ("dumbbell", "press") must not be able to carry a
// match on their own, while a distinctive word ("bulgarian") should nearly settle it.
const UNKNOWN_WEIGHT = Math.pow(Math.log(N / 0.5) + 1, 2);
function weightOf(token: string): number {
  const df = docFreq.get(token);
  if (!df) return UNKNOWN_WEIGHT;
  return Math.pow(Math.log(N / df) + 1, 2);
}

// ---------- matching ----------

// Below this, the token overlap is not evidence of the same movement. A wrong id
// silently merges two lifts' personal records, so the default is null.
export const MATCH_FLOOR = 0.72;

function f1(query: string[], entry: string[]): number {
  let inter = 0, wq = 0, we = 0;
  const entrySet = new Set(entry);
  for (const t of query) {
    const w = weightOf(t);
    wq += w;
    if (entrySet.has(t)) inter += w;
  }
  for (const t of entry) we += weightOf(t);
  if (!inter || !wq || !we) return 0;
  const cq = inter / wq, ce = inter / we;
  return (2 * cq * ce) / (cq + ce);
}

// ---------- movement families ----------
//
// The fuzzy stage compares bags of words, and a bag of words does not know that a
// push-up and a bench press are different movements performed by different bodies
// in different postures — it only sees that both say "close grip". That is exactly
// how "Close Grip Pushups" landed on `close-grip-bench-press` at 0.74.
//
// So the head noun gets a veto. Every catalog entry and every incoming name is
// assigned the family of its head movement, and fuzzy may only compare two names
// that agree about what kind of thing they are. Order matters below: the compound
// families are listed before the bare verbs they contain, so "sumo deadlift high
// pull" is a deadlift rather than a pull, and "push up" is a push-up rather than a
// press.
const FAMILY_PATTERNS: [string, RegExp][] = [
  ["push up", /\bpush up\b/],
  ["pull up", /\b(?:pull up|chin up|muscle up)\b/],
  ["sit up", /\bsit up\b/],
  ["step up", /\bstep up\b/],
  ["deadlift", /\bdeadlift\b/],
  ["swing", /\bswing/],
  ["carry", /\b(?:carry|carries|farmer)\b/],
  ["lunge", /\blunge/],
  ["plank", /\bplank/],
  ["crunch", /\bcrunch/],
  ["squat", /\bsquat/],
  ["row", /\brow/],
  ["curl", /\bcurl/],
  ["raise", /\braise/],
  ["jump", /\b(?:jump|hop)\b/],
  ["press", /\bpress/],
  ["pull", /\bpull/],
];

/** The family of a NORMALIZED name, or null when it names no family at all. */
function familyOf(norm: string): string | null {
  for (const [name, re] of FAMILY_PATTERNS) if (re.test(norm)) return name;
  return null;
}

// Families whose standard version is the body and nothing else. A name in one of
// these may not resolve to an entry built around a loaded implement unless the
// name itself — or the equipment the video was SEEN to use — says that implement.
const BODYWEIGHT_FAMILIES = new Set(["push up", "pull up", "sit up", "plank", "crunch"]);
const LOADED_CODES = new Set(["bb", "db", "kb", "cb", "mc"]);
const IMPLEMENT_WORDS: Record<string, RegExp> = {
  bb: /\bbarbell|smith\b/,
  db: /\bdumbbell\b/,
  kb: /\bkettlebell\b/,
  cb: /\bcable\b/,
  mc: /\bmachine\b/,
};

/** The equipment codes a name (plus whatever was seen) actually claims. */
function implementsNamed(norm: string, hintEquip: string[]): Set<string> {
  const hay = (norm + " " + hintEquip.join(" ")).toLowerCase();
  const out = new Set<string>();
  for (const [code, re] of Object.entries(IMPLEMENT_WORDS)) if (re.test(hay)) out.add(code);
  return out;
}

const CODE_FOR_EQUIP: Record<string, string> = Object.fromEntries(
  Object.entries(EQUIP_CODES).map(([code, name]) => [name, code]),
);

/** What the fuzzy stage is allowed to consider, given who is asking. */
function fuzzyAllows(
  queryFamily: string | null, named: Set<string>, entry: CatalogEntry, entryFamily: string | null,
): boolean {
  // Two names that both declare a family have to declare the same one. A name with
  // no family (a proper noun like "Turkish Get Up") is not held to this.
  if (queryFamily && entryFamily && queryFamily !== entryFamily) return false;
  if (!queryFamily || !BODYWEIGHT_FAMILIES.has(queryFamily)) return true;
  const loaded = entry.equipment.filter((q) => LOADED_CODES.has(CODE_FOR_EQUIP[q] ?? ""));
  if (!loaded.length) return true;
  // A loaded entry is still reachable — "kettlebell push up" is a real thing — but
  // only when the implement was named or seen, never as a fuzzy accident.
  return loaded.some((q) => named.has(CODE_FOR_EQUIP[q]));
}

/** Cached per entry: the family of its display name, which is its head movement. */
const FAMILY_BY_ID = new Map<string, string | null>();
for (const e of CATALOG) FAMILY_BY_ID.set(e.id, familyOf(normalizeText(e.name)));

/**
 * What the catalog says this movement normally looks like, for `delta`.
 *
 * The same nine fields the pack's `as_performed` overlay carries, so a standard and
 * a performance can be compared field by field rather than by prose. Null means the
 * standard version does not fix that attribute — a push-up has no standard tempo,
 * and a made-up one would put a delta on every push-up ever filmed.
 */
export type StandardVariant = {
  /** Equipment names, as the catalog spells them. [] means bodyweight. */
  equipment: string[];
  hand_placement: string | null;
  /** What the body, or the load, is normally on. */
  surface: string | null;
  grip_width: string | null;
  /** Where the load normally sits. Always null on a bodyweight entry. */
  load_position: string | null;
  stance: string | null;
  unilateral: boolean;
  tempo: string | null;
  range_of_motion: string | null;
};

/**
 * The standard version of a catalog entry: what somebody reading only the name
 * would picture. `delta` is the difference between this and what the video showed,
 * and it exists so a demo clip can be labelled honestly — "the standard version,
 * shown on the floor" — instead of silently presenting a different movement.
 *
 * Until this wave it was a family-level guess: thirteen head nouns, so every squat
 * in the catalog claimed the same standard and a Bulgarian split squat was told its
 * load belongs at the chest. The answer now comes off the entry's own row, which is
 * the only place that can be right about 224 different movements.
 */
export function standardOf(entry: CatalogEntry): StandardVariant {
  const s = entry.standard;
  // Copied rather than handed out: callers compare against this and a shared array
  // that one of them sorted in place would change what "standard" means elsewhere.
  return { ...s, equipment: s.equipment.slice() };
}

/**
 * Map a model-produced exercise name to a catalog entry.
 * Returns null when nothing clears MATCH_FLOOR — callers store canonical_id: null
 * and keep the raw name, rather than guessing.
 *
 * `hint.equipment` is what the video was SEEN to use — the Video Context Pack's
 * `variant.equipment`. It never invents a match; it breaks ties between entries
 * that are otherwise equally close, and it is what lets a name the creator said
 * loosely ("deadlift with a high pull") reach the entry that matches what is
 * actually in their hands.
 */
export function canonicalize(
  rawName: string | null | undefined,
  hint?: { equipment?: string[] },
): Match | null {
  if (!rawName || typeof rawName !== "string") return null;

  const norm = normalizeText(rawName);
  if (!norm) return null;
  const hintEquip = (hint?.equipment ?? []).filter((e): e is string => typeof e === "string");

  const exact = exactIndex.get(norm);
  if (exact) return { id: exact, entry: BY_ID.get(exact)!, confidence: 1, method: "exact" };

  const toks = tokenize(rawName);
  if (!toks.length) return null;

  const keyed = keyIndex.get(toks.slice().sort().join(" "));
  if (keyed) return { id: keyed, entry: BY_ID.get(keyed)!, confidence: 0.95, method: "key" };

  // A lone word is a body part or a section header far more often than a movement:
  // "Legs", "Back", "Jump", "Extension". Token overlap will happily land those on
  // leg-press, back-squat or jump-squat. Single-word movements that are real —
  // "burpees", "bulgarians", "swings", "thrusters" — are catalog aliases and were
  // already answered by the two exact stages above, so fuzzy needs two tokens.
  if (toks.length < 2) return null;

  const queryFamily = familyOf(norm);
  const named = implementsNamed(norm, hintEquip);

  let bestId = "";
  let bestScore = 0;
  for (const sets of entryTokenSets) {
    for (const s of sets) {
      const entry = BY_ID.get(s.id);
      if (!entry) continue;
      if (!fuzzyAllows(queryFamily, named, entry, FAMILY_BY_ID.get(s.id) ?? null)) continue;
      const score = f1(toks, s.tokens);
      // The hint is worth a hair, never a match: a candidate the video's own
      // equipment agrees with wins a photo finish and loses everything else.
      const tuned = hintEquip.length && entry.equipment.some((q) => hintEquip.includes(q))
        ? score + 0.02
        : score;
      if (tuned > bestScore) { bestScore = tuned; bestId = s.id; }
    }
  }
  if (!bestId || bestScore < MATCH_FLOOR) return null;
  return {
    id: bestId, entry: BY_ID.get(bestId)!,
    confidence: Math.round(Math.min(1, bestScore) * 100) / 100, method: "fuzzy",
  };
}

/** Convenience for callers that only want the id. */
export function canonicalIdFor(
  rawName: string | null | undefined,
  hint?: { equipment?: string[] },
): string | null {
  const m = canonicalize(rawName, hint);
  return m ? m.id : null;
}
