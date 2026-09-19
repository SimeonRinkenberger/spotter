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
// DEBUG only, and inert unless asked:
//
//   SIMCTL_CHILD_SPOTTER_LIVE_SHOTS=1 xcrun simctl launch <udid> <bundle id>
//   xcrun simctl get_app_container <udid> <bundle id> data   # → Documents/live-shots
enum LiveActivityShots {
    static func runIfAsked() {
        guard ProcessInfo.processInfo.environment["SPOTTER_LIVE_SHOTS"] != nil else { return }
        DispatchQueue.main.async { MainActor.assumeIsolated { render() } }
    }

    /// One PNG per phase per appearance, plus the two that break layouts: a long
    /// movement name and a large Dynamic Type setting.
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
        // The two layout stress cases, at the size the card is designed up to.
        shots.append(("xl-work", state(.work), .xLarge))
        shots.append(("xl-rest", state(.rest), .xLarge))
        shots.append(("long-name", longName(), .large))
        // The tallest this card can be: two wrapped lines at the top of the
        // Dynamic Type range it is designed for. Must stay under 160 pt.
        // The clamp in the card tops out at 1.25x, which an accessibility size
        // reaches and XL does not — so THIS is the tallest the card can ever be.
        shots.append(("worst-case", longName(), .accessibility3))

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
         ("rest", state(.rest)),
         ("paused", state(.paused)),
         ("timed", state(.timed)),
         ("complex", state(.complex)),
         ("done", state(.done))]
    }

    private enum Case { case work, rest, paused, timed, complex, done }

    private static func state(_ kind: Case) -> WorkoutActivityAttributes.ContentState {
        let until = Date().addingTimeInterval(47).timeIntervalSince1970 * 1000
        switch kind {
        case .work:
            return .init(phase: .work, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 2, total: 3), target: "10 reps", weight: "24 kg",
                         rest: nil, next: "Bench Press", progress: .init(done: 4, total: 10))
        case .rest:
            return .init(phase: .rest, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 3, total: 3), target: "10 reps", weight: "24 kg",
                         rest: .init(until: until, total: 60_000, held: 0),
                         next: "Bench Press", progress: .init(done: 5, total: 10))
        case .paused:
            return .init(phase: .rest, exercise: "Goblet Squat", block: "Main",
                         set: .init(index: 3, total: 3), target: "10 reps", weight: "24 kg",
                         rest: .init(until: until, total: 60_000, held: 23_000),
                         next: "Bench Press", progress: .init(done: 5, total: 10))
        case .timed:
            return .init(phase: .timed, exercise: "Plank", block: "Finisher",
                         set: nil, target: "40 s", weight: nil,
                         rest: .init(until: until, total: 40_000, held: 0),
                         next: "Barbell Row", progress: .init(done: 8, total: 10))
        case .complex:
            return .init(phase: .complex, exercise: "Kettlebell Swing", block: "Round 2",
                         set: nil, target: "12 reps", weight: "24 kg",
                         rest: nil, next: "Goblet Squat", progress: .init(done: 6, total: 12))
        case .done:
            return .init(phase: .done, exercise: "Workout saved", block: nil, set: nil,
                         target: "42:10  ·  18 sets  ·  2 PRs", weight: nil, rest: nil,
                         next: nil, progress: .init(done: 18, total: 18))
        }
    }

    /// The layout's worst realistic input: a movement name nobody abbreviates.
    private static func longName() -> WorkoutActivityAttributes.ContentState {
        .init(phase: .work, exercise: "Bulgarian Split Squat (Rear Foot Elevated)",
              block: "Accessory", set: .init(index: 12, total: 12),
              target: "8-12 reps each side", weight: "142.5 kg", rest: nil,
              next: "Romanian Deadlift", progress: .init(done: 11, total: 12))
    }
}
#endif
