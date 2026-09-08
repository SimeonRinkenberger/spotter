import Capacitor
import Foundation

// URLSession delivers bytes as they arrive; CapacitorHttp buffers the entire body.
@objc(PumpyStreamPlugin)
public class PumpyStreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PumpyStreamPlugin"
    public let jsName = "PumpyStream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private var streams: [String: PumpyConnection] = [:]

    @objc func start(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let body = call.getString("body"),
              let token = call.getString("authorization") else {
            call.reject("Missing stream request")
            return
        }
        DispatchQueue.main.async {
            guard self.streams[id] == nil else { call.reject("Duplicate stream"); return }
            var request = URLRequest(url: URL(string: "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/pumpy/chat")!)
            request.httpMethod = "POST"
            request.httpBody = Data(body.utf8)
            request.setValue(token, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
            call.keepAlive = true
            self.bridge?.saveCall(call)
            let connection = PumpyConnection(call: call) { [weak self] in
                self?.streams.removeValue(forKey: id)
                self?.bridge?.releaseCall(call)
            }
            self.streams[id] = connection
            connection.start(request)
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let id = call.getString("id") { self.streams[id]?.cancel() }
            call.resolve()
        }
    }
}

private final class PumpyConnection: NSObject, URLSessionDataDelegate {
    private let call: CAPPluginCall
    private let finish: () -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?

    init(call: CAPPluginCall, finish: @escaping () -> Void) {
        self.call = call
        self.finish = finish
    }

    func start(_ request: URLRequest) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 240
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func cancel() { task?.cancel() }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        call.resolve(["type": "headers", "status": response.statusCode,
                      "contentType": response.value(forHTTPHeaderField: "Content-Type") ?? "application/json"])
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // Base64 preserves UTF-8 characters split across network packets.
        call.resolve(["type": "data", "data": data.base64EncodedString()])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        call.keepAlive = false
        if error != nil { call.resolve(["type": "error", "message": "Stream connection ended"] ) }
        else { call.resolve(["type": "end"]) }
        session.finishTasksAndInvalidate()
        self.task = nil
        self.session = nil
        finish()
    }
}
