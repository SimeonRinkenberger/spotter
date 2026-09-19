import Foundation
import Security

// The one drop box the app, the widgets and the Live Activity all reach into.
//
// The obvious tool for this is an App Group, and there is a door open for one
// (below). Spotter cannot walk through it yet: signing is a Personal Team, and
// personal teams get no App Groups at all. What they do get is the keychain
// access group the app and the Share Extension already share, so that is what
// carries the widget payloads today.
//
// Using the Keychain as a small key/value store is unusual enough to justify:
//
//   - It is the only container two of this app's targets can both open under
//     the current signing, so the alternative is no widgets until the paid
//     account exists.
//   - The payloads are not secrets. A week count and a workout title are what
//     the widget is going to draw on a locked screen anyway.
//   - Accessibility is AfterFirstUnlockThisDeviceOnly, matching SecureSession:
//     a Lock Screen widget must render before the day's first unlock — actually
//     after a reboot it must not, and that is the correct trade. Anything
//     WhenUnlocked would leave widgets blank in a pocket; anything without
//     ThisDeviceOnly would sync a device's workout state through iCloud Keychain
//     to devices that never ran the session.
//
// When the paid account arrives, set `SpotterAppGroup` in both Info.plists to
// the real group id and every caller here switches to UserDefaults with no code
// change. The empty string in the plist today is the switch in its off position;
// a value still containing "$(" means the build setting did not expand, which is
// treated as off rather than as a group literally named "$(SOMETHING)".
enum SharedStore {
    /// Keychain service for every item this store owns. Deliberately not
    /// `app.spotter.share` (the ingest key) or `app.spotter.session` (the
    /// refresh token): three services, three lifetimes, no accidental overlap.
    static let service = "app.spotter.shared"

    /// The whole key space, so a typo is a compiler error somewhere else.
    enum Key {
        static let widgetSummary = "widget-summary"
        static let liveState = "live-state"
    }

    enum Failure: Error, LocalizedError {
        /// No keychain group in Info.plist and no App Group: nowhere to write.
        case unavailable
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "Shared storage is unavailable: no keychain access group and no app group."
            case .keychain(let status):
                return "Keychain error " + String(Int(status)) + "."
            }
        }
    }

    // MARK: - App Group door

    /// The App Group suite, when the owner has filled one in. Nil is the norm today.
    private static var suite: UserDefaults? {
        guard let name = info("SpotterAppGroup"), !name.isEmpty, !name.contains("$(") else { return nil }
        return UserDefaults(suiteName: name)
    }

    /// True when payloads are going through an App Group rather than the Keychain.
    /// Worth logging once at launch when something is not showing up in a widget.
    static var usesAppGroup: Bool { suite != nil }

    private static func info(_ key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }

    // MARK: - Keychain

    private static func query(_ key: String) throws -> [String: Any] {
        guard let group = info("SpotterKeychainGroup"), !group.isEmpty, !group.contains("$(") else {
            throw Failure.unavailable
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: key,
                kSecAttrAccessGroup as String: group]
    }

    // MARK: - API

    static func write(_ data: Data, key: String) throws {
        if let suite = suite {
            suite.set(data, forKey: key)
            return
        }
        let q = try query(key)
        let values: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }

    static func read(key: String) throws -> Data? {
        if let suite = suite { return suite.data(forKey: key) }
        var q = try query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.keychain(status) }
        return data
    }

    /// Best effort by design. A widget timeline that cannot clear a stale key is
    /// not a reason to fail the sign-out that asked for it.
    static func remove(key: String) {
        if let suite = suite {
            suite.removeObject(forKey: key)
            return
        }
        guard let q = try? query(key) else { return }
        SecItemDelete(q as CFDictionary)
    }

    // MARK: - JSON convenience

    static func writeJSON<T: Encodable>(_ value: T, key: String) throws {
        try write(try JSONEncoder().encode(value), key: key)
    }

    /// Returns nil both when nothing is stored and when what is stored no longer
    /// decodes. A widget's answer to "the app wrote a shape I do not understand"
    /// is its empty state, not a crash in the extension process.
    static func readJSON<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = try? read(key: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
