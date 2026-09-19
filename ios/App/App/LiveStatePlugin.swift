import Capacitor
import Foundation
import WidgetKit

/// Anything that wants to be told what the running session is doing.
///
/// Implemented once per destination — the Live Activity, the watch — and
/// registered at launch. Sinks are held weakly and called on the main thread.
protocol LiveStateSink: AnyObject {
    func update(_ state: LiveState)
    func end(_ summary: LiveSummary)
}

// The single door between the workout engine and every native surface.
//
// The web app already calls saveDraft() on every engine state change; the same
// call now also hands over a LiveState. Rather than let each feature reach into
// the bridge for itself — a Live Activity plugin, a watch plugin, a widget
// plugin, three subtly different ideas of what "resting" means — everything
// goes through here and fans out to sinks. One decode, one contract, one place
// to look when the Lock Screen disagrees with the phone.
//
// Persisting to SharedStore on the way through is deliberate: a widget or an
// activity that is rebuilt by the system after the app is jetsammed has no
// bridge to ask, only the last state the app managed to write down.
@objc(LiveStatePlugin)
public class LiveStatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveStatePlugin"
    public let jsName = "LiveState"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyRequest", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Sink registry

    private final class WeakSink {
        weak var value: LiveStateSink?
        init(_ value: LiveStateSink) { self.value = value }
    }

    private static var sinks: [WeakSink] = []

    /// The most recent state the engine sent, for a sink that starts late or a
    /// surface rebuilding itself. Nil once the session ends.
    private(set) static var latest: LiveState?

    /// The instance currently attached to the web view. Weak because the bridge
    /// owns the plugin: a reload replaces it, and a strong reference here would
    /// keep delivering actions into a dead web view.
    private static weak var current: LiveStatePlugin?

    override public func load() {
        LiveStatePlugin.current = self
    }

    /// Registered once at launch from SpotterViewController. Registering the
    /// same object twice is a no-op, so a web view reload cannot double-fan.
    static func register(sink: LiveStateSink) {
        sinks.removeAll { $0.value == nil || $0.value === sink }
        sinks.append(WeakSink(sink))
    }

    private static func fanout(_ body: @escaping (LiveStateSink) -> Void) {
        DispatchQueue.main.async {
            sinks.removeAll { $0.value == nil }
            for sink in sinks {
                if let value = sink.value { body(value) }
            }
        }
    }

    // MARK: - Native to JavaScript

    /// Deliver a Lock Screen, wrist or notification tap to the web app.
    ///
    /// `retainUntilConsumed` matters more here than anywhere else in this app:
    /// the common case for a notification action is a cold launch, where the tap
    /// is handled before the web view has attached its listener. Without the
    /// retain the user's tap on "Log set" would be silently dropped.
    static func deliver(_ action: LiveAction) {
        guard let payload = action.jsObject() else {
            CAPLog.print("LiveState: could not encode action", action.kind.rawValue)
            return
        }
        DispatchQueue.main.async {
            current?.notifyListeners("action", data: payload, retainUntilConsumed: true)
        }
    }

    // MARK: - JavaScript to native

    @objc func update(_ call: CAPPluginCall) {
        do {
            let state = try decode(LiveState.self, from: call)
            LiveStatePlugin.latest = state
            store(state, key: SharedStore.Key.liveState)
            LiveStatePlugin.fanout { $0.update(state) }
            call.resolve()
        } catch {
            call.reject(message("LiveState.update", error))
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        do {
            let summary = try decode(LiveSummary.self, from: call)
            LiveStatePlugin.latest = nil
            SharedStore.remove(key: SharedStore.Key.liveState)
            LiveStatePlugin.fanout { $0.end(summary) }
            call.resolve()
        } catch {
            call.reject(message("LiveState.end", error))
        }
    }

    @objc func publish(_ call: CAPPluginCall) {
        do {
            let summary = try decode(WidgetSummary.self, from: call)
            store(summary, key: SharedStore.Key.widgetSummary)
            // Reload every family rather than a named kind: the widget target is
            // free to grow kinds without this file learning their names.
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject(message("LiveState.publish", error))
        }
    }

    @objc func notifyStatus(_ call: CAPPluginCall) {
        NotificationsHost.shared.status { status in
            call.resolve(["status": status.rawValue])
        }
    }

    @objc func notifyRequest(_ call: CAPPluginCall) {
        NotificationsHost.shared.request { status in
            call.resolve(["status": status.rawValue])
        }
    }

    // MARK: - Plumbing

    /// call.options is a JavaScript object graph, so the shortest honest route
    /// to a Codable is through JSON. JSValueDecoder would do it in one step but
    /// is internal to Capacitor.
    private func decode<T: Decodable>(_ type: T.Type, from call: CAPPluginCall) throws -> T {
        let raw = call.options as? [String: Any] ?? [:]
        guard JSONSerialization.isValidJSONObject(raw) else { throw DecodeFailure.notJSON }
        let data = try JSONSerialization.data(withJSONObject: raw)
        return try JSONDecoder().decode(type, from: data)
    }

    private enum DecodeFailure: Error { case notJSON }

    /// A failed write is logged, never fatal. Losing the cached copy costs a
    /// widget one stale render; failing the call would cost the user their set.
    private func store<T: Encodable>(_ value: T, key: String) {
        do {
            try SharedStore.writeJSON(value, key: key)
        } catch {
            CAPLog.print("LiveState: could not write", key, String(describing: error))
        }
    }

    private func message(_ method: String, _ error: Error) -> String {
        if case DecodeFailure.notJSON = error {
            return method + " received options that are not a JSON object."
        }
        return method + " could not decode its payload: " + String(describing: error)
    }
}

// Kept fileprivate on purpose: this is plumbing for notifyListeners, not a
// capability the rest of the app should discover on every Encodable it holds.
fileprivate extension Encodable {
    /// A JSON-object dictionary for notifyListeners, or nil if this value is not
    /// one (a bare array or scalar, which no event in this app sends).
    func jsObject() -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(self),
              let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return object as? [String: Any]
    }
}
