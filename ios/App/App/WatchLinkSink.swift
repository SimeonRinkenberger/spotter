import Capacitor
import Foundation
import WatchConnectivity

// The watch's ear on the workout engine, phone side.
//
// Registered at launch alongside the Live Activity sink. The watch is the one
// destination that has to hold its own copy of the rest deadline — the phone
// can be locked and the wrist still has to finish the countdown — so what
// crosses this seam is the whole LiveState, not a rendered string.
//
// Three WatchConnectivity facts decide the shape of this file, all of them from
// Apple's WCSession documentation:
//
//  1. `updateApplicationContext` REPLACES the dictionary it was given last time.
//     It is not a patch. A naive `["live": …]` followed by `["summary": …]`
//     erases the running session from the watch's view of the world, so this
//     class keeps the whole mirror in `mirror` and always sends all of it.
//  2. It is delivered "when the opportunity arises", latest-wins, and may be
//     called while the counterpart is unreachable — exactly the semantics of a
//     session mirror, where a dropped intermediate state costs nothing and the
//     newest one is the only one worth having.
//  3. `sendMessageData` is immediate but needs `isReachable`, and — this is the
//     asymmetry that matters for the wrist — a message from the WATCH wakes the
//     iOS app in the background, while a message from the phone does NOT wake
//     the watch app. So the phone uses it only as a low-latency echo of a
//     context it has already queued, never as the delivery it depends on.
final class WatchLinkSink: NSObject, LiveStateSink {
    /// The four keys of the phone-watch wire. Spelled identically in
    /// SpotterWatch/WatchLink.swift; tools/ios/watch-check.mjs holds the two
    /// lists against each other, because a typo here is a watch that shows
    /// nothing and reports nothing.
    enum Key {
        static let live = "live"
        static let done = "done"
        static let summary = "summary"
        static let action = "action"
    }

    /// Everything the watch should currently believe, by key. Sent whole.
    private var mirror: [String: Data] = [:]
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    override init() {
        super.init()
        activate()
    }

    private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

    /// Idempotent, like the watch's own activate(): the app may be relaunched
    /// while a session object already exists.
    private func activate() {
        guard let session = session else { return }
        session.delegate = self
        if session.activationState != .activated { session.activate() }
    }

    // MARK: - LiveStateSink

    func update(_ state: LiveState) {
        put(Key.live, state, dropping: Key.done)
    }

    func end(_ summary: LiveSummary) {
        // The live state goes out in the same breath the summary arrives in.
        // A watch that kept both would have a countdown running under a "Nice
        // work" card, and the deadline it is counting to belongs to a session
        // that is over.
        put(Key.done, summary, dropping: Key.live)
    }

    func publish(_ summary: WidgetSummary) {
        // Survives the session: this is what the idle face shows afterwards.
        put(Key.summary, summary, dropping: nil)
    }

    // MARK: - Sending

    private func put<T: Encodable>(_ key: String, _ value: T, dropping stale: String?) {
        guard let data = try? encoder.encode(value) else {
            CAPLog.print("WatchLink: could not encode", key)
            return
        }
        if let stale = stale { mirror.removeValue(forKey: stale) }
        mirror[key] = data
        push(changed: key)
    }

    private func push(changed key: String) {
        guard let session = session, session.activationState == .activated else { return }
        // An iPhone with no watch paired, or one whose owner never installed the
        // companion, is the common case. Both throw here rather than no-op.
        #if os(iOS)
        guard session.isPaired, session.isWatchAppInstalled else { return }
        #endif

        do {
            try session.updateApplicationContext(mirror)
        } catch {
            // Two ordinary failures live here and neither is worth a user-facing
            // anything: a context identical to the last one, and a watch that
            // went away between the guard above and this line.
            CAPLog.print("WatchLink: context not accepted", String(describing: error))
        }

        // The echo. Only the part that changed, because this is about latency,
        // not about state: the context above is what the watch can rely on.
        guard session.isReachable, let body = mirror[key],
              let object = try? JSONSerialization.jsonObject(with: body),
              let message = try? JSONSerialization.data(withJSONObject: [key: object]) else { return }
        session.sendMessageData(message, replyHandler: nil, errorHandler: { error in
            CAPLog.print("WatchLink: echo failed", String(describing: error))
        })
    }

    // MARK: - Receiving

    /// A wrist tap, from either transport, into the one door the Lock Screen
    /// uses as well. Nothing here knows what a set is: the engine does.
    private func receive(_ payload: [String: Any]) -> Bool {
        guard let data = payload[Key.action] as? Data,
              let action = try? decoder.decode(LiveAction.self, from: data) else { return false }
        LiveStatePlugin.deliver(action)
        return true
    }
}

// MARK: - WCSessionDelegate

extension WatchLinkSink: WCSessionDelegate {
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        if let error = error {
            CAPLog.print("WatchLink: activation failed", String(describing: error))
            return
        }
        // A session that activated after the engine had already published —
        // a cold launch straight into a resumed workout — has a mirror waiting.
        if !mirror.isEmpty { push(changed: mirror.keys.first ?? Key.live) }
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Switching to another Apple Watch deactivates the old session; nothing is
    /// delivered again until a new one is activated, so do it immediately.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The companion was just installed, or a different watch became the active
    /// one. Either way it has never seen the mirror.
    func sessionWatchStateDidChange(_ session: WCSession) {
        if !mirror.isEmpty { push(changed: mirror.keys.first ?? Key.live) }
    }
    #endif

    /// The watch came within reach mid-session. The context it was sent while
    /// unreachable is already queued, but the echo is cheap and the wrist is
    /// looking at the screen right now.
    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable, let key = mirror[Key.live] != nil ? Key.live : mirror.keys.first else { return }
        push(changed: key)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        _ = receive(message)
    }

    /// The reply is the watch's receipt: it clears the "Waiting for iPhone…"
    /// footnote without waiting for the state that the action will produce.
    func session(_ session: WCSession,
                 didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        replyHandler(["ok": receive(message)])
    }

    /// The queued path, used by the watch when the phone is not reachable. It
    /// arrives late by design — possibly at the next launch — which is why the
    /// engine's own guards (no session running, rest already over) are what
    /// decide whether it still means anything.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        _ = receive(userInfo)
    }
}
