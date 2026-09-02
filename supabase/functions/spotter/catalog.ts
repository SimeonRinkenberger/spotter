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
};

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

// [id, display name, aliases (";"), primary muscle codes (","),
//  secondary muscle codes (","), equipment codes (","), unilateral]
type Row = [string, string, string, string, string, string, 0 | 1];

const ROWS: Row[] = [
  // ---------- squat / knee dominant ----------
  ["back-squat", "Back Squat", "squat;squats;barbell squat;bb squat;barbell back squat;back squats;high bar squat;low bar squat", "qu,gl,ha,co", "bk", "bb", 0],
  ["front-squat", "Front Squat", "front squats;barbell front squat;bb front squat", "qu,gl,co", "bk,sh,ha", "bb", 0],
  ["goblet-squat", "Goblet Squat", "goblet squats;goblets;db goblet squat;dumbbell goblet squat;kb goblet squat;kettlebell goblet squat", "qu,gl,co", "ha,fa", "db,kb", 0],
  ["bodyweight-squat", "Bodyweight Squat", "air squat;air squats;bw squat;body weight squat;prisoner squat", "qu,gl", "ha,co", "", 0],
  ["jump-squat", "Jump Squat", "jump squats;squat jump;squat jumps;jumping squat", "qu,gl,ca", "ha,co", "", 0],
  ["sumo-squat", "Sumo Squat", "sumo squats;wide stance squat;plie squat", "qu,gl", "ha,co", "db,kb", 0],
  ["split-squat", "Split Squat", "split squats;static lunge;stationary lunge;split stance lunge;split stance squat", "qu,gl", "ha,co", "", 1],
  ["bulgarian-split-squat", "Bulgarian Split Squat", "bulgarians;bulgarian;bulgarian squat;bulgarian lunge;bulgarian split squats;bss;rear foot elevated split squat;rfe split squat;rear foot elevated lunge;elevated split squat", "qu,gl,ha", "co,ca", "bn", 1],
  ["pistol-squat", "Pistol Squat", "pistol squats;single leg squat;one legged squat", "qu,gl,co", "ha,ca", "", 1],
  ["cossack-squat", "Cossack Squat", "cossack squats;lateral squat;side squat", "qu,gl,ha", "co", "", 1],
  ["box-squat", "Box Squat", "box squats", "qu,gl", "ha,bk,co", "bb,bx", 0],
  ["overhead-squat", "Overhead Squat", "overhead squats;ohs", "qu,gl,sh,co", "bk,ha,tr", "bb", 0],
  ["zercher-squat", "Zercher Squat", "zercher squats", "qu,gl,co", "bk,bi,fa", "bb", 0],
  ["hack-squat", "Hack Squat", "hack squats;machine hack squat", "qu,gl", "ha,ca", "mc", 0],
  ["sissy-squat", "Sissy Squat", "sissy squats", "qu", "co", "", 0],
  ["wall-sit", "Wall Sit", "wall sits;wall squat;wall hold", "qu,gl", "co,ca", "", 0],
  ["leg-press", "Leg Press", "leg presses;machine leg press", "qu,gl,ha", "ca", "mc", 0],
  ["leg-extension", "Leg Extension", "leg extensions;quad extension;knee extension", "qu", "", "mc", 0],
  ["lunge", "Lunge", "lunges;forward lunge;front lunge;dumbbell lunge;db lunge;barbell lunge;goblet lunge", "qu,gl,ha", "co,ca", "", 1],
  ["reverse-lunge", "Reverse Lunge", "reverse lunges;backward lunge;back lunge;rear lunge", "qu,gl,ha", "co,ca", "", 1],
  ["walking-lunge", "Walking Lunge", "walking lunges;travelling lunge;traveling lunge", "qu,gl,ha", "co,ca", "", 1],
  ["lateral-lunge", "Lateral Lunge", "lateral lunges;side lunge;side lunges", "qu,gl,ha", "co", "", 1],
  ["curtsy-lunge", "Curtsy Lunge", "curtsy lunges;crossover lunge", "gl,qu", "ha,co", "", 1],
  ["step-up", "Step Up", "step ups;stepup;stepups;box step up;bench step up", "qu,gl", "ha,ca,co", "bx", 1],
  ["thruster", "Thruster", "thrusters;squat to press;squat press;dumbbell thruster;db thruster;barbell thruster", "qu,gl,sh,tr", "co,bk", "db,bb", 0],
  ["wall-ball", "Wall Ball", "wall balls;wall ball shot;medicine ball thruster", "qu,gl,sh", "tr,co", "mb", 0],
  ["box-jump", "Box Jump", "box jumps;jump to box;box jump over", "qu,gl,ca", "ha,co", "bx", 0],
  ["broad-jump", "Broad Jump", "broad jumps;standing long jump", "qu,gl,ca", "ha,co", "", 0],
  ["skater-jump", "Skater Jump", "skater jumps;skaters;skater hops;speed skater;lateral skater", "gl,qu,ca", "ha,co", "", 1],
  ["lateral-bound", "Lateral Bound", "lateral bounds;side bound", "gl,qu,ca", "ha,co", "", 1],
  ["tuck-jump", "Tuck Jump", "tuck jumps", "qu,ca,co", "gl,ha", "", 0],
  ["calf-raise", "Calf Raise", "calf raises;standing calf raise;heel raise;calve raise", "ca", "", "", 0],
  ["seated-calf-raise", "Seated Calf Raise", "seated calf raises", "ca", "", "mc", 0],
  ["tibialis-raise", "Tibialis Raise", "tib raise;tibialis anterior raise", "ca", "", "", 0],

  // ---------- hinge / posterior chain ----------
  ["deadlift", "Deadlift", "deadlifts;conventional deadlift;barbell deadlift;bb deadlift;dead lift;dl", "bk,gl,ha,fa", "qu,co", "bb", 0],
  ["sumo-deadlift", "Sumo Deadlift", "sumo deadlifts;sumo dl", "gl,qu,bk", "ha,fa,co", "bb", 0],
  ["romanian-deadlift", "Romanian Deadlift", "romanian deadlifts;rdl;rdls;romanian dead lift;barbell rdl;bb rdl;dumbbell rdl;db rdl", "ha,gl,bk", "fa,co", "bb,db", 0],
  ["single-leg-deadlift", "Single Leg Deadlift", "single leg deadlifts;single leg rdl;sl rdl;sldl;one leg deadlift;one legged deadlift;single leg romanian deadlift", "ha,gl,co", "bk,fa,ca", "db,kb", 1],
  ["stiff-leg-deadlift", "Stiff Leg Deadlift", "stiff legged deadlift;straight leg deadlift", "ha,gl,bk", "fa,co", "bb", 0],
  ["trap-bar-deadlift", "Trap Bar Deadlift", "hex bar deadlift;trap bar dl", "qu,gl,bk,fa", "ha,co", "bb", 0],
  ["deficit-deadlift", "Deficit Deadlift", "deficit deadlifts", "bk,gl,ha", "qu,fa,co", "bb", 0],
  ["rack-pull", "Rack Pull", "rack pulls;block pull", "bk,fa", "gl,ha", "bb", 0],
  ["good-morning", "Good Morning", "good mornings", "ha,gl,bk", "co", "bb", 0],
  ["hip-thrust", "Hip Thrust", "hip thrusts;barbell hip thrust;bb hip thrust;glute thrust;hip thruster", "gl,ha", "qu,co", "bb,bn", 0],
  ["glute-bridge", "Glute Bridge", "glute bridges;hip bridge;bridge;bridges", "gl,ha,co", "", "", 0],
  ["single-leg-glute-bridge", "Single Leg Glute Bridge", "one leg glute bridge;single leg bridge;single leg hip thrust", "gl,ha", "co", "", 1],
  ["kettlebell-swing", "Kettlebell Swing", "kettlebell swings;kb swing;kb swings;swing;swings;russian swing;american swing;russian kettlebell swing", "gl,ha,bk,co", "sh,fa", "kb", 0],
  ["kettlebell-deadlift", "Kettlebell Deadlift", "kb deadlift;suitcase deadlift", "gl,ha,bk", "qu,fa,co", "kb", 0],
  ["back-extension", "Back Extension", "back extensions;hyperextension;hyperextensions;superman machine", "bk,gl,ha", "", "mc", 0],
  ["reverse-hyper", "Reverse Hyper", "reverse hypers;reverse hyperextension", "gl,ha,bk", "", "mc", 0],
  ["nordic-curl", "Nordic Curl", "nordic hamstring curl;nordics;nordic ham curl", "ha", "gl,co", "", 0],
  ["glute-ham-raise", "Glute Ham Raise", "glute ham raises;ghr;ghd raise", "ha,gl", "bk,co", "mc", 0],
  ["leg-curl", "Leg Curl", "leg curls;hamstring curl;lying leg curl;seated leg curl;machine leg curl", "ha", "ca", "mc", 0],
  ["cable-pull-through", "Cable Pull Through", "pull through;pull throughs;rope pull through", "gl,ha", "bk,co", "cb", 0],
  ["jefferson-curl", "Jefferson Curl", "jefferson curls", "bk,ha", "co", "bb", 0],
  ["power-clean", "Power Clean", "power cleans;clean;cleans", "qu,gl,bk,sh", "ha,fa,co", "bb", 0],
  ["hang-clean", "Hang Clean", "hang cleans;hang power clean", "qu,gl,bk,sh", "ha,fa,co", "bb", 0],
  ["squat-clean", "Squat Clean", "squat cleans;full clean", "fb", "", "bb", 0],
  ["clean-and-jerk", "Clean and Jerk", "clean jerk;clean and jerks", "fb", "", "bb", 0],
  ["snatch", "Snatch", "snatches;barbell snatch;power snatch", "fb", "", "bb", 0],
  ["push-jerk", "Push Jerk", "push jerks", "sh,tr,qu", "gl,co,bk", "bb", 0],
  ["split-jerk", "Split Jerk", "split jerks", "sh,qu", "tr,gl,co", "bb", 0],
  ["sumo-deadlift-high-pull", "Sumo Deadlift High Pull", "sdhp;sumo dl high pull", "fb,sh,bk", "qu,gl,fa", "bb", 0],
  ["kettlebell-clean", "Kettlebell Clean", "kettlebell cleans;kb clean", "sh,bk,gl", "ha,fa,co", "kb", 1],
  ["kettlebell-snatch", "Kettlebell Snatch", "kettlebell snatches;kb snatch", "sh,bk,gl", "ha,fa,co", "kb", 1],
  ["turkish-get-up", "Turkish Get Up", "turkish get ups;turkish getup;tgu;get up", "fb,co,sh", "tr,gl,qu", "kb", 1],

  // ---------- horizontal push ----------
  ["bench-press", "Bench Press", "bench presses;barbell bench press;bb bench press;flat bench press;flat bench;bench;bp", "ch,tr,sh", "fa,bk", "bb,bn", 0],
  ["incline-bench-press", "Incline Bench Press", "incline bench;incline barbell press;incline barbell bench press", "ch,sh,tr", "fa,bk", "bb,bn", 0],
  ["decline-bench-press", "Decline Bench Press", "decline bench;decline barbell press", "ch,tr", "sh", "bb,bn", 0],
  ["close-grip-bench-press", "Close Grip Bench Press", "close grip bench;narrow grip bench press;cgbp", "tr,ch", "sh,fa", "bb,bn", 0],
  ["dumbbell-bench-press", "Dumbbell Bench Press", "db bench press;db bench;dumbbell press;db press;dumbbell chest press;flat dumbbell press", "ch,tr,sh", "fa,co", "db,bn", 0],
  ["incline-dumbbell-press", "Incline Dumbbell Press", "incline db press;incline dumbbell bench press;incline db bench press", "ch,sh,tr", "fa,co", "db,bn", 0],
  ["dumbbell-floor-press", "Dumbbell Floor Press", "floor press;db floor press", "ch,tr", "sh,co", "db", 0],
  ["push-up", "Push-Up", "push up;push ups;pushup;pushups;press up;press ups;pressups", "ch,tr,sh,co", "fa,gl", "", 0],
  ["incline-push-up", "Incline Push-Up", "incline push ups;incline pushup;elevated push up;hands elevated push up", "ch,tr,sh", "co", "bn", 0],
  ["decline-push-up", "Decline Push-Up", "decline push ups;decline pushup;feet elevated push up", "ch,sh,tr", "co", "bn", 0],
  ["diamond-push-up", "Diamond Push-Up", "diamond pushup;triangle push up;close grip push up;narrow push up", "tr,ch", "sh,co", "", 0],
  ["wide-push-up", "Wide Push-Up", "wide grip push up;wide pushup", "ch,sh", "tr,co", "", 0],
  ["pike-push-up", "Pike Push-Up", "pike push ups;pike pushup", "sh,tr", "ch,co", "", 0],
  ["archer-push-up", "Archer Push-Up", "archer pushup", "ch,tr", "sh,co", "", 1],
  ["plyo-push-up", "Plyo Push-Up", "clapping push up;clap push up;explosive push up;plyometric push up", "ch,tr", "sh,co", "", 0],
  ["chest-fly", "Chest Fly", "chest flies;dumbbell fly;db fly;dumbbell flyes;flyes;flys;pec fly", "ch,sh", "bi", "db,bn", 0],
  ["incline-dumbbell-fly", "Incline Dumbbell Fly", "incline fly;incline flyes;incline db fly", "ch,sh", "bi", "db,bn", 0],
  ["cable-fly", "Cable Fly", "cable flies;cable flyes;cable crossover;crossover", "ch", "sh,bi", "cb", 0],
  ["machine-chest-press", "Machine Chest Press", "chest press machine;seated chest press;chest press", "ch,tr,sh", "", "mc", 0],
  ["pec-deck", "Pec Deck", "pec deck fly;butterfly machine;machine fly", "ch", "sh", "mc", 0],
  ["dip", "Dip", "dips;parallel bar dip;chest dip;tricep dip;triceps dip;bar dips", "tr,ch,sh", "co", "", 0],
  ["ring-dip", "Ring Dip", "ring dips", "tr,ch,sh", "co,fa", "ot", 0],
  ["bench-dip", "Bench Dip", "bench dips;chair dip", "tr,ch", "sh", "bn", 0],
  ["landmine-press", "Landmine Press", "landmine presses;single arm landmine press", "sh,ch,tr", "co", "bb", 1],
  ["svend-press", "Svend Press", "plate squeeze press", "ch", "sh,tr", "ot", 0],

  // ---------- vertical push / shoulders ----------
  ["overhead-press", "Overhead Press", "ohp;military press;barbell shoulder press;bb overhead press;strict press;standing press;overhead presses", "sh,tr,co", "bk,ch", "bb", 0],
  ["seated-shoulder-press", "Seated Shoulder Press", "seated overhead press;seated barbell press", "sh,tr", "ch", "bb,bn", 0],
  ["dumbbell-shoulder-press", "Dumbbell Shoulder Press", "shoulder press;shoulder presses;db shoulder press;dumbbell overhead press;db overhead press;seated dumbbell press", "sh,tr", "co", "db", 0],
  ["machine-shoulder-press", "Machine Shoulder Press", "shoulder press machine;seated machine shoulder press", "sh,tr", "", "mc", 0],
  ["arnold-press", "Arnold Press", "arnold presses;arnolds", "sh,tr", "ch,co", "db", 0],
  ["push-press", "Push Press", "push presses", "sh,tr,qu", "gl,co", "bb,db", 0],
  ["handstand-push-up", "Handstand Push-Up", "handstand push ups;handstand pushup;hspu", "sh,tr", "co,bk", "", 0],
  ["lateral-raise", "Lateral Raise", "lateral raises;side raise;side lateral raise;lat raise;db lateral raise;dumbbell lateral raise;cable lateral raise", "sh", "bk", "db,cb", 0],
  ["front-raise", "Front Raise", "front raises;dumbbell front raise;db front raise;plate front raise", "sh", "ch,co", "db", 0],
  ["rear-delt-fly", "Rear Delt Fly", "rear delt flies;reverse fly;reverse flyes;rear delt raise;rear fly;bent over rear delt fly", "sh,bk", "", "db,cb", 0],
  ["upright-row", "Upright Row", "upright rows", "sh,bk,fa", "bi", "bb,db", 0],
  ["face-pull", "Face Pull", "face pulls;rope face pull", "sh,bk", "bi", "cb", 0],
  ["shrug", "Shrug", "shrugs;barbell shrug;dumbbell shrug;db shrug;trap shrug", "bk,fa", "sh", "bb,db", 0],
  ["band-pull-apart", "Band Pull Apart", "band pull aparts;pull aparts", "sh,bk", "", "rb", 0],
  ["arm-circles", "Arm Circles", "arm circle;shoulder circles", "sh", "bk", "", 0],

  // ---------- pull ----------
  ["pull-up", "Pull-Up", "pull up;pull ups;pullup;pullups;wide grip pull up", "bk,bi,fa", "co,sh", "pb", 0],
  ["chin-up", "Chin-Up", "chin up;chin ups;chinup;chinups;underhand pull up", "bk,bi", "fa,co", "pb", 0],
  ["assisted-pull-up", "Assisted Pull-Up", "assisted pullup;band assisted pull up;machine assisted pull up", "bk,bi", "fa,sh", "pb,mc", 0],
  ["muscle-up", "Muscle-Up", "muscle up;muscle ups;bar muscle up", "bk,tr,ch", "bi,fa,co", "pb", 0],
  ["scapular-pull-up", "Scapular Pull-Up", "scap pull up;scapular pull ups;scap pulls", "bk", "sh,fa", "pb", 0],
  ["dead-hang", "Dead Hang", "dead hangs;bar hang;hang", "fa,bk", "sh", "pb", 0],
  ["lat-pulldown", "Lat Pulldown", "lat pulldowns;lat pull down;pulldown;wide grip pulldown;cable pulldown", "bk,bi", "fa,sh", "cb,mc", 0],
  ["straight-arm-pulldown", "Straight Arm Pulldown", "straight arm pull down;lat pushdown", "bk", "tr,co", "cb", 0],
  ["bent-over-row", "Bent-Over Row", "bent over row;bent over rows;bentover row;barbell row;barbell rows;bb row;row;rows;pendlay row;bent over barbell row", "bk,bi,fa", "ha,co", "bb", 0],
  ["dumbbell-row", "Dumbbell Row", "dumbbell rows;db row;db rows;one arm row;single arm row;single arm dumbbell row;one arm dumbbell row;kroc row;gorilla row", "bk,bi", "fa,co", "db,bn", 1],
  ["seated-cable-row", "Seated Cable Row", "cable row;cable rows;seated row", "bk,bi", "fa,sh", "cb", 0],
  ["chest-supported-row", "Chest Supported Row", "incline row;chest supported dumbbell row;seal row", "bk,bi", "fa,sh", "db,bn", 0],
  ["t-bar-row", "T-Bar Row", "t bar row;tbar row;t bar rows", "bk,bi", "fa,ha", "bb,mc", 0],
  ["inverted-row", "Inverted Row", "inverted rows;body row;bodyweight row;australian pull up;ring row", "bk,bi", "fa,co", "pb", 0],
  ["machine-row", "Machine Row", "seated machine row;hammer strength row", "bk,bi", "fa", "mc", 0],
  ["renegade-row", "Renegade Row", "renegade rows;plank row;push up row", "bk,co,bi", "sh,fa", "db", 1],
  ["meadows-row", "Meadows Row", "landmine row", "bk,bi", "fa,co", "bb", 1],
  ["pull-over", "Pull-Over", "pullover;pullovers;dumbbell pullover;db pullover;lat pullover", "bk,ch", "tr,co", "db", 0],
  ["high-pull", "High Pull", "barbell high pull;kettlebell high pull", "sh,bk", "fa,qu", "bb,kb", 0],
  ["farmers-carry", "Farmer's Carry", "farmers carry;farmers walk;farmer carry;suitcase carry;loaded carry", "fa,co,bk", "sh,gl", "db,kb", 0],
  ["overhead-carry", "Overhead Carry", "overhead carries;waiter carry;overhead walk", "sh,co", "bk,fa", "kb,db", 0],

  // ---------- arms ----------
  ["dumbbell-curl", "Dumbbell Curl", "dumbbell curls;curl;curls;bicep curl;bicep curls;biceps curl;db curl;standing dumbbell curl", "bi,fa", "", "db", 0],
  ["barbell-curl", "Barbell Curl", "barbell curls;bb curl;straight bar curl", "bi,fa", "", "bb", 0],
  ["ez-bar-curl", "EZ Bar Curl", "ez curl;ez bar curls", "bi,fa", "", "bb", 0],
  ["hammer-curl", "Hammer Curl", "hammer curls;db hammer curl;neutral grip curl", "bi,fa", "", "db", 0],
  ["preacher-curl", "Preacher Curl", "preacher curls;scott curl", "bi", "fa", "bb,bn", 0],
  ["incline-dumbbell-curl", "Incline Dumbbell Curl", "incline curl;incline db curl", "bi", "fa", "db,bn", 0],
  ["concentration-curl", "Concentration Curl", "concentration curls", "bi", "fa", "db", 1],
  ["cable-curl", "Cable Curl", "cable curls;cable bicep curl;rope curl", "bi", "fa", "cb", 0],
  ["spider-curl", "Spider Curl", "spider curls", "bi", "fa", "db,bn", 0],
  ["zottman-curl", "Zottman Curl", "zottman curls", "bi,fa", "", "db", 0],
  ["drag-curl", "Drag Curl", "drag curls", "bi", "fa,bk", "bb", 0],
  ["reverse-curl", "Reverse Curl", "reverse curls;reverse grip curl", "fa,bi", "", "bb,db", 0],
  ["wrist-curl", "Wrist Curl", "wrist curls;forearm curl", "fa", "", "db,bb", 0],
  ["tricep-pushdown", "Tricep Pushdown", "tricep pushdowns;triceps pushdown;pushdown;rope pushdown;cable pushdown;tricep push down", "tr", "fa", "cb", 0],
  ["overhead-tricep-extension", "Overhead Tricep Extension", "overhead triceps extension;tricep extension;triceps extension;french press;overhead extension", "tr", "sh,co", "db,cb", 0],
  ["skull-crusher", "Skull Crusher", "skull crushers;skullcrusher;lying tricep extension;lying triceps extension", "tr", "fa", "bb,bn", 0],
  ["tricep-kickback", "Tricep Kickback", "tricep kickbacks;triceps kickback;db kickback", "tr", "sh", "db", 1],

  // ---------- core ----------
  ["plank", "Plank", "planks;forearm plank;front plank;plank hold;high plank;elbow plank", "co,sh", "gl,bk", "", 0],
  ["side-plank", "Side Plank", "side planks;side plank hold", "co", "sh,gl", "", 1],
  ["copenhagen-plank", "Copenhagen Plank", "copenhagen;copenhagen side plank", "co", "qu,gl", "bn", 1],
  ["plank-shoulder-tap", "Plank Shoulder Tap", "shoulder taps;plank shoulder taps;shoulder tap", "co,sh", "ch,gl", "", 0],
  ["hip-dip", "Hip Dip", "hip dips;plank hip dip;side plank hip dip", "co", "gl", "", 0],
  ["crunch", "Crunch", "crunches;ab crunch;abdominal crunch", "co", "", "", 0],
  ["reverse-crunch", "Reverse Crunch", "reverse crunches", "co", "", "", 0],
  ["cable-crunch", "Cable Crunch", "kneeling cable crunch;rope crunch", "co", "", "cb", 0],
  ["sit-up", "Sit-Up", "sit up;sit ups;situp;situps;full sit up", "co", "qu", "", 0],
  ["bicycle-crunch", "Bicycle Crunch", "bicycle crunches;bicycles;bicycle kicks", "co", "", "", 0],
  ["russian-twist", "Russian Twist", "russian twists;seated twist", "co", "sh", "mb", 0],
  ["leg-raise", "Leg Raise", "leg raises;lying leg raise;lying leg raises", "co", "qu", "", 0],
  ["hanging-leg-raise", "Hanging Leg Raise", "hanging leg raises;hanging leg lift", "co,fa", "qu,bk", "pb", 0],
  ["hanging-knee-raise", "Hanging Knee Raise", "hanging knee raises;knee raise;knee raises", "co,fa", "qu,bk", "pb", 0],
  ["toes-to-bar", "Toes to Bar", "toes to bars;ttb;t2b;toes 2 bar", "co,fa,bk", "sh,qu", "pb", 0],
  ["v-up", "V-Up", "v up;v ups;vups;v sit up", "co", "qu", "", 0],
  ["hollow-hold", "Hollow Hold", "hollow holds;hollow body hold;hollow rock;hollow rocks", "co", "qu", "", 0],
  ["dead-bug", "Dead Bug", "dead bugs;deadbug", "co", "", "", 0],
  ["bird-dog", "Bird Dog", "bird dogs;birddog", "co,bk,gl", "sh", "", 1],
  ["mountain-climber", "Mountain Climber", "mountain climbers;mtn climbers", "co,sh,fb", "qu", "", 0],
  ["flutter-kick", "Flutter Kick", "flutter kicks", "co", "qu", "", 0],
  ["scissor-kick", "Scissor Kick", "scissor kicks", "co", "qu", "", 0],
  ["heel-tap", "Heel Tap", "heel taps;lying heel tap", "co", "", "", 0],
  ["ab-wheel-rollout", "Ab Wheel Rollout", "ab rollout;ab wheel;rollout;barbell rollout;ab roller", "co", "bk,sh", "ot", 0],
  ["sit-through", "Sit Through", "sit throughs;bear sit through", "co,fb", "sh", "", 0],
  ["windshield-wiper", "Windshield Wiper", "windshield wipers", "co", "bk", "", 0],
  ["superman", "Superman", "supermans;supermen;superman hold", "bk,gl", "ha,sh", "", 0],
  ["pallof-press", "Pallof Press", "pallof presses;anti rotation press", "co", "sh,gl", "cb,rb", 0],
  ["dragon-flag", "Dragon Flag", "dragon flags", "co", "bk,gl", "bn", 0],
  ["l-sit", "L-Sit", "l sit;l sits;l sit hold", "co,tr", "sh,qu", "", 0],
  ["side-bend", "Side Bend", "side bends;dumbbell side bend;oblique side bend", "co", "bk", "db", 1],
  ["woodchop", "Woodchop", "woodchops;wood chop;cable woodchop;chop", "co", "sh,bk", "cb", 1],
  ["landmine-rotation", "Landmine Rotation", "landmine rotations;landmine twist", "co,sh", "bk", "bb", 0],
  ["bear-crawl", "Bear Crawl", "bear crawls", "co,sh,fb", "qu", "", 0],
  ["kettlebell-windmill", "Kettlebell Windmill", "windmill;windmills;kb windmill", "co,sh", "ha,gl", "kb", 1],
  ["kettlebell-halo", "Kettlebell Halo", "halo;halos;kb halo", "sh,co", "tr,bk", "kb", 0],

  // ---------- cardio / conditioning ----------
  ["running", "Running", "run;runs;jog;jogs;jogging;steady state run", "fb,ca", "qu,ha,gl", "", 0],
  ["sprint", "Sprint", "sprints;sprint intervals;hill sprint", "fb,qu", "ha,gl,ca", "", 0],
  ["treadmill-run", "Treadmill Run", "treadmill;treadmill running;incline treadmill walk", "fb,ca", "qu,ha,gl", "mc", 0],
  ["cycling", "Cycling", "bike;biking;cycle;stationary bike;spin bike", "qu,ca,fb", "gl,ha", "mc", 0],
  ["assault-bike", "Assault Bike", "air bike;echo bike;fan bike", "fb", "", "mc", 0],
  ["rowing-machine", "Rowing Machine", "rowing;indoor rowing;row erg;rower;erg;concept 2", "fb,bk", "qu,bi", "mc", 0],
  ["ski-erg", "Ski Erg", "skierg;ski machine", "fb,bk", "tr,co", "mc", 0],
  ["stair-climber", "Stair Climber", "stairmaster;stair master;stair stepper;stairs", "gl,qu,ca", "ha,co", "mc", 0],
  ["elliptical", "Elliptical", "cross trainer;elliptical machine", "fb", "", "mc", 0],
  ["jump-rope", "Jump Rope", "jump ropes;skipping;skipping rope;rope skipping", "ca,fb", "sh,fa", "jr", 0],
  ["double-under", "Double Under", "double unders;dubs", "ca,fb", "sh,fa", "jr", 0],
  ["burpee", "Burpee", "burpees;burpee to jump", "fb", "", "", 0],
  ["devils-press", "Devil's Press", "devils press;devil press", "fb", "", "db", 0],
  ["man-maker", "Man Maker", "man makers;manmaker", "fb", "", "db", 0],
  ["jumping-jack", "Jumping Jack", "jumping jacks;star jump;star jumps", "fb,ca", "sh", "", 0],
  ["high-knees", "High Knees", "high knee;running in place high knees", "qu,ca,co", "ha,gl", "", 0],
  ["butt-kicks", "Butt Kicks", "butt kickers;heel kicks", "ha,ca", "gl", "", 0],
  ["battle-ropes", "Battle Ropes", "battle rope;battling ropes;rope slams", "sh,co,fb", "fa", "ot", 0],
  ["sled-push", "Sled Push", "sled pushes;prowler push", "qu,gl,fb", "ca,co", "ot", 0],
  ["sled-pull", "Sled Pull", "sled pulls;sled drag", "bk,ha,fb", "fa", "ot", 0],
  ["shuttle-run", "Shuttle Run", "shuttle runs;suicides;line drill", "fb,qu", "ha,ca", "", 0],
  ["medicine-ball-slam", "Medicine Ball Slam", "medicine ball slams;ball slam;med ball slam;slam ball;slams", "fb,co,sh", "bk", "mb", 0],
  ["wall-walk", "Wall Walk", "wall walks", "sh,co", "tr,bk", "", 0],
  ["inchworm", "Inchworm", "inchworms;inch worm;walkout;inchworm walkout", "fb,co,ha", "sh,ch", "", 0],

  // ---------- glutes / hips / accessory ----------
  ["hip-abduction", "Hip Abduction", "abduction machine;hip abductor;seated hip abduction", "gl", "qu", "mc", 0],
  ["hip-adduction", "Hip Adduction", "adduction machine;hip adductor;seated hip adduction", "qu", "ha", "mc", 0],
  ["clamshell", "Clamshell", "clamshells;clam shell;banded clamshell", "gl", "", "rb", 1],
  ["fire-hydrant", "Fire Hydrant", "fire hydrants", "gl", "co", "", 1],
  ["donkey-kick", "Donkey Kick", "donkey kicks;glute kickback;glute kickbacks;cable kickback", "gl", "ha", "", 1],
  ["banded-walk", "Banded Walk", "banded walks;monster walk;lateral band walk;banded lateral walk", "gl", "qu", "rb", 0],
  ["frog-pump", "Frog Pump", "frog pumps", "gl", "ha", "", 0],
  ["side-lying-leg-raise", "Side Lying Leg Raise", "side leg raise;side lying leg lifts;lying side leg lift", "gl", "co", "", 1],
  ["leg-swing", "Leg Swing", "leg swings", "ha,gl", "qu", "", 1],
  ["hip-circle", "Hip Circle", "hip circles", "gl", "co", "", 0],

  // ---------- mobility / yoga ----------
  ["downward-dog", "Downward Dog", "downward facing dog;down dog;adho mukha svanasana", "sh,ha,ca", "bk,co", "", 0],
  ["childs-pose", "Child's Pose", "childs pose;child pose;balasana", "bk", "sh", "", 0],
  ["cat-cow", "Cat-Cow", "cat cow;cat camel;cat cow stretch", "bk,co", "", "", 0],
  ["cobra-stretch", "Cobra Stretch", "cobra pose;cobra;upward dog;upward facing dog", "bk,co", "ch,sh", "", 0],
  ["pigeon-pose", "Pigeon Pose", "pigeon stretch;pigeon", "gl", "bk", "", 0],
  ["hip-flexor-stretch", "Hip Flexor Stretch", "hip flexor stretches;couch stretch;kneeling hip flexor stretch", "qu,gl", "", "", 1],
  ["hamstring-stretch", "Hamstring Stretch", "seated hamstring stretch;standing hamstring stretch", "ha", "ca,bk", "", 0],
  ["worlds-greatest-stretch", "World's Greatest Stretch", "worlds greatest stretch;greatest stretch;wgs", "fb", "", "", 1],
  ["thread-the-needle", "Thread the Needle", "thread needle;thread the needle stretch", "bk,sh", "ch", "", 1],
  ["sun-salutation", "Sun Salutation", "sun salutations;surya namaskar", "fb", "", "", 0],
];

function codesTo(map: Record<string, string>, csv: string, what: string): string[] {
  if (!csv) return [];
  return csv.split(",").map((c) => {
    const v = map[c.trim()];
    if (!v) throw new Error("catalog: unknown " + what + " code " + JSON.stringify(c));
    return v;
  });
}

export const CATALOG: CatalogEntry[] = ROWS.map(([id, name, aliases, mus, sec, eq, uni]) => ({
  id,
  name,
  aliases: aliases ? aliases.split(";").map((a) => a.trim()).filter(Boolean) : [],
  muscles: codesTo(MUSCLE_CODES, mus, "muscle"),
  secondary: codesTo(MUSCLE_CODES, sec, "muscle"),
  equipment: codesTo(EQUIP_CODES, eq, "equipment"),
  unilateral: uni === 1,
}));

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

/**
 * Map a model-produced exercise name to a catalog entry.
 * Returns null when nothing clears MATCH_FLOOR — callers store canonical_id: null
 * and keep the raw name, rather than guessing.
 */
export function canonicalize(rawName: string | null | undefined): Match | null {
  if (!rawName || typeof rawName !== "string") return null;

  const norm = normalizeText(rawName);
  if (!norm) return null;

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

  let bestId = "";
  let bestScore = 0;
  for (const sets of entryTokenSets) {
    for (const s of sets) {
      const score = f1(toks, s.tokens);
      if (score > bestScore) { bestScore = score; bestId = s.id; }
    }
  }
  if (!bestId || bestScore < MATCH_FLOOR) return null;
  return { id: bestId, entry: BY_ID.get(bestId)!, confidence: Math.round(bestScore * 100) / 100, method: "fuzzy" };
}

/** Convenience for callers that only want the id. */
export function canonicalIdFor(rawName: string | null | undefined): string | null {
  const m = canonicalize(rawName);
  return m ? m.id : null;
}
