import ActivityKit
import Foundation

// The Live Activity's half of the LiveState contract.
//
// ActivityKit splits a running activity in two: the attributes, fixed for the
// life of the activity, and the ContentState, replaced on every update. The
// split here follows what actually changes during a workout — the title and the
// moment it started do not, everything else does — which keeps each update
// small. ActivityKit charges a real budget for update frequency, and an
// activity that re-sent its title every three seconds would spend it on nothing.
//
// `startedAt` is a Date rather than the contract's ISO string because it is
// handed straight to Text(timerInterval:) on the Lock Screen: parsing it once
// here means the widget process never parses at render time, and a malformed
// string fails at the boundary instead of drawing a timer that starts at zero.
//
// Availability: ActivityKit needs iOS 16.1 and this project's floor is 17.0, so
// nothing in this file needs an availability guard. If that floor ever drops,
// every declaration here needs @available(iOS 16.1, *) and the callers change too.
struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: LiveState.Phase
        var exercise: String
        var block: String?
        var set: LiveState.SetPosition?
        var target: String?
        var weight: String?
        var rest: LiveState.RestState?
        var next: String?
        var progress: LiveState.Progress

        /// True while a rest is counting down and has not been paused.
        var isResting: Bool {
            guard let rest = rest else { return false }
            return phase == .rest && !rest.isPaused
        }

        /// "Set 2 of 4" material, already 1-based, or nil where sets do not apply.
        var setLabel: String? {
            guard let set = set else { return nil }
            return "Set " + String(set.index) + " of " + String(set.total)
        }
    }

    /// The workout's name. Fixed for the life of the activity.
    var title: String
    /// When the session started; the elapsed timer counts up from here.
    var startedAt: Date

    /// Split one LiveState into the pair ActivityKit wants.
    ///
    /// Returned as a tuple rather than two calls so a caller cannot accidentally
    /// build the attributes from one state and the content from a later one.
    static func from(_ state: LiveState) -> (WorkoutActivityAttributes, ContentState) {
        let attributes = WorkoutActivityAttributes(title: state.title, startedAt: state.startedDate)
        return (attributes, content(state))
    }

    /// The changing half on its own, for updating an activity that already runs.
    static func content(_ state: LiveState) -> ContentState {
        ContentState(phase: state.phase,
                     exercise: state.exercise,
                     block: state.block,
                     set: state.set,
                     target: state.target,
                     weight: state.weight,
                     rest: state.rest,
                     next: state.next,
                     progress: state.progress)
    }

    /// A real-looking session for previews and for the redacted placeholder, so
    /// no surface in this project ever has to ship lorem to see its own layout.
    static let sample = WorkoutActivityAttributes(title: "Kettlebell Circuit",
                                                  startedAt: Date().addingTimeInterval(-18 * 60))

    static let sampleContent = ContentState(phase: .work,
                                            exercise: "Goblet Squat",
                                            block: "Round 2",
                                            set: LiveState.SetPosition(index: 2, total: 4),
                                            target: "10 reps",
                                            weight: "24 kg",
                                            rest: nil,
                                            next: "Kettlebell Swing",
                                            progress: LiveState.Progress(done: 6, total: 12))

    static let sampleResting = ContentState(phase: .rest,
                                            exercise: "Goblet Squat",
                                            block: "Round 2",
                                            set: LiveState.SetPosition(index: 2, total: 4),
                                            target: "10 reps",
                                            weight: "24 kg",
                                            rest: LiveState.RestState(until: Date().addingTimeInterval(45).timeIntervalSince1970 * 1000,
                                                                      total: 90_000,
                                                                      held: 0),
                                            next: "Kettlebell Swing",
                                            progress: LiveState.Progress(done: 7, total: 12))
}
