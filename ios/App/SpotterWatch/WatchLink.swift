import Combine
import Foundation
import WatchConnectivity
import WatchKit

// The watch's end of the phone link.
//
// The phone runs the workout engine; this holds the last thing it said and
// sends back what the wrist did. There is deliberately no second engine here:
// a set is logged by the same app.ts code path a thumb would have run, so the
// PR logic, the haptics and the toast all happen once, in one place.
//
// Three things this class owns that the phone cannot do for it:
//
//  1. The rest deadline. `rest.until` is an absolute instant, so the countdown
//     is arithmetic against the watch's own clock — a phone in a pocket, locked
//     or out of range does not stop it, and the end-of-rest haptic is scheduled
//     here rather than delivered from over there.
//  2. Optimism. A tap has to look like it worked before the round trip finishes,
//     so `display` is the last real state with the pending action already
//     applied. The truth replaces it on the next context; if nothing arrives
//     within five seconds the UI says so instead of pretending.
//  3. The asymmetry. Apple's WCSession documentation is explicit that
//     `sendMessage` from the watch wakes the iOS app in the background, while
//     the same call from the phone does not wake the watch. So the wrist's
//     actions go by message (falling back to a queued transfer when the phone
//     is out of reach) and the phone's state arrives as an application context.
@MainActor
final class WatchLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchLink()

    /// The four keys of the phone-watch wire. Spelled identically in
    /// App/WatchLinkSink.swift and held against it by tools/ios/watch-check.mjs.
    enum Key {
        static let live = "live"
        static let done = "done"
        static let summary = "summary"
        static let action = "action"
    }

    /// The last state the phone sent.
    @Published private(set) var state: LiveState?
    /// The session that just ended, shown for half a minute and then let go.
    @Published private(set) var done: LiveSummary?
    /// The week and the plan, for the idle face. Outlives any session.
    @Published private(set) var summary: WidgetSummary?
    /// A tap that has left the wrist and not yet come back as a state.
    @Published private(set) var pending: Pending?
    /// Five seconds of silence after a tap. Not an error — a phone that is
    /// asleep in another room is a normal thing for a watch to be honest about.
    @Published private(set) var stalled = false

    struct Pending: Equatable {
        var kind: LiveAction.Kind
        /// What the wrist dialled, kept so the metrics page can go on showing it
        /// while the phone catches up.
        var reps: Int?
        var weight: Double?
    }

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var stallTask: Task<Void, Never>?
    private var restAlarm: Task<Void, Never>?
    /// The deadline the end-of-rest haptic has already fired for, so a state
    /// that arrives twice (context and echo) buzzes the wrist once.
    private var firedDeadline: Double = 0

    private override init() { super.init() }

    /// Idempotent: the app's init and any later retry can both call it.
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated { session.activate() }
        // A context the phone left waiting is already on this device — it is
        // not redelivered as a callback when the app launches into it.
        apply(session.receivedApplicationContext)
#if DEBUG
        loadFixture()
#endif
    }

#if DEBUG
    /// A wire payload handed in at launch, for a watch with no phone to talk to.
    ///
    ///   xcrun simctl launch <watch udid> <bundle> \
    ///     with SIMCTL_CHILD_SPOTTER_WATCH_FIXTURE='{"live":{…}}'
    ///
    /// It is deliberately the SAME envelope the phone sends and it goes through
    /// the same `apply`, so what a screenshot shows is the real decode path fed
    /// real contract JSON — not a hand-built Swift value that could disagree
    /// with the wire and never be caught. DEBUG only; the shipped watch app has
    /// no way in but the phone.
    private func loadFixture() {
        let environment = ProcessInfo.processInfo.environment
        if let raw = environment["SPOTTER_WATCH_FIXTURE"],
           let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] {
            var payload: [String: Any] = [:]
            for (key, value) in object {
                if let data = try? JSONSerialization.data(withJSONObject: value) { payload[key] = data }
            }
            apply(payload)
        }
        // And the other half of what a screenshot cannot otherwise reach: a tap
        // that has left the wrist. Leaves the optimistic state up and arms the
        // five-second footnote, exactly as a real press would with the phone
        // asleep — WCSession is not activated here, so nothing is sent.
        if let pending = environment["SPOTTER_WATCH_PENDING"],
           let kind = LiveAction.Kind(rawValue: pending) {
            // After activation, not during it: a send before the session is
            // active returns early, and the interesting case is the one where
            // the message really goes out and the phone's reply comes back.
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(1500))
                await MainActor.run { self?.send(kind) }
            }
        }
    }
#endif

    // MARK: - What the views draw

    /// The last state with the pending tap applied. A wrist that presses Log set
    /// should see the set counted on the next frame, not on the next round trip.
    var display: LiveState? {
        guard var shown = state else { return nil }
        guard let pending = pending else { return shown }
        switch pending.kind {
        case .set:
            shown.progress.done += 1
            if var position = shown.set, position.index < position.total {
                position.index += 1
                shown.set = position
            }
        case .skipRest:
            shown.rest = nil
        case .toggleRest:
            if var rest = shown.rest {
                if rest.isPaused {
                    rest.until = Date().timeIntervalSince1970 * 1000 + rest.held
                    rest.held = 0
                } else {
                    rest.held = rest.remaining() * 1000
                }
                shown.rest = rest
            }
        default:
            break
        }
        return shown
    }

    /// True while the phone is being asked to end the session.
    var ending: Bool { pending?.kind == .finish }

    // MARK: - Sending

    func send(_ kind: LiveAction.Kind, reps: Int? = nil, weight: Double? = nil) {
        let action = LiveAction(kind: kind, source: .watch, id: nil, reps: reps, weight: weight)
        guard let data = try? encoder.encode(action) else { return }

        pending = Pending(kind: kind, reps: reps, weight: weight)
        stalled = false
        // The wrist's own receipt. Apple's guidance is that a watch confirms
        // input locally rather than waiting for a network of any kind.
        WKInterfaceDevice.current().play(.click)
        armStall()

        let session = WCSession.default
        guard session.activationState == .activated else { return }
        if session.isReachable {
            session.sendMessage([Key.action: data], replyHandler: { [weak self] _ in
                // The phone has it. That is a different fact from "the engine
                // has caught up", and it is the one the footnote is about: an
                // acknowledged action whose new state is a moment behind is not
                // a watch that has lost its phone.
                Task { @MainActor in self?.acknowledged() }
            }, errorHandler: { [weak self] error in
                NSLog("Spotter watch: message failed, queueing %@", String(describing: error))
                // Reachability can lapse between the check and the send. The
                // queued path still delivers, just not now.
                session.transferUserInfo([Key.action: data])
                Task { @MainActor in self?.armStall() }
            })
        } else {
            // Out of range: it will arrive, possibly at the phone's next launch.
            // The footnote stays armed, because from here nothing has answered.
            session.transferUserInfo([Key.action: data])
        }
    }

    /// The phone answered. Stop counting toward the footnote; the optimistic
    /// state stands until the real one replaces it.
    private func acknowledged() {
        stalled = false
        stallTask?.cancel()
        stallTask = nil
    }

    /// Let the done card go and fall back to the idle face.
    func dismissDone() {
        done = nil
    }

    private func armStall() {
        stallTask?.cancel()
        stallTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            await MainActor.run { if self?.pending != nil { self?.stalled = true } }
        }
    }

    // MARK: - Receiving

    private func apply(_ payload: [String: Any]) {
        guard !payload.isEmpty else { return }

        if let data = payload[Key.summary] as? Data,
           let summary = try? decoder.decode(WidgetSummary.self, from: data) {
            self.summary = summary
        }

        if let data = payload[Key.done] as? Data,
           let ended = try? decoder.decode(LiveSummary.self, from: data) {
            state = nil
            done = ended
            settle()
            cancelRestAlarm()
            return
        }

        if let data = payload[Key.live] as? Data,
           let live = try? decoder.decode(LiveState.self, from: data) {
            // A state arriving for a session that is running again clears the
            // card from the one before it.
            done = nil
            state = live
            settle()
            scheduleRestAlarm(for: live)
        }
    }

    /// The truth is in. Whatever the wrist was pretending stops being pretend.
    private func settle() {
        pending = nil
        stalled = false
        stallTask?.cancel()
        stallTask = nil
    }

    // MARK: - The rest deadline, held here

    private func scheduleRestAlarm(for live: LiveState) {
        guard let rest = live.rest, !rest.isPaused else { cancelRestAlarm(); return }
        guard rest.until > firedDeadline else { return }
        let remaining = rest.remaining()
        guard remaining > 0 else { return }
        let deadline = rest.until
        cancelRestAlarm()
        restAlarm = Task { [weak self] in
            try? await Task.sleep(for: .seconds(remaining))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.firedDeadline = deadline
                // .notification is the system's "something you were waiting for
                // has happened" pattern — a double tap, distinct from the click
                // that confirms the wearer's own press. It only reaches the
                // wrist while the app is frontmost or a workout session is
                // running; see WorkoutKeeper.
                WKInterfaceDevice.current().play(.notification)
            }
        }
    }

    private func cancelRestAlarm() {
        restAlarm?.cancel()
        restAlarm = nil
    }

    // MARK: - WCSessionDelegate

    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        if let error = error {
            NSLog("Spotter watch: session activation failed %@", String(describing: error))
            return
        }
        let waiting = session.receivedApplicationContext
        Task { @MainActor [weak self] in self?.apply(waiting) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor [weak self] in self?.apply(context) }
    }

    /// The phone's low-latency echo of a context it has already queued: the same
    /// keys, as one JSON object rather than a dictionary of blobs.
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: messageData) as? [String: Any] else { return }
        var payload: [String: Any] = [:]
        for (key, value) in object {
            if let data = try? JSONSerialization.data(withJSONObject: value) { payload[key] = data }
        }
        Task { @MainActor [weak self] in self?.apply(payload) }
    }
}
