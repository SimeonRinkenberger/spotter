import SwiftUI

// Rest, counted by this watch.
//
// The whole point of the feature: `rest.until` is an absolute instant, so every
// frame here is arithmetic against the watch's own clock. The phone can be
// locked, in a bag, or out of Bluetooth range and the ring still closes on
// time. Nothing counts ticks and nothing is pushed per second.
//
// TimelineView is what redraws it, at one second normally and once a minute in
// Always On — a display that only refreshes about that often should not be
// asked to render a figure that changes faster than it can show it.
struct RestView: View {
    let state: LiveState
    @ObservedObject var link: WatchLink
    @ObservedObject var keeper: WorkoutKeeper

    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.periodic(from: .now, by: dimmed ? 60 : 1)) { context in
            let rest = state.rest
            let remaining = rest?.remaining(at: context.date) ?? 0
            let total = max(1, rest?.totalInterval ?? 1)

            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .stroke(WidgetTheme.sand, lineWidth: dimmed ? 6 : 9)
                    // Fills as the rest is spent, so a full ring is the moment
                    // to lift again — the same direction as every progress ring
                    // on this watch.
                    Circle()
                        .trim(from: 0, to: min(1, max(0, 1 - remaining / total)))
                        .stroke(dimmed ? WidgetTheme.emberInk : WidgetTheme.ember,
                                style: StrokeStyle(lineWidth: dimmed ? 6 : 9, lineCap: .round))
                        .rotationEffect(.degrees(-90))

                    VStack(spacing: -2) {
                        Text(face(remaining))
                            .font(WidgetTheme.numeral(dimmed ? 26 : 32, weight: .semibold))
                            .foregroundStyle(WidgetTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                        Text(rest?.isPaused == true ? "Paused" : "rest")
                            .font(WidgetTheme.label(9))
                            .foregroundStyle(rest?.isPaused == true ? WidgetTheme.emberInk : WidgetTheme.muted)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                }
                .frame(maxHeight: .infinity)
                .padding(.horizontal, 6)

                Text(nextLine)
                    .font(WidgetTheme.display(12, weight: .medium))
                    .foregroundStyle(WidgetTheme.ink2)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)

                if link.stalled {
                    WaitingNote()
                } else {
                    Button {
                        link.send(.skipRest)
                    } label: {
                        Text("Skip")
                            .font(WidgetTheme.display(14, weight: .semibold))
                            .foregroundStyle(WidgetTheme.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                    .background(WidgetTheme.sand, in: Capsule())
                    .disabled(link.pending != nil)
                }
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 2)
        }
    }

    /// Seconds below a minute, m:ss above it — and in Always On, whole minutes
    /// only. A per-second figure on a display that refreshes once a minute is a
    /// number that is wrong more often than it is right.
    private func face(_ remaining: TimeInterval) -> String {
        let seconds = Int(remaining.rounded(.up))
        if dimmed {
            if seconds >= 60 { return String((seconds + 59) / 60) + " min" }
            return seconds > 0 ? "<1 min" : "0"
        }
        if seconds < 60 { return String(seconds) }
        return String(seconds / 60) + ":" + String(format: "%02d", seconds % 60)
    }

    /// What this rest is for. During rest the phone's `set.index` is already the
    /// set about to be done, so this is the honest "next" even mid-movement.
    private var nextLine: String {
        if let set = state.set {
            return "Next: " + state.exercise + " · set " + String(set.index)
        }
        if let next = state.next { return "Next: " + next }
        return state.exercise
    }
}
