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
    static func savedMessage(status: Int, body: [String: Any]) -> String? {
        guard (200..<300).contains(status), let id = body["id"] as? String, !id.isEmpty else { return nil }
        switch body["status"] as? String {
        case "processing": return "Saved to your library. Spotter is reading the workout."
        case "exists": return "Already in your Spotter library."
        case "saved": return "Saved to your Spotter library."
        default: return nil
        }
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
    static func failureMessage(status: Int, body: [String: Any]) -> String {
        if body["code"] as? String == "ai_consent_required" {
            return "Allow AI processing in Spotter → Settings → Data & privacy, then share this post again."
        }
        if status == 401 { return "Open Spotter to refresh your sign-in, then share again." }
        if let message = body["message"] as? String, !message.isEmpty {
            return String(message.prefix(300))
        }
        return status == 403 ? "Spotter couldn’t authorize this save. Open Spotter to check your account, then share again."
            : "Spotter couldn’t save this link. Please try again."
    }
}
