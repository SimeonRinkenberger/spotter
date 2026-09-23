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
// page as a height with its duration and curve, and the page lifts the one surface
// that owns the field — a sheet, the composer — with a composited transform that
// starts on the same frame and follows the same curve. Capacitor's Keyboard plugin
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
            self.sentHeight = height
            self.animatingUntil = CACurrentMediaTime() + duration
            self.send("spotter:keyboard-transition", [
                "visible": height > 0, "height": Double(height), "duration": duration, "curve": curve
            ])
            if height > 0 {
                self.keyboardShown = true
                self.armInteractiveDismissal(in: webView.scrollView)
                self.startFollowing()
            } else {
                self.keyboardShown = false
                // Outlast the closing animation, then stop sampling.
                DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.1) { [weak self] in
                    guard let self = self, !self.keyboardShown else { return }
                    self.keyboardLink?.invalidate()
                    self.keyboardLink = nil
                }
            }
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

    // Sample the layout guide once a frame while the keyboard is up. Animated
    // moves need nothing from here — the notification above already started the
    // page's matching animation, and the guide's model value jumps straight to
    // the value that was sent. Only a finger moves the guide without a
    // notification, and then the page follows it frame by frame.
    private func startFollowing() {
        guard keyboardLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(followKeyboard))
        link.add(to: .main, forMode: .common)
        keyboardLink = link
    }

    @objc private func followKeyboard() {
        guard keyboardShown else { return }
        view.layoutIfNeeded()
        let top = keyboardProbe.frame.maxY
        let height = top >= view.bounds.height - view.safeAreaInsets.bottom - 1 ? 0 : max(0, view.bounds.height - top)
        // While UIKit animates, the guide is already at its end value and the page
        // is already animating there; take it as the baseline and send nothing.
        if CACurrentMediaTime() < animatingUntil { sentHeight = height; return }
        if abs(height - sentHeight) < 0.5 { return }
        sentHeight = height
        send("spotter:keyboard-track", ["height": Double(height)])
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
