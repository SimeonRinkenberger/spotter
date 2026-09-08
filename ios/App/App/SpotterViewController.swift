import Capacitor
import UIKit

// Keep the web app's complete visual design. UIKit owns only the keyboard frame,
// avoiding the delayed, competing viewport resize that made typing feel jumpy.
class SpotterViewController: CAPBridgeViewController {
    private var webBottom: NSLayoutConstraint?
    private var keyboardObserver: NSObjectProtocol?
    // Match --paper in the shared stylesheet, including appearance changes.
    private let paper = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 16/255, green: 18/255, blue: 20/255, alpha: 1)
            : UIColor(red: 245/255, green: 246/255, blue: 248/255, alpha: 1)
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PumpyStreamPlugin())
        bridge?.registerPluginInstance(ShareAccessPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = webView else { return }
        let host = UIView(frame: webView.frame)
        host.backgroundColor = paper
        view = host
        host.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        let keyboard = host.keyboardLayoutGuide
        keyboard.followsUndockedKeyboard = false
        if #available(iOS 17.0, *) {
            keyboard.usesBottomSafeArea = false
            keyboard.keyboardDismissPadding = 24
        }
        webBottom = webView.bottomAnchor.constraint(equalTo: keyboard.topAnchor)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webBottom!
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
            let frame = self.view.convert(screenFrame, from: nil)
            let overlap = self.view.bounds.intersection(frame)
            let visible = !overlap.isNull && overlap.height > self.view.safeAreaInsets.bottom + 1
                && frame.width >= self.view.bounds.width * 0.8
            let timing: [String: Any] = [
                "visible": visible,
                "duration": info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25,
                "curve": info[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int ?? 0
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: timing),
                  let json = String(data: data, encoding: .utf8) else { return }
            // Geometry stays with the guide. Only the web page's internal
            // clearance animates using this timing, rather than snapping first.
            self.bridge?.triggerWindowJSEvent(eventName: "spotter:keyboard-transition", data: json)
        }
    }

    deinit { if let keyboardObserver = keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) } }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        view.window?.backgroundColor = paper
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Older layout guides rest at the safe-area edge. The page already owns
        // its home-indicator padding, so include that area once when at rest.
        if #available(iOS 17.0, *) { return }
        let inset = view.keyboardLayoutGuide.layoutFrame.height <= view.safeAreaInsets.bottom + 1
            ? view.safeAreaInsets.bottom : 0
        if webBottom?.constant != inset { webBottom?.constant = inset }
    }
}
