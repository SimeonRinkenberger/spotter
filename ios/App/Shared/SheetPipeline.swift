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
         "evidence": ["version": 3, "sampling": "sparse_uniform",
                      "timestamp_basis": "actual_pts", "timing_uncertainty_s": 0,
                      "requested_frames": framesRequested, "captured_frames": framesKept,
                      "uploaded_frames": framesKept, "sampling_complete": true],
         "sheets": sheets.map { sheet in
             ["path": sheet.path, "cols": sheet.cols, "rows": sheet.rows,
              "cell_w": sheet.cellW, "cell_h": sheet.cellH, "times": sheet.times]
         }]
    }
}

enum SheetPipeline {
    static let functionBase = "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter"

    /**
     * The TikTok path: watch page, MP4, sheet, upload.
     *
     * `html` is accepted but only used if the page fetch itself fails. The page is
     * fetched here even when the caller already has it because the cookies are the
     * point — playAddr answers 403 to a request that does not carry the ones the
     * watch page set moments earlier, and a caller's cached HTML has no cookies
     * attached to it.
     */
    static func run(pageURL: URL, html: String?,
                    auth: SheetAuth, deadline: Date) async -> SheetOutcome? {
        let started = Date()
        guard TikTokMedia.isTikTok(pageURL) else { return nil }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }

        // The extension has no app profile/cache. Ask before downloading the MP4.
        // App callers already performed this check and may be explicit rereads.
        if case .ingestKey(let key) = auth {
            var check = URLRequest(url: URL(string: functionBase + "/api/ingest/prepare")!)
            check.httpMethod = "POST"
            check.timeoutInterval = 5
            check.setValue("application/json", forHTTPHeaderField: "Content-Type")
            check.setValue(key, forHTTPHeaderField: "x-ingest-key")
            check.httpBody = try? JSONSerialization.data(withJSONObject: ["url": pageURL.absoluteString])
            if let (data, response) = try? await session.data(for: check),
               (response as? HTTPURLResponse)?.statusCode == 200,
               let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               reply["needs_frames"] as? Bool == false { return nil }
        }

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

        return await finish(mp4: mp4, duration: video.duration, shortcode: shortcode,
                            auth: auth, deadline: deadline, started: started, session: session)
    }

    /**
     * The upload path: a file already on the phone, so no page, no cookies and no
     * download budget — the same builder from step three onwards.
     */
    static func runLocal(file: URL, shortcode: String,
                         auth: SheetAuth, deadline: Date) async -> SheetOutcome? {
        let started = Date()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        return await finish(mp4: file, duration: 0, shortcode: shortcode,
                            auth: auth, deadline: deadline, started: started, session: session)
    }

    private static func finish(mp4: URL, duration: Double, shortcode: String,
                               auth: SheetAuth, deadline: Date, started: Date,
                               session: URLSession) async -> SheetOutcome? {
        let built: ContactSheetResult
        do {
            built = try await ContactSheetBuilder.build(mp4: mp4, duration: duration, deadline: deadline)
        } catch { return nil }

        // One authorization, then all pages. An interrupted upload uses the
        // existing fallback instead of publishing only the beginning of the clip.
        let slots = await authorize(shortcode: shortcode, sizes: built.pages.map { $0.jpeg.count },
                                    auth: auth, session: session)
        var uploaded: [UploadedSheet] = []
        for (index, page) in built.pages.enumerated() where index < slots.count {
            guard await put(page.jpeg, to: slots[index].url, session: session) else { break }
            uploaded.append(UploadedSheet(path: slots[index].path, cols: page.cols, rows: page.rows,
                                          cellW: built.cellW, cellH: built.cellH,
                                          times: page.times, bytes: page.jpeg.count))
            if Date() >= deadline { break }
        }
        // A failed upload must not silently turn the overview into a video prefix.
        guard !uploaded.isEmpty, uploaded.count == built.pages.count else { return nil }

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

    /// A place the server has agreed to accept one sheet: where the bytes go, and
    /// what to call the object in the ingest body afterwards.
    private struct Slot {
        let path: String
        let url: URL
    }

    /**
     * One authorize for the whole save.
     *
     * Every sheet's size goes up together and the server answers with a
     * pre-signed address for each, which is what lets the Share Extension take
     * part at all: it holds the 32-hex ingest key and no Supabase session, so it
     * could never write to Storage itself. The PUTs that follow carry no session
     * header on either path — the token in the address is the whole authority,
     * and it is good for fifteen minutes, which is a hundred times the budget.
     */
    private static func authorize(shortcode: String, sizes: [Int],
                                  auth: SheetAuth, session: URLSession) async -> [Slot] {
        let body: [String: Any] = [
            "kind": "pack",
            "shortcode": shortcode,
            "sheets": sizes.map { ["bytes": $0] }
        ]
        var request = URLRequest(url: URL(string: functionBase + "/api/uploads/authorize")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        switch auth {
        case .bearer(let token): request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        case .ingestKey(let key): request.setValue(key, forHTTPHeaderField: "x-ingest-key")
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let sheets = reply["sheets"] as? [[String: Any]] else { return [] }

        var slots: [Slot] = []
        for sheet in sheets {
            guard let path = sheet["path"] as? String, !path.isEmpty,
                  let address = sheet["upload_url"] as? String, !address.isEmpty else { break }
            // The token may already be in the address; appending a second copy
            // would be the kind of bug that only shows up on the server's next
            // refactor, so it is added only when it is missing.
            var full = address
            if let token = sheet["token"] as? String, !token.isEmpty,
               !address.contains("token=") {
                full += (address.contains("?") ? "&" : "?") + "token=" + token
            }
            guard let url = URL(string: full) else { break }
            slots.append(Slot(path: path, url: url))
        }
        return slots
    }

    private static func put(_ jpeg: Data, to url: URL, session: URLSession) async -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(SheetSpec.contentType, forHTTPHeaderField: "Content-Type")
        guard let (_, response) = try? await session.upload(for: request, from: jpeg),
              let code = (response as? HTTPURLResponse)?.statusCode else { return false }
        return (200...299).contains(code)
    }
}
