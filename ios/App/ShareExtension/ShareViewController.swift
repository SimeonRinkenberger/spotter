import UIKit
import UniformTypeIdentifiers

// A small native view, with no WebView and no attempt to launch the containing
// app. The backend acknowledges a durable job before we tell the user it saved.
final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let linkLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var links: [URL] = []
    private var task: Task<Void, Never>?
    private var session: URLSession?
    private var started = false
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        preferredContentSize = CGSize(width: 390, height: 340)
        let title = UILabel()
        title.text = "Save to Spotter"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.accessibilityTraits = .header
        for label in [statusLabel, linkLabel] {
            label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
        }
        linkLabel.textColor = .secondaryLabel
        linkLabel.lineBreakMode = .byTruncatingMiddle
        linkLabel.numberOfLines = 2
        statusLabel.text = "Reading shared link…"
        saveButton.setTitle("Save workout", for: .normal)
        saveButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
        saveButton.isHidden = true
        closeButton.setTitle("Cancel", for: .normal)
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, linkLabel, statusLabel, spinner, saveButton, closeButton])
        stack.axis = .vertical; stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
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

    private func submit() async {
        guard let link = links.first, !finished else { return }
        saveButton.isHidden = true
        let key: String
        do {
            guard let stored = try ShareCredential.read() else {
                statusLabel.text = "Open Spotter and sign in once, then share this post again."
                return
            }
            key = stored
        } catch {
            statusLabel.text = "Unlock your phone and open Spotter once, then try sharing again."
            return
        }
        spinner.startAnimating()
        statusLabel.text = "Saving to your library…"
        var request = URLRequest(url: URL(string: "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/ingest")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-ingest-key")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["url": link.absoluteString])
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 30
        let transport = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        session = transport
        defer { spinner.stopAnimating(); transport.invalidateAndCancel(); session = nil }
        do {
            let (data, response) = try await transport.data(for: request)
            guard !Task.isCancelled else { return }
            let http = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            if let message = SharedLink.savedMessage(status: http, body: body) {
                statusLabel.text = message; finished = true
                closeButton.setTitle("Done", for: .normal)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                UIAccessibility.post(notification: .announcement, argument: message)
            } else {
                statusLabel.text = http == 401 || http == 403
                    ? "Open Spotter to refresh your sign-in, then share again."
                    : (body["message"] as? String).map { String($0.prefix(300)) }
                        ?? "Spotter couldn’t save this link. Please try again."
                saveButton.setTitle("Try again", for: .normal); saveButton.isHidden = false
            }
        } catch {
            guard !Task.isCancelled else { return }
            statusLabel.text = "Couldn’t confirm the save. Check your connection and try again; the same link won’t be added twice."
            saveButton.setTitle("Try again", for: .normal); saveButton.isHidden = false
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
