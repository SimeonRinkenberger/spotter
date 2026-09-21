import Foundation
import UIKit
import UserNotifications

// Every local notification this app will ever post goes through here.
//
// Spotter has shipped without notifications of any kind, which means the first
// time a person sees the system permission sheet is a decision, not a detail.
// Two rules follow from Apple's guidance (HIG, "Notifications": ask in context,
// after the value is obvious) and they are enforced by this file's shape:
//
//   - `request()` is never called at launch. There is no call to it in
//     AppDelegate. The only caller is the web app, from inside Workout Mode,
//     after its own one-line explanation of what the notification is for. A
//     permission sheet on first launch is the fastest way to a permanent "Don't
//     Allow", and iOS gives an app exactly one chance to ask.
//   - `willPresent` stays silent while the app is in front. A rest timer ending
//     while Workout Mode is on screen already announces itself — the screen
//     changes, the haptic fires. A banner over the top of that is the app
//     talking to itself.
//
// `install()` is called at launch and only sets the delegate, which is required
// before the first notification is delivered if taps are to be routed at all.
// Setting a delegate asks for nothing and shows nothing.
final class NotificationsHost: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationsHost()

    /// The four answers the contract allows. `.provisional` is reported honestly
    /// rather than folded into `.granted`: a provisional authorization delivers
    /// quietly to Notification Centre, which is not the rest-timer nudge anyone
    /// asked for, and the web app may want to say so.
    enum Status: String {
        case granted, denied, undetermined, provisional
    }

    private override init() { super.init() }

    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    /// Claim the notification delegate. Called from AppDelegate.didFinishLaunching
    /// — early enough for a launch response — and AGAIN from
    /// SpotterViewController.capacitorDidLoad.
    ///
    /// The second call is not belt and braces. Capacitor installs its own
    /// `CAPNotificationRouter` as the delegate when the bridge loads, which
    /// silently replaces this one: measured on the iPhone 16e, six seconds after
    /// launch the delegate read back as `CAPNotificationRouter`, and every tap on
    /// a Spotter notification went nowhere — no route to the Plan tab, no route
    /// out of a rest-end nudge. Taking it back is safe precisely because that
    /// router exists to feed notification-handling plugins and this build has
    /// none: no local-notifications plugin, no push-notifications plugin. If one
    /// is ever added, it and this have to be reconciled rather than race.
    ///
    /// Delegate only — no permission is requested here. That is asked for in
    /// Workout Mode, in context, from a tap.
    func install() {
        center.delegate = self
    }

    /// The response that launched the app, handed over by the scene: a cold
    /// launch resolves it before any delegate of ours can be asked.
    func handle(_ response: UNNotificationResponse) {
        route(response)
    }

    // MARK: - Permission

    func status(_ completion: @escaping (Status) -> Void) {
        center.getNotificationSettings { settings in
            let status: Status
            switch settings.authorizationStatus {
            case .authorized, .ephemeral: status = .granted
            case .provisional: status = .provisional
            case .denied: status = .denied
            case .notDetermined: status = .undetermined
            @unknown default: status = .undetermined
            }
            DispatchQueue.main.async { completion(status) }
        }
    }

    /// Ask, then report what the system actually settled on.
    ///
    /// The requestAuthorization callback's Bool is not the answer on its own: a
    /// second call after a denial returns false without showing anything, and an
    /// app that trusted the Bool would keep insisting it had just been refused.
    /// Reading the settings back afterwards gives the same answer in both cases.
    func request(_ completion: @escaping (Status) -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] _, error in
            if let error = error {
                NSLog("Spotter notifications: authorization failed %@", String(describing: error))
            }
            guard let self = self else {
                DispatchQueue.main.async { completion(.undetermined) }
                return
            }
            self.status(completion)
        }
    }

    // MARK: - Scheduling

    /// One notification at an absolute instant.
    ///
    /// A date trigger, not a time interval: the caller's deadline is the rest
    /// deadline the whole app already agrees on, and an interval computed at
    /// scheduling time drifts against it every time the app is suspended
    /// mid-rest. Re-scheduling the same id replaces the pending copy, so a
    /// paused-and-resumed rest cannot queue two alerts.
    /// A date in the past is dropped rather than fired immediately.
    ///
    /// `timeSensitive` raises the interruption level to `.timeSensitive`, which
    /// "presents the notification immediately, lights up the screen, can play a
    /// sound, and breaks through system controls such as Notification Summary
    /// and Focus" (UNNotificationInterruptionLevel.timeSensitive). It needs the
    /// `com.apple.developer.usernotifications.time-sensitive` entitlement,
    /// which the App target's entitlements files carry; without it the system
    /// quietly delivers the notification at the active level instead. Off by
    /// default: the person can switch Time Sensitive alerts off per app in
    /// Settings, and an app that marked every reminder urgent would earn
    /// exactly that. The rest-end nudge is the one caller that passes true.
    func schedule(id: String, title: String, body: String, at date: Date, category: String? = nil,
                  timeSensitive: Bool = false) {
        guard date.timeIntervalSinceNow > 0.5 else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if timeSensitive { content.interruptionLevel = .timeSensitive }
        if let category = category { content.categoryIdentifier = category }
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) { error in
            if let error = error {
                NSLog("Spotter notifications: could not schedule %@ %@", id, String(describing: error))
            }
        }
    }

    /// Cancel both the pending copy and one already sitting in Notification
    /// Centre. A rest the user skipped should not still be announced, and it
    /// should not still be readable a minute later either.
    func cancel(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }

    func cancelAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let active = UIApplication.shared.applicationState == .active
        completionHandler(active ? [] : [.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        // A remote reminder carries where it wants to go in userInfo["url"] as a
        // spotter:// link; a local one has only its own identifier. The web app
        // can tell the two apart by shape, and routing a link is strictly more
        // useful than routing the string "rest-end".
        route(response)
        completionHandler()
    }

    private func route(_ response: UNNotificationResponse) {
        let link = response.notification.request.content.userInfo["url"] as? String
        let id = (link?.isEmpty == false) ? link : response.notification.request.identifier
        LiveStatePlugin.deliver(LiveAction(kind: .notification, source: .notification, id: id))
    }
}
