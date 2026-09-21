#if DEBUG
import SwiftUI
import UIKit

// Render the Lock Screen card to PNGs, because this machine could not lock a
// simulator.
//
// The Live Activity's Lock Screen presentation is only composited by the system
// on an actually-locked device. Locking a Simulator needs a keystroke (⌘L) or
// the simulator-control tool, and on the machine this was built on the agent had
// neither accessibility permission nor device permission — so the one surface
// this feature exists for could not be photographed. `xcrun simctl` can take a
// screenshot but cannot press a button.
//
// So the card is rendered instead. ImageRenderer draws the SAME `LockScreenWorkout`
// the widget extension draws, with the same theme, at a real width, in both
// appearances and at a large Dynamic Type size. What it does NOT prove is the
// system's part: the rounded mask, the background blur, the 160 pt truncation
// and the live tick of Text(timerInterval:). Those are stated as unverified in
// the report rather than implied by these images.
//
// It is also the ruler. Every PNG is 3x, so its pixel height / 3 is the card's
// height in points, and 160 is the line none of them may cross.
//
// DEBUG only, and inert unless asked:
//
//   SIMCTL_CHILD_SPOTTER_LIVE_SHOTS=1 xcrun simctl launch <udid> <bundle id>
//   xcrun simctl get_app_container <udid> <bundle id> data   # → Documents/live-shots
enum LiveActivityShots {
    static func runIfAsked() {
        guard ProcessInfo.processInfo.environment["SPOTTER_LIVE_SHOTS"] != nil else { return }
        DispatchQueue.main.async { MainActor.assumeIsolated { render() } }
    }

    /// One PNG per phase per appearance, plus the ones that break layouts: a
    /// long movement name, a large Dynamic Type setting, and the dial.
    @MainActor private static func render() {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("live-shots")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let attributes = WorkoutActivityAttributes(title: "Lock Screen Test",
                                                   startedAt: Date().addingTimeInterval(-1090))
        var shots: [(String, WorkoutActivityAttributes.ContentState, DynamicTypeSize)] = []
        for (name, state) in cases() {
            shots.append((name, state, .large))
        }
        // The layout stress cases, at the size the card is designed up to.
        shots.append(("xl-work", state(.work), .xLarge))
        shots.append(("xl-dial", state(.dial), .xLarge))
        shots.append(("xl-rest", state(.rest), .xLarge))
        shots.append(("long-name", longName(dial: false), .large))
        shots.append(("long-name-dial", longName(dial: true), .large))
        // The tallest this card can be: two wrapped lines at the top of the
        // Dynamic Type range it is designed for. Must stay under 160 pt.
        // The clamp in the card tops out at 1.25x, which an accessibility size
        // reaches and XL does not — so THIS is the tallest the card can ever be.
        shots.append(("worst-case", longName(dial: false), .accessibility3))
        shots.append(("worst-case-dial", longName(dial: true), .accessibility3))
        // The complex row is the dial row's height under a hero that must
        // stay one line; same ceiling, same proof.
        shots.append(("worst-case-complex", longComplex(), .accessibility3))
        shots.append(("xl-complex", state(.complexRunning), .xLarge))

        for scheme in [ColorScheme.light, .dark] {
            for (name, content, size) in shots {
                let card = LockScreenWorkout(attributes: attributes, state: content)
                    .frame(width: 372)
                    .background(WidgetTheme.card)
                    .environment(\.colorScheme, scheme)
                    .environment(\.dynamicTypeSize, size)
                let renderer = ImageRenderer(content: AnyView(card))
                renderer.scale = 3
                // ImageRenderer resolves dynamic UIColors against the trait
                // collection of the window it has, not the SwiftUI environment,
                // so the override has to be made at the UIKit layer too or every
                // "dark" shot comes out light.
                renderer.proposedSize = ProposedViewSize(width: 372, height: nil)
                // Inherit the process's traits and override only the
                // appearance. A bare UITraitCollection(userInterfaceStyle:)
                // leaves preferredContentSizeCategory unspecified, which pins
                // @ScaledMetric to 1x and silently made every "XL" shot
                // identical to its default-size twin.
                let traits = UITraitCollection.current.modifyingTraits {
                    $0.userInterfaceStyle = scheme == .dark ? .dark : .light
                }
                traits.performAsCurrent {
                    guard let image = renderer.uiImage, let data = image.pngData() else { return }
                    let file = dir.appendingPathComponent(name + "-" + (scheme == .dark ? "dark" : "light") + ".png")
                    try? data.write(to: file)
                }
            }
        }
        NSLog("Spotter shots: wrote %@", dir.path)
    }

    private static func cases() -> [(String, WorkoutActivityAttributes.ContentState)] {
        [("work", state(.work)),
         ("dial", state(.dial)),
         ("dial-bodyweight", state(.dialBodyweight)),
         ("dial-zero", state(.dialZero)),
         ("rest", state(.rest)),
         ("held", state(.held)),
         ("paused", state(.paused)),
         ("timed", state(.timed)),
         ("complex", state(.complex)),
         ("complex-running", state(.complexRunning)),
         ("complex-idle", state(.complexIdle)),
         ("complex-held", state(.complexHeld)),
         ("complex-over", state(.complexOver)),
         ("complex-counted", state(.complexCounted)),
         ("done", state(.done))]
    }

    /// `work` is what an engine older than the dose sends: a plain Log set.
    /// `dial` is the same set from the current engine; `dialZero` the same
    /// set never loaded (weight 0, not nil). `held` is a rest paused with time
    /// left; `paused` is the whole session stopped. `complex` is a complex
    /// from an engine older than the counter; the four after it are the
    /// counter's states, and `complexCounted` a complex with no cap at all.
    private enum Case {
        case work, dial, dialBodyweight, dialZero, rest, held, paused, timed
        case complex, complexRunning, complexIdle, complexHeld, complexOver, complexCounted, done
    }

    /// Complex Fives, mid-round, as the engine sends it. `until` is the cap's
    /// deadline; the running case sets it, the others leave it 0.
    private static func complex(rounds: Int, marked: Int, until: Double = 0, held: Double = 0,
                                over: Bool = false, cap: Double = 15 * 60 * 1000) -> LiveState.Complex {
        LiveState.Complex(rounds: rounds, marked: marked, moves: 5, move: "Kettlebell Swing",
                          cap: cap, until: until, held: held, over: over)
    }

    private static func state(_ kind: Case) -> WorkoutActivityAttributes.ContentState {
        let until = Date().addingTimeInterval(47).timeIntervalSince1970 * 1000
        switch kind {
        case .work:
            return .init(phase: .work, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 2, total: 3), target: "10 reps", weight: "24 kg",
                         rest: nil, next: "Bench Press", progress: .init(done: 4, total: 10),
                         pausedAt: nil, dial: nil, loggable: true)
        case .dial:
            return .init(phase: .work, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 2, total: 3), target: "10 reps", weight: "24 kg",
                         rest: nil, next: "Bench Press", progress: .init(done: 4, total: 10),
                         pausedAt: nil, dial: .init(reps: 10, weight: 24, unit: "kg"), loggable: true)
        case .dialBodyweight:
            return .init(phase: .work, exercise: "Push-up", block: "Main",
                         set: .init(index: 2, total: 3), target: "12 reps", weight: nil,
                         rest: nil, next: "Bench Press", progress: .init(done: 4, total: 10),
                         pausedAt: nil, dial: .init(reps: 12, weight: nil, unit: "kg"), loggable: true)
        case .dialZero:
            return .init(phase: .work, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 1, total: 3), target: "10 reps", weight: nil,
                         rest: nil, next: "Bench Press", progress: .init(done: 0, total: 10),
                         pausedAt: nil, dial: .init(reps: 10, weight: 0, unit: "kg"), loggable: true)
        case .rest:
            return .init(phase: .rest, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 3, total: 3), target: "10 reps", weight: "24 kg",
                         rest: .init(until: until, total: 60_000, held: 0),
                         next: "Bench Press", progress: .init(done: 5, total: 10),
                         pausedAt: nil, dial: .init(reps: 10, weight: 24, unit: "kg"), loggable: true)
        case .held:
            return .init(phase: .rest, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 3, total: 3), target: "10 reps", weight: "24 kg",
                         rest: .init(until: until, total: 60_000, held: 23_000),
                         next: "Bench Press", progress: .init(done: 5, total: 10),
                         pausedAt: nil, dial: .init(reps: 10, weight: 24, unit: "kg"), loggable: true)
        case .paused:
            return .init(phase: .paused, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 2, total: 3), target: "10 reps", weight: "24 kg",
                         rest: nil, next: "Bench Press", progress: .init(done: 4, total: 10),
                         pausedAt: Date().addingTimeInterval(-40),
                         dial: .init(reps: 10, weight: 24, unit: "kg"), loggable: true)
        case .timed:
            return .init(phase: .timed, exercise: "Plank", block: "Finisher",
                         set: nil, target: "40 s", weight: nil,
                         rest: .init(until: until, total: 40_000, held: 0),
                         next: "Barbell Row", progress: .init(done: 8, total: 10),
                         pausedAt: nil, dial: nil, loggable: false)
        case .complex:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: "Round 2",
                         set: nil, target: "12 reps", weight: "24 kg",
                         rest: nil, next: "Goblet Squat", progress: .init(done: 6, total: 12),
                         pausedAt: nil, dial: nil, loggable: false)
        case .complexRunning:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: nil,
                         set: nil, target: "5 reps", weight: "24 kg",
                         rest: nil, next: nil, progress: .init(done: 11, total: 15),
                         pausedAt: nil, dial: nil, loggable: false,
                         complex: complex(rounds: 2, marked: 1, until: until + 700_000))
        case .complexIdle:
            return .init(phase: .complex, exercise: "Deadlift", block: nil,
                         set: nil, target: "5 reps", weight: "24 kg",
                         rest: nil, next: nil, progress: .init(done: 0, total: 15),
                         pausedAt: nil, dial: nil, loggable: false,
                         complex: complex(rounds: 0, marked: 0))
        case .complexHeld:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: nil,
                         set: nil, target: "5 reps", weight: "24 kg",
                         rest: nil, next: nil, progress: .init(done: 11, total: 15),
                         pausedAt: nil, dial: nil, loggable: false,
                         complex: complex(rounds: 2, marked: 1, held: 250_000))
        case .complexOver:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: nil,
                         set: nil, target: "5 reps", weight: "24 kg",
                         rest: nil, next: nil, progress: .init(done: 17, total: 17),
                         pausedAt: nil, dial: nil, loggable: false,
                         complex: complex(rounds: 3, marked: 2, over: true))
        case .complexCounted:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: nil,
                         set: nil, target: "5 reps", weight: "24 kg",
                         rest: nil, next: nil, progress: .init(done: 11, total: 15),
                         pausedAt: nil, dial: nil, loggable: false,
                         complex: complex(rounds: 2, marked: 1, cap: 0))
        case .done:
            return .init(phase: .done, exercise: "Workout saved", block: nil, set: nil,
                         target: "42:10  ·  18 sets  ·  2 PRs", weight: nil, rest: nil,
                         next: nil, progress: .init(done: 18, total: 18),
                         pausedAt: nil, dial: nil, loggable: false)
        }
    }

    /// The layout's worst realistic input: a movement name nobody abbreviates,
    /// with the widest figures the dial can show.
    private static func longName(dial: Bool) -> WorkoutActivityAttributes.ContentState {
        .init(phase: .work, exercise: "Bulgarian Split Squat (Rear Foot Elevated)",
              block: "Accessory", set: .init(index: 12, total: 12),
              target: "8-12 reps each side", weight: "142.5 kg", rest: nil,
              next: "Romanian Deadlift", progress: .init(done: 11, total: 12),
              pausedAt: nil,
              dial: dial ? .init(reps: 12, weight: 142.5, unit: "kg") : nil, loggable: true)
    }

    /// The same name on a complex with the cap running and the widest round
    /// count the button can carry.
    private static func longComplex() -> WorkoutActivityAttributes.ContentState {
        .init(phase: .complex, exercise: "Bulgarian Split Squat (Rear Foot Elevated)",
              block: nil, set: nil, target: "8 reps each side", weight: "142.5 kg", rest: nil,
              next: nil, progress: .init(done: 58, total: 60), pausedAt: nil, dial: nil, loggable: false,
              complex: .init(rounds: 11, marked: 4, moves: 5, move: "Bulgarian Split Squat (Rear Foot Elevated)",
                             cap: 20 * 60 * 1000,
                             until: Date().addingTimeInterval(47).timeIntervalSince1970 * 1000,
                             held: 0, over: false))
    }
}
#endif
