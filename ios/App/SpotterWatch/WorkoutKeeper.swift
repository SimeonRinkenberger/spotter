import Foundation
#if SPOTTER_HEALTHKIT
import HealthKit
#endif

// What keeps the watch app awake, and the only reason HealthKit is here at all.
//
// A watchOS app is suspended when the wrist drops. For a workout that is fatal
// twice over: the rest countdown stops being redrawn, and — the part that is
// not recoverable by arithmetic — WKInterfaceDevice.play() does nothing in the
// background, so the end-of-rest haptic never reaches the wearer. Apple's
// documentation for play(_:) names the one exception: "apps with an active
// workout session". An HKWorkoutSession is therefore not a data feature here,
// it is the foreground.
//
// What it buys, in order of why it exists:
//   1. The app stays frontmost while the session runs, so the wrist-raise shows
//      the set instead of the watch face.
//   2. Haptics play in the background, so rest ends on the wrist.
//   3. Heart rate, live, from HKLiveWorkoutBuilder — shown small and muted.
//
// Nothing is WRITTEN to Health this wave: stop() discards the builder rather
// than finishing it, so no HKWorkout sample is saved. Saving one is a product
// decision (it belongs with the session the phone already stores) and a second
// permission prompt, and neither is in this brief.
//
// The whole thing is behind SPOTTER_HEALTHKIT because the entitlement needs a
// paid Apple Developer Program membership. Off, the app still works: it just
// only counts rest while someone is looking at it. See design/native/watch.md
// and Local.xcconfig.example.
@MainActor
final class WorkoutKeeper: ObservableObject {
    /// Beats per minute, live. Nil when HealthKit is off, unauthorised, or the
    /// sensor has not produced a sample yet.
    @Published private(set) var heartRate: Double?
    /// True when a workout session is actually running — which is what the
    /// interface needs to know before it promises a haptic it cannot play.
    @Published private(set) var holding = false

#if SPOTTER_HEALTHKIT
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var proxy: Proxy?

    func start() {
        guard session == nil, HKHealthStore.isHealthDataAvailable() else { return }

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor

        // Read-only, and only the two values the page shows. A workout app that
        // asks for the whole store to draw one number is asking for a refusal.
        let wanted: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned)
        ]
        store.requestAuthorization(toShare: [], read: wanted) { _, _ in }

        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store,
                                                         workoutConfiguration: configuration)
            let proxy = Proxy(keeper: self)
            session.delegate = proxy
            builder.delegate = proxy
            let now = Date()
            session.startActivity(with: now)
            builder.beginCollection(withStart: now) { _, _ in }
            self.session = session
            self.builder = builder
            self.proxy = proxy
            holding = true
        } catch {
            NSLog("Spotter watch: could not start a workout session %@", String(describing: error))
        }
    }

    func stop() {
        guard let session = session else { return }
        session.end()
        // Discard, do not finish: finishing writes an HKWorkout sample, and this
        // wave has no permission to write and nothing to say in one.
        builder?.discardWorkout()
        self.session = nil
        self.builder = nil
        self.proxy = nil
        holding = false
        heartRate = nil
    }

    fileprivate func note(_ rate: Double) { heartRate = rate }

    fileprivate func ended() {
        holding = false
        heartRate = nil
    }

    /// HealthKit's delegates are nonisolated and called on its own queues; this
    /// keeps that off the ObservableObject rather than sprinkling the class with
    /// nonisolated members that cannot touch @Published.
    private final class Proxy: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
        private weak var keeper: WorkoutKeeper?
        init(keeper: WorkoutKeeper) { self.keeper = keeper }

        func workoutSession(_ workoutSession: HKWorkoutSession,
                            didChangeTo toState: HKWorkoutSessionState,
                            from fromState: HKWorkoutSessionState,
                            date: Date) {
            guard toState == .ended || toState == .stopped else { return }
            Task { @MainActor [weak keeper] in keeper?.ended() }
        }

        func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
            NSLog("Spotter watch: workout session failed %@", String(describing: error))
            Task { @MainActor [weak keeper] in keeper?.ended() }
        }

        func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                            didCollectDataOf collectedTypes: Set<HKSampleType>) {
            let heartRate = HKQuantityType(.heartRate)
            guard collectedTypes.contains(heartRate),
                  let statistics = workoutBuilder.statistics(for: heartRate),
                  let value = statistics.mostRecentQuantity()?
                      .doubleValue(for: HKUnit.count().unitDivided(by: .minute())) else { return }
            Task { @MainActor [weak keeper] in keeper?.note(value) }
        }

        func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    }
#else
    /// HealthKit off. The app runs exactly as it otherwise would, minus the
    /// foreground guarantee and the heart rate — and the interface is told so
    /// through `holding`, so it never promises a haptic it cannot play.
    func start() {}
    func stop() {}
#endif
}
