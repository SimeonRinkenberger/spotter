import AuthenticationServices
import Capacitor
import CryptoKit
import Security
import UIKit

@objc(AppleAuthPlugin)
public class AppleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleAuthPlugin"
    public let jsName = "AppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)]
    private var pendingCall: CAPPluginCall?
    private var controller: ASAuthorizationController?
    private var anchor: UIWindow?
    private var rawNonce: String?
    private var requestState: String?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingCall == nil else { call.reject("Apple sign-in is already open."); return }
            guard let window = self.bridge?.viewController?.view.window else {
                call.reject("Sign-in needs an active window."); return
            }
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                call.reject("Could not prepare secure sign-in."); return
            }
            let nonce = Data(bytes).base64EncodedString()
            let state = UUID().uuidString
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            request.state = state
            self.pendingCall = call
            self.rawNonce = nonce
            self.requestState = state
            self.anchor = window
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        defer { clearRequest() }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == requestState, let nonce = rawNonce,
              let data = credential.identityToken,
              let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            call.reject("Apple did not return a valid sign-in credential."); return
        }
        var result: [String: Any] = ["identityToken": token, "nonce": nonce]
        if let name = credential.fullName {
            let fullName = PersonNameComponentsFormatter().string(from: name).trimmingCharacters(in: .whitespacesAndNewlines)
            if !fullName.isEmpty { result["fullName"] = fullName }
        }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        defer { clearRequest() }
        if let error = error as? ASAuthorizationError, error.code == .canceled {
            call.reject("Apple sign-in cancelled.", "AUTH_CANCELLED")
        } else {
            call.reject("Apple sign-in did not complete. Please try again.")
        }
    }

    private func clearRequest() {
        pendingCall = nil
        controller = nil
        anchor = nil
        rawNonce = nil
        requestState = nil
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return anchor!
    }
}
