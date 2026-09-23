import Capacitor
import UIKit

// Keep the web app's complete visual design, and keep its frame still.
//
// The web view used to end on UIKit's keyboard layout guide, so UIKit resized it
// inside the keyboard's own animation. WebKit does not lay a page out once per
// animation frame: it re-laid the page at the final size at once while the view's
// edge was still travelling, so the whole page dropped a quarter of the screen and
// climbed back, the set sheet waited and then jumped, and the Pumpy composer
// vanished for a few frames on every dismissal (before/after recordings, BRIEF
// 0923-KB). So the frame no longer moves at all. The keyboard is reported to the
// page as a height with its duration, curve and how far the keys' own animation has
// already run, and the page lifts the one surface that owns the field — a sheet,
// the composer — with a composited transform on the keys' timeline and curve. Capacitor's Keyboard plugin
// already detaches WebKit's own keyboard observers (resize: none), so WebKit neither
// shrinks the visual viewport nor scrolls the document to reveal the field; the page
// owns all of it.
class SpotterViewController: CAPBridgeViewController {
    private var keyboardObserver: NSObjectProtocol?
    // A 1pt view hung from the keyboard layout guide: the only public, per-frame
    // account of where the keyboard is while a finger drags it down (interactive
    // dismissal posts no notification until the finger lets go).
    private let keyboardProbe = UIView()
    private var keyboardLink: CADisplayLink?
    private var sentHeight: CGFloat = 0
    private var keyboardShown = false
    private var animatingUntil: CFTimeInterval = 0
    private var pendingTransition: [String: Any]?
    private var pendingDuration: Double = 0
    private var pendingSince: CFTimeInterval = 0
    private var targetHeight: CGFloat = 0
    // Match --paper in the shared stylesheet, including appearance changes.
    private let paper = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 16/255, green: 18/255, blue: 20/255, alpha: 1)
            : UIColor(red: 245/255, green: 246/255, blue: 248/255, alpha: 1)
    }

    // Sinks are held weakly by the registry, so the controller owns them. They
    // outlive a web view reload on purpose: a Live Activity on the Lock Screen
    // must not be orphaned because the page reloaded underneath it.
    private let liveActivitySink = LiveActivitySink()
    private let watchLinkSink = WatchLinkSink()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PumpyStreamPlugin())
        bridge?.registerPluginInstance(ShareAccessPlugin())
        bridge?.registerPluginInstance(GoogleAuthPlugin())
        bridge?.registerPluginInstance(AppleAuthPlugin())
        bridge?.registerPluginInstance(SecureSessionPlugin())
        bridge?.registerPluginInstance(LiveStatePlugin())
        bridge?.registerPluginInstance(SpotterPushPlugin())
        LiveStatePlugin.register(sink: liveActivitySink)
        LiveStatePlugin.register(sink: watchLinkSink)
        // The bridge has just taken the notification delegate for its own router.
        // Take it back — see NotificationsHost.install().
        NotificationsHost.shared.install()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = webView else { return }
        let host = UIView(frame: webView.frame)
        host.backgroundColor = paper
        view = host
        host.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: host.bottomAnchor)
        ])
        let keyboard = host.keyboardLayoutGuide
        keyboard.followsUndockedKeyboard = false
        keyboard.usesBottomSafeArea = false
        keyboard.keyboardDismissPadding = 24
        keyboardProbe.isHidden = true
        keyboardProbe.isUserInteractionEnabled = false
        keyboardProbe.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(keyboardProbe)
        NSLayoutConstraint.activate([
            keyboardProbe.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            keyboardProbe.widthAnchor.constraint(equalToConstant: 1),
            keyboardProbe.heightAnchor.constraint(equalToConstant: 1),
            keyboardProbe.bottomAnchor.constraint(equalTo: keyboard.topAnchor)
        ])
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.delaysContentTouches = false
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.underPageBackgroundColor = paper
        keyboardObserver = NotificationCenter.default.addObserver(
            forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let info = notification.userInfo,
                  let screenFrame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            if let local = info[UIResponder.keyboardIsLocalUserInfoKey] as? Bool, !local { return }
            let height = self.overlap(of: self.view.convert(screenFrame, from: nil))
            let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int ?? 7
            // The frame the keys are already travelling to, reported again with no
            // duration, is not news: taken as news it would cut the page's
            // animation short and drop the sheet in one frame.
            let now = CACurrentMediaTime()
            if duration == 0, abs(height - self.targetHeight) < 0.5,
               self.pendingTransition != nil || now < self.animatingUntil { return }
            self.targetHeight = height
            self.sentHeight = height
            self.keyboardShown = height > 0
            // UIKit posts this before the keys' animation exists: it is committed
            // at the end of this run-loop turn, or later while a keyboard is still
            // being built (a first number pad: 60ms in the Simulator). Told now,
            // the page started its clock that much ahead of the keys and its first
            // visible frame was two-thirds of the way up. The page is told on the
            // first frame the keys' animation has a begin time (followKeyboard).
            self.pendingSince = CACurrentMediaTime()
            self.pendingTransition = [
                "visible": height > 0, "height": Double(height), "duration": duration, "curve": curve
            ]
            self.pendingDuration = duration
            self.animatingUntil = .infinity
            if height > 0 { self.armInteractiveDismissal(in: webView.scrollView) }
            self.startFollowing()
        }
    }

    // The part of the keyboard that covers the page, in points. A floating or
    // split keyboard, or a hardware keyboard's thin bar at the safe-area edge,
    // covers nothing the page has to move for.
    private func overlap(of frame: CGRect) -> CGFloat {
        let covered = view.bounds.intersection(frame)
        guard !covered.isNull, frame.width >= view.bounds.width * 0.8,
              covered.height > view.safeAreaInsets.bottom + 1 else { return 0 }
        return covered.height
    }

    private func send(_ event: String, _ data: [String: Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: data),
              let text = String(data: json, encoding: .utf8) else { return }
        bridge?.triggerWindowJSEvent(eventName: event, data: text)
    }

    // WebKit makes a UIScrollView for every overflowing scroller in the page and
    // gives none of them the web view's own dismiss mode, so dragging the Pumpy
    // thread or a list of results never took the keyboard with it. Every scroller
    // present when the keyboard rises gets the Messages behaviour: the keyboard
    // follows a finger that drags down into it.
    private func armInteractiveDismissal(in root: UIView) {
        for sub in root.subviews {
            if let scroller = sub as? UIScrollView, scroller.keyboardDismissMode != .interactive {
                scroller.keyboardDismissMode = .interactive
            }
            armInteractiveDismissal(in: sub)
        }
    }

    // Once a frame while the keyboard is on screen or moving: hand the page a
    // pending transition on the first free frame (above), then sample the layout
    // guide. Animated moves need nothing more — the page is already animating to
    // the value the guide jumps to. Only a finger moves the guide without a
    // notification (interactive dismissal), and then the page follows it frame by
    // frame.
    private func startFollowing() {
        guard keyboardLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(followKeyboard))
        link.add(to: .main, forMode: .common)
        keyboardLink = link
    }

    @objc private func followKeyboard() {
        let now = CACurrentMediaTime()
        if var pending = pendingTransition {
            // How long the keys have already been moving when the page hears of
            // it; the page starts its clock that far in, so both run on one
            // timeline. An animation that began before the notification is the
            // last one still settling, not this one. A keyboard UIKit moves some
            // other way (or not at all) gets one frame's grace, then goes as is.
            let animation = keyboardAnimation()
            let fresh = animation.map { $0.begin == 0 || $0.begin >= pendingSince - 0.001 } ?? false
            let waited = now - pendingSince
            if !fresh && waited < 0.02 { return }
            let begin = fresh ? animation!.begin : 0
            if fresh && begin == 0 && waited < 0.3 { return }
            // A number pad with its form accessory is dismissed with a notification
            // that says 0s while the keys still take 0.383s to leave: the page
            // dropped its sheet in one frame. The animation itself knows better.
            var duration = pendingDuration
            if duration == 0, fresh, animation!.duration > 0 { duration = animation!.duration }
            let elapsed = begin > 0 ? max(0, min(duration, now - begin)) : 0
            pending["duration"] = duration
            pending["elapsed"] = elapsed
            pendingTransition = nil
            animatingUntil = now - elapsed + duration
            send("spotter:keyboard-transition", pending)
            return
        }
        guard keyboardShown else {
            if now > animatingUntil + 0.1 { keyboardLink?.invalidate(); keyboardLink = nil }
            return
        }
        view.layoutIfNeeded()
        let top = keyboardProbe.frame.maxY
        let height = top >= view.bounds.height - view.safeAreaInsets.bottom - 1 ? 0 : max(0, view.bounds.height - top)
        // While UIKit animates, the guide is already at its end value and the page
        // is already animating there; take it as the baseline and send nothing.
        if now < animatingUntil { sentHeight = height; return }
        if abs(height - sentHeight) < 0.5 { return }
        sentHeight = height
        send("spotter:keyboard-track", ["height": Double(height)])
    }

    // The keys' own position animation: UIKit moves the keyboard's container in
    // the text-effects window with an additive CASpringAnimation, whose beginTime
    // is 0 until the transaction carrying it commits. nil when there is none.
    private func keyboardAnimation() -> (begin: CFTimeInterval, duration: CFTimeInterval)? {
        for scene in UIApplication.shared.connectedScenes {
            guard let windows = (scene as? UIWindowScene)?.windows else { continue }
            for window in windows where window !== view.window {
                if let found = positionAnimation(in: window, depth: 0) {
                    return (found.beginTime, found.duration)
                }
            }
        }
        return nil
    }

    private func positionAnimation(in view: UIView, depth: Int) -> CAAnimation? {
        if let animation = view.layer.animation(forKey: "position") { return animation }
        guard depth < 4 else { return nil }
        for sub in view.subviews {
            if let found = positionAnimation(in: sub, depth: depth + 1) { return found }
        }
        return nil
    }

    deinit {
        keyboardLink?.invalidate()
        if let keyboardObserver = keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        view.window?.backgroundColor = paper
    }
}
