import Capacitor
import Foundation

// Remote notifications, declared but not yet possible.
//
// Spotter's two reminders (plan-day and week-at-risk) reach the web app through
// VAPID Web Push today. The native shell has no route for them: APNs needs the
// `aps-environment` entitlement, and this project signs with a Personal Team,
// which is not issued one. That is an account fact, not an engineering gap.
//
// So the plugin exists with its full method set and answers `configured: false`
// to everything. The web app can ask, get a straight no, and keep showing the
// honest copy it already shows — rather than the alternative, which is a bridge
// call that rejects and a reminders screen that looks broken.
//
// C fills. When the paid account exists: register with APNs here, hand the token
// to the backend through the push_devices route, and start answering
// `configured: true`. `tokenReceived` and `tokenFailed` are already wired to
// AppDelegate, so the only thing missing on this side is what to do with them.
@objc(SpotterPushPlugin)
public class SpotterPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotterPushPlugin"
    public let jsName = "SpotterPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise)
    ]

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["configured": false])
    }

    @objc func register(_ call: CAPPluginCall) {
        call.resolve(["configured": false])
    }

    @objc func unregister(_ call: CAPPluginCall) {
        call.resolve(["configured": false])
    }

    /// Called by AppDelegate when APNs hands over a device token. A no-op until
    /// there is a backend route to put it in.
    static func tokenReceived(_ data: Data) {
        // C fills.
    }

    /// Called by AppDelegate when registration fails. Also the path taken on
    /// every build signed by a Personal Team, so it must stay quiet.
    static func tokenFailed(_ error: Error) {
        // C fills.
    }
}
