import AppIntents
import Foundation

// The taps a Live Activity is allowed to send back into the session.
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
// It names closures instead; LiveActivitySink installs the real ones at launch,
// and in the extension's copy they are simply never set and the tap is a no-op
// — which is correct, because a tap handled in the extension would have nowhere
// to send it.
enum LiveActionRouter {
    /// Installed once by `LiveActivitySink` in the app process. Nil in the
    /// widget extension, and nil in the app for the instant before the view
    /// controller exists — both of which mean "drop it", not "crash".
    static var handler: ((LiveAction) -> Void)?

    /// One press of a ± button on the card's dial. Installed beside `handler`
    /// by the sink, which owns the figures; a press never reaches JavaScript.
    static var adjuster: ((DialField, Int) -> Void)?

    /// What the dial currently reads — nil for a figure nobody has touched, so
    /// an untouched Log set sends exactly what the phone prefilled.
    static var dialled: (() -> (reps: Int?, weight: Double?))?

    /// Waits, up to the interval, for the engine to answer the action just
    /// sent with a state of its own. Installed by the sink; nil in the widget
    /// extension, where there is nothing to wait for.
    static var settler: ((TimeInterval) async -> Void)?

    /// A tap on one of the dial's figures: the sink turns it into the
    /// `spotter://set/<field>?reps=..&weight=..` link the engine answers with
    /// the set sheet open on that field, carrying the dial's figures.
    static var typist: ((DialField) -> Void)?

    static func send(_ kind: LiveAction.Kind, reps: Int? = nil, weight: Double? = nil) {
        handler?(LiveAction(kind: kind, source: .activity, id: nil, reps: reps, weight: weight))
    }

    static func adjust(_ field: DialField, by delta: Int) {
        adjuster?(field, delta)
    }

    static func type(_ field: DialField) {
        typist?(field)
    }

    /// Why every `perform()` that sends an action awaits this before returning.
    ///
    /// Measured on the 17 Pro, 21 Sept, app backgrounded: the system wakes the
    /// app for the intent, `perform()` returns at once, and the process is
    /// suspended again about 100 ms later. The web engine DID run inside that
    /// window — its answer to a Next move reached the sink 50 ms after the tap
    /// — but anything the sink had not pushed by the suspension waited for
    /// the next wake, which was the next tap. Holding the intent open until
    /// the engine's state has been pushed (or a second and a half has passed)
    /// keeps the process alive for exactly as long as the round trip takes,
    /// so the card shows the engine's own frame — the next movement's name,
    /// the rest under the set just logged — rather than the optimistic one.
    static func settle(within seconds: TimeInterval = 1.5) async {
        await settler?(seconds)
    }
}

/// Which of the two figures a ± button turns. An `AppEnum` rather than a
/// string so the parameter can only ever be one of the two the sink knows how
/// to step, and so `Button(intent:)` serialises it without a custom entity.
enum DialField: String, AppEnum {
    case reps, weight

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Set figure")
    static let caseDisplayRepresentations: [DialField: DisplayRepresentation] = [
        .reps: "Reps",
        .weight: "Weight"
    ]
}

// Every intent here is marked `isDiscoverable = false`. They are meaningless
// outside a running session — "Skip rest" offered in Shortcuts or to Siri with
// no workout on is a promise the app cannot keep — and the Live Activity's
// buttons do not need discoverability to work.

struct SkipRestIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Skip rest"
    static let description = IntentDescription("End the rest that is running and move on to the next set.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        LiveActionRouter.send(.skipRest)
        await LiveActionRouter.settle()
        return .result()
    }
}

struct LogSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Log set"
    static let description = IntentDescription("Log the set the app has prefilled, exactly as the Save button would.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        // The dial's figures ride on the one action that does cross the
        // bridge. Nil for anything untouched: app.ts falls back to its own
        // prefill, which is the same number the card was showing.
        let dial = LiveActionRouter.dialled?()
        LiveActionRouter.send(.set, reps: dial?.reps, weight: dial?.weight)
        await LiveActionRouter.settle()
        return .result()
    }
}

/// The complex's two taps, from the card. `mark` ticks the movement the round
/// is up to and `round` counts the whole round; both go through the same
/// handler as Log set and land in `liveAction()` on the phone, where
/// `cxMark()` / `cxRound()` — the functions the screen's own buttons call —
/// count them, start the cap if it is not running, and rebuild the log.
/// Nothing is counted natively except the optimistic frame the sink draws
/// while the engine catches up.
struct MarkMoveIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Next move"
    static let description = IntentDescription("Tick the movement the round of the complex is up to.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        LiveActionRouter.send(.mark)
        await LiveActionRouter.settle()
        return .result()
    }
}

struct RoundDoneIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Round done"
    static let description = IntentDescription("Count a round of the complex on screen.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult {
        LiveActionRouter.send(.round)
        await LiveActionRouter.settle()
        return .result()
    }
}

/// The figure between the ± buttons, tapped: open the phone on the set sheet
/// with the dial's figures in it and this field under the keyboard — the one
/// thing a card cannot do for itself ("i will want to be able to type it in").
///
/// A button rather than a `Link`, although Apple documents `Link` for the
/// expanded presentation: on the 17 Pro (21 Sept) a `Link` on the figure
/// answered a tap with the card's own `widgetURL` — `spotter://resume` — in
/// the expanded island and on the Lock Screen alike, so the figure never
/// reached the sheet. `openAppWhenRun` brings the app forward the way a link
/// would, and `perform()` hands the sink the field; the sink delivers the
/// `spotter://set/<field>?reps=..&weight=..` link through the same door a
/// tapped notification's link goes through, and the engine's `openSetLink()`
/// does the rest. The figures ride in the link, read at tap time, so the
/// number typed over is the number the card was showing.
struct TypeFigureIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Type the figure"
    static let description = IntentDescription("Open the set sheet on the phone to type this figure.")
    static let isDiscoverable = false
    static let openAppWhenRun = true

    @Parameter(title: "Figure")
    var field: DialField

    init() {
        field = .weight
    }

    init(field: DialField) {
        self.field = field
    }

    func perform() async throws -> some IntentResult {
        LiveActionRouter.type(field)
        return .result()
    }
}

/// One type serves all four ± buttons. The parameters travel with the button:
/// WidgetKit archives the intent instance the view was built with, and the
/// system hands the app a copy with `field` and `delta` already assigned, so
/// `perform()` needs no resolution step — which is as well, because widgets
/// never resolve parameters (WidgetKit, "Adding interactivity to widgets and
/// Live Activities").
struct AdjustSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Adjust set"
    static let description = IntentDescription("Turn the reps or the weight of the set about to be logged by one step.")
    static let isDiscoverable = false

    @Parameter(title: "Figure")
    var field: DialField

    /// +1 or −1: one press of the stepper. The size of a weight step is the
    /// phone's (`dose.step`), not the button's, so a press is worth 2.5 kg on
    /// one account and 5 lb on another without the card knowing which.
    @Parameter(title: "Direction")
    var delta: Int

    init() {
        field = .reps
        delta = 1
    }

    init(field: DialField, delta: Int) {
        self.field = field
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        LiveActionRouter.adjust(field, by: delta)
        return .result()
    }
}
