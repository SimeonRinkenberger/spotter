import Foundation

/**
 * Page to MP4 to sheet to storage to the `frames` block of a save — the whole
 * errand, in one place, so the Share Extension and the in-app plugin cannot drift
 * apart on any of it.
 *
 * Everything here is best-effort by construction: every failure path returns nil
 * and the caller saves without frames, because a save that fails because a CDN
 * changed a cookie name would be a far worse product than a card the server reads
 * with Gemini instead. Nothing in this file is allowed to throw at the caller.
 *
 * The two callers differ in exactly one way, which is why `SheetAuth` exists: the
 * app holds a Supabase session and the extension holds only the 32-hex ingest key
 * that `/api/ingest` accepts. See the note on `authorize`.
 */

enum SheetAuth {
    /// In-app: the signed-in user's Supabase access token.
    case bearer(String)
    /// The Share Extension's long-lived per-user save key.
    case ingestKey(String)
}

/**
 * One uploaded sheet, in the server's own vocabulary.
 *
 * The fields are kept apart rather than stored as the finished dictionary
 * because the two callers need two different containers for the same numbers:
 * the extension serialises them with JSONSerialization, and the plugin has to
 * hand Capacitor a JSObject.
 */
struct UploadedSheet {
    let path: String
    let cols: Int
    let rows: Int
    let cellW: Int
    let cellH: Int
    let times: [Double]
    let bytes: Int
}

struct SheetOutcome {
    let sheets: [UploadedSheet]
    let durationS: Double
    let milliseconds: Int
    let framesRequested: Int

    var bytes: Int { sheets.reduce(0) { $0 + $1.bytes } }
    var framesKept: Int { sheets.reduce(0) { $0 + $1.times.count } }

    /// Exactly the `frames` object POST /api/ingest takes.
    var frames: [String: Any] {
        ["source": "device", "duration_s": durationS,
         "sheets": sheets.map { sheet in
             ["path": sheet.path, "cols": sheet.cols, "rows": sheet.rows,
              "cell_w": sheet.cellW, "cell_h": sheet.cellH, "times": sheet.times]
         }]
    }
}

enum SheetPipeline {
    static let functionBase = "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter"
    static let storageBase = "https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1"
    /// The same public anon key the web page ships with; Storage wants it on every
    /// request even when the bearer token is what actually authorises the write.
    static let anonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10emV2b3h4cHNrdG1yYmJ1eHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjM5ODgsImV4cCI6MjEwMzc5OTk4OH0._vpNhLJtv2bVGgXXClva9O5cX8Y5eJdTgbgAO81NnmU"

    /**
     * The TikTok path: watch page, MP4, sheet, upload.
     *
     * `html` is accepted but only used if the page fetch itself fails. The page is
     * fetched here even when the caller already has it because the cookies are the
     * point — playAddr answers 403 to a request that does not carry the ones the
     * watch page set moments earlier, and a caller's cached HTML has no cookies
     * attached to it.
     */
    static func run(pageURL: URL, html: String?, uid: String?,
                    auth: SheetAuth, deadline: Date) async -> SheetOutcome? {
        let started = Date()
        guard TikTokMedia.isTikTok(pageURL) else { return nil }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }

        var page: (html: String, cookie: String, url: URL)
        do {
            page = try await TikTokMedia.page(pageURL, session: session)
        } catch {
            guard let fallback = html else { return nil }
            page = (fallback, "", pageURL)
        }
        guard let shortcode = TikTokMedia.shortcode(for: page.url) ?? TikTokMedia.shortcode(for: pageURL),
              let video = TikTokMedia.video(html: page.html, cookie: page.cookie),
              Date() < deadline else { return nil }

        let mp4: URL
        do {
            mp4 = try await TikTokMedia.download(video, cap: SheetSpec.budgetBytes, deadline: deadline)
        } catch { return nil }
        // Never persist somebody else's media, on any path out of this function.
        defer { try? FileManager.default.removeItem(at: mp4) }

        return await finish(mp4: mp4, duration: video.duration, shortcode: shortcode, uid: uid,
                            auth: auth, deadline: deadline, started: started, session: session)
    }

    /**
     * The upload path: a file already on the phone, so no page, no cookies and no
     * download budget — the same builder from step three onwards.
     */
    static func runLocal(file: URL, shortcode: String, uid: String?,
                         auth: SheetAuth, deadline: Date) async -> SheetOutcome? {
        let started = Date()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        return await finish(mp4: file, duration: 0, shortcode: shortcode, uid: uid,
                            auth: auth, deadline: deadline, started: started, session: session)
    }

    private static func finish(mp4: URL, duration: Double, shortcode: String, uid: String?,
                               auth: SheetAuth, deadline: Date, started: Date,
                               session: URLSession) async -> SheetOutcome? {
        let built: ContactSheetResult
        do {
            built = try await ContactSheetBuilder.build(mp4: mp4, duration: duration, deadline: deadline)
        } catch { return nil }

        // Uploaded in order and counted as they land. Past the deadline, or after
        // an upload that would not go, whatever is already up is what goes with
        // the save — the sheets are in time order, so a short set is the first
        // part of the video rather than a hole in the middle of it.
        var uploaded: [UploadedSheet] = []
        for (index, page) in built.pages.enumerated() {
            guard let path = await upload(jpeg: page.jpeg, shortcode: shortcode, index: index,
                                          uid: uid, auth: auth, session: session) else { break }
            uploaded.append(UploadedSheet(path: path, cols: page.cols, rows: page.rows,
                                          cellW: built.cellW, cellH: built.cellH,
                                          times: page.times, bytes: page.jpeg.count))
            if Date() >= deadline { break }
        }
        guard !uploaded.isEmpty else { return nil }

        // A local file's duration is whatever AVFoundation measured, and the last
        // frame's own time plus the half-second inset is that number back again —
        // close enough that the server's "times inside duration_s" check passes,
        // and never a value the phone did not observe.
        let lastTime = uploaded.last?.times.last ?? 0
        return SheetOutcome(
            sheets: uploaded,
            durationS: built.duration > 0 ? built.duration : lastTime + SheetSpec.edgeInset,
            milliseconds: Int(Date().timeIntervalSince(started) * 1000),
            framesRequested: built.requested)
    }

    // MARK: - storage

    /**
     * Authorise, then put the bytes. Returns the object path the server accepted.
     *
     * TWO SHAPES, deliberately. What `/api/uploads/authorize` answers TODAY is
     * `{status:"ok", path}` and nothing else, and the direct Storage write that
     * follows it needs a Supabase session — which the app has and the extension
     * does not. So this also reads an `upload_url` out of the reply and, when one
     * is there, puts the bytes at that pre-signed address with no session at all.
     * That single extra field is what the Share Extension needs from vcp-a; until
     * it exists the extension's authorize call fails its auth gate, `nil` comes
     * back, and the share saves without frames exactly as it does today.
     */
    private static func upload(jpeg: Data, shortcode: String, index: Int, uid: String?,
                               auth: SheetAuth, session: URLSession) async -> String? {
        var body: [String: Any] = [
            "bytes": jpeg.count,
            "content_type": SheetSpec.contentType,
            "kind": "pack",
            "shortcode": shortcode,
            "sheet": index + 1
        ]
        if let uid = uid, !uid.isEmpty {
            body["path"] = SheetSpec.objectPath(uid: uid, shortcode: shortcode, index: index)
        }

        var request = URLRequest(url: URL(string: functionBase + "/api/uploads/authorize")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        apply(auth, to: &request)
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (reply["status"] as? String) == "ok",
              let path = (reply["path"] as? String) ?? body["path"] as? String else { return nil }

        let signed = (reply["upload_url"] as? String).flatMap(URL.init(string:))
        var put = URLRequest(url: signed ?? URL(string: storageBase + "/object/uploads/" + path)!)
        put.httpMethod = "PUT"
        put.setValue(SheetSpec.contentType, forHTTPHeaderField: "Content-Type")
        put.setValue(anonKey, forHTTPHeaderField: "apikey")
        put.setValue("false", forHTTPHeaderField: "x-upsert")
        if let token = reply["token"] as? String {
            put.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        } else if signed == nil {
            apply(auth, to: &put, storage: true)
        }

        guard let (_, upResponse) = try? await session.upload(for: put, from: jpeg),
              let code = (upResponse as? HTTPURLResponse)?.statusCode,
              (200...299).contains(code) else { return nil }
        return path
    }

    /// The extension's key is not a bearer token and Storage would not know what to
    /// do with it, so it is only ever sent to the function's own endpoints.
    private static func apply(_ auth: SheetAuth, to request: inout URLRequest, storage: Bool = false) {
        switch auth {
        case .bearer(let token):
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        case .ingestKey(let key):
            if !storage { request.setValue(key, forHTTPHeaderField: "x-ingest-key") }
        }
    }
}
