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
| `work` | movement · `Set 2 of 4 · 10 reps · 24 kg` | elapsed, ink-2 | session progress (done/total), ember | **Log set** | dumbbell / `2/4` | dumbbell |
| `rest` | movement · `Up next · Set 3 of 4` | countdown, **ember, larger** | rest countdown, ember | **Skip rest** | hourglass / countdown | countdown ring |
| `rest` paused | movement · `Up next · Set 3 of 4` | frozen `1:23`, muted | frozen fraction, muted | **Skip rest** | hourglass / `1:23` muted | muted ring |
| `timed` | movement · target | countdown, ember | countdown, ember | — | timer / countdown | countdown ring |
| `complex` | movement · block · target | elapsed, ink-2 | session progress | — | dumbbell / elapsed | dumbbell |
| `done` | `Workout saved` / `Session ended` · `42:10 · 18 sets · 2 PRs` | check, good | — | — | check / elapsed | check |
| `unknown` | falls through to the `work` treatment with no button | elapsed | session progress | — | dumbbell / elapsed | dumbbell |

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

## The button round trip — what was measured

`SkipRestIntent` and `LogSetIntent` are `LiveActivityIntent`s in `Shared/LiveActivityIntents.swift`,
compiled into **both** the App target (where `perform()` runs) and the SpotterWidgets target (which
needs the type to build the `Button`). They call `LiveActionRouter.send`, whose handler is installed
by `LiveActivitySink` at launch and does two things in order: apply an **optimistic native update**
to the activity, then `LiveStatePlugin.deliver(...)` the action to JavaScript with
`retainUntilConsumed: true`.

The optimistic update is not a nicety. Findings, measured on iPhone 17 Pro (see the report):

- **Locked device: the button does nothing at all** until the user authenticates. This is Apple's
  documented behaviour, quoted above — not a Spotter bug, and not fixable. The Lock Screen button is
  therefore a *post-unlock* affordance; the thing that works on a locked screen is the countdown,
  which is why the countdown is the hero and the button is the smallest element on the card.
- **Unlocked, app backgrounded:** the intent runs in the app process promptly, but the WKWebView's
  content process is suspended, so the JavaScript listener does not run until the app is
  foregrounded. Without the optimistic update the card would sit on a rest the engine has already
  been told to end. With it, the card corrects within ~1 frame and `retainUntilConsumed: true`
  guarantees the engine applies the same action for real the moment the web view wakes — the two can
  disagree only about *when*, never about *what*.

Every action still goes through `liveAction()` in app.ts, which calls `doneRest()` / `saveSet()` —
the same functions a thumb calls. No shortcut path, per the contract in NATIVE-SHARED.

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

## Screenshots (evidence)

Under the session scratchpad, `…/scratchpad/a/`:
`lock-rest-t0.png`, `lock-rest-t10.png` (the same rest, ten seconds later, counted while locked),
`island-compact.png`, `island-expanded.png`, `nudge-banner.png`, `lock-rest-dark.png`,
`island-compact-dark.png`, `done.png`, `relaunch-reconciled.png`, `nudge-ask.png`.
