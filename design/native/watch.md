# The Apple Watch companion

What the wrist does during a Spotter session: mirror it, log a set, skip or pause the rest, end the
workout — and keep counting the rest when the phone is locked, in a bag or dead.

It is a **companion**, not a second app. The workout engine is JavaScript in the phone's web view and stays
there. Every action from the wrist ends in the same `app.ts` function a thumb would have run, so PR
detection, the toast, the haptic and the saved set all happen once, in one place. There is no Swift copy of
the engine to drift from it.

## What was looked at first

| Source | What was taken |
| --- | --- |
| Apple HIG, *Workouts* (developer.apple.com/design/human-interface-guidelines/workouts) | Page order: **controls on the left, metrics in the middle**, media on the right. Spotter has no media page, so it ships the first two in that order. No more than five metrics on a page. |
| Apple's own Workout app (watchOS 26) | Horizontal paging between views; End and Pause live on their own page, never a thumb's width from the button pressed forty times a session; End is confirmed. |
| WWDC23 *Design and build apps for watchOS 10* | watchOS 10 gave the Digital Crown paging duty (`TabView.verticalPage`, as in the Activity app) **and** precise-adjustment duty. Both cannot have it — see "The Crown" below. |
| `WCSession` documentation (`updateApplicationContext`, `sendMessageData`, `transferUserInfo`, `isReachable`) | The transport design, top to bottom. Quoted in the next section because every line of it decided something. |
| `WKInterfaceDevice.play(_:)` documentation | "By default, you cannot play haptic feedback in the background. The only exception are apps with an active workout session." This is why HealthKit is in this feature at all. |
| `HKWorkoutSession` / `HKLiveWorkoutBuilder` | What keeps the app frontmost, and where the heart rate on the metrics page comes from. |
| `TimelineView`, `isLuminanceReduced` | The countdown redraws itself from a deadline; Always On dims the ember, strokes rather than fills, and stops rendering a per-second figure a once-a-minute display cannot show. |
| Strong, Hevy, Gymaholic watch apps | The shape of a logging screen on a wrist: one movement, one big primary button, reps and weight on steppers rather than a keyboard, rest as a ring with a Skip under it. Spotter's version differs in one way on purpose — the dose is **prefilled by the phone**, so the common case is one press with no dialling at all. |

## The transport, and why each half is different

Apple's `WCSession` documentation decides all three choices:

- **Phone → watch: `updateApplicationContext`.** "The system sends context data when the opportunity
  arises, with the goal of having the data ready to use by the time the counterpart wakes up… This method
  replaces the previous dictionary… You may call this method when the counterpart is not currently
  reachable." Latest-wins with a dropped intermediate costing nothing is exactly a session mirror.
  Because it **replaces** rather than merges, `WatchLinkSink` keeps the whole mirror (`live`, `done`,
  `summary`) in one dictionary and sends all of it every time. A naive `["summary": …]` after a
  `["live": …]` would erase the running session from the watch's world; `tools/ios/watch-check.mjs` asserts
  the whole-mirror call so nobody re-introduces it.
- **Phone → watch, immediacy: `sendMessageData`, only when `isReachable`.** An echo of a context already
  queued, never the delivery anything depends on.
- **Watch → phone: `sendMessage`, falling back to `transferUserInfo`.** "Calling this method from your
  WatchKit extension while it is active and running wakes up the corresponding iOS app in the background
  and makes it reachable. Calling this method from your iOS app does not wake up the corresponding WatchKit
  extension." That asymmetry is the whole reason the wrist's actions and the phone's state travel
  differently. Out of range, `transferUserInfo` queues the action and it arrives later — possibly at the
  phone's next launch — which is why the engine's own guards (no session running, rest already over) are
  what decide whether a late action still means anything.

**The background round-trip, measured** (both simulators, evidence in the report): with the iOS app
**terminated**, one `sendMessage` from the watch relaunched it in the background — `launchctl` on the phone
goes from no matching job to `UIKitApplication:com.simeonrinkenberger.spotter.dev` — and the phone's
`["ok": true]` reply came back in about one second. So a wrist tap reaches the native shell with the phone
locked or the app killed. What is *not* proven is what the web view does with it while the app is
background-launched; `LiveStatePlugin.deliver` uses `notifyListeners(retainUntilConsumed: true)`, so the
worst case is that the action is retained and applied the moment the page is alive again.

## The pages

**Idle.** "Start a workout on your iPhone", and under it today's plan from the last published
`WidgetSummary` ("Kettlebell Circuit · 35 min"), else the next planned day, else the last session. Nothing
is tappable: this app cannot start a workout — the library, the plan and the engine are all on the phone —
and a button that looked like it could would be a promise the wrist cannot keep.

**Metrics** (the page it opens on). Elapsed time as `Text(timerInterval:)` so the system draws it,
the block name, the movement (two lines, scaled), "Set 2 of 4 · 8-12 reps", a reps stepper, a weight
stepper when the movement has a weight, and a full-width ember **Log set**. Everything fits a 46 mm screen
without scrolling — the primary action must never be below the fold.

**The Crown** is on the reps value (±1, `sensitivity: .low`, haptic detents), which is why paging is
horizontal. The alternative — watchOS 10's vertical paging — would have spent the Crown on navigation that
a swipe already does, in an app whose one adjustable number is reps. Every stepper is also a pair of
buttons, because a simulator, a glove and an accessibility user all need the tap.

**The dose.** `LiveState.dose` carries `reps`, `weight`, `unit`, `step` and `loggable` as numbers. The
watch does not parse `"1,200 lb"` or `"8-12 reps"` — those are sentences rendered for a reader, grouped for
their locale. `step` is the phone's own `plate()` (2.5 kg / 5 lb) rather than a constant the watch guesses,
and `loggable` is `liveAction`'s own refusal (a timed hold and an unresolved complex are logged on the
phone) answered **before** a button is drawn instead of after someone presses it. An untouched Log set
sends no numbers at all, so it cannot drift from the phone's prefill; only a dialled figure travels, as
`LiveAction(kind: .set, source: .watch, reps:, weight:)`.

**Rest.** The page becomes a ring that fills as the rest is spent — full means lift — with the seconds in
the middle, "Next: Bench Press · set 3" under it and Skip below that. `rest.until` is an absolute instant,
so every frame is arithmetic against the watch's own clock: nothing is ticked, nothing is pushed per
second, and a phone that locks mid-rest changes nothing. Paused (`held > 0`) freezes the figure and labels
it in ember. At zero the watch plays `.notification` — the system's "the thing you were waiting for has
happened" pattern, distinct from the `.click` that confirms the wearer's own press — fired once per
deadline, so a state that arrives twice does not buzz twice.

**Controls.** Title, "7 of 12 sets", Skip rest and Pause rest while resting, and End workout in ember-soft
behind a confirmation.

**Done.** "Nice work", the duration, sets and PRs, the workout title. Gone after 30 seconds, or on a tap:
the session is saved on the phone, which is where anyone would read it properly.

**Optimism.** A tap applies its own expected state immediately (set counted, rest cleared, pause flipped)
and the next context replaces it. The phone's reply to the message means "I have it" and stops the clock on
the footnote; five seconds with no answer at all shows a quiet **"Waiting for iPhone…"** in the header,
where the block name usually is — a footnote under a button the page has scrolled past is a message nobody
reads. The last known state stays on screen underneath it, because a wrist mid-set wants the movement name
more than it wants a blank apology.

**Always On.** `isLuminanceReduced` strokes the ring thinner, drops the ember to `ember-ink`, and shows
whole minutes instead of a per-second figure the display cannot keep up with.

## HealthKit: what it is for, and how it is switched on

An `HKWorkoutSession` (`.traditionalStrengthTraining`, indoor) is started when a session begins and ended
when the summary arrives. It is not a data feature. It buys, in order:

1. the app stays frontmost, so a raised wrist shows the set rather than the watch face;
2. **haptics play in the background** — per Apple, the only exception to the rule that they do not;
3. a live heart rate on the metrics page, small and muted, from `HKLiveWorkoutBuilder`.

Nothing is written to Health: `stop()` calls `discardWorkout()`, never `finishWorkout()`. Saving an
`HKWorkout` is a separate product decision and a second permission prompt.

It is behind the compile flag **`SPOTTER_HEALTHKIT`**, off in the committed project. Two lines in
`ios/App/Local.xcconfig` turn it on:

```
SPOTTER_WATCH_FLAGS = SPOTTER_HEALTHKIT
SPOTTER_WATCH_ENTITLEMENTS = SpotterWatch/SpotterWatch.entitlements
```

(also documented in `Local.xcconfig.example`). The entitlement file is committed but unreferenced until
then, and the two `NSHealth*UsageDescription` strings are set as `INFOPLIST_KEY_*` build settings — inert
without the entitlement, and one less thing to get right when the switch is flipped.

**Signing outcome.** With the flag on, the whole scheme **builds and signs for the Simulator with the
personal team** — verified. Device signing could not be settled here: a device build fails at
`GatherProvisioningInputs` for **both** `SpotterWatch` and `SpotterWidgets`, with and without HealthKit,
because no development provisioning profile exists locally for either phase-2 bundle id, and creating one
needs `-allowProvisioningUpdates`, which registers profiles on the owner's Apple account. Apple's app
capabilities table lists HealthKit as available to a free Apple Developer account, so the flag may well
work on device — but that is one Xcode build by the owner away from being a fact rather than a reading.

With the flag off the watch app behaves exactly as it otherwise would, minus the heart rate and the
foreground guarantee: the countdown is still correct whenever the app is on screen, because it is computed
from the deadline rather than accumulated, but a lowered wrist suspends the app and the end-of-rest haptic
does not reach it.

## What this Mac could not verify, and why

No process here can inject a touch into a simulator: `osascript` has no assistive access
(`-1728`), and the simulator MCP tool's device grant was declined for both devices. So everything below
was reached from launch alone, and three things were left for someone with a thumb.

Verified end to end on the two simulators (iPhone 17 Pro Max + Spotter Watch):

- The **publish path**, with a real signed-in account: the phone's `WidgetSummary` crosses and the idle
  face draws it ("0 of 3 this week"). It was first noticed as a bug — a fixture plan line being *cleared*
  the moment the phone app launched, which is the signed-out summary arriving.
- The **action round trip**, including the background wake described above, and the reply that stops the
  waiting footnote.
- **Every watch screen**, driven by the real contract JSON in `tools/ios/contract-fixture.json` through the
  same decode the phone's bytes take.

Not verified, needing one tap each:

- A **live session** mirrored from a real workout. `spotter://start/<id>` from `simctl` raises SpringBoard's
  "Open in Spotter?" confirmation, and the in-app resume toast is a tap as well. The `live` key travels the
  same mirror, the same context and the same decode as the `summary` key that is verified, but the engine's
  own `liveState()` has not been seen arriving on a wrist.
- **Logging a set from the watch into the engine** (the transport is verified; the engine's reaction is not).
- **The end-of-rest haptic** and **Always On**, neither of which a simulator has.

To finish these, grant the simulator panel access to iPhone 17 Pro Max and Spotter Watch, or run the
sequence in `briefs/BRIEF-NATIVE-D.md` §Verify by hand.
