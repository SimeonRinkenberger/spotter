import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The running workout on the Lock Screen and in the Dynamic Island.
//
// Design notes and the research behind them are in design/native/live-activity.md.
// The three that constrain every edit to this file:
//
//   1. Nothing here ticks. Every clock is handed an instant — a start date or a
//      deadline — and rendered with Text(timerInterval:) or .timer style, so it
//      keeps counting while the app process is suspended and while the phone is
//      locked. A number that had to be pushed would freeze the moment the phone
//      went in a pocket, which is the entire feature.
//   2. The layout does not change shape between phases. Apple's guidance is to
//      animate existing elements to new positions rather than remove and
//      re-add them; a rest starting therefore grows and re-colours the clock
//      rather than swapping the card for a different card.
//   3. One button, never two. HIG: "prefer limiting it to a single element to
//      help people avoid accidentally tapping the wrong control". Work offers
//      Log set, rest offers Skip rest, and the phases whose action app.ts
//      answers with "Log this one on the phone." offer nothing at all.
//
// Height budget: the system truncates a Lock Screen activity past 160 pt. The
// card below is ~130 pt at the default type size and ~160 at the 1.25x ceiling
// the scale is clamped to, which is why that clamp exists.
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenWorkout(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(WidgetTheme.card)
                .activitySystemActionForegroundColor(WidgetTheme.emberInk)
        } dynamicIsland: { context in
            let look = PhaseLook(state: context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedCorner(title: "Elapsed", alignment: .leading) {
                        Text(context.attributes.startedAt, style: .timer)
                            .font(WidgetTheme.numeral(15))
                            .foregroundStyle(WidgetTheme.ink2)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedCorner(title: look.clockLabel, alignment: .trailing) {
                        IslandClock(attributes: context.attributes, state: context.state, size: 15)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title.uppercased())
                            .font(WidgetTheme.label())
                            .tracking(0.6)
                            .foregroundStyle(WidgetTheme.muted)
                            .lineLimit(1)
                        Text(look.primary)
                            .font(WidgetTheme.display(17))
                            .foregroundStyle(WidgetTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        if let detail = look.detail {
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
                        PhaseBar(state: context.state)
                        if let action = look.action { ActionButton(action: action) }
                    }
                }
            } compactLeading: {
                Image(systemName: look.glyph)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(look.glyphTint)
            } compactTrailing: {
                IslandClock(attributes: context.attributes, state: context.state, size: 14)
            } minimal: {
                MinimalDial(attributes: context.attributes, state: context.state, look: look)
            }
            .keylineTint(WidgetTheme.ember)
            // Tapping anywhere that is not the button brings the session
            // forward rather than dropping the user on the last tab they used.
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

    /// True while a rest or a timed hold is counting down and not paused. The
    /// two share a treatment on purpose: Nike Training Club shows a drill's
    /// remaining time the same way it shows a break, and inventing a second
    /// visual language for "the clock is going down" would only be a puzzle.
    var counting: Bool {
        guard let rest = state.rest, state.phase == .rest || state.phase == .timed else { return false }
        return !rest.isPaused
    }

    var paused: Bool {
        guard let rest = state.rest, state.phase == .rest || state.phase == .timed else { return false }
        return rest.isPaused
    }

    var done: Bool { state.phase == .done }

    var glyph: String {
        if done { return "checkmark.circle.fill" }
        if state.phase == .rest { return "hourglass" }
        if state.phase == .timed { return "timer" }
        return "figure.strengthtraining.traditional"
    }

    var glyphTint: Color { done ? WidgetTheme.good : WidgetTheme.ember }

    var clockLabel: String {
        if done { return "Done" }
        if state.phase == .rest { return paused ? "Paused" : "Rest" }
        if state.phase == .timed { return paused ? "Paused" : "Hold" }
        return "Elapsed"
    }

    /// The line that carries the card. On a finished session the sink has
    /// already put the closing headline in `exercise`, so this is one field in
    /// every phase and no presentation has to know which.
    var primary: String { state.exercise }

    /// The set line: position, then what the set asks for, then the weight —
    /// joined only from the parts that exist, so a bodyweight AMRAP round reads
    /// as a short line rather than a line full of separators.
    var detail: String? {
        // Finished: the sink built "42:10 · 18 sets · 2 PRs" into `target`.
        if done { return state.target }

        // Resting: `set` still describes the set you are about to do, which is
        // what the engine leaves there while the clock runs — so it is labelled
        // rather than rebuilt. What it asks for and what it weighs are on the
        // phone; the Lock Screen's job during a rest is the countdown.
        if state.phase == .rest {
            if let label = state.setLabel { return "Up next  ·  " + label }
            if let next = state.next { return "Up next  ·  " + next }
            return state.block
        }

        // A complex is scored in rounds off one screen and so has no set
        // position; the block is the only thing that locates you inside it.
        var parts: [String] = []
        if state.phase == .complex, let block = state.block { parts.append(block) }
        if let label = state.setLabel { parts.append(label) }
        if let target = state.target { parts.append(target) }
        if let weight = state.weight { parts.append(weight) }
        if parts.isEmpty, let block = state.block { parts.append(block) }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }

    /// The single interactive element, or none. `timed` and `complex` are
    /// deliberately absent: app.ts answers a remote Save for either with
    /// "Log this one on the phone.", and a button that only ever produces a
    /// toast is worse than no button.
    var action: ActionKind? {
        if state.phase == .rest { return .skipRest }
        if state.phase == .work { return .logSet }
        return nil
    }
}

private enum ActionKind {
    case skipRest, logSet

    var title: String { self == .skipRest ? "Skip rest" : "Log set" }
    var glyph: String { self == .skipRest ? "forward.fill" : "checkmark" }
}

// MARK: - Pieces

/// Elapsed session time, the rest countdown, or a frozen remainder when the
/// rest is paused. All three are one view so the number never moves between
/// phases — only its size and colour change.
private struct IslandClock: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var size: CGFloat = 14

    var body: some View {
        let look = PhaseLook(state: state)
        Group {
            if look.done {
                Image(systemName: "checkmark")
                    .font(.system(size: size, weight: .bold))
                    .foregroundStyle(WidgetTheme.good)
            } else if let rest = state.rest, look.paused {
                Text(Duration.seconds(rest.remaining()), format: .time(pattern: .minuteSecond))
                    .foregroundStyle(WidgetTheme.muted)
            } else if let rest = state.rest, look.counting {
                // A ClosedRange traps when its upper bound is below its lower
                // one, and an activity that lingers a second past its deadline
                // would do exactly that. The floor keeps a finished rest
                // rendering as 0:00 instead of crashing the widget process.
                Text(timerInterval: Date()...max(rest.deadline, Date().addingTimeInterval(1)), countsDown: true)
                    .foregroundStyle(WidgetTheme.ember)
            } else {
                Text(attributes.startedAt, style: .timer)
                    .foregroundStyle(WidgetTheme.ink2)
            }
        }
        .font(WidgetTheme.numeral(size))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(minWidth: size * 3.1)
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

    var body: some View {
        let look = PhaseLook(state: state)
        Group {
            if look.done {
                Bar(fraction: 1, tint: WidgetTheme.good)
            } else if let rest = state.rest, look.counting, let span = span(rest) {
                ProgressView(timerInterval: span, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.linear)
                .tint(WidgetTheme.ember)
            } else if let rest = state.rest, look.paused {
                Bar(fraction: rest.remaining() / max(rest.totalInterval, 1), tint: WidgetTheme.muted)
            } else {
                Bar(fraction: state.progress.fraction, tint: WidgetTheme.ember)
            }
        }
        .frame(height: 5)
    }

    /// The whole rest as a range, clamped so the upper bound is always above the
    /// lower one even a second after the deadline passes.
    private func span(_ rest: LiveState.RestState) -> ClosedRange<Date>? {
        let end = max(rest.deadline, Date().addingTimeInterval(1))
        let start = end.addingTimeInterval(-max(rest.totalInterval, 1))
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

/// The one interactive element. `LiveActivityIntent` is what makes this legal:
/// the system runs `perform()` in the app's process, waking the app in the
/// background if it has to, which is the only way a Lock Screen tap can reach
/// the workout engine at all.
private struct ActionButton: View {
    let action: ActionKind

    var body: some View {
        Group {
            switch action {
            case .skipRest: Button(intent: SkipRestIntent()) { label }
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

/// A caption over a number, in the expanded island's narrow corners.
private struct ExpandedCorner<Content: View>: View {
    let title: String
    let alignment: HorizontalAlignment
    let content: Content

    init(title: String, alignment: HorizontalAlignment, @ViewBuilder content: () -> Content) {
        self.title = title
        self.alignment = alignment
        self.content = content()
    }

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(title.uppercased())
                .font(WidgetTheme.label(9.5))
                .tracking(0.5)
                .foregroundStyle(WidgetTheme.muted)
                .lineLimit(1)
            content
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
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
            if let rest = state.rest, look.counting {
                ProgressView(timerInterval: Date()...max(rest.deadline, Date().addingTimeInterval(1)),
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
    /// which is the button. One shrunk line keeps the whole card.
    private var heroLines: Int { scale > 1.12 ? 1 : 2 }

    var body: some View {
        let look = PhaseLook(state: state)
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
                    .foregroundStyle(look.counting ? WidgetTheme.emberInk : WidgetTheme.muted)
                    .lineLimit(1)
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(look.primary)
                        .font(WidgetTheme.display(19 * scale))
                        .foregroundStyle(WidgetTheme.ink)
                        .lineLimit(heroLines)
                        .minimumScaleFactor(0.65)
                    if let detail = look.detail {
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
                            size: (look.counting ? 30 : 22) * scale)
            }
            PhaseBar(state: state)
            if let action = look.action { ActionButton(action: action) }
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
