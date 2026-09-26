# B.2 — a one-tap front door, and goals Pumpy turns into a calendar (September 2026)

Follow-up to Option B ("Train is home", `design/SIMPLIFY-B-2026-09.md`). Two jobs, both from the owner's 25 September
asks: a new person gets from the App Store to a first logged set with nothing in the way, and "get my bench to 305" or
"lose 10 lb" becomes dated weeks on the calendar that Up next, Workout Mode's Log set and the Lock Screen follow.

Branch `simplify-b2`, iOS build 11. Design source: the "B.2" section of the review artifact
(https://claude.ai/artifact/JipkBFW48WBnQ6tMDeK5Wz); the cycle prompt is authoritative where they differ.

## Tap counts (iPhone 16e; a tap is a touch on a control, typing listed apart)

| Journey | Before (build 10) | After (build 11) |
|---|---|---|
| Open → signed in, Apple | 3 (scroll, button, Apple's sheet) | **1** + Apple's sheet |
| Open → signed in, returning email + password | 4 + typing | 3 + 2 typings |
| New user → first set logged | ~10 + waiting for a video to be read | **3**, no account (Try a workout first → a starter → Log set 1); 6 + 2 typings through a sign-up and S6's starter |
| Goal chip → program on the calendar | impossible on Basic; Plus ≈ 5 sends + typing | **3** on Basic and Plus (chip · Build my plan · Build my plan); a brand-new account adds Allow AI processing once |

Measured by the QA agent (`briefs/simplify-b2/qa/QA.md`): the real build signed out on the 16e, and the lab inside
the app for every signed-in journey. No credential was ever typed into an app that talks to production.

## The first-run bug (Phase 0), and what it was
A new account signed up on a launch that had held a deleted account's session sat on Up next's skeleton, with no week
ring, until a relaunch. Offline, with the real supabase-js against a fake Supabase, it never reproduced (80+ walks).
The project's edge logs did: a second after the sign-up minted its token, PostgREST refused that account's first
`workout_logs` read once (401 PGRST303, a token dated a moment ahead of its clock); every other read answered. The app
toasted, gave up, and drew Up next without logs; the logs a later render fetched never redrew Train. The deleted
session was a coincidence. Fixed: a failed history or plan read is tried once more (as the library's read always was),
and a net asks again for anything missing if Up next is still loading eight seconds on. `tools/firstrun-harness.mjs`
walks the sign-up with that read refused once — it fails without the fix and passes with it — beside its controls,
the web and the native (Keychain) paths, in `verify:local` and CI. The same logs showed the hourly reminder tick
getting the same 401 (already retried by `rest.ts`), and the function's own reads now take that retry too.

## Independent review and QA (fresh agents, neither wrote any of it)
- **Review** (`briefs/simplify-b2/REVIEW.md`): fix first — 19 bugs, 9 gaps. The two highs: a program followed exactly
  read "Behind" and lightened its later weeks (Epley on the program's own sub-maximal sets reads under the real max;
  now a week's loads never drop below the baseline on an estimate, a lift is behind on missed sessions, and the card's
  bar is the block's sessions); and "I eat 1,500 calories" got the eating-disorder line (numbers are read whole now).
  Also fixed: heights and weights read as ages; the program's own text now passes the chat's filter and titles never
  state a pace; "pre-workout warm-up" read as a supplement; everyone new counted as a novice; the model's body weight
  beating the person's; the adult/max/weight answers read only under one id; "used" copy when no plan was built; Undo
  missing moved days (new migration `20260926120000`); safety flags forgotten after ten messages; and the client
  half (below).
- **QA** (`briefs/simplify-b2/qa/QA.md`): 9 of 10 rows passed on the first walk; the fat-loss reframe failed because
  the model wrote the pounds to lose as the goal weight. Fixed in the server (and the prompt), and re-run live: "Lose
  10 pounds in a month" → the ask card (weight, "Are you 18 or older?" unanswered) → 200 → 190 lb over 8 weeks,
  1.25 lb a week, the CDC and NHS links and the medical line, no calorie number anywhere. QA also found the recap's
  Done reloading the whole page on the first workout's last tap (there since build 9) — fixed.

## Screens (`design/simplify-b2/`, 375 × 812, light and dark)
Rendered from the offline lab (the app's built page with a fake data layer; no account, no network), so the numbers are
the lab's fixtures. The web lab has no Apple sheet, so `01-landing` unhides the Apple button the iOS app draws;
everything else is as rendered. Before-screens from the iPhone 16e on build 10 are `before-*.jpg`.

| | |
|---|---|
| `01-landing` | One screen: the brand row and headline, the three-frame loop (share a reel → Spotter reads it → you do it), Continue with Apple / Google / email, the legal line with the creator-code fold, "Try a workout first". Before: Apple and Google only after scrolling, under an email form (`before-01`, `before-02`). |
| `02-email` | The card's second face: one field and Continue (a six-digit code by mail); "Use a password instead" and "Forgot password?" always there. |
| `03-intent` | A new account's one question screen, skippable: what for, where. |
| `04-train-first-doors` | S6 with three doors: Add video, "Try one now: Bodyweight Starter · 20 min · No equipment" + "2 more", "Set a goal with Pumpy". |
| `05-starter-picker` | The three Spotter Starters, each with Keep. |
| `06-pumpy-goal-chips` | Pumpy's empty chat opens on outcomes: "What are we working toward?", four goal chips with the "1 free plan" badge on Basic, two quiet links marked Plus. Before: the Plus card on top and four fixed asks below the fold (`before-05`). |
| `07-ask-card` | One compact form for what the coach can't infer; the pre-filled max says where it came from. |
| `08-program-card` | The program as the server expanded it: the verdict pill ("Too fast") and its honest note, the weeks with each day's numbers, Show all, Not now / Build my plan. |
| `09-train-goal` | Up next on a program day ("W2 · Build · 5×5 @ 220 lb") and the goal card (status pill, "est. 286 → 295 lb · week 2 of 8", the bar with the plan's tick). |
| `10-goal-sheet` | The card opened: from and to by when, the dream and the block, the note, this program week's days, Adjust with Pumpy, End goal. |
| `11-workout-mode-rx` | Workout Mode on that day: "W2 Build · Goal 5 × 5 @ 220 lb", the big button "Log set 1 · 5 × 220 lb" (the set sheet and the Lock Screen's dial read the same number). |
| `12-free-plan-offer` | Basic's free plan on the calendar, and the Plus offer right under it. |

## The client (three build agents, merged into `simplify-b2`)
- **The front door** (b2-door): the landing above; the email face (codes on: `PUBLIC_AUTH.emailCode = true`, the
  password path behind "Use a password instead", "Create an account with this email" offered only after a password
  that signed nobody in, in words that never say whether the address has an account); the web app's sign-in retired
  (Google's script, Apple's JS pop-up, the nonce juggling, the redirect fallback, `linkProblem`) — both providers
  sign in through the phone's own sheet, and Apple's grant still reaches the server, so deleting an account still
  revokes it. The intent screen (`settings.intent`). Spotter Starters: run from S6, the picker, or — with no account —
  "Try a workout first"; a guest's session stays on the phone and the first sign-in saves it as an ordinary log. The
  first plan offers training-day reminders on a button that does not say Allow, before the system's own ask.
  "Workouts per week" everywhere.
- **Pumpy's goal front** (b2-pumpy-ui): the goal chips and quiet links from `goalStarters()`; the ask card (segmented
  control, chips, the set sheet's stepper, date chips + the phone's picker; "Are you 18 or older?" never pre-selected);
  the program card; confirm → Train at once, Undo on the toast; Basic's free plan, the Plus offer under it, and the
  static preview once it is spent (no request, no AI); `openGoalChat`.
- **Goals on Train** (b2-goal): the goal card and sheet; a program day's numbers from Up next to Workout Mode, the set
  sheet and LiveState's `dose` (the Lock Screen and the Island, proven on the iPhone 17 Pro); Move / Do it today / Swap
  keep them where they still mean something, Copy week never copies them; End goal with Undo; the weekly check-in in
  the recap; Body weight in Settings and the weigh-in.
- **Mine at integration:** the goal-status seam says "upcoming" before a program starts; a program's reminder offer
  waits for the next arrival on Train; the ask card says where a pre-filled number came from only when it knows;
  keeping a starter gives its earlier card-less sessions the kept card (server, deployed and live-checked).

## Page size
`web-dist/index.html`: main 872,635 B → B.2 850,710 B (**−21.9 KB net**). The cycle's features cost about +57 KB (the
seams +15.2, goals on Train +13.9, the front door +9.6 after retiring the web sign-in and the old landing, Pumpy's goal
front +19.4 after retiring the fixed asks and Basic's offer card). `build.mjs` now drops the printer's leading
indentation from the script and the style (−79 KB): every line stays where it was, so a stack trace still finds its
line, and it is safe only because esbuild never lets a token span a line — the build refuses a backtick to keep it so.

## The server and the data (additive; builds 5–10 unchanged)

**Migration `20260926100000_goals_programs.sql`** (applied 26 Sept):
- `plan.prescription` (nullable jsonb object, ≤ 2 KB): what a program day asks of its goal lift — week, label,
  exercise, sets, reps, pct, the load worked out from the baseline, rpe, note, goal_id. Builds 5–10 read `plan` with
  `select *` and never read the key (`loadPlan`, `planShape`, the Train cache and the widget summary all take named
  fields), so they are unaffected.
- `goals`: one row per goal, one active per person (a unique partial index), owner-only RLS. The person may read their
  goals and move one between active and ended (End goal and its Undo); only the server inserts, and nobody deletes.
- `profiles.free_goal_thread` / `free_goal_at`: the ledger of Basic's one free program — which conversation the server
  gave it. A service-role-only column: the client can neither read-modify nor reset it.
- `guard_workout_library`: a kept Spotter Starter (`kind 'starter'`) and a program's own workouts (`kind 'program'`) are
  neither refused at the Basic cap nor counted toward it; the API's `libraryCount` agrees.
- `confirm_pumpy_proposal` + kind `program`, one transaction: every check before the first write (a refusal changes
  nothing); ends the active goal and takes its future days off (kept for Undo); makes the program's new workouts; writes
  the goal and its dated days; a day already planned by hand with the same workout takes the program's numbers instead
  of a second copy. Retries return the same receipt. Its receipts now say Workouts and Train (it said "library" and "the
  Plan tab", B's leftover).
- `undo_pumpy_program`: within 15 minutes, removes exactly what the confirm wrote, marks the goal undone (which gives
  Basic's free conversation back) and restores whatever the program replaced.

**The function** (v203, deployed 26 Sept from `simplify-b2`):
- **The capability flag.** A build sends `caps: ["ask","program"]` with every Pumpy turn. Only then does the prompt
  carry the goals section (a second static block, so the cache prefix stays whole), and only then may the model's reply
  carry an ask card or a program. A build without it gets byte-for-byte the prompt it had; an ask it cannot draw is said
  as a sentence; a program is not a proposal kind for it (tests: the truncation harness, section 9).
- **`get_lift_history {exercise}`**: best sets, the estimated max per week over 12 weeks, the formula named (Epley,
  sets of ten or fewer, eight weeks, near-max sets preferred, ±10 %), and whether the person is new to the lift. The
  app's goal chip ("your best ~287") and the server's baseline use the same rule and are tested to agree.
- **The snapshot** adds INTENT, BODY WEIGHT (only if typed), EST. MAXES and the ACTIVE GOAL for goal-capable builds.
- **The ask card** (`meta.ask`): ≤ 6 fields of choice / number / date, pre-filled where known; "Are you 18 or older?"
  is never pre-filled. Submitting sends one readable message plus `answers` + `ask_id`; the server keeps only the
  answers to questions that were asked and marks the card answered.
- **The program** (`kind: "program"`): the model writes weeks of weekday + template + prescription; the server dates
  every day from `start` (calendar dates, so no daylight change can move one), puts each load on a plate, caps a block at
  12 weeks and 6 days a week, checks each prescription against the workout it rides on, and holds it to the honesty
  rules below. The expanded program is what the card shows and what the confirm writes.
- **Basic's one free program** (owner decision): a build with `caps` may open ONE goal conversation; the server claims
  it in `profiles.free_goal_thread`, counts its model turns (8) in `saves_log` (so deleting the thread does not reset
  them), refuses any other kind of proposal in it, and refuses everything else with the Plus answer. `/api/limits`
  reports `free_program: available | open | used`.
- **`/api/pumpy/undo`**, **`/api/starters/keep`** (writes the kept copy from the server's own list, `starters.ts`, once
  per starter; the client names a key and nothing else).

## Honesty and safety (enforced in the prompt AND in code)

| Case | What happens | Where |
|---|---|---|
| A lift goal inside the typical range | realistic | `goals.ts liftVerdict` |
| Up to 1.5× the top of the range | stretch | same |
| Beyond | too fast → a milestone block toward what the range reaches; the goal is stated with how long it usually takes; a test week ends the block. Never a refusal. | same |
| Fat loss | ≤ 1 % of body weight and ≤ 2 lb (0.9 kg) a week; faster becomes the cap's plan with the goal stated; always the not-medical-advice line and the CDC and NHS links; "training keeps muscle, the scale mostly follows food"; a daily steps or cardio target and a weekly weigh-in; adults only (asked, never pre-filled) | `fatVerdict`, `expandProgram` |
| Signs of disordered eating (a very-low-calorie day in the person's words, purging, not eating…) | a supportive line pointing to real help (ANAD's helpline + 988 in the US, Beat + 999/Samaritans in the UK, a local charity elsewhere), no plan, no weight talk after it | `safetyCheck`, before any model |
| Under 18 asking to lose weight | a kind line; strength and fitness offered instead; no weight-loss program in that conversation | same |
| Medication or supplements | "I can't advise on medications or supplements — a doctor or pharmacist can…" | same |
| A calorie number to eat, or a supplement to take, in anything the model writes | the sentence is dropped (and taken back live while streaming) | `cleanCoachText`, `makeSayGate` |

Typical progress, as both the prompt and the code read it: an intermediate adds about 2–5 lb a month to a press (the
spec's range) and, our extrapolation, about 3–8 lb to a squat or a pull from the floor; roughly twice that in someone's
first months (fewer than six sessions with the lift in twelve weeks); even competitive lifters gain only about
10–13 kg a year (Latella et al. 2022). The spec's example holds exactly: 287 → 305 in eight weeks is too fast; the block
aims for 295 and says "305 usually takes about 4–9 months from an estimated 287".

Sources checked on 25 September 2026 (research report `briefs/simplify-b2/RESEARCH-DESIGN.md` §5): CDC "Steps for
Losing Weight" (about 1–2 lb a week are more likely to keep it off); NHS "Overweight and obesity" (0.5–1 kg a week — the
old NHS weight-loss-plan URL now 404s); FTC "Gut Check" (more than 3 lb a week for over 4 weeks is a claim that cannot be
true); NEDA (no longer runs a helpline), ANAD (888-375-7767), 988 Lifeline, Beat (0808 801 0677, weekdays 3–8 pm);
NIH ODS on weight-loss supplements; AAP guidance via Stanford Medicine on teens and weight.

## Checks (server half)
- `tools/goals-harness.mjs` — 53 checks, Node only: goal chips, the estimated max (app and server agree), prescriptions,
  goal status, program expansion across a month end and both 2026 daylight changes, plate rounding, the 12-week cap,
  the verdicts (the spec's 287 → 305 example exactly), the fat-loss cap and the FTC line, the five red-team prompts with
  recorded model outputs, the ask card, the capability flag, the free-program states, the starters.
- `tools/goals-db-check.mjs` — 46 checks on every migration replayed in PGlite: confirm and its retry, the free program
  once and refused twice, Undo inside and after 15 minutes, a program replacing a goal and Undo restoring it, an
  attached hand-planned day, a vanished workout refused with nothing changed, RLS on goals, the ledger, the library
  cap's exemptions, old builds' plan inserts. It caught one bug before production (a day with no prescription was
  stored as an array).
- `tools/pumpy-truncation-harness.ts` section 9 — a 12-week, 4-day program is ≈ 1,950 tokens against a 6,000 cap;
  no caps, no program; an ask card with and without the cap.
- Live, on a Basic throwaway (26 Sept, ≈ $0.003): the medication line with no model call; a bench goal → an ask card
  (start and max pre-filled) → a 12-week, 48-session program (the kept Gym Starter plus two new workouts, loads on
  plates, a test single at the block target) → confirm → a second goal refused before any model → Undo → the free plan
  back. Evidence `briefs/simplify-b2/evidence/server/`.
