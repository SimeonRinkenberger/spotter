import ActivityKit
import SwiftUI
import WidgetKit

// The running workout on the Lock Screen and in the Dynamic Island.
//
// This is the foundation build: correct structure, Spotter's colours, nothing
// clipped, no lorem — and deliberately no more than that. The Live Activity
// agent designs the real presentation (rest ring, interactive log-set button,
// the rest countdown that keeps running while the phone is locked) on top of
// this shape.
//
// What is already load-bearing and should survive that redesign:
//   - The elapsed time is drawn from `attributes.startedAt` with SwiftUI's
//     .timer style, so it advances while the process is suspended. Nothing here
//     ticks; nothing here needs to be updated to stay correct.
//   - Rest is drawn from its deadline for the same reason, and shows the frozen
//     remainder instead when the user has paused it.
//   - Every text runs through lineLimit and minimumScaleFactor: an activity has
//     a fixed height and a long movement name at accessibility sizes is the one
//     thing that cannot be allowed to clip.
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenWorkout(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(WidgetTheme.card)
                .activitySystemActionForegroundColor(WidgetTheme.emberInk)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.exercise)
                        .font(WidgetTheme.display(15))
                        .foregroundStyle(WidgetTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandClock(attributes: context.attributes, state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(WidgetTheme.muted)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "figure.strengthtraining.traditional")
                    .foregroundStyle(WidgetTheme.ember)
            } compactTrailing: {
                IslandClock(attributes: context.attributes, state: context.state)
            } minimal: {
                Image(systemName: "figure.strengthtraining.traditional")
                    .foregroundStyle(WidgetTheme.ember)
            }
            .keylineTint(WidgetTheme.ember)
        }
    }
}

/// Elapsed session time, or the rest countdown when one is running. Both are
/// rendered from an instant rather than a number, so neither needs an update to
/// stay right between engine states.
private struct IslandClock: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        Group {
            if let rest = state.rest, state.phase == .rest {
                if rest.isPaused {
                    Text(Duration.seconds(rest.remaining()), format: .time(pattern: .minuteSecond))
                        .foregroundStyle(WidgetTheme.muted)
                } else {
                    // A ClosedRange traps when its upper bound is below its
                    // lower one, and an activity that lingers a second past its
                    // rest deadline would do exactly that. The floor keeps a
                    // finished rest rendering as 0:00 instead of crashing the
                    // widget process.
                    Text(timerInterval: Date()...max(rest.deadline, Date().addingTimeInterval(1)), countsDown: true)
                        .foregroundStyle(WidgetTheme.ember)
                }
            } else {
                Text(attributes.startedAt, style: .timer)
                    .foregroundStyle(WidgetTheme.ink2)
            }
        }
        .font(WidgetTheme.numeral(14))
        .monospacedDigit()
        .frame(minWidth: 44)
        .multilineTextAlignment(.trailing)
    }
}

private struct LockScreenWorkout: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(attributes.title.uppercased())
                    .font(WidgetTheme.label())
                    .tracking(0.6)
                    .foregroundStyle(WidgetTheme.muted)
                    .lineLimit(1)
                Text(state.exercise)
                    .font(WidgetTheme.display(19))
                    .foregroundStyle(WidgetTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let detail = detail {
                    Text(detail)
                        .font(.system(size: 13))
                        .foregroundStyle(WidgetTheme.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                IslandClock(attributes: attributes, state: state)
                    .font(WidgetTheme.numeral(22))
                Text(state.phase == .rest ? "Rest" : "Elapsed")
                    .font(WidgetTheme.label())
                    .tracking(0.6)
                    .foregroundStyle(WidgetTheme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    /// The set line: position, then what it asks for, then the weight — joined
    /// only from the parts that exist, so a bodyweight AMRAP round reads as a
    /// short line rather than as a line full of dashes.
    private var detail: String? {
        var parts: [String] = []
        if let label = state.setLabel { parts.append(label) }
        if let target = state.target { parts.append(target) }
        if let weight = state.weight { parts.append(weight) }
        if parts.isEmpty, let block = state.block { parts.append(block) }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }
}
