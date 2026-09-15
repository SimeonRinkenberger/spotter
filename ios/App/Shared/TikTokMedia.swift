import Foundation

/**
 * Getting the MP4 onto the phone.
 *
 * The one thing this file exists to work around: `AVURLAssetHTTPHeaderFieldsKey`
 * is not public API (Apple engineer, developer forums thread 20421), and the two
 * keys that ARE public — `AVURLAssetHTTPUserAgentKey` and
 * `AVURLAssetHTTPCookiesKey` — cannot set a Referer. TikTok's CDN answers 403
 * without one. So AVFoundation never sees the network at all: URLSession fetches
 * the file with the three headers that matter, and the image generator is pointed
 * at a local file where no header question can arise.
 *
 * The watch page is fetched for two things at once, and they have to travel
 * together: the `playAddr` URL, and the cookies that page sets. The server
 * measured the same pairing in September — playAddr answers 403 to a bare request
 * and 206 to the identical request carrying the cookies from a second earlier.
 */

struct TikTokVideo {
    let playAddr: URL
    let duration: Double
    let width: Double
    let height: Double
    let cookie: String
}

enum TikTokMedia {
    /// The UA the server uses for the same page, so both halves see one TikTok.
    static let desktopUA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    enum Failure: Error { case page, notTikTok, noMedia, tooBig, timedOut, cancelled }

    /// `tt-<id>`, the key the server caches the pack under. Share links
    /// (`vm.tiktok.com/...`) carry no id, which is why the redirect is followed
    /// before this is asked.
    static func shortcode(for url: URL) -> String? {
        let s = url.absoluteString
        guard let m = s.range(of: #"tiktok\.com/(?:@[^/]+/(?:video|photo)|v)/(\d+)"#,
                              options: [.regularExpression, .caseInsensitive]) else { return nil }
        guard let digits = s[m].range(of: #"\d+$"#, options: .regularExpression) else { return nil }
        return "tt-" + s[digits]
    }

    static func isTikTok(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "tiktok.com" || host.hasSuffix(".tiktok.com")
    }

    /// The watch page, its cookies, and the address it settled on after redirects.
    static func page(_ url: URL, session: URLSession) async throws -> (html: String, cookie: String, url: URL) {
        var request = URLRequest(url: url)
        request.setValue(desktopUA, forHTTPHeaderField: "User-Agent")
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        request.timeoutInterval = 12
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let html = String(data: data, encoding: .utf8) else { throw Failure.page }
        let final = http.url ?? url
        var jar: [String] = []
        if let fields = http.allHeaderFields as? [String: String] {
            for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: final) {
                jar.append("\(cookie.name)=\(cookie.value)")
            }
        }
        return (html, jar.joined(separator: "; "), final)
    }

    /**
     * `itemStruct.video` out of the rehydration blob — the same blob and the same
     * field names the edge function reads, so a TikTok change breaks both halves
     * at once rather than silently disagreeing.
     *
     * A photo post carries a `video` object of all zeroes; a zero duration fails
     * the guard below and the save goes out without frames, which is correct — a
     * carousel has no frames to cut.
     */
    static func video(html: String, cookie: String) -> TikTokVideo? {
        guard let blob = between(html,
                                 start: #"<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>"#,
                                 end: "</script>"),
              let data = blob.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let scope = root["__DEFAULT_SCOPE__"] as? [String: Any],
              let detail = scope["webapp.video-detail"] as? [String: Any],
              let info = detail["itemInfo"] as? [String: Any],
              let item = info["itemStruct"] as? [String: Any],
              let v = item["video"] as? [String: Any] else { return nil }

        let raw = (v["playAddr"] as? String) ?? (v["downloadAddr"] as? String) ?? ""
        let cleaned = raw.replacingOccurrences(of: "\\u0026", with: "&")
            .replacingOccurrences(of: "\\/", with: "/")
        guard cleaned.hasPrefix("https://"), let addr = URL(string: cleaned) else { return nil }

        let duration = number(v["duration"])
        let width = number(v["width"]), height = number(v["height"])
        guard duration > 0 else { return nil }
        return TikTokVideo(playAddr: addr, duration: duration,
                           width: width, height: height, cookie: cookie)
    }

    /**
     * The MP4, to a file in this process's own temporary directory.
     *
     * Capped and deadlined, and the caller deletes the file in a `defer` — the
     * standing rule is that Spotter never persists somebody else's media, and a
     * share extension that leaks a 20 MB MP4 into a container nobody cleans is
     * exactly the way that rule gets broken by accident.
     */
    static func download(_ video: TikTokVideo, cap: Int, deadline: Date) async throws -> URL {
        var request = URLRequest(url: video.playAddr)
        request.setValue(desktopUA, forHTTPHeaderField: "User-Agent")
        request.setValue("https://www.tiktok.com/", forHTTPHeaderField: "Referer")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.setValue("identity;q=1, *;q=0", forHTTPHeaderField: "Accept-Encoding")
        if !video.cookie.isEmpty { request.setValue(video.cookie, forHTTPHeaderField: "Cookie") }
        let seconds = deadline.timeIntervalSinceNow
        guard seconds > 0.5 else { throw Failure.timedOut }
        request.timeoutInterval = seconds

        let sink = CappedDownload(cap: cap)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = seconds
        config.timeoutIntervalForResource = seconds
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config, delegate: sink, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        return try await sink.run(session: session, request: request)
    }

    // MARK: - helpers

    private static func number(_ raw: Any?) -> Double {
        if let d = raw as? Double { return d }
        if let i = raw as? Int { return Double(i) }
        if let s = raw as? String { return Double(s) ?? 0 }
        return 0
    }

    private static func between(_ text: String, start: String, end: String) -> String? {
        guard let open = text.range(of: start, options: [.regularExpression, .caseInsensitive]),
              let close = text.range(of: end, range: open.upperBound..<text.endIndex) else { return nil }
        return String(text[open.upperBound..<close.lowerBound])
    }
}

/**
 * A download that stops itself.
 *
 * `URLSession`'s async `download(for:)` has no way to say "and give up past 25
 * MB", so this is the delegate form: the byte counter cancels the task the moment
 * the cap is crossed, and the file is moved out of the system's staging area
 * inside the delegate callback because that file is deleted the instant the
 * callback returns.
 */
private final class CappedDownload: NSObject, URLSessionDownloadDelegate {
    private let cap: Int
    private var continuation: CheckedContinuation<URL, Error>?
    private var settled = false
    private let lock = NSLock()

    init(cap: Int) { self.cap = cap }

    func run(session: URLSession, request: URLRequest) async throws -> URL {
        try await withCheckedThrowingContinuation { c in
            lock.lock(); continuation = c; lock.unlock()
            session.downloadTask(with: request).resume()
        }
    }

    private func settle(_ result: Result<URL, Error>) {
        lock.lock()
        guard !settled, let c = continuation else { lock.unlock(); return }
        settled = true; continuation = nil
        lock.unlock()
        c.resume(with: result)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > Int64(cap) || totalBytesExpectedToWrite > Int64(cap) {
            downloadTask.cancel()
            settle(.failure(TikTokMedia.Failure.tooBig))
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        let http = downloadTask.response as? HTTPURLResponse
        guard let code = http?.statusCode, (200...299).contains(code) else {
            settle(.failure(TikTokMedia.Failure.noMedia)); return
        }
        let target = FileManager.default.temporaryDirectory
            .appendingPathComponent("spotter-frames-\(UUID().uuidString).mp4")
        do {
            try FileManager.default.moveItem(at: location, to: target)
            settle(.success(target))
        } catch {
            settle(.failure(error))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        settle(.failure(error ?? TikTokMedia.Failure.cancelled))
    }
}
