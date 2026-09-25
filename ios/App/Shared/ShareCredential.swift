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

    // File-private rather than private: ParkedShare, below, keeps its two
    // values under their own accounts through these same two functions.
    fileprivate static func read(account: String) throws -> String? {
        var q = try query(account: account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.keychain(status) }
        return String(data: data, encoding: .utf8)
    }
    fileprivate static func write(_ value: String?, account: String) throws {
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
// second time. Now it parks the link and says it will be saved once they sign
// in; the app takes each parked link after sign-in and saves it like any other
// share.
//
// Parked links live in the Keychain group, beside the save key (service
// app.spotter.share, their own accounts), never in SharedStore. The Keychain
// group is the one container the app, the Share extension and the Action
// extension ("Save to Spotter") are all entitled to. The App Group is not: the
// Action extension has no application-groups entitlement, so on build 8, where
// these went through SharedStore and SharedStore used the App Group, a link
// parked from "Save to Spotter" went to a store the app could not open and the
// promise on screen was false. Whatever build 8 did leave in SharedStore, the
// app drains on its next sign-in or take (drainLegacy).
//
// Accessibility is the save key's own, WhenUnlockedThisDeviceOnly. Every path
// that touches a parked link already runs with the phone unlocked: the share
// sheet is on screen when the extension parks, the app claims right after
// writing the save key (itself WhenUnlocked), and it takes only after reading
// that key, when it comes to the front. AfterFirstUnlock would make no read
// succeed that now fails, and would leave a list of what someone browsed
// readable on a locked phone. ThisDeviceOnly keeps it out of iCloud Keychain
// and device-to-device restores: the owner tag means something only here.
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
// Only links park. A shared video file is tens of megabytes, the Keychain
// cannot hold it and the extension's own container is gone when it closes.
enum ParkedShare {
    /// ShareCredential accounts for the list and the owner tag, one JSON value
    /// each, agreed with the app half of the contract.
    static let account = "parked"
    static let ownerAccount = "parked-owner"
    /// Where build 8 kept the same two values: SharedStore keys, which a Release
    /// build puts in the App Group. Read only to drain them.
    static let legacyKey = "spotter.parkedShare"
    static let legacyOwnerKey = "spotter.parkedOwner"
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
        drainLegacy(now: now)
        let owner = tag(forKey: saveKey)
        try? writeOwner(owner)
        guard let items = try? stored(now: now) else { return }
        let mine = items.filter { $0.owner == nil || $0.owner == owner }
        guard mine.count != items.count else { return }
        try? save(mine)
    }

    static func park(_ url: URL, now: Date = Date()) throws {
        let link = url.absoluteString
        var items = try stored(now: now).filter { $0.url != link }
        // Until the app has run once on this build, the account signed in last
        // may still be named only where build 8 kept it.
        let owner = readOwner() ?? legacyOwner()
        items.append(Item(url: link, at: (now.timeIntervalSince1970 * 1000).rounded(), owner: owner))
        try save(Array(items.suffix(limit)))
    }

    /// The oldest parked link still worth saving for the account holding
    /// `saveKey`, removed from the store as it is handed over — each link is
    /// given to the app exactly once. Nil when no account is configured yet (the
    /// app asks again once it has told the native side who is signed in); links
    /// parked under another account are dropped on the way. Nil too when the
    /// Keychain will not answer, and then nothing is cleared: a store that could
    /// not be read is not an empty one.
    static func take(for saveKey: String?, now: Date = Date()) -> Item? {
        guard let saveKey = saveKey, !saveKey.isEmpty else { return nil }
        drainLegacy(now: now)
        let owner = tag(forKey: saveKey)
        guard let parked = try? stored(now: now) else { return nil }
        var items = parked.filter { $0.owner == nil || $0.owner == owner }
        guard !items.isEmpty else { try? save([]); return nil }
        let first = items.removeFirst()
        try? save(items)
        return first
    }

    /// What is parked, expired links left out; empty when nothing is. Throws
    /// when the Keychain refuses, so no caller mistakes that for "nothing".
    private static func stored(now: Date) throws -> [Item] {
        guard let json = try ShareCredential.read(account: account) else { return [] }
        let cutoff = (now.timeIntervalSince1970 - maxAge) * 1000
        // A value that no longer decodes is as good as nothing parked.
        let items = (try? JSONDecoder().decode([Item].self, from: Data(json.utf8))) ?? []
        return items.filter { $0.at >= cutoff }
    }

    /// An empty list removes the item rather than storing "[]".
    private static func save(_ items: [Item]) throws {
        guard !items.isEmpty else { try ShareCredential.write(nil, account: account); return }
        try ShareCredential.write(String(decoding: try JSONEncoder().encode(items), as: UTF8.self), account: account)
    }

    private static func readOwner() -> String? {
        guard let json = try? ShareCredential.read(account: ownerAccount) else { return nil }
        return (try? JSONDecoder().decode(Owner.self, from: Data(json.utf8)))?.tag
    }

    private static func writeOwner(_ tag: String) throws {
        try ShareCredential.write(String(decoding: try JSONEncoder().encode(Owner(tag: tag)), as: UTF8.self), account: ownerAccount)
    }

    // MARK: - Build 8

    private static func legacyOwner() -> String? {
        guard let data = try? SharedStore.read(key: legacyOwnerKey) else { return nil }
        return (try? JSONDecoder().decode(Owner.self, from: data))?.tag
    }

    /// Moves whatever build 8 parked through SharedStore (the App Group, in a
    /// Release app) into the Keychain item, older links first and the ten-link
    /// cap kept, then clears the old keys. Nothing leaves the old store until the
    /// Keychain holds it; a Keychain that will not answer means "next time".
    /// Only the app calls this: it is the one side that can open both stores.
    private static func drainLegacy(now: Date) {
        if let data = try? SharedStore.read(key: legacyKey) {
            guard let current = try? stored(now: now) else { return }
            let cutoff = (now.timeIntervalSince1970 - maxAge) * 1000
            let old = ((try? JSONDecoder().decode([Item].self, from: data)) ?? [])
                .filter { item in item.at >= cutoff && !current.contains { $0.url == item.url } }
            if !old.isEmpty {
                guard (try? save(Array((old + current).suffix(limit)))) != nil else { return }
            }
            SharedStore.remove(key: legacyKey)
        }
        if let tag = legacyOwner() {
            if readOwner() == nil { guard (try? writeOwner(tag)) != nil else { return } }
            SharedStore.remove(key: legacyOwnerKey)
        }
    }
}
