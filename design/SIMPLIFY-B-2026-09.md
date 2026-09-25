# Train is home — the Option B cycle (September 2026)

Owner decision, 25 September 2026: Option B of the 24 September review ("Spotter, simplified",
https://claude.ai/artifact/JipkBFW48WBnQ6tMDeK5Wz). Train becomes the first tab and answers "what now?" with one card;
Workouts becomes the library; a paused session follows you across tabs; the month is a pull-down of the week strip.
No feature was removed — every one has a home, listed in the relocation table below.

> Status: in progress. Sections marked TODO are filled in as the branches land.

## The core loop, before and after (tap counts)
Measured on the iPhone 16e simulator with the fixture account (8 cards, 3 never done, a two-week plan with a missed
day, a paused session) unless marked "from the code path".

| Task | Before (main, build 9) | After | What changed |
|---|---|---|---|
| Share a video, then log the first set (iOS) | 9 — Share · More · Spotter · Done · open the app · card · Start workout · Set 1 · Save set (code path) | TODO | TODO |
| Open the app and start today's workout | 1 on Library (it opened there) · 2 on Train (tab + Start) (measured) | TODO | TODO |
| Log one set | 2 — the set pill, then Save set (measured) | TODO | TODO |
| Plan a saved workout for Thursday | 6 — card · Schedule · › month · the day · ✓ · Add to plan (5 inside the month) (measured) | TODO | TODO |
| Finish, then see the week | 3 — Save workout · ✕ · Train (code path) | TODO | TODO |

## Research
- The month pull-down: 11 apps and libraries (iOS Calendar, Fantastical, Structured, Runna, Google Calendar, Todoist,
  FSCalendar, react-native-calendars, table_calendar, Kizitonwose) plus Apple's and Android's gesture numbers. First-party
  apps publish no thresholds; FSCalendar and react-native-calendars do. Taken: a 10 px axis lock, 1:1 tracking, commit
  at 150 px/s or half-way, the selected week's row anchored while the others unfold, the tab pager's critically damped
  spring after a drag, only when the page is at its top; VoiceOver gets a button and actions.
- One-tap logging and Finish: Hevy, Strong, Alpha Progression, StrongLifts, Gravl, Boostcamp; Apple HIG. Taken: the
  big button logs the next set with prefilled numbers (Hevy's checkmark, StrongLifts' circle), rest starts at once,
  one haptic, a PR toast that does not block; a short Undo (our own call: a full-width button makes mistaps likelier);
  Finish as a quiet pill top right (Hevy, Strong), confirming only when sets are left; neutral progress.
- The status on a card: Pinterest, ReciMe, Paprika, Mela, Netflix, Spotify, Apple Books, Peloton; NN/g on indicators and
  cards; Material's date wording. Taken: one status, on the thumbnail where the duration badge already sits, solid
  pills with an icon so colour is never the only signal, "today / tomorrow / Thu" for the coming week.
- TODO: the card, the Plan sheet and the ready moment (from the agents' reports).

## Relocation table (every row checked on the simulator)
| Feature | Before | After | Verified |
|---|---|---|---|
| Resume / End a paused session | Library Resume card; the card's button | The paused bar on every tab; Up next; the card's Resume | TODO |
| Today's planned workout | Library Today card; Train Today card | Up next on Train | TODO |
| Day details, sessions on a day, add to a day | The day sheet (no Start, no Move) | The selected-day card under the strip | TODO |
| Month grid, legend, Copy week, Build with Pumpy, What counts | Calendar segment (Pumpy ×2 there, ×3 elsewhere) | Pull the strip down; its ⋯ | TODO |
| Progress, Records, awards | Train segments | Progress · Records segments | TODO |
| Search, filters, collections, sort, favorites, pull to refresh, Plus meter | Library | Workouts | TODO |
| Watch this part, demo, edit, rest, swap, reorder, remove exercise | Three controls per row, an Options fold | The exercise sheet (+ swipe to remove) | TODO |
| Rename, collections, share, read again, remove, Ask Pumpy | Options sheet + a chip | The ⋯ Workout sheet | TODO |
| Watch original and caption | A folded row | The cover; the caption under the list | TODO |
| Plus and Basic read offers | Above Start | "Improve this read", the recap, the save limit | TODO |
| Set logging | Pill + sheet | The big button; the sheet one tap away | TODO |
| Swap, demo, clip, add exercise mid-workout | Options fold | ⋯ Exercise | TODO |
| Finish | The big button at the bottom | A pill at the top right; the big button after the last set | TODO |
| Section edit, add exercise and section, muscles, notes and category | Scattered | Below the list | TODO |

## What was built (TODO)

## Evidence (TODO)
Screenshots: before `briefs/simplify-b/evidence/before/` (not published); after, light and dark, in `design/simplify-b/`.

## Not verified on a device (TODO)
