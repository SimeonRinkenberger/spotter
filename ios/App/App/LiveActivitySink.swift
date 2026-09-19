import Foundation

// The Live Activity's ear on the workout engine.
//
// Registered at launch so ActivityKit work has somewhere to live from the first
// state the engine sends. The bodies are empty on purpose: starting, updating
// and ending the activity — and the rest-end notification that goes with it —
// is the Live Activity agent's work, and this file is the seam it fills.
//
// A fills. What lands here: start an Activity on the first `update` that is not
// already finished, update its ContentState on every subsequent one, end it
// from `end`, and cancel any scheduled rest notification on the way out.
// Everything it needs is in the state it is handed; it should not reach back
// into the bridge for more.
final class LiveActivitySink: LiveStateSink {
    func update(_ state: LiveState) {
        // A fills.
    }

    func end(_ summary: LiveSummary) {
        // A fills.
    }
}
