// The three Spotter Starters, as the server writes a kept copy (B.2). The app reads the
// same three from docs/assets/starters.json, which ships inside both native bundles;
// tools/goals-harness.mjs fails if the two ever differ. A kept copy is written from
// THIS list, never from anything a client sends: the client names a key, nothing more.
//
// Every movement is a catalog id with a demo clip, and nothing here needs a model.

export type Starter = {
  key: "bodyweight" | "dumbbells" | "gym"; title: string; where: string; minutes: number; category: string;
  equipment: string[]; muscle_groups: string[];
  blocks: { title: string | null; type: string; rounds: number | null; rest_seconds: number | null;
    exercises: { name: string; canonical_id: string; sets: number; reps?: string; duration_seconds?: number; rest_seconds: number; cue: string;
      // The catalog's own clip (row zero of exercise_demo_videos, what /api/demo-video answers), so a
      // guest sees how a movement goes with no account and no server call (app.ts starterDemo).
      demo?: { id: string; title: string; channel: string; secs: number | null } }[] }[];
};

export const STARTERS: Starter[] = [
  {
    "key": "bodyweight",
    "title": "Bodyweight Starter",
    "where": "home",
    "minutes": 20,
    "category": "Full Body",
    "equipment": [],
    "muscle_groups": [
      "quads",
      "glutes",
      "chest",
      "core"
    ],
    "blocks": [
      {
        "title": null,
        "type": "straight",
        "rounds": null,
        "rest_seconds": null,
        "exercises": [
          {
            "name": "Bodyweight Squat",
            "canonical_id": "bodyweight-squat",
            "sets": 3,
            "reps": "12",
            "rest_seconds": 45,
            "cue": "Sit back and down, chest tall, heels flat.",
            "demo": {
              "id": "BKU3FCkS3-k",
              "title": "Body Weight Squat",
              "channel": "MuscleWiki",
              "secs": 13
            }
          },
          {
            "name": "Push-Up",
            "canonical_id": "push-up",
            "sets": 3,
            "reps": "8",
            "rest_seconds": 45,
            "cue": "Hands under shoulders, body in one line. Knees down is fine.",
            "demo": {
              "id": "mm6_WcoCVTA",
              "title": "Pushup",
              "channel": "Renaissance Periodization",
              "secs": 11
            }
          },
          {
            "name": "Reverse Lunge",
            "canonical_id": "reverse-lunge",
            "sets": 3,
            "reps": "8 each leg",
            "rest_seconds": 45,
            "cue": "Step back, lower the back knee, drive up through the front heel.",
            "demo": {
              "id": "TQfhY5oJ_Sc",
              "title": "Reverse Lunge",
              "channel": "Renaissance Periodization",
              "secs": 11
            }
          },
          {
            "name": "Glute Bridge",
            "canonical_id": "glute-bridge",
            "sets": 3,
            "reps": "12",
            "rest_seconds": 45,
            "cue": "Squeeze at the top and hold for a second.",
            "demo": {
              "id": "1PzFtQZhIgU",
              "title": "Glute Loop Glute Bridges",
              "channel": "Functional Bodybuilding",
              "secs": 11
            }
          },
          {
            "name": "Plank",
            "canonical_id": "plank",
            "sets": 3,
            "duration_seconds": 30,
            "rest_seconds": 30,
            "cue": "Elbows under shoulders, ribs down, keep breathing.",
            "demo": {
              "id": "P3FR4GUl2QM",
              "title": "Plank",
              "channel": "Catalyst Athletics",
              "secs": 57
            }
          }
        ]
      }
    ]
  },
  {
    "key": "dumbbells",
    "title": "Dumbbell Starter",
    "where": "both",
    "minutes": 25,
    "category": "Full Body",
    "equipment": [
      "dumbbells"
    ],
    "muscle_groups": [
      "quads",
      "glutes",
      "chest",
      "back",
      "shoulders",
      "hamstrings"
    ],
    "blocks": [
      {
        "title": null,
        "type": "straight",
        "rounds": null,
        "rest_seconds": null,
        "exercises": [
          {
            "name": "Goblet Squat",
            "canonical_id": "goblet-squat",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 60,
            "cue": "Hold one dumbbell at your chest, elbows inside the knees at the bottom.",
            "demo": {
              "id": "OmPAYXdeRAo",
              "title": "Goblet Squat",
              "channel": "MuscleWiki",
              "secs": 26
            }
          },
          {
            "name": "Dumbbell Floor Press",
            "canonical_id": "dumbbell-floor-press",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 60,
            "cue": "Lie on the floor, upper arms touch down, press straight up.",
            "demo": {
              "id": "6G-fNatzuSk",
              "title": "Floor Press",
              "channel": "CrossFit",
              "secs": 33
            }
          },
          {
            "name": "Dumbbell Row",
            "canonical_id": "dumbbell-row",
            "sets": 3,
            "reps": "10 each arm",
            "rest_seconds": 60,
            "cue": "Hand on a knee or a chair, pull the bell to your hip.",
            "demo": {
              "id": "QvJZNnUcbsQ",
              "title": "Dumbbell Row",
              "channel": "MuscleWiki",
              "secs": 19
            }
          },
          {
            "name": "Dumbbell Romanian Deadlift",
            "canonical_id": "romanian-deadlift",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 60,
            "cue": "Soft knees, push the hips back, bells close to your legs.",
            "demo": {
              "id": "_U9KjljQyd0",
              "title": "Romanian Deadlift (RDL)",
              "channel": "Catalyst Athletics",
              "secs": 84
            }
          },
          {
            "name": "Dumbbell Shoulder Press",
            "canonical_id": "dumbbell-shoulder-press",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 60,
            "cue": "Ribs down, press up until your arms are straight.",
            "demo": {
              "id": "Raemd3qWgJc",
              "title": "Standing Dumbbell Shoulder Press",
              "channel": "Renaissance Periodization",
              "secs": 11
            }
          },
          {
            "name": "Plank",
            "canonical_id": "plank",
            "sets": 2,
            "duration_seconds": 40,
            "rest_seconds": 30,
            "cue": "Elbows under shoulders, ribs down, keep breathing.",
            "demo": {
              "id": "P3FR4GUl2QM",
              "title": "Plank",
              "channel": "Catalyst Athletics",
              "secs": 57
            }
          }
        ]
      }
    ]
  },
  {
    "key": "gym",
    "title": "Gym Starter",
    "where": "gym",
    "minutes": 35,
    "category": "Full Body",
    "equipment": [
      "barbell",
      "bench",
      "cables",
      "machine"
    ],
    "muscle_groups": [
      "quads",
      "glutes",
      "chest",
      "back",
      "hamstrings"
    ],
    "blocks": [
      {
        "title": null,
        "type": "straight",
        "rounds": null,
        "rest_seconds": null,
        "exercises": [
          {
            "name": "Back Squat",
            "canonical_id": "back-squat",
            "sets": 3,
            "reps": "8",
            "rest_seconds": 120,
            "cue": "Bar on your upper back, brace, sit down between your heels.",
            "demo": {
              "id": "i7J5h7BJ07g",
              "title": "High Bar Squat",
              "channel": "Renaissance Periodization",
              "secs": 10
            }
          },
          {
            "name": "Bench Press",
            "canonical_id": "bench-press",
            "sets": 3,
            "reps": "8",
            "rest_seconds": 120,
            "cue": "Feet down, shoulder blades pinned, touch the lower chest.",
            "demo": {
              "id": "gMgvBspQ9lk",
              "title": "Medium Grip Bench Press",
              "channel": "Renaissance Periodization",
              "secs": 13
            }
          },
          {
            "name": "Lat Pulldown",
            "canonical_id": "lat-pulldown",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 90,
            "cue": "Pull the bar to your upper chest, elbows down and back.",
            "demo": {
              "id": "YCKPD4BSD2E",
              "title": "Wide Grip Pulldown",
              "channel": "Renaissance Periodization",
              "secs": 15
            }
          },
          {
            "name": "Leg Curl",
            "canonical_id": "leg-curl",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 90,
            "cue": "Slow on the way back, hips stay down.",
            "demo": {
              "id": "Orxowest56U",
              "title": "Seated Leg Curl",
              "channel": "Renaissance Periodization",
              "secs": 11
            }
          },
          {
            "name": "Seated Cable Row",
            "canonical_id": "seated-cable-row",
            "sets": 3,
            "reps": "10",
            "rest_seconds": 90,
            "cue": "Sit tall, pull to your stomach, squeeze your shoulder blades.",
            "demo": {
              "id": "UCXxvVItLoM",
              "title": "Seated Cable Row",
              "channel": "Renaissance Periodization",
              "secs": 18
            }
          }
        ]
      }
    ]
  }
];
