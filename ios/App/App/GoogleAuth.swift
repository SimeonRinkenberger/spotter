import AuthenticationServices
import Capacitor
import UIKit

@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)]
    private var session: ASWebAuthenticationSession?
    private var anchor: UIWindow?

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme == "https", url.host == "mtzevoxxpsktmrbbuxva.supabase.co",
              url.path == "/auth/v1/authorize", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil,
              parts.queryItems?.filter({ $0.name == "provider" }).map({ $0.value }) == ["google"],
              parts.queryItems?.filter({ $0.name == "redirect_to" }).map({ $0.value }) == ["com.spotter.auth://callback"],
              parts.queryItems?.first(where: { $0.name == "code_challenge_method" })?.value == "s256",
              let challenge = parts.queryItems?.first(where: { $0.name == "code_challenge" })?.value,
              !challenge.isEmpty else {
            call.reject("Invalid Google sign-in request."); return
        }
        DispatchQueue.main.async {
            guard self.session == nil else { call.reject("Sign-in is already open."); return }
            guard let window = self.bridge?.viewController?.view.window else {
                call.reject("Sign-in needs an active window."); return
            }
            self.anchor = window
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "com.spotter.auth") { [weak self] callback, error in
                DispatchQueue.main.async {
                    self?.session = nil
                    self?.anchor = nil
                    if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                        call.reject("Sign-in cancelled.", "AUTH_CANCELLED"); return
                    }
                    guard error == nil, let callback = callback,
                          callback.scheme == "com.spotter.auth", callback.host == "callback",
                          callback.path.isEmpty, callback.user == nil, callback.password == nil,
                          callback.port == nil, callback.fragment == nil else {
                        call.reject("Google sign-in did not complete."); return
                    }
                    call.resolve(["url": callback.absoluteString])
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                self.anchor = nil
                call.reject("Could not open Google sign-in.")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // start() retains the active window for the entire authentication session.
        return anchor!
    }
}
