import CryptoKit
import Foundation
import Security

// A save-only key, never the user's password or refresh token. Both signed
// targets explicitly opt into this Keychain group; no App Group is required.
enum ShareCredential {
    static func query(account: String = "ingest") throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "SpotterKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw Failure.unavailable }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "app.spotter.share",
                kSecAttrAccount as String: account,
                kSecAttrAccessGroup as String: group]
    }
    enum Failure: Error { case unavailable, keychain(OSStatus) }
    static func read() throws -> String? { try read(account: "ingest") }
    static func write(_ key: String?) throws { try write(key, account: "ingest") }

    // The plan hint, beside the key (a separate item, so an extension built
    // before it existed reads the key exactly as it always did).
    //
    // The Share Extension decides before its one POST whether to ask the server
    // to hold the save for the phone's frames, and frames are a Plus thing. The
    // server knows the plan, but asking it (`/api/ingest/prepare`) was a whole
    // round trip on the path to "Saved" for every TikTok share, Basic included
    // (audit S6). So the app writes the plan it last saw here, and the extension
    // reads it with the key. It is a hint, never an entitlement: the server
    // still decides whether any frames are used.
    static let planAccount = "plan"
    static func readPlan() -> String? { try? read(account: planAccount) }
    static func writePlan(_ plan: String?) throws { try write(plan, account: planAccount) }

    /// Mirrors the server's `plusPlan`.
    static func plusPlan(_ plan: String?) -> Bool { ["plus", "pro", "staff"].contains(plan ?? "") }

    private static func read(account: String) throws -> String? {
        var q = try query(account: account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.keychain(status) }
        return String(data: data, encoding: .utf8)
    }
    private static func write(_ value: String?, account: String) throws {
        let q = try query(account: account)
        guard let value = value else {
            let status = SecItemDelete(q as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
            return
        }
        let values: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }
}

// Links shared while nobody was signed in (audit S14).
//
// The extension used to answer a signed-out share with "sign in, then share this
// post again" and drop the link, which asks the person to go and find the post a
// second time. Now it parks the link in the store the app and its extensions
// share (the App Group when there is one, the shared Keychain group today — see
// SharedStore) and says it will be saved once they sign in; the app takes each
// parked link after sign-in and saves it like any other share.
//
// A parked link belongs to whoever was signed in last on this phone: each item
// carries a one-way tag of the save key the app last configured (nil when no
// account ever had), and only that account — or, for an untagged link, the first
// one to sign in — is handed it. On a shared or handed-down phone, a link parked
// after one person signed out never lands in the next person's library or uses
// their saves; it is dropped when a different account signs in. The tag outlives
// sign-out on purpose (the app clears the key itself at every launch, before
// anyone has signed in), and a new account's key replaces it.
//
// Only links park. A shared video file is tens of megabytes, the shared Keychain
// cannot hold it and the extension's own container is gone when it closes.
enum ParkedShare {
    /// The SharedStore key, agreed with the app half of the contract.
    static let key = "spotter.parkedShare"
    /// Where the tag of the account last signed in is kept.
    static let ownerKey = "spotter.parkedOwner"
    /// Enough for a burst of shares while signed out, few enough that the
    /// Keychain item stays small.
    static let limit = 10
    /// A link parked a week ago is not a save anybody is still waiting for.
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60

    struct Item: Codable, Equatable {
        let url: String
        /// Milliseconds since 1970, the unit JavaScript's Date uses.
        let at: Double
        /// The tag of the account signed in last when this was parked; nil when
        /// none had been (or the item predates tags).
        var owner: String? = nil
    }

    private struct Owner: Codable { let tag: String }

    /// A one-way tag for a save key: enough to tell two accounts apart on one
    /// phone, useless as a credential. The key itself is never copied.
    static func tag(forKey saveKey: String) -> String {
        SHA256.hash(data: Data(saveKey.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// The app says who is signed in (ShareAccess.configure with a key). From now
    /// on links park under this account, and any parked under another are gone.
    static func claim(saveKey: String, now: Date = Date()) {
        let owner = tag(forKey: saveKey)
        try? SharedStore.writeJSON(Owner(tag: owner), key: ownerKey)
        let items = stored(now: now)
        let mine = items.filter { $0.owner == nil || $0.owner == owner }
        guard mine.count != items.count else { return }
        if mine.isEmpty { SharedStore.remove(key: key) } else { try? SharedStore.writeJSON(mine, key: key) }
    }

    static func park(_ url: URL, now: Date = Date()) throws {
        let link = url.absoluteString
        var items = stored(now: now).filter { $0.url != link }
        let owner = SharedStore.readJSON(Owner.self, key: ownerKey)?.tag
        items.append(Item(url: link, at: (now.timeIntervalSince1970 * 1000).rounded(), owner: owner))
        try SharedStore.writeJSON(Array(items.suffix(limit)), key: key)
    }

    /// The oldest parked link still worth saving for the account holding
    /// `saveKey`, removed from the store as it is handed over — each link is
    /// given to the app exactly once. Nil when no account is configured yet (the
    /// app asks again once it has told the native side who is signed in); links
    /// parked under another account are dropped on the way.
    static func take(for saveKey: String?, now: Date = Date()) -> Item? {
        guard let saveKey = saveKey, !saveKey.isEmpty else { return nil }
        let owner = tag(forKey: saveKey)
        var items = stored(now: now).filter { $0.owner == nil || $0.owner == owner }
        guard !items.isEmpty else { SharedStore.remove(key: key); return nil }
        let first = items.removeFirst()
        if items.isEmpty { SharedStore.remove(key: key) } else { try? SharedStore.writeJSON(items, key: key) }
        return first
    }

    private static func stored(now: Date) -> [Item] {
        let cutoff = (now.timeIntervalSince1970 - maxAge) * 1000
        return (SharedStore.readJSON([Item].self, key: key) ?? []).filter { $0.at >= cutoff }
    }
}
