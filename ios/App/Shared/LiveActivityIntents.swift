import AppIntents
import Foundation

// The two taps a Live Activity is allowed to send back into the session.
//
// Why this file is shared rather than living in the App target alone: a
// `Button(intent:)` in the widget extension needs the intent's *type* to
// compile, and `perform()` needs to run in the app's process to reach the
// bridge. `LiveActivityIntent` gives exactly that split — the system always
// runs it in the app, even launching the app in the background to do it — but
// only if the same declaration is compiled into both targets. So the type is
// here, in Shared, and `tools/ios/live-activity-check.mjs` asserts it is in the
// App target specifically, because that membership is the part that makes
// `perform()` meaningful rather than merely compilable.
//
// The router is the seam that keeps this file free of everything else. The
// widget extension has no Capacitor, no LiveStatePlugin and no web view, so an
// intent that named any of them could not be built into the extension at all.
// It names a closure instead; LiveActivitySink installs the real one at launch,
// and in the extension's copy it is simply never set and the tap is a no-op —
// which is correct, because a tap handled in the extension would have nowhere
// to send it.
enum LiveActionRouter {
    /// Installed once by `LiveActivitySink` in the app process. Nil in the
    /// widget extension, and nil in the app for the instant before the view
    /// controller exists — both of which mean "drop it", not "crash".
    static var handler: ((LiveAction) -> Void)?

    static func send(_ kind: LiveAction.Kind) {
        handler?(LiveAction(kind: kind, source: .activity, id: nil))
    }
}

// Both intents are marked `isDiscoverable = false`. They are meaningless
// outside a running session — "Skip rest" offered in Shortcuts or to Siri with
// no workout on is a promise the app cannot keep — and the Live Activity's
// button does not need discoverability to work.

struct SkipRestIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Skip rest"
    static let description = IntentDescription("End the rest that is running and move on to the next set.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        LiveActionRouter.send(.skipRest)
        return .result()
    }
}

struct LogSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Log set"
    static let description = IntentDescription("Log the set the app has prefilled, exactly as the Save button would.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        LiveActionRouter.send(.set)
        return .result()
    }
}
