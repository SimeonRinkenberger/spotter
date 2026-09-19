import Foundation

// The watch's ear on the workout engine, phone side.
//
// Registered at launch alongside the Live Activity sink. The watch is the one
// destination that has to hold its own copy of the rest deadline — the phone
// can be locked and the wrist still has to finish the countdown — so what
// crosses this seam is the whole LiveState, not a rendered string.
//
// D fills. What lands here: a WCSession, `updateApplicationContext` on every
// update (the latest state wins and a dropped one costs nothing, which is
// exactly the semantics of a session mirror), and a final context on `end` so a
// watch that missed the last second does not keep counting.
final class WatchLinkSink: LiveStateSink {
    func update(_ state: LiveState) {
        // D fills.
    }

    func end(_ summary: LiveSummary) {
        // D fills.
    }
}
