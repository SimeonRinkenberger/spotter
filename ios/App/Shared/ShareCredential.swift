import Foundation
import Security

// A save-only key, never the user's password or refresh token. Both signed
// targets explicitly opt into this Keychain group; no App Group is required.
enum ShareCredential {
    static func query() throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "SpotterKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw Failure.unavailable }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "app.spotter.share",
                kSecAttrAccount as String: "ingest",
                kSecAttrAccessGroup as String: group]
    }
    enum Failure: Error { case unavailable, keychain(OSStatus) }
    static func read() throws -> String? {
        var q = try query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.keychain(status) }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ key: String?) throws {
        let q = try query()
        guard let key = key else {
            let status = SecItemDelete(q as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
            return
        }
        let values: [String: Any] = [kSecValueData as String: Data(key.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }
}
