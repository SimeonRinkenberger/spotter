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
// One consequence of `startedAt` being an attribute: a resume shifts it (the
// engine moves the start forward by the length of the pause so the elapsed
// clock skips time nobody trained), and attributes cannot change — so a resume
// is a new activity, not an update. LiveActivitySink.push handles the swap.
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
        /// The instant the session was paused; nil in every other phase. The
        /// card renders `pausedAt − startedAt` as a static string, because a
        /// live timer would go on counting a session that is stopped.
        var pausedAt: Date?
        /// What the Log set button would save, as the dial currently reads:
        /// the engine's prefill until a ± button is pressed, the dialled
        /// figure after. Nil when this set cannot be logged from the card (a
        /// timed hold, an unresolved complex) or when an older engine sent no
        /// dose at all — in which case `loggable` says whether the plain
        /// button still applies.
        var dial: Dial?
        /// Whether a remote Log set is worth offering. The engine's own answer
        /// (`dose.loggable`); true when the engine predates the dose, which is
        /// the behaviour the card had before the dial existed.
        var loggable: Bool

        /// The two figures a thumb can turn on the card, plus the unit they are
        /// in. Kept small on purpose: ActivityKit budgets static + dynamic
        /// content at 4 KB, and a name for every field is a name the widget
        /// draws, not one it stores.
        struct Dial: Codable, Hashable {
            var reps: Int
            /// Nil for bodyweight: the card then shows the reps dial alone.
            var weight: Double?
            /// "kg" or "lb", straight from the account setting.
            var unit: String
        }

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
    ///
    /// `dialReps` / `dialWeight` are what the card's ± buttons have turned the
    /// set to, nil until touched; the engine's prefill fills whichever is nil.
    /// They come from the sink, not the engine, because the dial never crosses
    /// the bridge until Log set is pressed.
    static func content(_ state: LiveState, dialReps: Int? = nil, dialWeight: Double? = nil) -> ContentState {
        var dial: ContentState.Dial?
        if let dose = state.dose, dose.loggable {
            dial = ContentState.Dial(reps: dialReps ?? dose.reps ?? 0,
                                     weight: dose.weight == nil ? nil : (dialWeight ?? dose.weight),
                                     unit: dose.unit)
        }
        return ContentState(phase: state.phase,
                            exercise: state.exercise,
                            block: state.block,
                            set: state.set,
                            target: state.target,
                            weight: state.weight,
                            rest: state.rest,
                            next: state.next,
                            progress: state.progress,
                            pausedAt: state.pausedDate,
                            dial: dial,
                            loggable: state.dose?.loggable ?? true)
    }

    /// m:ss, or h:mm:ss past an hour, for the two clocks that must not tick: the
    /// closing frame's duration and a paused session's frozen elapsed time.
    /// Hand-rolled because DateComponentsFormatter would localise "42:10" into
    /// "42 minutes, 10 seconds" at some locales and both have to fit on one
    /// line beside a glyph.
    static func clock(_ interval: TimeInterval) -> String {
        let total = Int(max(0, interval.rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        let mm = String(format: "%02d", m), ss = String(format: "%02d", s)
        return h > 0 ? String(h) + ":" + mm + ":" + ss : String(m) + ":" + ss
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
                                            progress: LiveState.Progress(done: 6, total: 12),
                                            pausedAt: nil,
                                            dial: ContentState.Dial(reps: 10, weight: 24, unit: "kg"),
                                            loggable: true)

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
                                            progress: LiveState.Progress(done: 7, total: 12),
                                            pausedAt: nil,
                                            dial: ContentState.Dial(reps: 10, weight: 24, unit: "kg"),
                                            loggable: true)
}
