import Capacitor
import Foundation
import UIKit

// Remote notifications: the device half, and only the device half.
//
// Spotter's two reminders (plan-day and week-at-risk) reach the web app through
// VAPID Web Push. This plugin gets them to a native install instead, and its
// entire job is to answer three questions about THIS phone: what has the user
// allowed, which APNs environment is this build talking to, and what is the
// device token. Everything else — whether the deployment has an APNs signing
// key, which row the token belongs in, when to stop — is the web app's, because
// the web app is the half that can ask the server.
//
// That split is why `status()` does not report `configured`. A plugin that
// guessed would be guessing about a secret it cannot see; the page already
// fetches GET /api/push/config for the VAPID key and now reads `apns` from the
// same answer.
//
// Two rules from Apple's guidance shape the rest (HIG "Notifications", and
// "Registering your app with APNs"):
//
//   - Nothing here is called at launch. `register()` runs from the tap on a
//     reminder switch, and it is the FIRST thing that can show the system
//     permission sheet. iOS gives an app one chance to ask.
//   - `registerForRemoteNotifications()` is only called once permission is
//     actually held. Calling it first would succeed — it is not gated on
//     permission — and hand back a token for a phone that will never display
//     anything, which is a row in the database that costs a push a day and
//     shows nobody anything.
//
// On today's signing this mostly cannot work: a Personal Team is not issued the
// `aps-environment` entitlement, so on a DEVICE registration fails and
// `tokenFailed` is the only callback that fires. The Simulator is more
// forgiving — see design/native/push.md for what actually happened on iPhone Air.
@objc(SpotterPushPlugin)
public class SpotterPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotterPushPlugin"
    public let jsName = "SpotterPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise)
    ]

    /// How long to wait for APNs before giving the page an answer it can act on.
    /// Registration is a round trip to Apple over whatever network the phone is
    /// on; ten seconds is long enough for a slow one and short enough that a
    /// switch does not sit spinning while the user wonders whether it took.
    private static let tokenTimeout: TimeInterval = 10

    /// Which APNs host the token from this build belongs to. A Debug build is
    /// issued a sandbox token and a distribution build a production one, and
    /// sending to the wrong host is the single most common way a correct payload
    /// never arrives — so the answer travels with the token into the row.
    private static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    // MARK: - The token, which arrives somewhere else entirely

    // AppDelegate is handed the token, not this plugin, and the delegate method
    // has no idea which call asked for it. So a registration parks a completion
    // here and the delegate callback spends every one that is waiting. A list
    // rather than a single slot because the page is allowed to ask twice (two
    // switches, two taps) and the second ask must not orphan the first.
    private static let lock = NSLock()
    private static var waiting: [(String?, Error?) -> Void] = []

    private static func park(_ completion: @escaping (String?, Error?) -> Void) {
        lock.lock()
        waiting.append(completion)
        lock.unlock()
    }

    private static func settle(_ token: String?, _ error: Error?) {
        lock.lock()
        let pending = waiting
        waiting = []
        lock.unlock()
        // On main, so every completion below can read UIApplication state and
        // resolve its call from one thread.
        DispatchQueue.main.async { for done in pending { done(token, error) } }
    }

    /// Called by AppDelegate when APNs hands over a device token.
    static func tokenReceived(_ data: Data) {
        // Lowercase hex, which is the form APNs itself wants back in the request
        // path. `data.description` used to be the shortcut for this and has
        // printed "{length = 32, bytes = 0x...}" since iOS 13.
        settle(data.map { String(format: "%02x", $0) }.joined(), nil)
    }

    /// Called by AppDelegate when registration fails — which is every build
    /// signed by a Personal Team, so it stays quiet apart from one log line.
    static func tokenFailed(_ error: Error) {
        NSLog("Spotter push: APNs registration failed %@", String(describing: error))
        settle(nil, error)
    }

    // MARK: - What the page asks

    /// The device facts, and nothing that needs the network.
    @objc func status(_ call: CAPPluginCall) {
        NotificationsHost.shared.status { permission in
            call.resolve([
                // `permission` is also the availability signal: a shell built
                // before this plugin existed rejects the call, and `push.js`
                // turns that into "unsupported", so the page has one field to
                // read whichever build it is running in.
                "permission": permission.rawValue,
                "environment": SpotterPushPlugin.environment,
                "bundle": Bundle.main.bundleIdentifier ?? "",
                "registered": UIApplication.shared.isRegisteredForRemoteNotifications
            ])
        }
    }

    /// Ask for permission if it has never been asked, then get a token.
    ///
    /// Called from the tap and only from the tap. Re-callable: a phone that is
    /// already registered takes the fast path through the same code, because
    /// tokens rotate and the page re-checks its own at boot.
    @objc func register(_ call: CAPPluginCall) {
        NotificationsHost.shared.status { [weak self] permission in
            guard let self = self else {
                call.reject("Spotter closed before the notification could be set up.")
                return
            }
            guard permission == .undetermined else {
                self.registerIfAllowed(call, permission)
                return
            }
            NotificationsHost.shared.request { settled in
                self.registerIfAllowed(call, settled)
            }
        }
    }

    private func registerIfAllowed(_ call: CAPPluginCall, _ permission: NotificationsHost.Status) {
        let base: [String: Any] = [
            "permission": permission.rawValue,
            "environment": SpotterPushPlugin.environment,
            "bundle": Bundle.main.bundleIdentifier ?? ""
        ]
        // A refusal is an answer, not a failure: the page has copy for it and a
        // rejected promise would only make that copy harder to reach. Provisional
        // counts as allowed — a quiet delivery to Notification Centre is still a
        // reminder, and it is the user's setting to raise.
        guard permission == .granted || permission == .provisional else {
            call.resolve(base.merging(["granted": false]) { _, new in new })
            return
        }

        // Guarded by `answered` rather than by a flag on the call: resolving a
        // CAPPluginCall twice is a warning in the log and a promise the page has
        // already moved on from. Both closures run on main, so the flag needs no
        // lock of its own.
        var answered = false
        SpotterPushPlugin.park { token, error in
            if answered { return }
            answered = true
            guard let token = token else {
                call.reject(error.map { String(describing: $0) }
                    ?? "This build cannot register for notifications.")
                return
            }
            call.resolve(base.merging(["granted": true, "token": token]) { _, new in new })
        }
        DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        DispatchQueue.main.asyncAfter(deadline: .now() + SpotterPushPlugin.tokenTimeout) {
            if answered { return }
            answered = true
            // Neither callback fired. On a Personal Team build that is the usual
            // outcome on device; on a real one it is a network that went away.
            // Either way the page shows the switch as it was and says nothing it
            // cannot stand behind.
            call.reject("Apple did not answer in time. Try that again in a moment.")
        }
    }

    /// Stop. Apple's own note on this call is that it should be rare — and it is:
    /// the only caller is the page turning the last reminder off, which deletes
    /// the row in the same breath.
    @objc func unregister(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
            call.resolve(["registered": false])
        }
    }
}
