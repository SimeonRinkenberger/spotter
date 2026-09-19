# The running workout on the Lock Screen and in the Dynamic Island

Spotter's answer to "does it do that permanent notification thing that like fitness or strava does?"
(owner, 5 Sept). ActivityKit, one Live Activity per session, started from the tap that starts the
workout and ended by the tap that saves it.

## Research — what was read, and what was taken

| Source | What it settled |
| --- | --- |
| [HIG, Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities) | The five presentations and their jobs; "use large, heavier-weight text — a medium weight or higher"; "focus on important information people need at a glance"; match the app's aesthetic in **both** appearances; the Dynamic Island is "a black opaque background" and you cannot tint compact/minimal/expanded — only the Lock Screen; tint the key line to match the content; keep content "compact and snug within a margin that's concentric to the outer edge"; "don't draw content all the way to the edge of the Dynamic Island". |
| HIG, same page, *Offering interactivity* | The rule that shaped the button row: "prefer limiting it to a single element to help people avoid accidentally tapping the wrong control", and interactivity is for actions people "activate once or temporarily pause and resume, **like music playback, workouts**". Spotter therefore shows **exactly one** button, never two. |
| HIG, same page, *Starting, updating, ending* | "Update a Live Activity only when new content is available" → the 1 update/s coalescer. "Don't use push notifications alongside Live Activities for the same updates" → the rest-end nudge is scheduled as a **local** notification and the activity update that starts the rest carries **no** `alertConfiguration`, so the rest ending makes one sound, not two. |
| HIG, same page, *Best practices* | "Avoid displaying sensitive information… could be viewed by casual observers." A movement name and a set count are not sensitive; bodyweight numbers are not shown, only the working weight the user typed. |
| [ActivityKit, Displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) | Hard limits now encoded in the code and the check: 8 h activity life, +4 h on the Lock Screen = **12 h max**; static + dynamic data **≤ 4 KB**; the system "may truncate a Live Activity if its height exceeds **160 points**"; the activity sandbox has no network. |
| [ActivityKit, `request(attributes:content:pushType:)`](https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:)) | "You can't do this while your app is in the background." Spotter only ever requests from `LiveState.update`, which is a JS call, which only runs in the foreground — so the start path is legal by construction. `ActivityAuthorizationInfo().areActivitiesEnabled` is checked first; a refusal is logged, never thrown. |
| [WidgetKit, Adding interactivity](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities) | `LiveActivityIntent` runs `perform()` **in the app's process** — that is the whole mechanism that lets a Lock Screen button reach `LiveStatePlugin.deliver`. Buttons are allowed in the **expanded and Lock Screen** presentations only (not compact, not minimal). And the line that decided the verification plan: **"On a locked device, buttons and toggles are inactive and the system doesn't perform actions unless a person authenticates and unlocks their device."** |
| [Hevy — Live Activity](https://www.hevyapp.com/features/live-activity/), [Hevy help centre](https://help.hevyapp.com/hc/en-us/sections/35649822080791-Live-Activity) | The category's reference implementation: next movement, sets done on the current movement, prescribed weight and reps, how long you have been training, mark a set complete without unlocking, and ±15 s / skip on the rest timer. Spotter takes the field list almost verbatim and **drops** ±15 s — because of the HIG single-element rule above, ±15 s stays on the phone. |
| Apple Fitness / Workouts, Nike Training Club, Strava | Elapsed time is the constant; everything else is the current interval. NTC shows "how much time or reps remain on the current drill" — which is why `phase == "timed"` gets the same countdown treatment as a rest rather than a second visual language. Strava users asked for exactly this in 2022 ([idea thread](https://communityhub.strava.com/t5/ideas/apples-live-activities-workout-data-on-lock-screen-ios-16-1/idi-p/2982)). |

**One correction to the older guidance.** Search results still surface the iOS 16-era line
"Live Activities on the Lock Screen and in the Dynamic Island don't support interactive buttons…
avoid displaying anything in your UI that resembles a button." That was superseded in iOS 17; the
current WidgetKit page above documents buttons in the Lock Screen and expanded presentations. The
project floor is iOS 17.0, so the buttons are legitimate — but the old rule is why they are limited
to one and why the rest of the surface is deliberately flat.

## The presentation matrix

`phase` comes straight off `LiveState`. "Clock" is always rendered from an instant
(`Text(timerInterval:)` / `Text(_:style:.timer)`), never from a number, so it keeps counting while
the process is suspended and while the phone is locked.

| phase | Lock Screen primary / secondary | Clock | Bar | Button | Compact leading / trailing | Minimal |
| --- | --- | --- | --- | --- | --- | --- |
| `work` | movement · `Set 2 of 3 · 10 reps · 24 kg` | elapsed, ink-2 | session progress (done/total), ember | **Log set** | dumbbell / elapsed | dumbbell |
| `rest` | movement · `Up next · Set 3 of 3` | countdown, **ember, larger** | rest countdown, ember | **Skip rest** | hourglass / countdown | countdown ring |
| `rest` paused | movement · `Up next · Set 3 of 3` | frozen `0:23`, muted | frozen fraction, muted | **Skip rest** | hourglass / frozen, muted | muted glyph |
| `timed` | movement · target | countdown, ember | countdown, ember | — | timer / countdown | countdown ring |
| `complex` | movement · block · target · weight | elapsed, ink-2 | session progress, ember | — | dumbbell / elapsed | dumbbell |
| `done` | `Workout saved` / `Session ended` · `42:10 · 18 sets · 2 PRs` | check, good | full, good | — | check / elapsed | check |
| `unknown` | falls through to the `work` treatment with no button | elapsed | session progress | — | dumbbell / elapsed | dumbbell |

The compact trailing element is one view (`IslandClock`) in every phase: it shows the countdown while
one is running and the elapsed session time otherwise. A set fraction was considered there and
dropped — at compact width it competes with the countdown for the same few points, and "how long
until I lift again" beats "which set is this" on a glance from across the gym.

The expanded presentation carries no captions over its two numbers. See *What rendering the card
caught*.

Deliberate departures from a literal reading of the brief, both in service of the HIG:

1. **The rest countdown is the hero by weight, not by position.** The brief says "the hero becomes
   the countdown". Moving the movement name out and a timer in on every rest would fight the HIG's
   "preserve as much of the existing layout as possible by animating existing elements to their new
   positions rather than removing and animating them back in". So the layout is stable across every
   phase and the countdown becomes the hero by growing (22 → 30 pt), turning ember, and taking the
   progress bar with it. Nothing jumps; the eye still lands on the number.
2. **One button, never two.** See the HIG interactivity rule. `work` → Log set, `rest` → Skip rest.
   `timed` and `complex` get none, because `liveAction()` in app.ts answers both with
   "Log this one on the phone." — a button that only ever produces a toast is worse than no button.

## The button round trip — what was and was not measured

`SkipRestIntent` and `LogSetIntent` are `LiveActivityIntent`s in `Shared/LiveActivityIntents.swift`,
compiled into **both** the App target (where `perform()` runs) and the SpotterWidgets target (which
needs the type to build the `Button`). They call `LiveActionRouter.send`, whose handler is installed
by `LiveActivitySink` at launch and does two things in order: apply an **optimistic native update**
to the activity, then `LiveStatePlugin.deliver(...)` the action to JavaScript with
`retainUntilConsumed: true`.

**The round trip was NOT measured.** Driving it needs a signed-in session in Workout Mode, and the
machine this was built on could send the Simulator neither a tap nor a keystroke — no accessibility
permission for `osascript`, no device permission for the simulator-control tool. There was no way to
type an email address, let alone press a Lock Screen button. What follows is therefore one verified
fact, one documented fact, and one piece of reasoning, labelled as such.

- **Verified.** The button renders, is reachable, and is the only interactive element, in both
  appearances (`70-expanded-light.png`, `71-expanded-dark.png`).
- **Documented, not measured.** WidgetKit: "On a locked device, buttons and toggles are inactive and
  the system doesn't perform actions unless a person authenticates and unlocks their device." So the
  Lock Screen button is a *post-unlock* affordance on every iPhone, in every app. That is not a
  Spotter bug and cannot be worked around. It is also why the countdown, not the button, is the
  hero: the countdown is the part that works while the phone is locked, and that part **is**
  verified — the card counted 0:56 → 0:54 → 0:47 across an app kill and relaunch
  (`reconcile-strip.png`), which is the same mechanism.
- **Reasoned, not measured.** With the app merely backgrounded, `perform()` runs in the app process
  (the system wakes the app for a `LiveActivityIntent`), but the WKWebView content process is
  suspended, so the JavaScript listener is unlikely to run until the app is foregrounded. The
  optimistic update exists for exactly that window, and `retainUntilConsumed: true` means the engine
  applies the same action for real when the web view wakes — so the two can disagree about *when*,
  never about *what*. **This is the one claim in this document that a person with a signed-in phone
  should check first.** The check is one line: start a workout, log a set, press Home, tap
  "Skip rest" in the Dynamic Island, and see whether the card leaves rest within ~2 s and whether
  the rest is also over when you reopen the app.

Every action still goes through `liveAction()` in app.ts, which calls `doneRest()` / `saveSet()` —
the same functions a thumb calls. No shortcut path, per the contract in NATIVE-SHARED.

## What rendering the card caught

The Lock Screen presentation is only composited by the system on a locked device, which this machine
could not produce. A DEBUG-only `ImageRenderer` harness (`ios/App/App/LiveActivityShots.swift`) draws
the real `LockScreenWorkout` instead. It found three defects that reading the code had not:

1. **Dynamic Type support was inert.** `@ScaledMetric(relativeTo: .body) var typeScale: CGFloat = 1`
   returns 1.0 at every type size, because `UIFontMetrics` rounds. Two renders at different sizes
   came out byte-identical. Scaling from a base of 100 and dividing fixes it.
2. **The progress bars ignored their tint.** A linear `ProgressView` forced into a 5 pt frame drew
   system yellow. Every fixed-value bar is now two hand-drawn capsules. (The remaining
   `ProgressView(timerInterval:)` — the only bar that can animate without an update — was later
   confirmed to tint ember correctly on the device itself, in `70-expanded-light.png`; the yellow in
   the rendered PNGs is an ImageRenderer artifact.)
3. **The card could exceed the 160 pt truncation limit.** "Bulgarian Split Squat (Rear Foot
   Elevated)" wrapped to two lines at 1.25x measured **166 pt**, and what the system truncates is the
   bottom — the button. The hero now drops to one shrunk line above 1.12x. Measured heights, every
   phase, after the fix: 94–151 pt, worst case 128 pt.

Capturing the expanded Dynamic Island (by sending one alerting update from the fixture, the only way
to open it without a long press) caught a fourth: the leading and trailing captions were **clipped by
the island's own corner radius** — "TIME" lost its T, "REST" lost its T. Shortening the words and
adding `minimumScaleFactor` did not help because the clipping is geometric. Both captions are gone;
the two numbers are inset 6 pt so they clear the curve. This is the HIG's "elements poking into the
rounded shape of the Live Activity and creating visual tension", found the hard way.

## The rest-end nudge

`NotificationsHost.schedule(id: "rest-end", …)` at the absolute rest deadline, scheduled on every
update whose phase is `rest` with `held == 0` and a deadline this sink has not already scheduled
(so +15 s reschedules, pause cancels, resume reschedules); cancelled on any other state and on
`end`. Only when `status()` answers `granted` — the sink never asks.

**Asking** is one line in app.ts, inside Workout Mode, on the first rest of a native session
(HIG *Notifications*: ask in context, once the value is obvious; Strong and Hevy both wait for the
first rest rather than asking at launch). It renders into the rest strip using existing classes —
a `.resthint` question and two 44 px `.chip`s — and `notifications.request()` is called from inside
the "Turn on" `onclick`, never on load. "Not now" writes `spotter_nudge_asked` and the app never
asks again; `denied` and `granted` never render it at all.

## Colour, type, motion

`WidgetTheme` only — the same `:root` tokens as the web app, resolved per appearance. Ember for
anything counting down, ink-2 for elapsed, muted for labels, `good` for the finished check. The Lock
Screen card is tinted `WidgetTheme.card` via `activityBackgroundTint`; the key line is ember, which
is the HIG's "consistent with the colour of other elements". Type is SF (an extension cannot fetch
Fontshare): `.rounded` monospaced digits for every number so a ticking timer does not reflow the
row, semibold display sizes for the movement. Sizes scale with Dynamic Type through `@ScaledMetric`
clamped to 1.0–1.25 ×, which keeps the card inside the 160 pt truncation limit at XL and above.

## Evidence

All under the session scratchpad `…/scratchpad/a/`:

| File | Shows |
| --- | --- |
| `cards-light.png`, `cards-dark.png` | the Lock Screen card in all six phases plus two layout stress cases, both appearances, heights labelled |
| `20-island-compact.png` | compact Dynamic Island, light — ember hourglass and an ember countdown |
| `70-expanded-light.png`, `71-expanded-dark.png` | expanded Dynamic Island, both appearances, after the caption fix |
| `reconcile-strip.png` | 0:56 → 0:54 → 0:47 across an app kill and relaunch: the clock is deadline-driven, and relaunch adopts one card rather than duplicating it |
| `ghost-strip.png` | an orphaned card (stored state wiped) ended on the next launch |
| `nudge-log.txt` | `id=rest-end title=Rest over body=Goblet Squat, set 3 of 3 fires=57s away`, then `pending=0` once the state is no longer that rest |
| `done-strip.png` | the ended activity leaves the Dynamic Island immediately, which is ActivityKit's documented behaviour for an ended activity (it persists only on the Lock Screen) |

Not captured, and why: the composited **Lock Screen** itself, the **minimal** presentation (needs a
second concurrent Live Activity), the **nudge banner**, and the **in-app permission line** — all four
need either a device lock or a tap, and this machine could send neither.
