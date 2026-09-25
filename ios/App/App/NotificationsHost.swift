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
//     talking to itself. A ready card is handed to the page instead, which has
//     a sheet for it.
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
    ///
    /// The ready card's category goes in at the same moment, for the same reason
    /// the delegate does: a category registered after the notification arrives
    /// is a banner with no buttons. Registering one asks for nothing either.
    func install() {
        center.delegate = self
        center.setNotificationCategories([Self.readyCategory])
    }

    // MARK: - A saved video is ready

    /// The one notification with buttons: a video shared in from another app has
    /// become a workout (push.ts, `card_ready`). Both buttons open the app,
    /// because both need it — Start Now to run the session, Plan It to show the
    /// days — and neither just opens it, which Apple's HIG rules out: Start Now
    /// lands in Workout Mode and Plan It on the ready sheet's days, where the
    /// banner itself shows the card. Title case and a symbol each, as the HIG asks
    /// of notification actions. Start Now goes first: the Watch's double tap
    /// answers with the first action that is not destructive.
    static let readyCategory = UNNotificationCategory(
        identifier: "CARD_READY",
        actions: [
            UNNotificationAction(identifier: "START_NOW", title: "Start Now", options: [.foreground],
                                 icon: UNNotificationActionIcon(systemImageName: "play.fill")),
            UNNotificationAction(identifier: "PLAN_IT", title: "Plan It", options: [.foreground],
                                 icon: UNNotificationActionIcon(systemImageName: "calendar.badge.plus")),
        ],
        intentIdentifiers: [],
        // What a Lock Screen with previews hidden says instead of the card's name.
        hiddenPreviewsBodyPlaceholder: "A saved workout is ready",
        options: [])

    /// The card a ready notification names, if it names a plausible one: the id
    /// ends up in a spotter:// link, so it may hold nothing a link could be bent by.
    private static func readyCard(_ content: UNNotificationContent) -> String? {
        guard content.categoryIdentifier == readyCategory.identifier,
              let card = content.userInfo["card"] as? String, !card.isEmpty, card.count <= 64,
              card.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { return nil }
        return card
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
        // A ready card with Spotter in front is not a banner over the app: the
        // page is handed the card and shows its own sheet, by its quieter rules
        // (?auto=1 — never over a set or another sheet, once per card), which is
        // Apple's "discoverable but not distracting" for news that arrives in the
        // foreground.
        if active, let card = Self.readyCard(notification.request.content) {
            LiveStatePlugin.deliver(LiveAction(kind: .notification, source: .notification,
                                               id: "spotter://ready/" + card + "?auto=1"))
        }
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
        let content = response.notification.request.content
        let link = content.userInfo["url"] as? String
        var id = (link?.isEmpty == false) ? link : response.notification.request.identifier
        // A ready card's two buttons act on the card it names; the banner itself
        // follows its url like any other (the card's sheet, or Workouts for a burst).
        if let card = Self.readyCard(content) {
            switch response.actionIdentifier {
            case "START_NOW": id = "spotter://start/" + card
            case "PLAN_IT": id = "spotter://ready/" + card
            default: break
            }
        }
        LiveStatePlugin.deliver(LiveAction(kind: .notification, source: .notification, id: id))
    }
}
