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
| HIG, *Offering interactivity* — re-read 20 Sept for the dial | The page has nothing on steppers. Its whole guidance on controls is the paragraph already cited: "Focus on simple, direct actions. Buttons or toggles take up space that might otherwise display useful information. Only include interactive elements for essential functionality that's directly related to your Live Activity and that people activate once or temporarily pause and resume, like music playback, workouts… If you offer interactivity, prefer limiting it to a single element to help people avoid accidentally tapping the wrong control." And, one line later, the door it leaves open: "If an update to your Live Activity is something that a person could respond to, consider offering a button or toggle to let people take action." The trade-off the dial makes against the single-element line is written out below the table. |
| [WidgetKit, Adding interactivity](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities), re-read 20 Sept | Only `Button` and `Toggle` are interactive in a Live Activity — there is no Stepper — so a dial is four buttons. Parameters travel with the button: "Define input parameters that your action needs using the `@Parameter` property wrapper… Make sure input parameters have assigned values because, unlike app intents you define for system functionality like Siri, widgets don't resolve parameters for app intents." Hence one `AdjustSetIntent(field:delta:)` behind all four ± buttons. `invalidatableContent(_:)` sat on the figure from 20 Sept until 21 Sept, when the figure became a control and the modifier turned out to swallow its tap (see *21 Sept — Typing a figure*). |
| HIG, *Compact presentation* + *Specifications* — for the width | "Keep content as narrow as possible and ensure it's snug against the TrueDepth camera… Maintain a balanced layout with similarly sized views for both leading and trailing elements; for example, use shortened units or less precise data to maintain appropriate width and balance." The specification table gives the compact leading and trailing views **52.33 × 36.67 pt** each on a 393-pt-wide phone and the compact island **230 pt** wide on the iPhone 17 Pro. The island this replaced measured ~330 pt across (owner: "way too wide"); the fixed one measures ~212. |
| HIG, *Best practices* — for the ± glyphs | "Use large, heavier-weight text — a medium weight or higher." The dial's figures are the numeral face at 17 pt semibold, the ± glyphs 13 pt bold. |
| [ActivityKit, Launching your app from a Live Activity](https://developer.apple.com/documentation/activitykit/launching-your-app-from-a-live-activity) — read 21 Sept for the typed figures | "To create a deep link into your app from the Lock Screen, compact leading, compact trailing, and minimal presentations, use `widgetURL(_:)`… To create a deep link into your app from the extended presentation, use `widgetURL(_:)` or SwiftUI's `Link`." So a `Link` on the figures is documented for the expanded island and *not* for the Lock Screen card — where the card already carries `widgetURL(spotter://resume)`. Both were tried on the 17 Pro (see *21 Sept*), because the doc says what is supported, not what is refused. |
| [UNNotificationInterruptionLevel.timeSensitive](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive), WWDC21 [Send communication and Time Sensitive notifications](https://developer.apple.com/videos/play/wwdc2021/10091/) | "The system presents the notification immediately, lights up the screen, can play a sound, and breaks through system notification controls. Time Sensitive notifications… can break through system controls such as Notification Summary and Focus. The user can turn off the ability for time sensitive notification interruptions." The session: "enable the associated capability via Xcode… For a local notification, the Time Sensitive interruption level is set on the content object", and "Do not overuse their interruptive nature" — which is why only the rest-end nudge carries it and the reminders stay ordinary. The capability's entitlement key is `com.apple.developer.usernotifications.time-sensitive` (Boolean); Apple's [Supported capabilities (iOS)](https://developer.apple.com/help/account/reference/supported-capabilities-ios) table marks Time Sensitive Notifications available to every membership including the free "Apple Developer" account, so the committed project still signs with the Personal Team. |
| [watchOS, Enabling and receiving notifications](https://developer.apple.com/documentation/watchos-apps/enabling-and-receiving-notifications) | "Schedule local or send remote notifications to the iOS companion app (if one exists), and let the system forward the notifications to the user's Apple Watch… the system ensures that the user only receives one notification at the best destination." So when the watch app is not open, the rest-end nudge reaches the wrist as the *phone's* forwarded notification, and there is no second mechanism to build (see *21 Sept — the wrist*). |

**One correction to the older guidance.** Search results still surface the iOS 16-era line
"Live Activities on the Lock Screen and in the Dynamic Island don't support interactive buttons…
avoid displaying anything in your UI that resembles a button." That was superseded in iOS 17; the
current WidgetKit page above documents buttons in the Lock Screen and expanded presentations. The
project floor is iOS 17.0, so the buttons are legitimate — but the old rule is why they were limited
to one and why the rest of the surface is deliberately flat.

### The single-element rule, traded for a dial (20 Sept)

The owner, from TestFlight build 4 on a 17 Pro: "when i press and hold the log set i want it to show
a thing where i can put in the sets and reps." Press-and-hold is how iOS opens the expanded
presentation, so what he is describing is a way to set the figures *there*, and then log.

The HIG's "prefer limiting it to a single element" was the rule this surface was built on, and it is
being consciously set aside for one case. The reasoning, in the order it was weighed:

1. **A Log set that can only save the prefill is a button that logs the wrong number.** Every set
   that is not exactly the last one — an extra rep, a plate added — meant unlocking, opening the app,
   editing the sheet. The button's whole value is not unlocking. So the choice was not "one control
   or five" but "a control that is right most of the time, or one that is right when it matters".
2. **The rule's stated reason is accidental taps, and that is answerable.** The four ± buttons are
   44 pt targets in a 44 pt row with the value between them; a miss lands on a number, not on a
   different action. Only one control in the row *commits* anything — Log set. A wrong ± press costs
   a second press the other way, and nothing has left the phone.
3. **The dial never crosses the bridge.** A press is a native update from the app process (the
   intent runs there), stepped with `Dose.stepping`, the same clamp app.ts applies. The engine hears
   one thing, the same `.set` it always heard, now carrying the figures — which app.ts already
   accepted from the wrist. Nothing about the contract changed to make room for it.
4. **It is confined to where WidgetKit runs buttons at all** — the expanded island and the Lock
   Screen — and to the one phase where a set is about to be logged. Rest keeps Skip rest alone, the
   rest-over card keeps Start set alone, a hold and an unresolved complex keep nothing, and a paused
   session has no control at all.

What it cost, measured: the expanded island grew from ~154 to 156 pt against a 160 pt cap, and only
after the island's copy of the workout title was dropped (with it the card wanted ~168 and the
system compressed the centre to fit); the Lock Screen card at `work` grew from 131 to 145 pt, 150 at
the 1.25x type clamp, and a long movement name is now one shrunk line whenever the dial is on the
card because two lines plus the row would have measured ~166.

## The presentation matrix

`phase` comes straight off `LiveState`. "Clock" is rendered from an instant
(`Text(timerInterval:)`), never from a number, so it keeps counting while the process is suspended
and while the phone is locked — with one deliberate exception: a **paused** session's clock is a
static string, `pausedAt − startedAt`, because a timer would keep counting a session that is
stopped. "Control" is what sits under the bar in the expanded island and on the Lock Screen card;
the compact and minimal presentations never carry one.

| phase | Lock Screen primary / secondary | Clock | Bar | Control | Compact leading / trailing | Minimal |
| --- | --- | --- | --- | --- | --- | --- |
| `work`, loggable | movement · `Set 2 of 3 · 10 reps` (the weight is on the dial, not repeated) | elapsed, ink-2 | session progress (done/total), ember | **dial** `[−] 10 reps [+] [−] 24 kg [+]` + **Log set**; reps only for bodyweight | dumbbell / elapsed | dumbbell |
| `work`, not loggable (a timed movement before its hold) | movement · `Set 2 of 3 · 40 s` | elapsed, ink-2 | session progress, ember | — | dumbbell / elapsed | dumbbell |
| `work`, engine older than `dose` | movement · `Set 2 of 3 · 10 reps · 24 kg` | elapsed, ink-2 | session progress, ember | **Log set** alone | dumbbell / elapsed | dumbbell |
| `rest` | movement · `Up next · Set 3 of 3` | countdown, **ember, larger** | rest countdown, ember | **Skip rest** | hourglass / countdown | countdown ring |
| `rest`, rest paused | movement · `Up next · Set 3 of 3` | frozen `0:23`, muted | frozen fraction, muted | **Skip rest** | hourglass / frozen, muted | muted glyph |
| `rest` over (`isStale`) | movement · `Next · Set 3 of 3 · 10 reps` | empty, width held | session progress, ember | **Start set** | lifter, ember / `Go`, ember | lifter, ember |
| `paused` (the session) | movement · `Set 2 of 3 · 4 sets logged` (island: `Paused · Set 2 of 3 · 4 sets logged`) | frozen `17:30`, muted, static | session progress, **muted** | — (the card itself is the affordance: `spotter://resume`) | `pause.fill`, muted / frozen `17:30`, muted | `pause.fill`, muted |
| `timed` | movement · target | countdown, ember | countdown, ember | — | timer / countdown | countdown ring |
| `complex`, cap running | the movement the round is up to · `2 rounds + 1 movement` (label `TIME CAP`) | cap countdown from `until`, **ember, larger** | cap fraction, ember | **Next move** + **Round 3 done** | repeat / cap countdown | countdown ring |
| `complex`, cap held | same (label `PAUSED`) | frozen remainder `4:10`, muted | frozen fraction, muted | same two | repeat / frozen, muted | repeat |
| `complex`, cap idle (`until == 0`) | same, `0 rounds` (label `TIME CAP`) | the whole cap `15:00`, static, ink-2 | session progress, ember | same two (the first tap starts the cap) | repeat / elapsed | repeat |
| `complex`, cap over (`over`, or `isStale` while running) | same (label `TIME`, ember) | empty, width held; island slots say `Time` in ember | session progress, ember | same two | repeat / `Time`, ember | repeat |
| `complex`, counted (`cap == 0`) | same (label `ELAPSED`) | elapsed, ink-2 | session progress, ember | same two | repeat / elapsed | repeat |
| `complex`, engine older than the counter | movement · block · target · weight | elapsed, ink-2 | session progress, ember | — | dumbbell / elapsed | dumbbell |
| `done` | `Workout saved` / `Session ended` · `42:10 · 18 sets · 2 PRs` | check, good | full, good | — | check / elapsed | check |
| `unknown` | falls through to the `work` treatment | elapsed | session progress | Log set if the engine says loggable | dumbbell / elapsed | dumbbell |

The compact trailing element is one view (`IslandClock`) in every phase: it shows the countdown while
one is running and the elapsed session time otherwise. A set fraction was considered there and
dropped — at compact width it competes with the countdown for the same few points, and "how long
until I lift again" beats "which set is this" on a glance from across the gym. Since 20 Sept the
slot is a **fixed** 42 pt frame (three digit-widths and a colon — `m:ss` measured at 41.5 pt in the
14 pt numeral face), because a timer Text asks for the widest string it could ever show and
ActivityKit gives a compact slot whatever it asks for: the island stretched to ~330 pt across the
status bar. Past an hour the clock scales down inside the same slot. The Lock Screen and expanded
slots keep their minimum-width frame; a fixed one there is what made the elapsed clock give up on
digits (see *20 Sept*).

The expanded presentation carries no captions over its two numbers, and — since the dial — no
workout title either; the Lock Screen keeps both label and title. See *What rendering the card
caught* and *20 Sept*.

Deliberate departures from a literal reading of the brief, both in service of the HIG:

1. **The rest countdown is the hero by weight, not by position.** The brief says "the hero becomes
   the countdown". Moving the movement name out and a timer in on every rest would fight the HIG's
   "preserve as much of the existing layout as possible by animating existing elements to their new
   positions rather than removing and animating them back in". So the layout is stable across every
   phase and the countdown becomes the hero by growing (22 → 30 pt), turning ember, and taking the
   progress bar with it. Nothing jumps; the eye still lands on the number.
2. **One action, never two.** See the HIG interactivity rule. `work` → Log set, `rest` → Skip rest.
   `timed` gets none, because `liveAction()` in app.ts answers a remote Save for it with
   "Log this one on the phone." — a button that only ever produces a toast is worse than no button.
   Since 20 Sept the `work` action has the dial beside it — four ± buttons that commit nothing —
   which is the one trade against the single-element rule, argued under the research table. It
   remains one *action*: only Log set sends anything. Since 21 Sept a complex is the second trade:
   two actions, Next move and Round done, argued under *21 Sept* below.

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

## The rest ending while the app is asleep (19 Sept)

The defect V2 found on the 17 Pro: with the app backgrounded, the Island froze at `0:00` under the
hourglass and stayed there until the app was opened. The countdown had been right all along — it is
deadline-driven — but the card's *shape* is not, and nothing native runs at the instant a rest ends.
The engine that would send the next state is a web view in a suspended process.

ActivityKit gives an activity exactly one local wake-up, and it is the one this had been throwing
away: `ActivityContent.staleDate`. When it passes, the system re-renders the activity's views with
[`context.isStale`](https://developer.apple.com/documentation/activitykit/activityviewcontext/isstale)
set. So a running rest's stale date is now **the deadline itself** (`LiveActivitySink.staleDate`),
clamped one second into the future because an update can land after the deadline it describes and
ActivityKit ignores a stale date already past. A timed hold keeps the old deadline + 5 min: its end
is a set to log on the phone, not a cue to move, and nothing on the card would change at zero. Work
keeps its 30 minutes. `relevanceScore` (100) and the `.after(15 min)` end policy are untouched.

`PhaseLook.restOver` is the one place that reads `isStale && phase == .rest && !paused`, and it
switches `counting` off — which is what turns the countdown back into an empty slot, the rest bar
back into session progress and the hourglass back into the lifter, in every presentation, without a
second branch per view.

### Two things the device said and the code could not

**The system does not honour a stale date sooner than two minutes.** Measured in `liveactivitiesd`'s
own log (`stale-timing.txt`), twice, on the same launch: a 300 s rest scheduled
`task "Marking activities stale"` for `+299.97 s` — exactly the deadline — and a 30 s rest scheduled
it for `+119.99 s`. The rule is `max(staleDate, now + 120 s)`, and `now` is the update that set it.
So a rest of two minutes or more flips **on** its deadline, and a shorter one flips at rest start
+ 120 s: a 90 s rest (Spotter's `REST_FALLBACK`) is 30 s late, a 30 s rest is 90 s late. That floor
belongs to the system and there is no local way under it — the previous `deadline + 5 min` sat on
top of it, so the same 90 s rest used to wait five and a half minutes. The thing that *is* exact at
the deadline is the rest-end nudge below, which is why it stays.

**A stale activity's live timers stop being driven.** The first build put the elapsed session time
in the slot the countdown vacated. On the device it rendered as the words "26 minutes" — 
`Text(_:style:.timer)` degrading to a static relative phrase, because the system will not run a
timer for content it has marked out of date. The rest-over state therefore asks for no timer
anywhere. The Lock Screen leaves the slot empty and keeps its width (the layout does not move, per
the HIG note at the top of the file, and the "REST OVER" label is already saying it); the two
Dynamic Island slots, which have no room for a label, get the word `Go` in ember instead.

*Corrected 20 Sept:* the words were not staleness. `Text(_:style: .timer)` — the date-style timer —
is not driven on the composited Lock Screen of a locked 17 Pro at all: a `work` card two seconds
after locking, nowhere near stale, read "18 minutes" in the elapsed slot. `Text(timerInterval:)`,
the form ActivityKit documents for Live Activities and the one every countdown here already used,
counted on the same locked screen ("0:41") and kept counting in the expanded island of a stale
rest-over card ("20:37"). The elapsed clock is now the interval form everywhere; the rest-over
layout above stands as it was, because it was right for the wrong reason.

### The button says Start set, and sends `skipRest`

The brief asked whether the engine's `set` action would log the next set from the rest-over card.
For straight sets it would: during a rest `wo.i` has not advanced, so `setPrefill(sets.length)`
resolves to the set the card is naming. For a **circuit** it would not. `saveSet()` starts that
rest with `startRest(gap, null, nextMove)`, so the move to the next station is owed by `restThen` —
and a `set` action runs `saveSet()` again, which calls `startRest(secs)` with no `then` and
overwrites it. A Log set tapped during a circuit rest would log an extra set at the station just
finished and silently swallow the advance. `LiveState` carries nothing that distinguishes the two
rests, so the card cannot choose per-rest.

`skipRest` is correct for both, and it is the only one safe to **retain**: the action is held until
the web view wakes, and by then the engine may have ended the rest itself, in which case
`liveAction`'s `if (restUntil) doneRest()` makes it a no-op — where a retained `set` would log a set
nobody performed. So the intent is unchanged (`SkipRestIntent`) and only the word changes, because
"Skip rest" over a rest that is already over reads as an offer to lose something.

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

### 19 Sept — the rest-over flip, iPhone 17 Pro, iOS 26.2

This machine could lock the phone and send taps, so the composited Lock Screen is captured at last.
All under `…/scratchpad/a2/`. Rests of 130 s and 125 s, so the deadline is past the system's 120 s
floor and governs on its own.

| File | Shows |
| --- | --- |
| `M10-lock-10s-left-card.png` → `M20-lock-deadline-plus7-card.png` | the composited **Lock Screen**, phone locked, app suspended: `REST` / `0:12` / `Skip rest` becomes `REST OVER` / `Next · Set 3 of 3 · 10 reps` / `Start set` **7 s after the deadline**. Same card height, same hero and button positions — only meaning changes |
| `D10-dark-rest-card.png`, `D20-dark-rest-over-card.png` | the same pair in the dark appearance, flipped 9 s after the deadline |
| `f00-backgrounded.png`, `e2-deadline-plus5-island.png`, `e4-deadline-plus65-island.png` | compact Dynamic Island: ember hourglass + countdown, then the frozen `0:00` the floor keeps on screen, then the ember lifter + `Go` |
| `N10c.png` | expanded Dynamic Island at rest over — elapsed, ember `Go`, the next set, session progress, one button |
| `N20full.png` | the same card one tap later: **Start set** was pressed on the expanded island with the app backgrounded and the card became the work presentation (`Set 3 of 3 · 10 reps · 24 kg`, `Log set`). The optimistic half of the round trip, measured at last — the JavaScript half still needs a signed-in phone |
| `stale-timing.txt`, `stale-timing-90.txt` | `liveactivitiesd` scheduling `task "Marking activities stale"`: `+299.97 s` for a 300 s rest, `+119.99 s` for a 90 s one and for a 30 s one. The `max(staleDate, now + 120 s)` rule, measured three times |

Still not captured: the **minimal** presentation, the **nudge banner**, and anything that needs a
signed-in session — this session could not type a password, so every state above came through the
DEBUG fixture, which drives the same `update(_:)`, the same coalescer and the same widget.

## 20 Sept — the dial, the narrower island, the paused session (iPhone 17 Pro, iOS 26.2)

Three owner asks from TestFlight build 4, in his words: "when i press and hold the log set i want
it to show a thing where i can put in the sets and reps"; "the dynamic island thing is way too wide";
"if i pause it i can go back in and resume it and it saves my progress. and if it like stops
unexpectedly i want it to pause it not exit." The third is mostly the web engine's (the pause/end
prompt, the draft that comes back paused); this is the card's half of all three.

### The dial

`[−] 10 reps [+]   [−] 24 kg [+]   [Log set]` on one 44 pt row, under the bar, in the expanded
island and on the Lock Screen card — the two presentations WidgetKit runs buttons in. Four
`Button(intent: AdjustSetIntent(field:delta:))`, one type; a press runs in the app process,
`LiveActivitySink.adjust` steps the figure with `Dose.stepping` (the clamp app.ts and the wrist
share) against the dial-or-prefill, and pushes a content update **at once** — no coalescing, the
number has to move under the thumb. `LogSetIntent` sends the ordinary `.set` with the dialled
`reps`/`weight` on it, which app.ts already honours. The dial resets when the engine moves to a
different set, movement or phase, on the optimistic `.set`, and on `end`. A bodyweight movement
shows the reps dial alone; a set the engine calls unloggable shows nothing; an engine older than
`dose` gets the lone Log set it always had. The figure carried `invalidatableContent()` so it dimmed
between the press and the app's update, which is the system's own way of saying "being changed" —
until 21 Sept, when the figure became a tap target and the modifier had to go (see *Typing a figure*).

### The width

The compact trailing slot was `IslandClock` with `.frame(minWidth: 43.4)`, and a timer Text asks
for the widest string it could ever show; ActivityKit gave the slot what it asked for and the island
ran from the lifter at the far left to the clock at the far right, ~330 pt across, hiding the status
bar's own clock and battery. Now a fixed 42 pt frame (`size × 3`, `m:ss` measured at 41.5 pt in the
14 pt numeral face on this machine's SF Rounded), `.monospacedDigit()` kept, `minimumScaleFactor`
0.7 for the hour case. The island measures ~212 pt with the status bar visible either side (the HIG
gives 230 for a compact island on a 17 Pro). The leading slot is an `Image` and was never the
problem; the minimal presentation is a glyph or a circular `ProgressView` and cannot stretch.

### Paused

`phase == "paused"` + `pausedAt`. Every presentation: the movement, `Paused · Set 2 of 3 · 4 sets
logged` (the Lock Screen's label already says PAUSED, so its line drops the word), a **frozen**
elapsed `pausedAt − startedAt` rendered as a plain string in muted ink — never a live timer, the
process may be suspended for hours — a muted session-progress bar, **no control**, `pause.fill`
muted in the compact leading and minimal slots, and the frozen clock in the compact trailing. The
whole card keeps `spotter://resume`; the app's own resume bar is what resumes. Stale date: the
activity's own 8 h life, so a paused card cannot flip into rest over. The nudge lands in the cancel
branch (no rest). A resume arrives as an ordinary `work`/`rest` state with `startedAt` shifted
forward by the pause; `startedAt` is an immutable attribute the widget's elapsed timer is drawn
from, so `LiveActivitySink.push` **requests a new activity and then ends the old one** with no
closing frame — request first, so a refused request (the app not in front) keeps the old card
updated rather than losing it. Measured both ways below.

### What the device said

- **The expanded island is capped at 160 pt and the system squeezes to fit.** With the dial row the
  island measured exactly 160.0 pt and the centre region had been compressed ~8 pt; it wanted ~168.
  Dropping the island's copy of the workout title (the Lock Screen keeps it) lands it at **156 pt**
  with nothing compressed. The Lock Screen card at `work` with the dial renders at **145.3 pt** at the
  default type size, **149.7 pt** at XL and **145.7 pt** at the 1.25x clamp with the longest name,
  because the movement name is one line whenever the dial is on the card (two lines plus the row
  would have been ~166). Every state without the dial is byte-for-byte the height it was.
- **The date-style timer is not driven on the locked Lock Screen.** See the correction under *The
  rest ending while the app is asleep*. The elapsed clock is `Text(timerInterval:)` everywhere now.
  Once the locked screen dims, every interval timer — countdown and elapsed alike — renders as
  `m:––` (seconds hidden, minutes advancing), the reduced-luminance treatment the simulator
  applies after a few seconds; the first frame after locking counts normally.
- **An empty trailing slot can hide the leading one.** In the paused expanded island, with the
  trailing region empty, the leading region's static frozen clock did not render at all, while a
  timer text in the same place (the `work` island) did. A pause glyph in the trailing slot brings
  the leading clock back; the mechanism is the system's and was not chased further.
- **Two activities from one app do not make a minimal pair.** A twin activity was requested to
  photograph the minimal presentation; the island kept showing one compact card. The minimal
  presentation needs another app's Live Activity, and this simulator has no Clock app. Still
  uncaptured, as in the two sessions before.
- **Not verified on a real device:** the island's true compact width against the hardware bezel,
  the dial's haptics (a `Button(intent:)` press has none of its own), and the JavaScript half of the
  round trip — every state here came through the DEBUG fixture and the actions stop at
  `LiveStatePlugin.deliver` with nobody signed in. `retainUntilConsumed` holds them.

### Evidence

All under `…/ea52f5b1-f596-4620-a895-cc706c85be89/scratchpad/d/`.

| File | Shows |
| --- | --- |
| `00-before-compact-island.png` / `10-after-compact-0-18-crop.png` / `11-after-compact-12-34-crop.png` | the compact island before (lifter far left, `18:20` far right, ~330 pt) and after at `0:18` and `12:34` (~212 pt, status bar visible) |
| `12-13-compact-hour-and-rest-crop.png` | the same slot past an hour (`1:02:34`, scaled) and during a rest (`2:09`, ember) |
| `20-expanded-dial-crop.png` | the expanded island at `work` with the dial, 156 pt, opened by the fixture's alert |
| `30-dial-before-tap-crop.png` → `31-dial-after-plus-reps-crop.png` → `32-dial-after-plus-weight-crop.png` → `33-dial-12-reps-21-5-kg-crop.png` → `34-after-log-set-crop.png` | the island opened by a real long press with Settings in front: `10 reps 24 kg` → `+` → `11` → `+` on weight → `26.5`; then a fresh run to `12 reps 21.5 kg` and **Log set**: the card advances to `Set 3 of 3`, the bar to 5/10, the dial back to the prefill |
| `dial-log.txt`, `dial-log-2.txt` | the app's log for those presses: `dial reps +1 -> reps=11 weight=nil (never sent)` ×2, `dial weight -1 -> … weight=21.5 (never sent)`, then the one bridge-bound line `action set reps=12 weight=21.5` |
| `cards-light.png`, `cards-dark.png`, `cards/` | the ImageRenderer sheet, both appearances, heights labelled: `work` (old engine), `dial`, `dial-bodyweight`, `rest`, `held`, `paused`, `timed`, `complex`, `done`, `long-name-dial`, `xl-dial`, `worst-case-dial` |
| `60-work-dial-lockscreen-card.png`, `60-62-work-lockscreen-counting-strip.png` | the composited Lock Screen at `work` with the dial, phone locked: `0:41` counting, then the dimmed `1:––` |
| `40-paused-compact-crop.png`, `41-paused-compact-frozen-strip.png` | compact paused: muted `pause.fill` / `17:30`, identical 12 s later |
| `42-paused-expanded-crop.png` | expanded paused: frozen `17:30`, pause glyph, `Paused · Set 2 of 3 · 4 sets logged`, muted bar, no control, 104 pt |
| `44-paused-lockscreen-card.png` | the composited Lock Screen paused card: `PAUSED`, `17:30`, `Set 2 of 3 · 4 sets logged`, muted bar, no button, 94 pt |
| `50-51-resume-strip.png`, `resume-log.txt` | resume with the app **backgrounded**: `could not replace on resume — visibility`, the old card updated (elapsed `18:15`, the 43 s gap counted) |
| `52-resume-foreground-after-crop.png`, `resume-log-fg.txt` | resume with the app **in front**: one activity left, a new id, elapsed `17:33` — the pause skipped |
| `53-54-paused-kill-relaunch-strip.png` | a paused card survives an app kill and is adopted on relaunch |
| `70-rest-over-compact-crop.png`, `71-rest-over-expanded-crop.png`, `72-after-start-set-crop.png` | the 19 Sept flip still works in the snug slot; the expanded rest-over card counts elapsed (`20:37`) and keeps its single Start set; one tap later it is the dial |

## 21 Sept — the whole workout from the Lock Screen (iPhone 17 Pro, iOS 26.2)

Four owner asks from TestFlight builds 4 and 5, in his words: "the persistent notification does
not work super well for complexes. i cant advance rounds or anything"; "it would be nice to be
able to log weight too. and i will want to be able to type it in"; "when i log the set in the
persistent notification if i completed the proper amount that the video shows i want it to just
move on to the next exercise"; "it should vibrate the phone and buzz the watch when the rest is up".
The engine's half landed in `d627c41` (the `complex` field, the `round` / `mark` actions, weight 0
rather than null, the `spotter://set/<field>` route, moving on after the last planned set); this is
the card's half of all four.

### The complex

`LiveState.complex` is the phone's own round counter and clock as numbers — rounds done, movements
ticked this round out of how many a round takes, the movement the round is up to, and the cap in the
rest engine's units. The card draws it in the same voice as the phone's screen: the movement the
round is up to as the primary line, the score under it written the way `cxScore()` writes it
(`2 rounds + 1 movement` — rounds plus what was done of the next one, in movements not reps), the cap
counting down from its deadline in ember exactly as a rest does, and two buttons on one 44 pt row:
**Next move** (`mark`, the phone's tick on the movement's row) and **Round N done** (`round`, the
phone's own button, with the phone's own label). Round done is the primary because it is the one
that scores; Next move's fifth tick *is* the round, on the card as on the phone, so the two cannot
disagree.

This is the second conscious trade against the HIG's single-element rule (the dial was the first),
and it is weighed the same way. One control — Round done alone — would have been the smaller
departure, but the owner's complaint was the whole complex: five movements in a round, and a card
that can only count the round leaves the person counting the movements in their head with a
kettlebell in their hands. The two targets are 44 pt with an 8 pt gutter; a miss lands on the
other count, which the phone's own Undo takes back — never on Log set or Skip rest, which are not
on this row.

The cap is a rest with a different word at zero. Its stale date is its deadline
(`LiveActivitySink.staleDate`), so the card flips to **Time** — the phone's word, `cxBody`'s —
without the app running, subject to the same 120 s system floor as a rest. The Lock Screen's label
says TIME and its clock slot goes empty, width held, exactly as it does for a rest that is over;
the two island slots, which have no label, say `Time` in ember where the countdown was, as they say
`Go` for a rest. A held cap freezes the remainder in muted ink and mutes the bar, as a paused rest
does. An idle cap prints the whole cap, static, in the *elapsed* clock's ink — `15:00` reads as
"this is the clock", not as a countdown that has stopped — and the compact slot keeps elapsed time
there instead, because a `15:00` that never moves beside the status bar's own clock looks broken.
The first Next move or Round done starts it under the thumb (`Complex.count`, which is `cxGo()`'s
arithmetic). A counted complex (no cap) shows elapsed time.

**No nudge for a cap.** `syncNudge` schedules only for `phase == .rest`, and the check pins that it
knows nothing about the cap. Three reasons, in order: the phone's own tone at zero is `cxTick()`'s
job, and while the app is asleep nothing plays — which is the honest state of a cap ending, because
a cap ending is not a cue to lift again, it is a cue to stop; the one notification this app posts is
named "Rest over" with the next set in its body, and a cap sharing its id and its words would be a
banner saying the wrong thing loudly; and the owner's ask was specifically the rest ("when the rest
is up"). The card's flip to Time is the cap's whole announcement.

The compact glyph is `repeat`: a complex is one thing done five ways and then done again, and the
round is the unit — the glyph is "again". It stays through idle, running, held and over, because
the trailing slot is where the cap speaks and a glyph that changed under it would be two things
saying one thing.

### The round trip, measured — and what it needed

The question every earlier section of this file left open ("the JavaScript half still needs a
signed-in phone") is answered. With the app backgrounded and the permanent test account signed in,
a Next move on the expanded island was traced through `runningboardd`, the app and the widget:

- The system wakes the app for the intent (`running-active`), `perform()` returns, and the
  process is suspended again **~100 ms later** (`running-suspended` at +100 ms in
  `webcontent-state-log.txt`).
- The web engine **runs inside that window**: `WebPage::runJavaScriptInFrameInScriptWorld`
  succeeded 50 ms after the tap, and the engine's own state — the next movement's name — reached
  the sink. But the sink's coalescer had just pushed the optimistic frame, so it queued the
  engine's state for a second later, and the process was asleep by then. The frame went out on
  the **next** tap: the card showed `Close Grip Push Up · 0 rounds + 1 movement` for a full minute,
  then jumped to `Kettlebell Sumo Deadlift High Pull · 1 round` the moment Round done was pressed
  (`63-real-after-next-move-1s-crop.png` … `66-real-after-round-done-crop.png`).

Two changes, both in the sink, close it:

1. **The four action intents hold `perform()` open** until the engine's state has been pushed to
   ActivityKit, or 1.5 s has passed (`LiveActionRouter.settle`, `LiveActivitySink.settle`). The
   intent still running is what keeps the process awake; the engine's answer releases it. Only
   `flush()` — the engine's own states — resolves the wait; the optimistic frame never does.
2. **No coalescing in the background.** The 1 s coalescer exists for the foreground, where one
   thumb makes three states a second; a state arriving while the app is not in front is the engine
   answering a tap inside the wake window, and a timer set for later fires on the next wake.

After that, the same tap: `Close Grip Push Up · 1 round` → **1.2 s** → `Kettlebell Sumo Deadlift
High Pull · 1 round + 1 movement`, the engine's own frame, app still in the background
(`68-real-expanded-before-next-move-crop.png` → `69-real-after-next-move-settled-crop.png`,
`settle-timing-log.txt`: action at +0.000 s, JavaScript at +0.110 s, second ActivityKit update at
+0.116 s, suspension at +0.258 s). Round 2 done the same way (`70-real-after-round-2-done-crop.png`),
and the phone, opened afterwards, agrees: `2 rounds`, `6:01` on the ring, Round 3 done
(`71-real-phone-agrees-2-rounds.png`). The optimistic frame is still drawn first — the counter
changes under the thumb — and is still the whole story for an engine that is not there (nobody
signed in, a web view mid-reload), where `retainUntilConsumed` holds the action as before.

### Typing a figure

A tap on the dial's reps or weight figure opens the phone on the set sheet with the dial's figures
in it and that field under the keyboard: `spotter://set/weight?reps=6&weight=15`, which
`openSetLink()` in app.ts answers with the sheet's own tap-to-type. The keypad comes up from a
programmatic focus because Capacitor's `CAPBridgeViewController` calls
`setKeyboardShouldRequireUserInteraction(false)` on the web view (its `_elementDidFocus` swizzle
passes `userIsInteracting = true`); nothing had to be set in `SpotterViewController`
(`90-real-figure-tap-sheet-keypad.png`: the sheet open on `15` with the field selected and the
keypad in the log — `_inputViewsForResponder … useKeyboard 1`, keyboard frame `402 × 233`).

What it took to make the figure a control at all:

- Apple documents `Link` for the expanded presentation. On the 17 Pro a `Link` on the figure
  answered the tap with the card's own `widgetURL` — `spotter://resume` — in the expanded island
  **and** on the Lock Screen (`83-real-weight-link-sheet.png`, `85-real-lockscreen-figure-tap.png`;
  SpringBoard logged `UIOpenURLAction url = spotter://resume` both times).
- A `Button(intent: TypeFigureIntent)` with `openAppWhenRun` did the same — until
  `.invalidatableContent()` came off the figure. WidgetKit treats that wrapper as display-only
  content, and a control inside it is not a control. The dim it gave the figure between a ± press
  and the app's update was never load-bearing (the optimistic push already changes the number
  under the thumb); the tap is.

So the figure is a button whose intent opens the app, and `LiveActivitySink.type` hands the engine
the link through the routed-link door a tapped notification's `url` uses (`openLink()` parks it if
the page cannot open it yet). The figures in the link are read at tap time — the dial's if it was
turned, the prefill's otherwise — so the number typed over is the number the card was showing.

### Weight from zero

The engine sends `dose.weight: 0` rather than null for a movement never loaded, and the card's
weight dial now exists at 0 and reads `0 LB`: on the real engine, Lat pulldown ("first time logging
this") opened with `0`, one `+` made it `5` (this account's plate), and eleven presses made it `55`
(`80-real-dial-weight-0-crop.png`, `81-real-dial-weight-5-crop.png`, `82-real-dial-weight-55-crop.png`,
`84-real-lockscreen-dial-55-crop.png` on the composited Lock Screen). `−` at 0 is `Dose.stepping`'s
no-op. The Log set pill lost its checkmark glyph so it still reads `Log set` beside `142.5` now that
the figure columns are 44 pt targets (`cards/worst-case-dial-light.png`).

### Moving on

After the last planned set, the engine's next state is a rest under the *next* movement with
`set 1 of N`. Read in every presentation, it already says what it is: the Lock Screen and the
expanded island print the new movement as the primary line with `Up next · Set 1 of 2` under it
and the rest counting (`95-real-moving-on-expanded-crop.png`: `Close grip row / Up next · Set 1
of 2 / 0:47`); the rest-over card prints `Next · Set 1 of 2 · 6-8 reps` with Start set; the nudge
says `Rest over — Close grip row, set 1 of 2`; the watch's rest page says `Next: Close grip row ·
set 1`. No copy changed. The phone agrees (`94-real-phone-moved-on.png`).

One thing the copy cannot fix: after the last set of the *last* movement the engine has nowhere to
move on to, and the card prints `Set 3 of 3` → `Set 4 of 4` for that rest ("Extras welcome" on the
phone). Pre-existing, noted, not touched.

### The rest, felt

The rest-end nudge is scheduled at `.timeSensitive` — the only notification in the app that is —
and `com.apple.developer.usernotifications.time-sensitive` is in the three entitlements files the
App target signs with (`Share` for Debug, `Push` for the paid-account Debug switch, `Release`),
read off `project.pbxproj`, `ios/debug.xcconfig`, `Local.xcconfig.example` and `App/Release.xcconfig`.
`ReleaseShared` and `Widgets` are the extensions' and are untouched; `Share.entitlements` is also
the ShareExtension's Debug and the ActionExtension's file, so those two carry the key too, which
is harmless (the capability is available to every account type and neither extension posts a
notification) and noted in the report.

Verified on the simulator with the app backgrounded: the banner arrives at the deadline labelled
**TIME SENSITIVE** (`96-nudge-banner-time-sensitive.png`), SpringBoard posts it at
`interruption-level: time-sensitive` and plays its sound (`nudge-sound-log.txt`: `Play sound for
notification`, `SBSoundController: played sound`), and Settings › Spotter › Notifications shows
the **Time Sensitive Notifications** switch the entitlement unlocks
(`93-settings-time-sensitive-recognised.png`). The vibration is the system's, per Sounds & Haptics,
and the simulator cannot show it; a Focus was not simulated either. Both are unverified on device.

The wrist: `WatchLink.scheduleRestAlarm` is called on every live state the phone sends, and a rest
started from the card is one — `.set` from the island → engine → `liveSync()` → `WatchLinkSink`
→ application context → `apply` → the haptic is armed from `rest.until`. A rest ended by
`.skipRest` arrives as a state with `rest: nil`, and `scheduleRestAlarm`'s first guard cancels the
alarm. The haptic only reaches the wrist while the watch app is frontmost (or a workout session
runs, behind the HealthKit switch); when it is not, the phone's rest-end notification is forwarded
to the watch by the system — watchOS documentation: "let the system forward the notifications to
the user's Apple Watch… the user only receives one notification at the best destination" — so
there is no second mechanism to build. Not run on a watch simulator this session (the paired watch
belongs to another session's phone).

### The wrist's complex

`SessionView` offers Next move and Round N done on a complex through the same two actions (61
lines), the score line in the subtitle with `Time` / `Cap paused` beside it, and the cap counting
down in the header where the elapsed clock was, in ember. `WatchLink.display` steps the counter
with the same `Complex.count` the phone's card uses. Not run on a watch simulator this session.

### Evidence

All under `…/ea52f5b1-f596-4620-a895-cc706c85be89/scratchpad/e/`.

| File | Shows |
| --- | --- |
| `cards/` | the ImageRenderer sheet, both appearances: every state that existed is byte-for-byte its old height; `complex-running/idle/held/over/counted` 145.3 pt, `worst-case-complex` 152.7, `xl-complex` 149.7, `dial-zero` 145.3 |
| `11-complex-running-compact-crop.png`, `12-complex-running-expanded-crop.png`, `15-complex-running-lockscreen-crop.png` | the fixture complex, cap running: `repeat` + `12:08` compact; elapsed / cap / score / two buttons expanded; the composited Lock Screen with `TIME CAP` and the dimmed `10:––` |
| `13-after-next-move-crop.png`, `14-after-round-done-crop.png`, `fixture-taps-log.txt` | Next move and Round 3 done from the background: `2 rounds + 1 movement` → `+ 2 movements` → `3 rounds`, `Round 4 done` |
| `20-…-idle-*`, `30-…-held-*`, `40-…-over-*` (compact, expanded, lockscreen) | idle (`15:00` static, `0 rounds`, `Round 1 done`), held (`4:10` muted, `PAUSED`), over (`Time` in the slots, `TIME` label, `3 rounds + 2 movements`) |
| `22-complex-idle-after-next-move-crop.png` | the first tap starts the cap under the thumb: `15:00` static → `14:53` ember, bar full |
| `50-cap-flip-before-crop.png`, `51-cap-flip-after-crop.png` | a 125 s cap, app backgrounded: `0:22` → `Time` on its deadline, nobody running |
| `60-…67-real-*`, `webcontent-state-log.txt` | the real engine, before the fix: the engine ran 50 ms after the tap, the process slept at +100 ms, the frame arrived on the next tap; the phone agreed when opened |
| `68-…71-real-*`, `settle-timing-log.txt` | after the fix: the engine's frame on the card 1.2 s after the tap, app in the background; the phone agreeing at 2 rounds |
| `80-…82-real-dial-weight-*`, `84-real-lockscreen-dial-55-crop.png` | the weight dial at 0, one plate, 55; on the Lock Screen |
| `83-real-weight-link-sheet.png`, `85-real-lockscreen-figure-tap.png`, `88-real-figure-tap-sheet.png` | the two dead ends: a `Link`, then an invalidatable button, both opening `spotter://resume` |
| `89-real-dial-15-before-type-crop.png`, `90-real-figure-tap-sheet-keypad.png`, `keyboard-log.txt` | the figure tap: the sheet open on `15` with the weight field selected, the keyboard raised by the programmatic focus |
| `94-real-phone-moved-on.png`, `95-real-moving-on-expanded-crop.png` | the last set logged: `Close grip row · Up next · Set 1 of 2` with the rest under it, phone and card |
| `93-settings-time-sensitive-recognised.png`, `96-nudge-banner-time-sensitive.png`, `nudge-delivery-log.txt`, `nudge-sound-log.txt` | the Time Sensitive switch in Settings; the banner at the deadline, app backgrounded, `interruption-level: time-sensitive`, sound played |
