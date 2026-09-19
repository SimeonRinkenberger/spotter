import Combine
import Foundation
import WatchConnectivity

// The watch's end of the phone link.
//
// Activating the session is all this does today, and it is the part that has to
// exist before anything else can: WCSession delivers nothing — not an
// application context the phone left waiting, not a message — until both ends
// have activated. Getting that out of the way at launch means the watch agent's
// first state arrives without a round trip.
//
// D fills. What lands here: `didReceiveApplicationContext` decoding a LiveState,
// published to the views; a `sendMessage` path for the log-set and skip-rest
// taps that reaches LiveStatePlugin.deliver on the phone; and the watch's own
// copy of the rest deadline, so the countdown survives the phone locking.
final class WatchLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchLink()

    /// The last state the phone sent, once D starts sending one.
    @Published private(set) var state: LiveState?

    private override init() { super.init() }

    /// Idempotent: activating an already-active session is a no-op, so the app's
    /// init and any later retry can both call it.
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated { session.activate() }
    }

    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        if let error = error {
            NSLog("Spotter watch: session activation failed %@", String(describing: error))
        }
        // D fills.
    }
}
