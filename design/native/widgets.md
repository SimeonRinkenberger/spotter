# Home Screen and Lock Screen widgets

Spotter's WidgetKit surfaces: what they show, why that and not something else, and what a
tap on each one does. Written before the code, from the sources at the bottom.

## What a Spotter widget is for

The app answers three questions on its own home: *am I on pace this week*, *what am I doing
today*, and *am I still on a run*. A widget cannot answer a fourth question and should not
try to answer all three at once — Apple's own line is to "choose simple ideas that relate to
your app's main purpose" and that "sparse layouts can make the widget seem unnecessary,
while overly dense layouts are less glanceable".

So: one widget per question, sized to the question. The week is a shape (dots and a
numeral) and fits a small square. Today is a sentence and an action, which needs a medium.
The Lock Screen gets the compressed version of both, because a Lock Screen glance is the one
that happens on the way to the gym.

## Content matrix

| Family | Widget kind | Gallery name | Content | Tap |
| --- | --- | --- | --- | --- |
| `systemSmall` | `SpotterWeek` | **This week** | Seven day dots Mon..Sun (done = ember filled, planned-and-still-ahead = ember ring, otherwise a `line` track); "3 of 4" in rounded numerals over "this week"; footer "6-week streak" / "New streak". `atRisk` → numeral in ember-ink and the eyebrow reads "1 to go". | `spotter://tab/progress` |
| `systemMedium` | `SpotterToday` | **Today** | **Left:** today's title (2 lines), "42 min", and a **Start** pill. Running → "Workout running" + **Resume**. Nothing today → "Rest day" (the plan has other days this week) or "Nothing planned" (it does not) + **Pick a workout**, with "Next · Push day · Thu" underneath when there is a next day. **Right:** the same dot column + "3 of 4" compact, separated by a hairline. | Pill: `spotter://start/<id>`, `spotter://resume` or `spotter://tab/library`. Background: `spotter://tab/plan` |
| `accessoryCircular` | `SpotterLock` | **Spotter** | `Gauge(.accessoryCircularCapacity)` filled done/goal with the **done count** in the middle and the goal under it. | `spotter://tab/progress` |
| `accessoryRectangular` | `SpotterLock` | **Spotter** | Line 1 "Push day · 42 min" (or "Rest day" / "Nothing planned"); line 2 "3 of 4 this week · streak 6". | `spotter://tab/plan` |
| `accessoryInline` | `SpotterLock` | **Spotter** | "Push day today · 3/4 this week" (one string; inline has exactly one tap target and no layout). | `spotter://tab/plan` |

Three widget kinds rather than two: a kind that declares an accessory family appears in the
Lock Screen gallery under its own `configurationDisplayName`, so folding the accessories into
`SpotterWeek` and `SpotterToday` would put two differently-named Spotter rows in the Lock
Screen picker and make the reader choose between them before knowing what either looks like.
One kind named "Spotter" fills whichever accessory slot is being edited. The same split keeps
the Home Screen gallery honest: exactly two Spotter cards, each named after the question it
answers.

### Why the circular gauge counts sessions, not streak weeks

The brief left this open. The circular accessory is ~40pt across and the HIG says accessory
widgets "display a very limited amount of information". A capacity gauge already *is* a
statement of done-out-of-goal; putting the streak number in its centre would print two
unrelated numbers on one glyph — the ring saying "3 of 4 this week", the numeral saying "6"
(weeks) — and the reader has to work out which unit each is in. Apple's Activity complication
puts the ring and its own value together and nothing else. So the ring and the numeral say
the same thing here, and the streak, which needs a word next to it to mean anything, lives on
the rectangular family where there is room for the word.

### States

| State | What every family does |
| --- | --- |
| Placeholder (`redacted(.placeholder)`) | The provider hands back a real-shaped sample, so the system redacts text into capsules over a dot row and a gauge that still draw (shapes are not redacted). No blank square. |
| Signed out / nothing published | One calm line — "Open Spotter to see your week" (small, rectangular), "Open Spotter" (inline), an empty gauge with the training glyph (circular) — on paper. No call to action beyond opening the app, because a signed-out widget cannot know whose week to offer. |
| Stale (`updatedAt` older than 36 h) | Data still shows. The footer that would say the streak says "as of Tue" in muted instead. 36 h, not 24, so a phone untouched overnight does not accuse itself. |
| A day has turned since the publish | The entry at local midnight promotes `next` into the today slot when `next.day` is that date; otherwise the today slot falls back to its empty copy. The widget never re-derives a plan it was not given. |
| Undecodable payload | `SharedStore.readJSON` returns nil and logs; the widget shows the signed-out line rather than crashing the extension. |

### Timeline

Two entries — now and the next local midnight — with `.after(nextMidnight)`. Nothing between
those two moments changes without the app also changing it, and the app's `publish` already
calls `WidgetCenter.reloadAllTimelines()` on every data change. Apple budgets a widget 40–70
reloads a day and asks that entries be "at least about 5 minutes apart", so a self-scheduled
tick would spend the budget on nothing; a reload requested while the containing app is in the
foreground (which is when Spotter publishes) does not count against that budget at all.

### Theme and appearance

`WidgetTheme` (ported `:root` tokens) for every colour, SF Pro rounded monospaced digits for
anything that counts, `.containerBackground(WidgetTheme.paper, for: .widget)` so the system
owns the margins (16 pt standard, which is why nothing here hardcodes an outer padding).
The dot row and the week numeral carry `.widgetAccentable()` so the accented rendering mode
(Home Screen tinted appearance, watch complications) keeps the thing that matters in the
accent group. On the Lock Screen the vibrant rendering mode desaturates everything, so no
state in an accessory family is distinguished by colour alone — "1 to go" is words.

### Left out, and why

- **Volume, sets, minutes trained.** Hevy's aggregate widget is configurable because those
  numbers mean different things to different lifters. Spotter has one goal number; adding a
  second scale would make the small widget answer two questions badly.
- **A month grid.** Hevy's calendar widget is good and needs a `systemMedium` of its own.
  The dot strip is the same language the Progress tab speaks, and it fits the square.
- **`systemLarge`.** There is no fourth layer of information to put in it. The HIG: "it's
  more important to create one widget in the size that best represents the content than
  providing the widget in all sizes."
- **Interactive `Button`/`Toggle` (App Intents).** Logging a set from the Home Screen is the
  Live Activity's job (agent A) and would need an AppIntent target the extension does not
  have. The medium widget's Start is a `Link`, which opens the app — honest about what it
  does.
- **`accessoryCorner`** (watchOS only) and StandBy-specific art: the watch is agent D's
  surface, and StandBy renders the small widget scaled with its background removed, which
  this layout already survives.

## Sources

- Apple HIG, **Widgets** — anatomy, the system-family and accessory tables, Appearances
  (full-color / accented / vibrant rendering modes), Best practices ("balance information
  density"), Adding interactivity ("inline accessory widgets offer only one tap target"),
  Choosing margins and padding (16 pt standard, 11 pt for tighter groupings, smaller margins
  on the Lock Screen). <https://developer.apple.com/design/human-interface-guidelines/widgets>
- Apple, **Keeping a widget up to date** — the 40–70 reloads/day budget, the ~5 minute
  minimum entry spacing, and the list of reloads that are not charged (containing app in the
  foreground, app intents, appearance changes).
  <https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date>
- Apple, **Supporting additional widget sizes** / **WidgetFamily** — `@Environment(\.widgetFamily)`
  switch per family, conditional `supportedFamilies`.
  <https://developer.apple.com/documentation/widgetkit/supporting-additional-widget-sizes>
- Apple, **Creating accessory widgets and watch complications**, **WidgetRenderingMode**,
  `widgetAccentable(_:)` (accent group vs default group), `widgetURL(_:)` — "Widgets support
  one `widgetURL` modifier in their view hierarchy. If multiple views have `widgetURL`
  modifiers, the behavior is undefined", which is why the medium widget uses one `widgetURL`
  for the background and `Link` for the pill.
- **Hevy** home-screen widgets — weekly volume/activity, a consistency calendar, a
  day-of-week routine widget that starts a live workout on tap, and a weekly active-streak
  widget. Taken: the routine widget's start-on-tap, and the "active streak counted in weeks"
  framing that Spotter already uses. <https://www.hevyapp.com/features/home-screen-widgets/>
- **Gentler Streak** widget catalogue — Activity Status (small and rectangular), "Go Gentler"
  with a recommended session and a Start button, Lock Screen tiles that say whether today is
  a rest day. Taken: saying "rest day" out loud instead of leaving today blank.
  <https://docs.gentler.app/using-gentler-streak-widgets/overview-of-available-gentler-streak-widgets>
- **Apple Fitness / Activity** complication and **Apple Reminders** widget — a ring plus its
  own value and nothing else; Reminders' toggles as the example of interactivity the HIG
  points at. Taken: the gauge-says-one-thing rule above, and the decision *not* to ship
  buttons this wave.

## Screenshots

Captured on iPhone 17 (simulator 05366E18-C9F6-4B88-A674-B939DDFB9B81), listed in the agent
report with absolute paths: Home Screen small + medium in light and dark, the Lock Screen
circular / rectangular / inline trio, each tap target's landing screen, the post-session
update, and the signed-out state.
