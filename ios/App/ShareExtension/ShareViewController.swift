import UIKit
import UniformTypeIdentifiers
import os

// Timings only, never a link or a key: enough to read tap → "Saved" off a device
// with `log stream --predicate 'subsystem == "app.spotter.share"'`.
private let log = Logger(subsystem: "app.spotter.share", category: "save")

// A small native view, with no WebView and no attempt to launch the containing
// app. The backend acknowledges a durable job before we tell the user it saved.
final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let linkLabel = UILabel()
    // The consent wording while asking; otherwise a quieter second line under
    // the confirmation (a post set aside, stills being added).
    private let detailLabel = UILabel()
    private let progress = UIProgressView(progressViewStyle: .default)
    private let saveButton = UIButton(type: .system)
    private let allowButton = UIButton(type: .system)
    private let declineButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    /// What this share saves: one link, or one video file.
    private enum Target {
        case link(URL, choice: SharedLink.Choice)
        case video(NSItemProvider)
    }
    private var target: Target?
    private var key: String?
    private var plan: String?
    /// The shared video, copied out of the host's hands; deleted once uploaded.
    private var staged: StagedVideo?
    /// Where the video landed, and its name. A save retried after the consent
    /// question or a dropped connection sends these again instead of uploading
    /// twice.
    private var uploadedPath: String?
    private var uploadedName = "Shared video"

    private var task: Task<Void, Never>?
    private var followUp: Task<Void, Never>?
    // One session for the whole share: the save, the consent answer, the
    // upload and the frames all ride the same connection.
    private lazy var transport: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 120
        return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }()
    private let loaded = Date()
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
        for label in [statusLabel, linkLabel, detailLabel] {
            label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
        }
        linkLabel.textColor = .secondaryLabel
        linkLabel.lineBreakMode = .byTruncatingMiddle
        linkLabel.numberOfLines = 2
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = .secondaryLabel
        detailLabel.isHidden = true
        progress.isHidden = true
        statusLabel.text = SharedLink.readingMessage
        saveButton.setTitle("Save to Spotter", for: .normal)
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
        let stack = UIStackView(arrangedSubviews: [title, linkLabel, statusLabel, progress, detailLabel, spinner,
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
        // Start now, not when the sheet has finished sliding up (audit S6). The
        // half second of animation is time the items, the Keychain and the
        // network can all use; the labels are already in the view, so what the
        // person sees when the sheet lands is simply further along.
        begin()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        begin()
    }

    // No connection warm-up: the items and the Keychain are read in 20–90 ms
    // (measured in the simulator), so the save itself is on the wire before a
    // warm-up request could finish, and a HEAD would only cost the function an
    // extra invocation per share.
    private func begin() {
        guard !started else { return }; started = true
        task = Task { await readInput() }
    }

    private func ms() -> Int { Int(Date().timeIntervalSince(loaded) * 1000) }

    // MARK: Reading the share

    /// The Keychain read, off the main thread and alongside the item loading.
    private enum Access { case key(String, plan: String?), signedOut, locked }
    private nonisolated static func readAccess() async -> Access {
        do {
            guard let key = try ShareCredential.read() else { return .signedOut }
            return .key(key, plan: ShareCredential.readPlan())
        } catch { return .locked }
    }

    private func readInput() async {
        spinner.startAnimating()
        async let access = Self.readAccess()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let found = await Self.collect(items)
        guard !Task.isCancelled else { return }
        log.info("items read at \(self.ms(), privacy: .public) ms")

        if let choice = SharedLink.choose(attached: found.attached, text: found.text) {
            target = .link(choice.link, choice: choice)
            linkLabel.text = choice.link.absoluteString
        } else if found.movies.count == 1, let movie = found.movies.first {
            // A link always wins over a file in the same share, as it did before
            // files were accepted: it is free to read, and it is the post.
            target = .video(movie)
            linkLabel.text = movie.suggestedName ?? "A video from your library"
        } else {
            spinner.stopAnimating()
            stop(found.movies.isEmpty ? SharedLink.noLinkMessage : SharedLink.oneVideoMessage)
            return
        }

        switch await access {
        case .key(let key, let plan):
            self.key = key; self.plan = plan
            await submit()
        case .signedOut:
            spinner.stopAnimating()
            guard case .link(let link, _)? = target else { stop(SharedLink.signedOutVideoMessage); return }
            do {
                try ParkedShare.park(link)
                stop(SharedLink.parkedMessage, done: true)
            } catch {
                stop(SharedLink.signedOutMessage)
            }
        case .locked:
            spinner.stopAnimating()
            stop(SharedLink.lockedMessage)
        }
    }

    private struct Found {
        var attached: [URL] = []
        var text: [URL] = []
        var movies: [NSItemProvider] = []
    }

    /// Every link in the share, URL attachments first, then text attachments,
    /// then the share's own caption; plus any video files. All providers are
    /// asked at once rather than one after another.
    private static func collect(_ items: [NSExtensionItem]) async -> Found {
        var found = Found()
        var loads: [(isURL: Bool, provider: NSItemProvider, task: Task<NSSecureCoding?, Never>)] = []
        var captions: [String] = []
        for item in items.prefix(10) {
            for provider in (item.attachments ?? []).prefix(10) {
                guard let type = [UTType.url.identifier, UTType.plainText.identifier, UTType.text.identifier]
                    .first(where: { provider.hasItemConformingToTypeIdentifier($0) }) else {
                    if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) { found.movies.append(provider) }
                    continue
                }
                let task = Task { () -> NSSecureCoding? in
                    await withCheckedContinuation { continuation in
                        provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                            continuation.resume(returning: value)
                        }
                    }
                }
                loads.append((type == UTType.url.identifier, provider, task))
            }
            if let text = item.attributedContentText?.string { captions.append(text) }
        }
        for load in loads {
            let value = await load.task.value
            var urls: [URL] = []
            if let url = value as? URL { urls = SharedLink.urls(in: url.absoluteString) }
            else if let text = value as? String { urls = SharedLink.urls(in: text) }
            else if let text = value as? NSAttributedString { urls = SharedLink.urls(in: text.string) }
            else if let data = value as? Data, data.count <= 64_000,
                    let text = String(data: data, encoding: .utf8) { urls = SharedLink.urls(in: text) }
            if load.isURL { found.attached += urls } else { found.text += urls }
            // A file URL is not a link. When that file is the video itself
            // (some hosts offer both representations), it is the video.
            if urls.isEmpty, load.provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                found.movies.append(load.provider)
            }
        }
        for caption in captions { found.text += SharedLink.urls(in: caption) }
        return found
    }

    // MARK: Saving

    @objc private func save() { task = Task { await submit() } }

    private func request(_ route: String, key: String, body: [String: Any]) -> URLRequest {
        var request = URLRequest(url: URL(string: SheetPipeline.functionBase + route)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-ingest-key")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    private func post(_ route: String, key: String, body: [String: Any]) async throws -> (Int, [String: Any]) {
        let (data, response) = try await transport.data(for: request(route, key: key, body: body))
        let http = (response as? HTTPURLResponse)?.statusCode ?? 0
        return (http, (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:])
    }

    private func submit() async {
        guard let target = target, let key = key, !finished else { return }
        saveButton.isHidden = true
        spinner.startAnimating()
        switch target {
        case .link(let link, let choice): await saveLink(link, choice: choice, key: key)
        case .video(let provider): await saveVideo(provider, key: key)
        }
    }

    /// Save first, frames after (audit S5).
    ///
    /// The one POST goes out before anything else, so "Saved" is the first thing
    /// the person sees and a swipe-down a second later cannot lose the link.
    /// For a Plus account sharing a TikTok video, the POST also says
    /// `frames_pending`: the server holds that one job up to twenty seconds for
    /// the stills this extension is about to cut, and reads the video itself if
    /// they never come — which is exactly what happens when the sheet is closed.
    private func saveLink(_ link: URL, choice: SharedLink.Choice, key: String) async {
        let framesPending = ShareCredential.plusPlan(plan) && TikTokMedia.isTikTok(link) && !TikTokMedia.isPhoto(link)
        var payload: [String: Any] = ["url": link.absoluteString]
        if framesPending { payload["frames_pending"] = true }
        statusLabel.text = "Saving to your library…"
        do {
            log.info("save sent at \(self.ms(), privacy: .public) ms")
            let (http, body) = try await post("/api/ingest", key: key, body: payload)
            guard !Task.isCancelled else { return }
            log.info("save answered \(http, privacy: .public) at \(self.ms(), privacy: .public) ms")
            guard answered(http, body) else { return }
            detail(SharedLink.setAsideNote(choice))
            if framesPending, SharedLink.wantsFrames(status: http, body: body), let id = body["id"] as? String {
                sendFrames(for: link, workout: id, key: key, choice: choice)
            } else {
                spinner.stopAnimating()
            }
        } catch {
            guard !Task.isCancelled else { return }
            spinner.stopAnimating()
            retry(SharedLink.networkMessage)
        }
    }

    /// The server's answer to a save, on screen. True when it saved.
    private func answered(_ http: Int, _ body: [String: Any]) -> Bool {
        if let message = SharedLink.savedMessage(status: http, body: body) {
            statusLabel.text = message; finished = true
            closeButton.setTitle("Done", for: .normal)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            UIAccessibility.post(notification: .announcement, argument: message)
            return true
        }
        spinner.stopAnimating()
        if SharedLink.needsConsent(status: http, body: body), !consentAsked {
            askConsent()
            return false
        }
        let failure = SharedLink.failure(status: http, body: body)
        if failure.retry { retry(failure.message) } else { stop(failure.message) }
        return false
    }

    // The stills, after the confirmation. Nothing here can undo the save: a
    // failure at any step leaves the held job to time out and read the video on
    // the server, as it did before the phone cut frames at all.
    private func sendFrames(for link: URL, workout id: String, key: String, choice: SharedLink.Choice) {
        detail([SharedLink.setAsideNote(choice), SharedLink.framesNote].compactMap { $0 }.joined(separator: "\n\n"))
        followUp = Task {
            let deadline = Date().addingTimeInterval(SheetSpec.budgetMs / 1000)
            var sent = false
            if let sheet = await SheetPipeline.run(pageURL: link, html: nil, auth: .ingestKey(key),
                                                   deadline: deadline, precheck: false), !Task.isCancelled {
                log.info("frames cut in \(sheet.milliseconds, privacy: .public) ms")
                if let (http, _) = try? await post("/api/workouts/\(id)/media", key: key, body: ["frames": sheet.frames]) {
                    sent = (200..<300).contains(http)
                    log.info("frames answered \(http, privacy: .public) at \(self.ms(), privacy: .public) ms")
                }
            }
            guard !Task.isCancelled else { return }
            spinner.stopAnimating()
            detail([SharedLink.setAsideNote(choice), sent ? SharedLink.framesSentNote : nil].compactMap { $0 }.joined(separator: "\n\n"))
        }
    }

    // MARK: A shared video file (the second door for Instagram)
    //
    // Instagram lets people download a public reel (Share → Download), and a
    // reel whose caption says nothing about the workout is only readable from
    // its video. So a single video file shared from Photos — or from anywhere —
    // is uploaded the way the app uploads one: the file goes straight from
    // disk to a signed storage address (never into this process's memory,
    // which an extension has little of), then one save names it.

    private func saveVideo(_ provider: NSItemProvider, key: String) async {
        if uploadedPath == nil {
            if staged == nil {
                statusLabel.text = "Preparing the video…"
                switch await StagedVideo.stage(provider) {
                case .success(let file): staged = file
                case .failure(let problem):
                    spinner.stopAnimating()
                    stop(SharedLink.videoProblem(problem))
                    return
                }
            }
            guard let file = staged, await upload(file, key: key) else { return }
        }
        guard let path = uploadedPath else { return }
        statusLabel.text = "Saving to your library…"
        do {
            let (http, body) = try await post("/api/ingest", key: key,
                                              body: ["upload_path": path, "filename": uploadedName])
            guard !Task.isCancelled else { return }
            if answered(http, body) { spinner.stopAnimating() }
        } catch {
            guard !Task.isCancelled else { return }
            spinner.stopAnimating()
            retry(SharedLink.networkMessage)
        }
    }

    /// Permission, then the bytes. True when the file is in storage.
    private func upload(_ file: StagedVideo, key: String) async -> Bool {
        statusLabel.text = "Uploading the video…"
        let slot: (path: String, url: URL)
        do {
            let (http, body) = try await post("/api/uploads/authorize", key: key,
                                              body: ["kind": "video", "bytes": file.bytes, "ext": file.ext])
            guard !Task.isCancelled else { return false }
            if let path = body["path"] as? String, !path.isEmpty,
               let address = body["upload_url"] as? String, !address.isEmpty, (200..<300).contains(http) {
                var full = address
                if let token = body["token"] as? String, !token.isEmpty, !address.contains("token=") {
                    full += (address.contains("?") ? "&" : "?") + "token=" + token
                }
                guard let url = URL(string: full) else { spinner.stopAnimating(); stop(SharedLink.videoNotHereYet); return false }
                slot = (path, url)
            } else if http == 400 || (200..<300).contains(http) {
                // A server that does not yet hand this extension an upload address
                // (see the contract) answers the old way. The app can still take it.
                spinner.stopAnimating(); stop(SharedLink.videoNotHereYet); return false
            } else {
                _ = answered(http, body)
                return false
            }
        } catch {
            guard !Task.isCancelled else { return false }
            spinner.stopAnimating(); retry(SharedLink.networkMessage); return false
        }

        progress.progress = 0; progress.isHidden = false
        var put = URLRequest(url: slot.url)
        put.httpMethod = "PUT"
        put.setValue(file.contentType, forHTTPHeaderField: "Content-Type")
        let meter = UploadMeter { [weak self] fraction in
            DispatchQueue.main.async {
                self?.progress.setProgress(Float(fraction), animated: true)
                self?.statusLabel.text = "Uploading the video… \(Int(fraction * 100))%"
            }
        }
        do {
            let (_, response) = try await transport.upload(for: put, fromFile: file.url, delegate: meter)
            guard !Task.isCancelled else { return false }
            progress.isHidden = true
            guard let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else {
                spinner.stopAnimating(); retry(SharedLink.uploadFailedMessage); return false
            }
        } catch {
            guard !Task.isCancelled else { return false }
            progress.isHidden = true
            spinner.stopAnimating(); retry(SharedLink.uploadFailedMessage); return false
        }
        uploadedPath = slot.path; uploadedName = file.name
        file.discard(); staged = nil
        return true
    }

    // MARK: Screen states

    /// A sentence with nothing left to do here but close.
    private func stop(_ message: String, done: Bool = false) {
        statusLabel.text = message
        closeButton.setTitle(done ? "Done" : "Close", for: .normal)
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    /// A sentence and a way to try again.
    private func retry(_ message: String) {
        statusLabel.text = message
        saveButton.setTitle("Try again", for: .normal); saveButton.isHidden = false
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func detail(_ text: String?) {
        detailLabel.text = text
        detailLabel.isHidden = (text ?? "").isEmpty
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
        detailLabel.text = SharedLink.consentText
        detailLabel.isHidden = false
        allowButton.isHidden = false; allowButton.isEnabled = true
        declineButton.isHidden = false; declineButton.isEnabled = true
        closeButton.isHidden = true
        UIAccessibility.post(notification: .screenChanged, argument: statusLabel)
    }

    private func endConsent() {
        statusLabel.font = .preferredFont(forTextStyle: .body)
        detail(nil)
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
        guard let key = key else { endConsent(); return }
        allowButton.isEnabled = false; declineButton.isEnabled = false
        spinner.startAnimating()
        let body: [String: Any] = ["enabled": true, "version": SharedLink.consentVersion]
        do {
            let (http, reply) = try await post("/api/ai-consent", key: key, body: body)
            guard !Task.isCancelled else { spinner.stopAnimating(); return }
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
        task?.cancel(); followUp?.cancel(); transport.invalidateAndCancel()
        staged?.discard(); staged = nil
        extensionContext?.completeRequest(returningItems: nil)
    }
}

// MARK: - The shared video on disk

/// A copy of the shared video in this process's temporary directory. The
/// host's own file is only valid inside the callback that hands it over, so it
/// is cloned out there (APFS makes that a metadata copy, not a read).
private struct StagedVideo {
    let url: URL
    let ext: String
    let bytes: Int
    let name: String

    var contentType: String { SharedLink.videoTypes[ext] ?? "video/mp4" }

    func discard() { try? FileManager.default.removeItem(at: url) }

    static func stage(_ provider: NSItemProvider) async -> Result<StagedVideo, SharedLink.VideoProblem> {
        let declared = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
        let fallbackExt: String? = declared.contains { $0.conforms(to: .quickTimeMovie) } ? "mov"
            : declared.contains { $0.conforms(to: .mpeg4Movie) } ? "mp4"
            : declared.contains { $0.identifier == "com.apple.m4v-video" } ? "m4v" : nil
        let suggested = provider.suggestedName
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { source, _ in
                guard let source = source else { continuation.resume(returning: .failure(.unreadable)); return }
                var ext = source.pathExtension.lowercased()
                if SharedLink.videoTypes[ext] == nil, let fallback = fallbackExt { ext = fallback }
                guard SharedLink.videoTypes[ext] != nil else {
                    continuation.resume(returning: .failure(.unsupported(ext))); return
                }
                let bytes = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard bytes > 0 else { continuation.resume(returning: .failure(.unreadable)); return }
                guard bytes <= SharedLink.videoMaxBytes else {
                    continuation.resume(returning: .failure(.tooBig(bytes))); return
                }
                let copy = FileManager.default.temporaryDirectory
                    .appendingPathComponent("spotter-share-\(UUID().uuidString).\(ext)")
                do {
                    try FileManager.default.copyItem(at: source, to: copy)
                } catch {
                    continuation.resume(returning: .failure(.unreadable)); return
                }
                let base = (suggested ?? source.deletingPathExtension().lastPathComponent)
                let name = String((base.isEmpty ? "Shared video" : base).prefix(150)) + "." + ext
                continuation.resume(returning: .success(StagedVideo(url: copy, ext: ext, bytes: bytes, name: name)))
            }
        }
    }
}

/// Upload progress for one task, handed to the screen.
private final class UploadMeter: NSObject, URLSessionTaskDelegate {
    private let report: (Double) -> Void
    init(_ report: @escaping (Double) -> Void) { self.report = report }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        report(min(1, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }
    // The signed address is the whole authority and carries no header worth
    // guarding, but a storage upload has no business following a redirect.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Never forward the save credential to a redirect destination.
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
