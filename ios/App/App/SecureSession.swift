import Capacitor
import Foundation
import Security

/// The Keychain home of the Supabase session.
///
/// A sibling of `ShareCredential`, deliberately not the same item: that one is a
/// save-only ingest key shared with the Share Extension through an explicit
/// access group, this one is the user's refresh token and belongs to the app
/// alone. The extension has never needed a session and still does not.
///
/// No `kSecAttrAccessGroup` is set. Naming a group requires the matching
/// entitlement at runtime, and the simulator builds the verification harness
/// uses are built with `CODE_SIGNING_ALLOWED=NO` and therefore carry no
/// entitlements at all — asking for a group there fails with
/// errSecMissingEntitlement. Left unset, the item lands in the app's default
/// group on device and in the simulator's keychain in the harness, which is the
/// behaviour we want in both places.
enum SessionKeychain {
    static let service = "app.spotter.session"

    enum Failure: Error { case keychain(OSStatus) }

    private static func query(_ account: String? = nil) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service]
        if let account = account { q[kSecAttrAccount as String] = account }
        return q
    }

    static func read(_ account: String) throws -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.keychain(status) }
        // A blob that is not UTF-8 is not something this app wrote. Report it as
        // absent rather than throwing: the caller's only sane response either way
        // is to treat the account as signed out.
        return String(data: data, encoding: .utf8)
    }

    static func write(_ account: String, _ value: String) throws {
        // AfterFirstUnlock, not WhenUnlocked: the app refreshes its token in the
        // background, which can happen while the phone is in a pocket. The
        // ThisDeviceOnly half keeps the item out of iCloud Keychain and out of
        // encrypted backups, so a session cannot be restored onto a second
        // device — the one thing a stolen refresh token would be worth.
        let values: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query(account) as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(account).merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }

    static func delete(_ account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
    }

    /// Every account this app holds under its own service — used once, at boot,
    /// to clear a session that survived an uninstall.
    static func accounts() throws -> [String] {
        var q = query()
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw Failure.keychain(status) }
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }
}

@objc(SecureSessionPlugin)
public class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keys", returnType: CAPPluginReturnPromise)
    ]

    // Rejection messages never name the key and never carry the OSStatus back to
    // the page; a status code in a JS error is one console paste away from a bug
    // report that fingerprints the user's keychain state.
    private func fail(_ call: CAPPluginCall) {
        call.reject("Secure sign-in storage is unavailable. Restart Spotter and try again.")
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { fail(call); return }
        // An absent item resolves with no `value` at all rather than a null, so
        // the adapter's "missing" branch is one shape on both platforms.
        do {
            if let value = try SessionKeychain.read(key) { call.resolve(["value": value]) } else { call.resolve([:]) }
        } catch { fail(call) }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty, let value = call.getString("value") else { fail(call); return }
        do { try SessionKeychain.write(key, value); call.resolve() }
        catch { fail(call) }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { fail(call); return }
        do { try SessionKeychain.delete(key); call.resolve() }
        catch { fail(call) }
    }

    @objc func keys(_ call: CAPPluginCall) {
        do { call.resolve(["keys": try SessionKeychain.accounts()]) }
        catch { fail(call) }
    }
}
