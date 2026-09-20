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
    static func failureMessage(status: Int, body: [String: Any]) -> String {
        if body["code"] as? String == "ai_consent_required" {
            return "Open Spotter → Settings → Data & privacy and review AI permission, then share this post again."
        }
        if status == 401 { return "Open Spotter to refresh your sign-in, then share again." }
        if let message = body["message"] as? String, !message.isEmpty {
            return String(message.prefix(300))
        }
        return status == 403 ? "Spotter couldn’t authorize this save. Open Spotter to check your account, then share again."
            : "Spotter couldn’t save this link. Please try again."
    }
}
