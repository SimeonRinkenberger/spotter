import Capacitor
import Foundation

@objc(ShareAccessPlugin)
public class ShareAccessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareAccessPlugin"
    public let jsName = "ShareAccess"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise)]

    @objc func configure(_ call: CAPPluginCall) {
        let key = call.getString("key")
        if let key = key, key.range(of: "^[0-9a-f]{32}$", options: .regularExpression) == nil {
            call.reject("Invalid share credential"); return
        }
        do { try ShareCredential.write(key); call.resolve() }
        catch { call.reject("Could not prepare sharing. Open Spotter again to retry.") }
    }
}
