# Handoff: the Train tab (Plan + Progress merged)

Built on branch `train`, 16 Sept 2026 — see `briefs/BRIEF-TRAIN.md` for the decisions that
filled the gaps.

Owner decision, 16 September 2026: "I like that train tab." Build it in a fresh session from this
file alone. Mockups: https://claude.ai/artifact/FuKP8v7qXPfcJajXVbTgTa (editable canvas) and the
same artboards as source in `design/train-tab-mockups/` (`Main.dc.html` = Calendar segment,
`TrainProgress.dc.html` = Progress segment, `TabBar.dc.html` = the bar before and after; the two
`Direction*.dc.html` files are the rejected alternates, kept for the reasoning).

## What it is
One tab, **Train**, replaces Plan and Progress. Top to bottom:
1. **Header** (collapses on scroll): eyebrow "Week 38", title "Train"; on the right the streak
   ("6 wk · 1 freeze") and the existing week ring (`.ringwrap`/`.wring`, 84 px).
2. **7-day strip**: day letter, date, one dot per day — hollow ember = planned, filled ember = done,
   filled with a ring = done as planned (the completed log's `workout_id` equals the plan row's),
   hollow warn = planned in the past and not done, sand = nothing. Today's cell is a white card with
   an ember border. Swiping the strip changes the week for everything below.
3. **Today card** (`.daycard.today`): the planned workout with thumbnail, title, "@creator · 15 min
   AMRAP · kettlebell", **Start workout** (existing start flow) and a ghost **Move**; overflow menu
   carries Copy week and Build with Pumpy (the existing prefilled-composer entry). Rest day: "Rest day —
   add one, or ask Pumpy".
4. **Segmented control** (`.seg`, sticky under the header): **Calendar · Progress · Records**. The
   last segment is remembered in `profiles.settings.trainSeg`.
   - *Calendar*: the existing month grid (`renderMonth`, `.mcell`) with past and future in one view and
     the same dot language; header row = month name + Copy week + Build with Pumpy pills. Tapping a day
     opens the existing `#daysheet`, which now lists that day's finished session(s) (→ `openSession`,
     the full summary after the recap wave) above the planned one; drag-to-move and copy-week stay.
   - *Progress*: "Muscles this week" card (existing anatomical body map, scoped to the strip's week),
     "Sets per day" bars for the week (new, tiny), then "Finished sessions" list (`renderHistoryInto`)
     with an "All" link.
   - *Records*: PR list, then achievements (existing).
5. **Tab bar**: three tabs — Workouts · Train · Pumpy. Train's icon = calendar with a check (see
   `TabBar.dc.html`).

## Why (research, 16 Sept)
Plan-first apps (TrainingPeaks, Intervals.icu, Garmin Connect, Runna, Centr) keep planned and
completed in ONE calendar and treat it as the hub; stats stay one tap away (a segment or a
dashboard tab). Apps that merged and buried stats — MyFitnessPal (April 2026, Diary → Today) and
Fitbit/Google Health (May 2026) — got one-star campaigns and rolled features back. Peloton's May-2025
profile is the closest precedent for the segmented shape (Progress | History | Achievements). Three
tabs is the norm for Oura, Apple Fitness and Hevy; Apple HIG: 3–5 tabs, each extra one costs.

## Where the code is (main `9db7698`, 16 Sept)
- Tab bar markup `supabase/functions/spotter/markup.ts` ≈ 223–229 (`data-view="plan"` /
  `"progress"`); pages `#planview` / `#progressview` ≈ 201–202; `VIEWS = ["library","plan",
  "progress","pumpy"]` in `app.ts` ≈ 12677; `setView(v)` ≈ 12862; the pager assumes four pages
  (`.track`, `--x`, `inert`, `.tabpill { width: calc((100% - 12px) / 4) }`, `.tab:nth-child(n) { --i }`
  in `style.ts` ≈ 1185–1215) — every "4" there becomes "3".
- Plan: `loadPlan` ≈ 7564 (queries `plan` + `workout_logs` for the range), `renderPlan` ≈ 7833,
  `renderWeek` ≈ 7926, `renderMonth` ≈ 7980, `.weekbar`, `.seg`/`.segpill`/`.segbtn`, `.mcell`,
  `#daysheet`, `#copysheet`, the "Build a program with Pumpy" prefill.
- Progress: `renderProgress` ≈ 8858 (ring, streak, body map, records, achievements),
  `renderHistoryInto` ≈ 9164, `openSession` ≈ 9104 (after the recap wave: the full summary).
- Data: `plan` rows `{day, workout_id}`; `workout_logs` `{started_at, completed_at, workout_id,
  entries}` (a session counts only with `completed_at` and a logged set); `achievements`.
- Design tokens: `style.ts` `:root` (paper #F5F6F8, card #FFFFFF, sand #E9ECF1, ink #14171A,
  ink-2 #58626E, muted #68727E, ember #E8551F, ember-ink #BE3F0E, ember-soft #FDEDE6, good #178055,
  warn #C98A00); display font Cabinet Grotesk, body Inter; radii 11/14/16/18; motion tokens
  `--t-1…4`, `--e-out/--e-spring/--e-soft/--e-in`.

## Rules for the build
- Research-first is done (above); polish is not optional: transitions on the tokens for the segment
  swap (the existing `.segpill` spring), the week-strip swipe (reuse the plan week-bar swipe with
  `data-noswipe`), both colour schemes, reduced motion, nothing clipping at 375 px, 44 px targets.
- Do not bury the stats: the segmented control is the mitigation the research found; never put
  Pumpy cards above the ring/strip. Keep deep links: `plan` and `progress` remain accepted view
  names that open Train on the Calendar / Progress segment.
- The Workouts tab and Pumpy are untouched. The old Plan and Progress pages are removed, not hidden.
- Page budget: this replaces two views, so net growth should be ≤ 0 KB; measure `docs/index.html`.
- Template modules only (`app.ts`, `markup.ts`, `style.ts`); `node build.mjs` after every edit;
  no backticks or `${` inside the templates; PR against protected `main` (CI: `verify` +
  `native-parity`), rebase before merge.

## Acceptance
- Fixture account with a planned week (3 days), two finished sessions (one as planned, one
  unplanned), one missed planned day: the strip shows filled-with-ring, filled, hollow-warn and
  hollow dots correctly; the month grid agrees.
- Segment memory survives a reload; `plan`/`progress` deep links land on the right segment.
- Day sheet lists the finished session and opens the summary; Copy week and Build with Pumpy work
  from both the Today card overflow and the Calendar header.
- Screenshots at 375×812 light and dark for both segments and the day sheet; harness for the dot
  rule and the segment memory (`tools/train-harness.mjs`, no playwright).
- Devices: unverified from the pane — list what needs the owner's phone.
