import Foundation

enum SharedLink {
    // Host-agnostic: social apps often send a caption plus an embedded URL.
    // Server-side URL validation and redirect checks remain authoritative.
    static func urls(in text: String) -> [URL] {
        guard text.utf8.count <= 64_000,
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
        var seen = Set<String>()
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard let url = match.url, let scheme = url.scheme?.lowercased(),
                  ["http", "https"].contains(scheme), url.host != nil,
                  url.user == nil, url.password == nil, url.absoluteString.utf8.count <= 8192,
                  seen.insert(url.absoluteString).inserted else { return nil }
            return url
        }
    }

    // MARK: - Which link a share means
    //
    // A share rarely carries one clean URL. Safari hands over the page address as
    // an attachment and the same address again in its text; TikTok sends the link
    // and a caption that repeats it without the trailing slash; Instagram's caption
    // brings the creator's linktr.ee along. Refusing all of those as "more than one
    // post" was a dead end with only a Cancel button (audit S1), while the server
    // and Android have always taken the first link. So links are compared by the
    // post they name rather than by spelling, links that are not posts step aside
    // when a post is present, and two genuinely different posts save the first —
    // with a sentence that says so, because silently picking one is how the wrong
    // workout ends up in a library.

    /// What a link names, for telling two spellings of one post apart.
    struct Identity: Equatable {
        /// `tt-<id>`, `ig-<code>`, `yt-<id>`, or host + path for anything else.
        let key: String
        /// A TikTok, Instagram or YouTube post (or a share link to one), as
        /// opposed to a profile, a bio link or an ordinary web page.
        let isPost: Bool
    }

    static func identity(of url: URL) -> Identity {
        var host = (url.host ?? "").lowercased()
        for prefix in ["www.", "m.", "mobile."] where host.hasPrefix(prefix) {
            host = String(host.dropFirst(prefix.count)); break
        }
        // URL.path drops the query, the fragment and a trailing slash, which is
        // exactly the spelling noise two copies of one link differ by.
        let path = url.path
        let plain = Identity(key: host + path, isPost: false)

        if host == "tiktok.com" || host.hasSuffix(".tiktok.com") || host == "tiktokv.com" || host.hasSuffix(".tiktokv.com") {
            if host.hasSuffix("tiktok.com"), let code = TikTokMedia.shortcode(for: url) {
                return Identity(key: code, isPost: true)
            }
            if let id = capture(path, #"^/(?:embed/v2|embed|player/v1|share/video)/(\d{6,})"#) {
                return Identity(key: "tt-" + id, isPost: true)
            }
            // vm./vt. short links and /t/ links are posts whose id only the
            // redirect knows; the server follows it. Same spelling = same post.
            if host == "vm.tiktok.com" || host == "vt.tiktok.com" || path.hasPrefix("/t/") {
                return Identity(key: host + path, isPost: path.count > 3)
            }
            return plain
        }

        if host == "instagram.com" || host.hasSuffix(".instagram.com") || host == "instagr.am" {
            let parts = path.split(separator: "/").map(String.init)
            // /share/<token>, /share/reel/<token>, /share/p/<token>: a post, but
            // the token is not its code.
            if parts.first == "share", let token = parts.last, parts.count >= 2 {
                return Identity(key: "ig-share-" + token, isPost: true)
            }
            // Optional username segment, then p|reel|reels|tv and the code.
            // `reels/audio/<id>` is a sound page, not a post.
            let kinds: Set<String> = ["p", "reel", "reels", "tv"]
            for start in [0, 1] where parts.count >= start + 2 && kinds.contains(parts[start]) {
                let code = parts[start + 1]
                if parts[start] == "reels" && code == "audio" { return plain }
                guard code.range(of: #"^[A-Za-z0-9_-]{5,}$"#, options: .regularExpression) != nil else { return plain }
                return Identity(key: "ig-" + code, isPost: true)
            }
            return plain
        }

        if host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "youtu.be" || host == "youtube-nocookie.com" {
            var id: String?
            if host == "youtu.be" {
                id = path.split(separator: "/").first.map(String.init)
            } else if path == "/watch" {
                id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "v" })?.value
            } else {
                id = capture(path, #"^/(?:shorts|embed|live|v)/([A-Za-z0-9_-]+)"#)
            }
            if let id = id, id.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil {
                return Identity(key: "yt-" + id, isPost: true)
            }
            return plain
        }
        return plain
    }

    /// The link to save, and how many other distinct posts (or, in a share with
    /// no post at all, other links) were set aside.
    struct Choice {
        let link: URL
        let setAside: Int
        let isPost: Bool
    }

    /// `attached` are URL attachments, in order; `text` are links found in text
    /// attachments and in the share's caption, in order. The attachment is the
    /// address the host app meant; a caption is whatever the creator wrote.
    static func choose(attached: [URL], text: [URL]) -> Choice? {
        var distinct: [(url: URL, id: Identity)] = []
        for url in attached + text {
            let id = identity(of: url)
            if distinct.contains(where: { $0.id.key == id.key }) { continue }
            distinct.append((url, id))
        }
        let posts = distinct.filter { $0.id.isPost }
        let pool = posts.isEmpty ? distinct : posts
        guard let first = pool.first else { return nil }
        return Choice(link: first.url, setAside: pool.count - 1, isPost: !posts.isEmpty)
    }

    /// Said under the confirmation when a share named more than one post.
    static func setAsideNote(_ choice: Choice) -> String? {
        let count = choice.setAside
        guard count > 0 else { return nil }
        let noun = choice.isPost ? "posts" : "links"
        return count == 1
            ? "You shared two \(noun), so Spotter saved the first one. Share the other on its own to save it too."
            : "You shared \(count + 1) \(noun), so Spotter saved the first one. Share the others one at a time to save them too."
    }

    private static func capture(_ text: String, _ pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    // MARK: - Messages

    static let readingMessage = "Reading what you shared…"
    static let noLinkMessage = "Spotter didn’t find a post link here. In TikTok, Instagram or YouTube, tap Share on the post and choose Spotter — or share the video file itself."
    /// S14: signed out. The link is parked for the app to save after sign-in.
    static let parkedMessage = "You’re signed out. Sign in to Spotter and it will be saved."
    static let signedOutMessage = "Open Spotter and sign in once, then share this post again."
    static let signedOutVideoMessage = "Open Spotter and sign in, then share this video again."
    static let lockedMessage = "Unlock your phone and open Spotter once, then try sharing again."
    static let networkMessage = "Couldn’t confirm the save. Check your connection and try again; the same link won’t be added twice."
    static let framesNote = "Adding stills from the video so Spotter can see each move. You can close this."
    static let framesSentNote = "Stills added — Spotter is reading them now."
    static let oneVideoMessage = "Spotter saves one video at a time. Share just the one with the workout."

    // A shared video file. The types and the cap are the server's upload rules
    // (UPLOAD_EXTS, UPLOAD_MAX_BYTES, the bucket's file_size_limit) for files
    // with pictures in them, so nothing is sent that the server would refuse.
    static let videoTypes = ["mp4": "video/mp4", "mov": "video/quicktime", "m4v": "video/x-m4v"]
    static let videoMaxBytes = 25 * 1024 * 1024
    enum VideoProblem: Error, Equatable { case tooBig(Int), unsupported(String), unreadable }
    static func videoProblem(_ problem: VideoProblem) -> String {
        switch problem {
        case .tooBig(let bytes):
            let mb = Int((Double(bytes) / 1_048_576).rounded(.up))
            return "This video is \(mb) MB, and Spotter takes videos up to 25 MB. Trim it in Photos (Edit, then drag the ends in) and share it again."
        case .unsupported(let ext):
            return "Spotter reads MP4 and MOV videos, and this is " + (ext.isEmpty ? "another kind of file" : "a .\(ext) file") + ". Save it to Photos, then share it from there."
        case .unreadable:
            return "Spotter couldn’t open this video. Save it to Photos, then share it from there."
        }
    }
    /// The server has not been given the extension's upload door yet.
    static let videoNotHereYet = "Spotter can’t take videos from the share sheet yet. Open Spotter, tap Save workout, then Upload a video from your phone."
    static let uploadFailedMessage = "The video didn’t finish uploading. Check your connection and try again."

    static func savedMessage(status: Int, body: [String: Any]) -> String? {
        guard (200..<300).contains(status), let id = body["id"] as? String, !id.isEmpty else { return nil }
        switch body["status"] as? String {
        case "processing": return "Saved to your library. Spotter is reading the workout."
        case "exists": return "Already in your Spotter library."
        case "saved": return "Saved to your Spotter library."
        default: return nil
        }
    }

    /// True when the answer is a brand-new job the server is holding for this
    /// extension's frames (contract: `frames_pending`). A duplicate, a cache hit
    /// or a job another save already started never wants them.
    static func wantsFrames(status: Int, body: [String: Any]) -> Bool {
        status == 202 && body["status"] as? String == "processing"
            && (body["id"] as? String)?.isEmpty == false && body["job_id"] != nil
            && body["frames_wanted"] as? Bool != false
    }

    // The AI-permission wording, as a date. Must equal the server's
    // AI_CONSENT_VERSION and the app's: the server refuses to record agreement to
    // any other, so an extension that has not been rebuilt for new wording asks
    // for an update instead of recording agreement to words it never showed.
    static let consentVersion = "2026-09-19"
    static let consentTitle = "Allow AI processing?"
    static let consentText = "To read workouts, Spotter sends the links, captions, images, text and audio or video you share to OpenAI or Google. AI can make mistakes; review exercises and instructions before training.\n\nYou can turn this off at any time in Spotter → Settings → Data & privacy. Privacy policy: quarterdeckcollective.com/spotter/privacy"
    static let consentDeclinedMessage = "AI processing is off, so Spotter can’t read this workout. Share it again to allow AI processing, or turn it on in Spotter → Settings → Data & privacy."
    static func needsConsent(status: Int, body: [String: Any]) -> Bool {
        status == 403 && body["code"] as? String == "ai_consent_required"
    }
    static func consentFailureMessage(status: Int, body: [String: Any]) -> String {
        if body["code"] as? String == "ai_consent_version" { return "Update Spotter to allow AI processing, then share again." }
        if status == 401 { return "Open Spotter to refresh your sign-in, then share again." }
        return "Couldn’t save your choice. Check your connection and try again."
    }

    /// One failed save: the sentence, and whether "Try again" can help.
    struct Failure: Equatable {
        let message: String
        let retry: Bool
    }

    static func failure(status: Int, body: [String: Any]) -> Failure {
        let code = body["code"] as? String
        let said = (body["message"] as? String).map { String($0.prefix(300)) }.flatMap { $0.isEmpty ? nil : $0 }
        if code == "ai_consent_required" {
            return Failure(message: "Allow AI processing in Spotter → Settings → Data & privacy, then share this post again.", retry: false)
        }
        if status == 401 { return Failure(message: "Open Spotter to refresh your sign-in, then share again.", retry: false) }
        // The post is gone or private: trying again cannot change that.
        if code == "unavailable" {
            return Failure(message: said ?? "This post is private, deleted or unavailable to Spotter. Check it opens in the app, then share it again.", retry: false)
        }
        // A save still in flight, or the per-minute burst: a few seconds fixes it.
        if code == "busy" || code == "minute" {
            return Failure(message: said ?? "Still saving your last share — try again in a few seconds.", retry: true)
        }
        if let said = said {
            // A refusal about the link itself (400, 413, blocked) or a daily or
            // monthly allowance (a limit that names its kind) says the same thing
            // on a second tap. Of the request-level refusals (kind "request") only
            // busy and the per-minute burst clear in moments — "daily" and the
            // credit caps do not — and a busy upload permit (no kind) clears too.
            let kind = body["kind"] as? String
            let passing = kind == "request" ? (code == "busy" || code == "minute") : kind == nil
            let final = status == 400 || status == 413 || body["status"] as? String == "blocked"
                || (body["status"] as? String == "limit" && !passing)
            return Failure(message: said, retry: !final)
        }
        return status == 403
            ? Failure(message: "Spotter couldn’t authorize this save. Open Spotter to check your account, then share again.", retry: false)
            : Failure(message: "Spotter couldn’t save this link. Please try again.", retry: true)
    }

    /// Kept for callers that only want the sentence.
    static func failureMessage(status: Int, body: [String: Any]) -> String {
        failure(status: status, body: body).message
    }
}
