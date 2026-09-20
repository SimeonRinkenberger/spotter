import UIKit
import UniformTypeIdentifiers

// A small native view, with no WebView and no attempt to launch the containing
// app. The backend acknowledges a durable job before we tell the user it saved.
final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let linkLabel = UILabel()
    private let consentLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let allowButton = UIButton(type: .system)
    private let declineButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var links: [URL] = []
    private var task: Task<Void, Never>?
    private var session: URLSession?
    private var started = false
    private var finished = false
    // Asked at most once per share: a save still refused after the agreement was
    // recorded is reported, not asked about again.
    private var consentAsked = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        preferredContentSize = CGSize(width: 390, height: 340)
        let title = UILabel()
        title.text = "Save to Spotter"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.accessibilityTraits = .header
        for label in [statusLabel, linkLabel, consentLabel] {
            label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
        }
        linkLabel.textColor = .secondaryLabel
        linkLabel.lineBreakMode = .byTruncatingMiddle
        linkLabel.numberOfLines = 2
        consentLabel.font = .preferredFont(forTextStyle: .subheadline)
        consentLabel.textColor = .secondaryLabel
        consentLabel.isHidden = true
        statusLabel.text = "Reading shared link…"
        saveButton.setTitle("Save workout", for: .normal)
        saveButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
        saveButton.isHidden = true
        allowButton.setTitle("Allow AI processing", for: .normal)
        allowButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        allowButton.addTarget(self, action: #selector(allow), for: .touchUpInside)
        allowButton.isHidden = true
        declineButton.setTitle("Not now", for: .normal)
        declineButton.addTarget(self, action: #selector(decline), for: .touchUpInside)
        declineButton.isHidden = true
        closeButton.setTitle("Cancel", for: .normal)
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, linkLabel, statusLabel, consentLabel, spinner,
                                                   saveButton, allowButton, declineButton, closeButton])
        stack.axis = .vertical; stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            allowButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            declineButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            closeButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }; started = true
        task = Task { await readInput() }
    }

    private func readInput() async {
        spinner.startAnimating()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        var values: [URL] = []
        for item in items.prefix(10) {
            for provider in (item.attachments ?? []).prefix(10) {
                guard let type = [UTType.url.identifier, UTType.plainText.identifier, UTType.text.identifier]
                    .first(where: { provider.hasItemConformingToTypeIdentifier($0) }) else { continue }
                let value: NSSecureCoding? = await withCheckedContinuation { continuation in
                    provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                        continuation.resume(returning: value)
                    }
                }
                guard !Task.isCancelled else { return }
                if let url = value as? URL { values += SharedLink.urls(in: url.absoluteString) }
                else if let text = value as? String { values += SharedLink.urls(in: text) }
                else if let text = value as? NSAttributedString { values += SharedLink.urls(in: text.string) }
                else if let data = value as? Data, data.count <= 64_000,
                        let text = String(data: data, encoding: .utf8) { values += SharedLink.urls(in: text) }
            }
            if let text = item.attributedContentText?.string { values += SharedLink.urls(in: text) }
        }
        var seen = Set<String>()
        links = values.filter { seen.insert($0.absoluteString).inserted }
        spinner.stopAnimating()
        guard !links.isEmpty else {
            statusLabel.text = "No video link was shared. In the social app, share the post’s link to Spotter. Photos and video files aren’t supported here yet."
            return
        }
        linkLabel.text = links.map(\.absoluteString).joined(separator: "\n")
        guard links.count == 1 else {
            statusLabel.text = "Please share one post at a time so Spotter saves the workout you intended."
            return
        }
        // Selecting Spotter is the save action; no second confirmation required.
        await submit()
    }

    @objc private func save() { task = Task { await submit() } }

    // The save key, or the sentence that says why there is none.
    private func credential() -> String? {
        do {
            guard let stored = try ShareCredential.read() else {
                statusLabel.text = "Open Spotter and sign in once, then share this post again."
                return nil
            }
            return stored
        } catch {
            statusLabel.text = "Unlock your phone and open Spotter once, then try sharing again."
            return nil
        }
    }

    private func request(_ route: String, key: String, body: [String: Any]) -> URLRequest {
        var request = URLRequest(url: URL(string: SheetPipeline.functionBase + route)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-ingest-key")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    private func makeTransport() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }

    private func submit() async {
        guard let link = links.first, !finished else { return }
        saveButton.isHidden = true
        guard let key = credential() else { return }
        spinner.startAnimating()

        // The frames, before the save that carries them.
        //
        // This is the one thing the phone can do that the server cannot: cut
        // stills out of the video and send them with the link, so the reader
        // looks at the workout instead of only listening to it. It is strictly
        // best effort and strictly budgeted — eight seconds, after which the save
        // goes out exactly as it did before and the server falls back to reading
        // the video itself. The wording changes because the wait changed: a
        // person watching a share sheet for four seconds deserves to know the
        // phone is doing something for them, not stalling.
        var payload: [String: Any] = ["url": link.absoluteString]
        if TikTokMedia.isTikTok(link) {
            statusLabel.text = "Reading the video…"
            let deadline = Date().addingTimeInterval(SheetSpec.budgetMs / 1000)
            if let sheet = await SheetPipeline.run(pageURL: link, html: nil,
                                                   auth: .ingestKey(key), deadline: deadline) {
                payload["frames"] = sheet.frames
            }
            guard !Task.isCancelled else { spinner.stopAnimating(); return }
        }

        statusLabel.text = "Saving to your library…"
        let transport = makeTransport()
        session = transport
        defer { spinner.stopAnimating(); transport.invalidateAndCancel(); session = nil }
        do {
            let (data, response) = try await transport.data(for: request("/api/ingest", key: key, body: payload))
            guard !Task.isCancelled else { return }
            let http = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            if let message = SharedLink.savedMessage(status: http, body: body) {
                statusLabel.text = message; finished = true
                closeButton.setTitle("Done", for: .normal)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                UIAccessibility.post(notification: .announcement, argument: message)
            } else if SharedLink.needsConsent(status: http, body: body), !consentAsked {
                askConsent()
            } else {
                statusLabel.text = SharedLink.failureMessage(status: http, body: body)
                saveButton.setTitle("Try again", for: .normal); saveButton.isHidden = false
            }
        } catch {
            guard !Task.isCancelled else { return }
            statusLabel.text = "Couldn’t confirm the save. Check your connection and try again; the same link won’t be added twice."
            saveButton.setTitle("Try again", for: .normal); saveButton.isHidden = false
        }
    }

    // MARK: AI permission
    //
    // A save is an AI request, and the server refuses it for an account that has
    // not agreed to AI processing. The app asks in a sheet before its own first AI
    // request; this process cannot show that sheet or open the app, so it asks
    // here, in the same words, and records the answer with the save key. Yes
    // continues the save it interrupted. No leaves the library as it was and says
    // where the switch lives.

    private func askConsent() {
        consentAsked = true
        // Taller than a save's few lines; a popover host sizes the sheet from this.
        preferredContentSize = CGSize(width: 390, height: 560)
        statusLabel.text = SharedLink.consentTitle
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        consentLabel.text = SharedLink.consentText
        consentLabel.isHidden = false
        allowButton.isHidden = false; allowButton.isEnabled = true
        declineButton.isHidden = false; declineButton.isEnabled = true
        closeButton.isHidden = true
        UIAccessibility.post(notification: .screenChanged, argument: statusLabel)
    }

    private func endConsent() {
        statusLabel.font = .preferredFont(forTextStyle: .body)
        consentLabel.isHidden = true
        allowButton.isHidden = true
        declineButton.isHidden = true
        closeButton.isHidden = false
    }

    @objc private func allow() { task = Task { await recordConsent() } }

    @objc private func decline() {
        endConsent()
        statusLabel.text = SharedLink.consentDeclinedMessage
        closeButton.setTitle("Close", for: .normal)
    }

    private func recordConsent() async {
        guard let key = credential() else { endConsent(); return }
        allowButton.isEnabled = false; declineButton.isEnabled = false
        spinner.startAnimating()
        let transport = makeTransport()
        session = transport
        defer { transport.invalidateAndCancel(); session = nil }
        let body: [String: Any] = ["enabled": true, "version": SharedLink.consentVersion]
        do {
            let (data, response) = try await transport.data(for: request("/api/ai-consent", key: key, body: body))
            guard !Task.isCancelled else { spinner.stopAnimating(); return }
            let http = (response as? HTTPURLResponse)?.statusCode ?? 0
            let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            spinner.stopAnimating()
            guard (200..<300).contains(http), reply["status"] as? String == "ok" else {
                statusLabel.text = SharedLink.consentFailureMessage(status: http, body: reply)
                allowButton.isEnabled = true; declineButton.isEnabled = true
                return
            }
            endConsent()
            await submit()
        } catch {
            spinner.stopAnimating()
            guard !Task.isCancelled else { return }
            statusLabel.text = SharedLink.consentFailureMessage(status: 0, body: [:])
            allowButton.isEnabled = true; declineButton.isEnabled = true
        }
    }

    @objc private func close() {
        task?.cancel(); session?.invalidateAndCancel()
        extensionContext?.completeRequest(returningItems: nil)
    }
}

// Never forward the save credential to a redirect destination.
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
