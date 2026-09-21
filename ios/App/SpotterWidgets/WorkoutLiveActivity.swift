import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The running workout on the Lock Screen and in the Dynamic Island.
//
// Design notes and the research behind them are in design/native/live-activity.md.
// The five that constrain every edit to this file:
//
//   1. Nothing here ticks. Every clock is handed an instant — a start date or a
//      deadline — and rendered with Text(timerInterval:) or .timer style, so it
//      keeps counting while the app process is suspended and while the phone is
//      locked. A number that had to be pushed would freeze the moment the phone
//      went in a pocket, which is the entire feature. The one clock that is
//      rendered from a number is the paused session's, and it is frozen on
//      purpose: a `.timer` text keeps counting while the process is suspended,
//      and a paused session must not.
//   2. The layout does not change shape between phases. Apple's guidance is to
//      animate existing elements to new positions rather than remove and
//      re-add them; a rest starting therefore grows and re-colours the clock
//      rather than swapping the card for a different card.
//   3. One action. HIG: "prefer limiting it to a single element to help people
//      avoid accidentally tapping the wrong control". Rest offers Skip rest and
//      nothing else; work offers Log set — and, since 20 Sept, the dial beside
//      it, which is the one conscious trade against that rule: the owner asked
//      to "put in the sets and reps" from the island, and a Log set that can
//      only save the prefill is a button that logs the wrong number. The dial
//      is confined to the presentations WidgetKit allows buttons in (expanded
//      and Lock Screen), the ± targets are 44 pt so a miss is a near miss, and
//      the figures never leave the card until Log set carries them. Phases
//      whose action app.ts answers with "Log this one on the phone." offer
//      nothing at all. A complex (since 21 Sept) is the second trade: its two
//      taps — Next move and Round done — are the phone's own two buttons, and
//      a card that showed a fifteen-minute cap counting down with no way to
//      count a round was the owner's first complaint from the gym.
//   4. `context.isStale` is not an error state here, it is the alarm clock. A
//      rest's stale date IS its deadline (see LiveActivitySink.staleDate), so
//      the one moment ActivityKit re-renders this card without the app running
//      is the moment the rest ends — and every presentation has to have
//      something to say then. See PhaseLook.restOver. A complex's cap is the
//      same mechanism with a different word at zero: "Time", the phone's.
//   5. The compact slots are fixed-width. A timer Text asks the layout for the
//      widest string it could ever show, and ActivityKit gives a compact slot
//      whatever it asks for — which on the 17 Pro stretched the island across
//      the whole status bar with black between the glyph and the clock (owner,
//      20 Sept: "way too wide"). See IslandClock.
//
// Height budget: the system truncates a Lock Screen activity past 160 pt. The
// card below is ~145 pt at the default type size with the dial and ~150 at the
// 1.25x ceiling the scale is clamped to, which is why that clamp exists and why
// the movement name drops to one line whenever the dial is on the card.
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenWorkout(attributes: context.attributes, state: context.state,
                              isStale: context.isStale)
                .activityBackgroundTint(WidgetTheme.card)
                .activitySystemActionForegroundColor(WidgetTheme.emberInk)
        } dynamicIsland: { context in
            let look = PhaseLook(state: context.state, isStale: context.isStale)
            return DynamicIsland {
                // No captions in these two regions. They sit directly under the
                // island's top corners, and a caption there is clipped by the
                // curve itself — "TIME" lost its T and "REST" its T, which is
                // the HIG's "elements poking into the rounded shape" exactly.
                // The numbers need no label: one counts up in ink, the other
                // counts down in ember, and the centre region names both.
                DynamicIslandExpandedRegion(.leading) {
                    ElapsedClock(attributes: context.attributes, state: context.state, size: 15)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // Concentric inset: without it the first digit sits on
                        // the island's corner curve and loses its edge.
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandClock(attributes: context.attributes, state: context.state, size: 15,
                                isStale: context.isStale, elapsedFallback: false, restOverMark: true)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    // No workout title here, unlike the Lock Screen card. The
                    // expanded island is capped at 160 pt and with the dial
                    // row the card wanted ~168: the system clamped it and
                    // squeezed the centre to fit (measured on the 17 Pro).
                    // The title is the line worth least mid-workout — the
                    // person is in it — and dropping it lands the island at
                    // ~153 pt with nothing compressed.
                    VStack(alignment: .leading, spacing: 2) {
                        Text(look.primary)
                            .font(WidgetTheme.display(17))
                            .foregroundStyle(WidgetTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        if let detail = look.detail(labelled: false) {
                            Text(detail)
                                .font(.system(size: 12))
                                .foregroundStyle(WidgetTheme.ink2)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        PhaseBar(state: context.state, isStale: context.isStale)
                        CardControl(state: context.state, isStale: context.isStale)
                    }
                }
            } compactLeading: {
                Image(systemName: look.glyph)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(look.glyphTint)
            } compactTrailing: {
                IslandClock(attributes: context.attributes, state: context.state, size: 14,
                            isStale: context.isStale, snug: true, restOverMark: true)
            } minimal: {
                MinimalDial(attributes: context.attributes, state: context.state, look: look)
            }
            .keylineTint(WidgetTheme.ember)
            // Tapping anywhere that is not a button brings the session forward
            // rather than dropping the user on the last tab they used. For a
            // paused session that tap is the whole affordance: the card offers
            // no button, and the app's own resume bar is what resumes.
            .widgetURL(URL(string: "spotter://resume"))
        }
    }
}

// MARK: - One reading of the phase, shared by every presentation

/// What this phase looks like, decided once so the Lock Screen, the compact
/// island and the expanded island cannot drift into three different opinions
/// about whether a paused rest is "resting".
private struct PhaseLook {
    let state: WorkoutActivityAttributes.ContentState

    /// ActivityKit's own word for "this content is past the date its author gave
    /// it". For a running rest that date is the deadline, so this arrives as a
    /// timer going off rather than as a warning. See `restOver`.
    var isStale: Bool = false

    /// The rest ended and nobody has said so yet — the app is asleep, the
    /// engine's next state will not arrive until it wakes, and the system has
    /// re-rendered this card because the stale date passed.
    ///
    /// This is the only state on the card the app did not send. It exists
    /// because the alternative, seen on the 17 Pro, is an hourglass over a
    /// frozen 0:00 for as long as the phone stays in a pocket — a card that has
    /// the information and refuses to use it.
    var restOver: Bool { isStale && state.phase == .rest && !paused }

    // MARK: The complex

    /// The round counter and the cap, on a complex from an engine that sends
    /// them. Nil on every other phase, and nil on a complex from an older
    /// engine — which then gets the flat treatment it always had.
    var complex: LiveState.Complex? { state.phase == .complex ? state.complex : nil }

    /// The cap ran out: the engine said so, or its deadline passed while the
    /// app was asleep. A running cap's stale date is its deadline, exactly as
    /// a rest's is (LiveActivitySink.staleDate), so this is the same alarm
    /// clock as `restOver` with the phone's own word at zero: "Time".
    var capOver: Bool {
        guard let complex = complex else { return false }
        return complex.over || (isStale && complex.isRunning)
    }

    /// The cap is counting down. Ember, a hero-sized countdown, a bar that
    /// drains — the rest's treatment, because it is the same thing: a clock
    /// somebody is working against.
    var capRunning: Bool {
        guard let complex = complex, !capOver else { return false }
        return complex.isRunning
    }

    /// The cap was started and paused on the phone: a frozen remainder in
    /// muted ink, as a paused rest shows.
    var capHeld: Bool {
        guard let complex = complex, !capOver else { return false }
        return complex.isHeld
    }

    /// A cap nobody has started. The card prints the whole cap, static and
    /// quiet, so the number reads as "this is the clock" rather than as a
    /// countdown that has stopped; the first Next move or Round done starts it.
    var capIdle: Bool {
        guard let complex = complex, !capOver else { return false }
        return complex.isIdle
    }

    /// Whether the two complex buttons sit under the bar. Only where the
    /// counter is known: a complex from an older engine has no counter to
    /// change, so it keeps the empty control it had.
    var complexControl: Bool { complex != nil }

    /// True while a rest, a timed hold or a complex's cap is counting down and
    /// not paused. They share a treatment on purpose: Nike Training Club shows
    /// a drill's remaining time the same way it shows a break, and inventing a
    /// second visual language for "the clock is going down" would only be a
    /// puzzle.
    ///
    /// A rest that is over is not counting, whatever its deadline says: that one
    /// word is what turns the countdown back into elapsed time, the rest bar
    /// back into session progress and the ember hero back to normal weight,
    /// everywhere, without a second branch in each view.
    var counting: Bool {
        guard !restOver else { return false }
        if capRunning { return true }
        guard let rest = state.rest, state.phase == .rest || state.phase == .timed else { return false }
        return !rest.isPaused
    }

    /// The instant the running countdown reaches zero — the rest's deadline
    /// or the cap's — and nil when nothing is counting. Every clock, bar and
    /// ring below reads this rather than `state.rest`, so a cap and a rest
    /// cannot be drawn by two different opinions of what "counting" means.
    var deadline: Date? {
        guard counting else { return nil }
        if capRunning { return complex?.deadline }
        return state.rest?.deadline
    }

    /// The whole length of what is counting, for the bar's denominator.
    var countdownTotal: TimeInterval? {
        guard counting else { return nil }
        if capRunning { return complex?.capInterval }
        return state.rest?.totalInterval
    }

    /// A countdown stopped with time left on it: the seconds left and the
    /// share of the whole they are, for the frozen clock and the muted bar.
    var held: (remaining: TimeInterval, fraction: Double)? {
        if capHeld, let complex = complex {
            return (complex.remaining(), complex.remaining() / max(complex.capInterval, 1))
        }
        if paused, let rest = state.rest {
            return (rest.remaining(), rest.remaining() / max(rest.totalInterval, 1))
        }
        return nil
    }

    /// A rest that has been paused with time left on it. Not the session
    /// pausing — that is `halted`, and it is a different card.
    var paused: Bool {
        guard let rest = state.rest, state.phase == .rest || state.phase == .timed else { return false }
        return rest.isPaused
    }

    /// The whole session is stopped: paused from the phone, or restored at
    /// boot from a draft the process died in the middle of. Everything on the
    /// card is muted, the clock is frozen, and there is no button — resuming
    /// is a tap on the card, which opens the app on its resume bar.
    var halted: Bool { state.phase == .paused }

    var done: Bool { state.phase == .done }

    var glyph: String {
        if done { return "checkmark.circle.fill" }
        if halted { return "pause.fill" }
        // The hourglass is the symptom: it is what a frozen card shows. The
        // moment the rest is over the glyph is the lifter again, because that is
        // the whole message.
        if restOver { return "figure.strengthtraining.traditional" }
        if state.phase == .rest { return "hourglass" }
        if state.phase == .timed { return "timer" }
        // `repeat`, the loop: a complex is one thing done five ways and then
        // done again, and the round is the unit — the glyph is "again". It
        // stays through idle, running, held and over, because the trailing
        // slot is where the cap speaks and a glyph that changed under it
        // would be two things saying one thing.
        if complexControl { return "repeat" }
        return "figure.strengthtraining.traditional"
    }

    var glyphTint: Color {
        if done { return WidgetTheme.good }
        if halted { return WidgetTheme.muted }
        return WidgetTheme.ember
    }

    var clockLabel: String {
        if done { return "Done" }
        if halted { return "Paused" }
        if restOver { return "Rest over" }
        if state.phase == .rest { return paused ? "Paused" : "Rest" }
        if state.phase == .timed { return paused ? "Paused" : "Hold" }
        // The cap's label carries its news the way "Rest over" carries a
        // rest's: "Time" is the phone's word at zero (cxBody), and the slot
        // under it goes empty as the rest-over slot does. A counted complex
        // has no cap, and its clock is the session's elapsed time.
        if capOver { return "Time" }
        if capHeld { return "Paused" }
        if capRunning || capIdle { return "Time cap" }
        return "Elapsed"
    }

    /// The label is ember exactly when it is the thing to read: while a clock is
    /// running down, and in the second it stops.
    var labelTint: Color { (counting || restOver || capOver) ? WidgetTheme.emberInk : WidgetTheme.muted }

    /// The line that carries the card. On a finished session the sink has
    /// already put the closing headline in `exercise`, so this is one field in
    /// every phase and no presentation has to know which.
    var primary: String { state.exercise }

    /// The set line: position, then what the set asks for, then the weight —
    /// joined only from the parts that exist, so a bodyweight AMRAP round reads
    /// as a short line rather than a line full of separators.
    ///
    /// `labelled` is whether the presentation already carries the phase in a
    /// label of its own. The Lock Screen does ("PAUSED" over the clock), so its
    /// paused line does not say the word again; the island's centre region has
    /// no label, so its line leads with it.
    func detail(labelled: Bool) -> String? {
        // Finished: the sink built "42:10 · 18 sets · 2 PRs" into `target`.
        if done { return state.target }

        // Paused: where it stopped, and how much of it is banked. Not what the
        // set asks for — nobody is about to do it — and not the weight.
        if halted {
            var parts: [String] = []
            if !labelled { parts.append("Paused") }
            if let label = state.setLabel { parts.append(label) }
            else if let block = state.block { parts.append(block) }
            let done = state.progress.done
            parts.append(String(done) + (done == 1 ? " set logged" : " sets logged"))
            return parts.joined(separator: "  ·  ")
        }

        // Rest over: the same fields as a rest, plus what the set asks for. The
        // countdown had the card's attention for the last minute and now has
        // nothing to say, so the space goes to the thing that replaced it — and
        // "Set 3 of 3 · 10 reps" is what someone standing over a bar needs
        // without unlocking anything. "Next" rather than "Up next": the waiting
        // is finished and the copy should stop implying it.
        if restOver {
            var parts: [String] = []
            if let label = state.setLabel { parts.append(label) }
            else if let next = state.next { parts.append(next) }
            if let target = state.target { parts.append(target) }
            if parts.isEmpty, let block = state.block { parts.append(block) }
            guard !parts.isEmpty else { return nil }
            return "Next  ·  " + parts.joined(separator: "  ·  ")
        }

        // Resting: `set` still describes the set you are about to do, which is
        // what the engine leaves there while the clock runs — so it is labelled
        // rather than rebuilt. What it asks for and what it weighs are on the
        // phone; the Lock Screen's job during a rest is the countdown.
        if state.phase == .rest {
            if let label = state.setLabel { return "Up next  ·  " + label }
            if let next = state.next { return "Up next  ·  " + next }
            return state.block
        }

        // A complex with its counter: the score, written the way the phone's
        // own screen writes it — "3 rounds + 2 movements", rounds done plus
        // what was done of the next one. Not the target and not the weight:
        // on a complex those describe the block's first movement, and the
        // primary line above already names the one the round is up to.
        if let complex = complex { return complex.score }

        // A complex from an older engine is scored in rounds off one screen
        // the card cannot see into, so it has no set position; the block is
        // the only thing that locates you inside it.
        var parts: [String] = []
        if state.phase == .complex, let block = state.block { parts.append(block) }
        if let label = state.setLabel { parts.append(label) }
        if let target = state.target { parts.append(target) }
        // With the dial on the card the weight is already on it, as a number a
        // thumb can turn; printing "24 kg" a second time in the line above it
        // would be the card contradicting itself the moment the dial moves.
        if state.dial?.weight == nil, let weight = state.weight { parts.append(weight) }
        if parts.isEmpty, let block = state.block { parts.append(block) }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }

    /// The single action, or none. `timed` is deliberately absent: app.ts
    /// answers a remote Save for it with "Log this one on the phone.", and a
    /// button that only ever produces a toast is worse than no button. `work`
    /// on a set the engine itself calls unloggable (a timed movement before
    /// its hold starts) is absent for the same reason, and a paused session
    /// offers nothing but the card itself to tap. A complex is not here at
    /// all: it has two taps, not one (`complexControl`), and a complex from
    /// an engine that sends no counter has none.
    var action: ActionKind? {
        if halted { return nil }
        if restOver { return .startSet }
        if state.phase == .rest { return .skipRest }
        if state.phase == .work { return state.loggable ? .logSet : nil }
        return nil
    }

    /// Whether the dial sits beside the button: only Log set carries figures,
    /// and only when the engine sent a dose to build them from.
    var hasDial: Bool { action == .logSet && state.dial != nil }
}

/// Start set and Skip rest send the SAME action — `skipRest` — because at the
/// deadline they ask the engine for the same thing: end this rest and put me on
/// the next set. Only the words differ, and they have to: "Skip rest" over a
/// rest that is already over reads as an offer to lose something.
///
/// It is deliberately not `set`. The brief asked whether the engine's `set`
/// would log the next set from here, and for straight sets it would — but a
/// circuit's rest carries the owed advance to the next station in `restThen`,
/// and `saveSet()` starts a fresh rest that overwrites it. So a Log set tapped
/// during a circuit rest would log an extra set at the station just finished
/// and silently swallow the move to the next one. `skipRest` is also the safe
/// one to retain: the action is held until the web view wakes, and by then the
/// engine may have ended the rest itself — `skipRest` then does nothing, where
/// a retained `set` would log a set nobody performed.
private enum ActionKind {
    case skipRest, logSet, startSet

    var title: String {
        switch self {
        case .skipRest: return "Skip rest"
        case .logSet: return "Log set"
        case .startSet: return "Start set"
        }
    }

    var glyph: String {
        switch self {
        case .skipRest: return "forward.fill"
        case .logSet: return "checkmark"
        case .startSet: return "arrow.right"
        }
    }
}

// MARK: - Pieces

/// Elapsed session time: a live timer from the start instant, or — while the
/// session is paused — the frozen distance between the start and the pause,
/// as a plain string in muted ink. One view, so the leading slot of the
/// expanded island and the fallback of every other clock cannot disagree
/// about whether a paused session's clock is running. (It is not.)
///
/// `Text(timerInterval:)`, not `Text(_:style: .timer)`. On the composited Lock
/// Screen of a locked 17 Pro the date-style timer is not driven at all: it
/// printed the words "18 minutes" where the card should have read 18:10, in
/// a state that was nowhere near stale (the earlier "26 minutes" sighting was
/// the same thing, blamed on staleness at the time). The interval form is the
/// one ActivityKit documents for Live Activities and the one the countdowns
/// already use, and it counted on the locked screen in every capture. The
/// range runs to the twelve hours a Live Activity can exist on the Lock
/// Screen; hours appear only once there is one.
private struct ElapsedClock: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var size: CGFloat = 14

    var body: some View {
        Group {
            if state.phase == .paused {
                if let pausedAt = state.pausedAt {
                    Text(WorkoutActivityAttributes.clock(pausedAt.timeIntervalSince(attributes.startedAt)))
                        .foregroundStyle(WidgetTheme.muted)
                }
                // A pause with no instant has no honest number: the slot stays
                // empty rather than showing a timer that counts a stopped
                // session. The contract always sends one.
            } else {
                Text(timerInterval: attributes.startedAt...attributes.startedAt.addingTimeInterval(12 * 60 * 60),
                     pauseTime: nil, countsDown: false, showsHours: true)
                    .foregroundStyle(WidgetTheme.ink2)
            }
        }
        .font(WidgetTheme.numeral(size))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

/// Elapsed session time, the rest countdown, or a frozen remainder when the
/// rest is paused. All three are one view so the number never moves between
/// phases — only its size and colour change.
///
/// `snug` is the compact island's fix. SwiftUI sizes a timer Text for the
/// widest string it might ever show, and a compact Dynamic Island slot is
/// given whatever width it asks for: with only a `minWidth` here the island
/// on the 17 Pro stretched to the status bar's edges, glyph far left, clock
/// far right, black between. Snug means a fixed frame of three digit-widths
/// and a colon — `m:ss` in this face, measured at 41.5 pt for 14 pt — and the
/// hour case scales down inside it through `minimumScaleFactor` rather than
/// widening the slot. Verified on the 17 Pro at 0:18, 12:34, 1:02:34 and a
/// 2:09 countdown.
///
/// Only the compact slot is snug. The same fixed frame on the Lock Screen
/// made the system's live timer give up on digits and print "18 min…" — a
/// timer Text that cannot have the width it reserves switches format before
/// it scales — so the card keeps the minimum-width frame it always had, where
/// a Spacer absorbs whatever the timer asks for and nothing else moves.
private struct IslandClock: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var size: CGFloat = 14
    var isStale: Bool = false
    /// Fixed-width slot (the compact island) rather than minimum-width.
    var snug: Bool = false
    /// Whether to fall back to the elapsed session time when nothing is
    /// counting down. Compact and minimal have one clock slot, so they want it.
    /// The expanded presentation already prints elapsed in its leading region,
    /// and printing it again in the trailing one put the same number on screen
    /// twice for the whole of every work phase — so expanded passes false and
    /// leaves the slot empty until a countdown has something to say.
    var elapsedFallback: Bool = true
    /// Whether this slot should say "Go" when the rest is over.
    ///
    /// Only the two Dynamic Island slots do. The island has no room for the
    /// "REST OVER" label the Lock Screen card carries, so the word has to be in
    /// the slot the countdown just vacated, where the eye already is. The Lock
    /// Screen has the label, so its clock goes back to elapsed session time
    /// rather than printing the same news twice.
    var restOverMark: Bool = false

    var body: some View {
        let look = PhaseLook(state: state, isStale: isStale)
        Group {
            if look.done {
                Image(systemName: "checkmark")
                    .font(.system(size: size, weight: .bold))
                    .foregroundStyle(WidgetTheme.good)
            } else if look.halted {
                // Frozen at the pause, in every slot that shows elapsed time.
                // ElapsedClock owns the arithmetic. The expanded island's
                // trailing slot (elapsedFallback false) gets the pause glyph
                // instead: its leading region already prints the frozen
                // clock, and a static text there vanished on the 17 Pro
                // whenever this slot was left empty — a timer text did not —
                // so the slot is not left empty.
                if elapsedFallback {
                    ElapsedClock(attributes: attributes, state: state, size: size)
                } else {
                    Image(systemName: "pause.fill")
                        .font(.system(size: size, weight: .semibold))
                        .foregroundStyle(WidgetTheme.muted)
                }
            } else if look.restOver {
                // Nothing here may be a live timer. Once the system marks an
                // activity stale it stops driving them: on the 17 Pro the
                // elapsed slot came back as the words "26 minutes" instead of
                // 26:14, because Text(style: .timer) degrades to a static
                // relative phrase rather than counting. So the Island gets a
                // word the card chose, and the Lock Screen gets an empty slot
                // it keeps the width of — the layout does not move, and the
                // "REST OVER" label above it is already saying this.
                if restOverMark {
                    Text("Go")
                        .foregroundStyle(WidgetTheme.ember)
                }
            } else if look.capOver {
                // The cap's "Go": the phone's word for a cap at zero, in the
                // two island slots that have no label to say it. The Lock
                // Screen's label says TIME and its slot goes empty, width
                // held, exactly as it does for a rest that is over.
                if restOverMark {
                    Text("Time")
                        .foregroundStyle(WidgetTheme.ember)
                }
            } else if let held = look.held {
                // A rest or a cap paused with time left: the remainder,
                // frozen, in muted ink.
                Text(Duration.seconds(held.remaining), format: .time(pattern: .minuteSecond))
                    .foregroundStyle(WidgetTheme.muted)
            } else if let deadline = look.deadline {
                // A ClosedRange traps when its upper bound is below its lower
                // one, and an activity that lingers a second past its deadline
                // would do exactly that. The floor keeps a finished rest
                // rendering as 0:00 instead of crashing the widget process.
                Text(timerInterval: Date()...max(deadline, Date().addingTimeInterval(1)), countsDown: true)
                    .foregroundStyle(WidgetTheme.ember)
            } else if look.capIdle, !snug, let complex = look.complex {
                // The whole cap, static and in the elapsed clock's ink, so it
                // reads as the length of the clock and not as a countdown that
                // has stopped. The compact slot keeps elapsed time instead: a
                // 15:00 that never moves beside the status bar's own clock
                // looks like a broken timer.
                Text(WorkoutActivityAttributes.clock(complex.capInterval))
                    .foregroundStyle(WidgetTheme.ink2)
            } else if elapsedFallback {
                ElapsedClock(attributes: attributes, state: state, size: size)
            }
        }
        .font(WidgetTheme.numeral(size))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(minWidth: snug ? nil : size * 3.1)
        .frame(width: snug ? (size * 3).rounded(.up) : nil, alignment: .trailing)
        .multilineTextAlignment(.trailing)
    }
}

/// The countdown or the session's own progress, in one 5 pt rule. During a rest
/// it is driven by the deadline, so like every other clock here it advances
/// without an update; the rest of the time it is the share of planned sets that
/// are logged.
///
/// Only the countdown is a ProgressView. Every fixed-value bar is two capsules,
/// drawn by hand — a linear ProgressView squeezed into a 5 pt frame ignored its
/// tint and came out system yellow in every render, and a bar that is not ember
/// is not Spotter's. Two capsules cannot drift.
private struct PhaseBar: View {
    let state: WorkoutActivityAttributes.ContentState
    var isStale: Bool = false

    var body: some View {
        let look = PhaseLook(state: state, isStale: isStale)
        Group {
            if look.done {
                Bar(fraction: 1, tint: WidgetTheme.good)
            } else if look.halted {
                // Session progress, like work — but muted, like everything
                // else on a card nobody is training against.
                Bar(fraction: state.progress.fraction, tint: WidgetTheme.muted)
            } else if let deadline = look.deadline, let total = look.countdownTotal,
                      let span = span(to: deadline, over: total) {
                // A rest or a cap draining: the one bar that animates without
                // an update.
                ProgressView(timerInterval: span, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.linear)
                .tint(WidgetTheme.ember)
            } else if let held = look.held {
                Bar(fraction: held.fraction, tint: WidgetTheme.muted)
            } else {
                Bar(fraction: state.progress.fraction, tint: WidgetTheme.ember)
            }
        }
        .frame(height: 5)
    }

    /// The whole countdown as a range, clamped so the upper bound is always
    /// above the lower one even a second after the deadline passes.
    private func span(to deadline: Date, over total: TimeInterval) -> ClosedRange<Date>? {
        let end = max(deadline, Date().addingTimeInterval(1))
        let start = end.addingTimeInterval(-max(total, 1))
        guard start < end else { return nil }
        return start...end
    }
}

/// A track and a fill, both capsules, with the fill clamped into the track.
private struct Bar: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(WidgetTheme.sand)
                Capsule().fill(tint)
                    .frame(width: geo.size.width * min(1, max(0, fraction)))
            }
        }
    }
}

/// The interactive strip under the bar, or nothing. The one place that decides
/// between the dial row and a lone button, so the expanded island and the Lock
/// Screen card cannot make that choice differently.
private struct CardControl: View {
    let state: WorkoutActivityAttributes.ContentState
    var isStale: Bool = false

    var body: some View {
        let look = PhaseLook(state: state, isStale: isStale)
        if let complex = look.complex {
            ComplexRow(complex: complex)
        } else if look.hasDial, let dial = state.dial {
            DialRow(dial: dial)
        } else if let action = look.action {
            ActionButton(action: action)
        }
    }
}

/// The complex's two taps: `[Next move]  [Round 3 done]`, the phone's own
/// two buttons on one 44 pt row. Round done is the primary (ember) because it
/// is the one that scores; Next move ticks the movement the round is up to and
/// its fifth tick is the round, so the two never disagree. Both run in the
/// app (`LiveActivityIntent`), draw an optimistic frame from the counter, and
/// reach `cxMark()` / `cxRound()` through the same door as Log set.
///
/// Two controls, against the HIG's "prefer limiting it to a single element":
/// the second conscious trade on this card, argued in
/// design/native/live-activity.md. The pills are 34 pt inside 44 pt targets
/// with an 8 pt gutter, and a miss lands on the other count — which the
/// phone's Undo takes back — never on Log set or Skip rest, which are not on
/// this row.
private struct ComplexRow: View {
    let complex: LiveState.Complex

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: MarkMoveIntent()) {
                pill("Next move", glyph: "checkmark", fill: WidgetTheme.sand, ink: WidgetTheme.ink)
            }
            .buttonStyle(.plain)
            Button(intent: RoundDoneIntent()) {
                pill("Round " + String(complex.rounds + 1) + " done", glyph: "repeat",
                     fill: WidgetTheme.ember, ink: WidgetTheme.onEmber)
            }
            .buttonStyle(.plain)
        }
        .frame(height: 44)
    }

    private func pill(_ title: String, glyph: String, fill: Color, ink: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: glyph).font(.system(size: 11, weight: .bold))
            Text(title).font(.system(size: 14, weight: .semibold))
        }
        .foregroundStyle(ink)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity)
        .frame(height: 34)
        .background(fill, in: Capsule())
        // The pill is 34 pt; the tappable label is 44.
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

/// The one interactive element. `LiveActivityIntent` is what makes this legal:
/// the system runs `perform()` in the app's process, waking the app in the
/// background if it has to, which is the only way a Lock Screen tap can reach
/// the workout engine at all.
private struct ActionButton: View {
    let action: ActionKind

    var body: some View {
        Group {
            switch action {
            // Start set is Skip rest wearing the right word for a rest that has
            // already run out. See the note on ActionKind.
            case .skipRest, .startSet: Button(intent: SkipRestIntent()) { label }
            case .logSet: Button(intent: LogSetIntent()) { label }
            }
        }
        .buttonStyle(.plain)
    }

    private var label: some View {
        HStack(spacing: 6) {
            Image(systemName: action.glyph).font(.system(size: 11, weight: .bold))
            Text(action.title).font(.system(size: 14, weight: .semibold))
        }
        .foregroundStyle(WidgetTheme.onEmber)
        .frame(maxWidth: .infinity)
        .frame(height: 30)
        .background(WidgetTheme.ember, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// The dial: `[−] 10 reps [+]   [−] 24 kg [+]   [Log set]`, on one 44 pt row.
///
/// Built from Buttons because those and Toggles are the only controls
/// WidgetKit runs in a Live Activity — there is no Stepper here — and every
/// press is its own `AdjustSetIntent`, run in the app, which steps the figure
/// with the phone's own clamp and pushes the card again at once. None of it
/// reaches JavaScript; only Log set does, carrying the figures. A bodyweight
/// movement has no weight to turn and shows the reps dial alone.
///
/// The row is 44 pt tall so every target is 44 pt (HIG minimum), while the
/// visible circles and pill are 32 and 34: the hit area extends into the
/// row's gutter, not the neighbour's. The value between the two circles is a
/// control too, since 21 Sept — a `Link`, not a button: a tap on the number
/// opens the phone's set sheet with these figures in it and that field under
/// the keyboard, which is the one thing a card cannot do for itself ("i will
/// want to be able to type it in"). Its target is the 44 pt column between
/// the two circles, so the three targets in a group abut and never overlap.
///
/// The weight half exists whenever the engine sent a weight, and 0 is a
/// weight: the phone's sheet opens on 0 for every set, and a card that hid
/// the dial until something had been logged had no way to log the first one.
private struct DialRow: View {
    let dial: WorkoutActivityAttributes.ContentState.Dial

    var body: some View {
        HStack(spacing: 6) {
            DialGroup(field: .reps, value: String(dial.reps), unit: "reps", link: link(.reps))
            if let weight = dial.weight {
                DialGroup(field: .weight, value: Self.format(weight), unit: dial.unit, link: link(.weight))
            }
            Button(intent: LogSetIntent()) {
                // No checkmark here, unlike the lone Log set button: the two
                // figure columns are 44 pt targets since 21 Sept and the pill
                // is what gives way, down to ~58 pt beside "142.5" — the
                // glyph's 16 pt was the difference between "Log set" and
                // "Log…" (measured in LiveActivityShots' worst-case-dial).
                Text("Log set").font(.system(size: 14, weight: .semibold))
                .foregroundStyle(WidgetTheme.onEmber)
                .lineLimit(1)
                // Down to 0.6: beside a five-character weight ("142.5") the
                // pill has ~58 pt, and the word needs 0.9 of its size to fit.
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .background(WidgetTheme.ember, in: Capsule())
                // The pill is 34 pt; the tappable label is 44.
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(height: 44)
    }

    /// 60, not 60.0; 62.5 keeps its half. Matches the sheet's own stepper and
    /// the wrist.
    static func format(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    /// `spotter://set/weight?reps=12&weight=55` — the deep link the engine
    /// answers by opening the set sheet with both figures in it and the named
    /// field under the keyboard (`openSetLink()` in app.ts). The figures are
    /// the dial's, so a number turned on the card is the number typed over.
    /// Nothing but digits and a dot ever goes in the query.
    private func link(_ field: DialField) -> URL? {
        var query = "reps=" + String(dial.reps)
        if let weight = dial.weight { query += "&weight=" + Self.format(weight) }
        return URL(string: "spotter://set/" + field.rawValue + "?" + query)
    }
}

/// One figure between its two buttons.
private struct DialGroup: View {
    let field: DialField
    let value: String
    let unit: String
    /// Where a tap on the figure takes the phone; nil draws a plain figure.
    var link: URL? = nil

    var body: some View {
        HStack(spacing: 0) {
            StepButton(field: field, delta: -1)
            if let link = link {
                // A Link, not a Button(intent:): the figure's tap is the one
                // that has to leave the card, because typing is the phone's.
                Link(destination: link) { figure }
            } else {
                figure
            }
            StepButton(field: field, delta: 1)
        }
    }

    private var figure: some View {
        VStack(spacing: -1) {
            Text(value)
                .font(WidgetTheme.numeral(17))
                .foregroundStyle(WidgetTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(unit.uppercased())
                .font(WidgetTheme.label(9))
                .tracking(0.4)
                .foregroundStyle(WidgetTheme.muted)
                .lineLimit(1)
        }
        // 44 wide, not 34: the column is a target now, the same size as the
        // circles either side of it. Beside the widest weight ("142.5") the
        // Log set pill gives way, as it always did.
        .frame(minWidth: 44)
        // The figure keeps its own width and the Log set pill gives way:
        // the pill is the flexible element in the row, and without this
        // it squeezed "142.5" into "14…" while keeping its own slack.
        .fixedSize(horizontal: true, vertical: false)
        .frame(height: 44)
        .contentShape(Rectangle())
        // The system's own "waiting for the intent" treatment: the figure
        // dims from the press until the app's update lands, which is the
        // honest state of a number that is being changed in another
        // process. Judiciously, per WidgetKit: on the figure only.
        .invalidatableContent()
        .accessibilityElement(children: .combine)
        .accessibilityHint(link == nil ? "" : "Opens the set sheet on the phone to type it")
    }
}

/// A ± button. 32 pt circle, 44 pt target, glyph in bold — the HIG's "medium
/// weight or higher" for anything read at a glance.
private struct StepButton: View {
    let field: DialField
    let delta: Int

    var body: some View {
        Button(intent: AdjustSetIntent(field: field, delta: delta)) {
            Image(systemName: delta < 0 ? "minus" : "plus")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(WidgetTheme.ink)
                .frame(width: 32, height: 32)
                .background(WidgetTheme.sand, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var label: String {
        switch (field, delta < 0) {
        case (.reps, true): return "Fewer reps"
        case (.reps, false): return "More reps"
        case (.weight, true): return "Less weight"
        case (.weight, false): return "More weight"
        }
    }
}

/// The minimal presentation is the smallest thing this app draws: a ring while
/// a clock is running, the phase's glyph otherwise. No text — at this size a
/// truncated "2/4" is a smudge.
private struct MinimalDial: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    let look: PhaseLook

    var body: some View {
        Group {
            if let deadline = look.deadline {
                ProgressView(timerInterval: Date()...max(deadline, Date().addingTimeInterval(1)),
                             countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(WidgetTheme.ember)
            } else {
                Image(systemName: look.glyph)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(look.glyphTint)
            }
        }
    }
}

// MARK: - Lock Screen

// Internal rather than private: the App target compiles this file too, so a
// DEBUG-only harness can render this exact card to a PNG. See LiveActivityShots.
struct LockScreenWorkout: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    /// Passed straight through from `context.isStale`. Defaulted so the DEBUG
    /// ImageRenderer harness can draw any phase without one, and so that adding
    /// it could not change a single pixel of the states that were already signed
    /// off in design/native/live-activity.md.
    var isStale: Bool = false

    // WidgetTheme's sizes are fixed points, which is what keeps the wave's four
    // surfaces identical — but a fixed point size ignores Dynamic Type
    // completely. Scaling them by the body metric restores it, and clamping the
    // factor at 1.25 keeps the card inside the 160 pt the system truncates at.
    // Scaled from 100, not from 1: UIFontMetrics rounds, and asking it to scale
    // a unit returns 1.0 at every Dynamic Type size — which looked like working
    // Dynamic Type support right up until two renders at different sizes came
    // out byte-identical.
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 100

    private var scale: CGFloat { min(max(typeScale / 100, 1), 1.25) }

    /// Two lines for a long movement name is worth the height at ordinary type
    /// sizes and is not at large ones: "Bulgarian Split Squat (Rear Foot
    /// Elevated)" wrapped at 1.25x measured 166 pt, past the 160 the system
    /// truncates at — and what the system truncates is the bottom of the card,
    /// which is the button. One shrunk line keeps the whole card. The dial row
    /// is 14 pt taller than the button it replaces, so with the dial on the
    /// card the same name is one line at every size: two lines plus the dial
    /// would measure ~166 pt at the default size alone. The complex's row is
    /// the dial row's height, and gets the same rule.
    private func heroLines(_ look: PhaseLook) -> Int {
        (scale > 1.12 || look.hasDial || look.complexControl) ? 1 : 2
    }

    var body: some View {
        let look = PhaseLook(state: state, isStale: isStale)
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(attributes.title.uppercased())
                    .font(WidgetTheme.label(10.5 * scale))
                    .tracking(0.6)
                    .foregroundStyle(WidgetTheme.muted)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(look.clockLabel.uppercased())
                    .font(WidgetTheme.label(10.5 * scale))
                    .tracking(0.6)
                    .foregroundStyle(look.labelTint)
                    .lineLimit(1)
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(look.primary)
                        .font(WidgetTheme.display(19 * scale))
                        .foregroundStyle(WidgetTheme.ink)
                        .lineLimit(heroLines(look))
                        .minimumScaleFactor(0.65)
                    if let detail = look.detail(labelled: true) {
                        Text(detail)
                            .font(.system(size: 13 * scale))
                            .foregroundStyle(WidgetTheme.ink2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                Spacer(minLength: 4)
                // The countdown becomes the hero by growing and turning ember,
                // not by taking the movement's place. See the note at the top.
                IslandClock(attributes: attributes, state: state,
                            size: (look.counting ? 30 : 22) * scale, isStale: isStale)
            }
            PhaseBar(state: state, isStale: isStale)
            CardControl(state: state, isStale: isStale)
        }
        .padding(.horizontal, 16)
        // 11 rather than the 14 this started at: a two-line movement name at
        // Dynamic Type XL is the tallest this card can get, and it has to clear
        // the 160 pt the system truncates at with room to spare.
        .padding(.vertical, 11)
        // Tapping the card resumes the session rather than dropping the user on
        // whichever tab the app was last left on.
        .widgetURL(URL(string: "spotter://resume"))
    }
}

#if DEBUG
#Preview("Lock Screen", as: .content, using: WorkoutActivityAttributes.sample) {
    WorkoutLiveActivity()
} contentStates: {
    WorkoutActivityAttributes.sampleContent
    WorkoutActivityAttributes.sampleResting
}

#Preview("Dynamic Island", as: .dynamicIsland(.expanded), using: WorkoutActivityAttributes.sample) {
    WorkoutLiveActivity()
} contentStates: {
    WorkoutActivityAttributes.sampleContent
    WorkoutActivityAttributes.sampleResting
}
#endif
