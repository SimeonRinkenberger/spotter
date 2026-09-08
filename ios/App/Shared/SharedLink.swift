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
}
