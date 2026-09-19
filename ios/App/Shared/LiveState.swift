import Foundation

// The running workout, as the web engine sees it.
//
// app.ts calls saveDraft() on every engine state change; the native half of
// that call now also ships this structure, so the Lock Screen, the Dynamic
// Island and the watch all read one description of the session rather than
// each deriving its own. The field names are the wire format (LiveState v1 in
// briefs/NATIVE-SHARED.md) and are written by a different agent's JavaScript,
// so they are spelled here exactly as they arrive: no CodingKeys renames, no
// snake_case, no "helpful" tidying. Renaming one silently breaks the bridge.
//
// Two decisions worth knowing before you extend this:
//
// 1. Enums decode unknown strings into `.unknown` rather than throwing. The web
//    app updates independently of the shell — a phase the installed Swift has
//    never heard of must degrade to "something is happening", never to a decode
//    failure that leaves a stale Live Activity on the Lock Screen forever.
// 2. Clocks are absolute. `startedAt` is an instant and `rest.until` is a
//    deadline, both produced by the phone; nothing here is a countdown that has
//    to be ticked. That is what lets the Lock Screen keep counting while the
//    process is suspended — SwiftUI's Text(timerInterval:) renders from the
//    deadline, and a watch that wakes up late still knows how much rest is left.
struct LiveState: Codable, Hashable {
    /// Contract version. Bumped only when a field changes meaning.
    var v: Int
    var title: String
    /// ISO 8601 with fractional seconds, straight from `new Date().toISOString()`.
    var startedAt: String
    var phase: Phase
    /// The movement on screen right now.
    var exercise: String
    /// Block or circuit name, when the workout has more than one.
    var block: String?
    /// 1-based position in the current movement; nil for AMRAP and complex rounds.
    var set: SetPosition?
    /// What this set asks for: "10 reps", "8-12 reps", "40 s".
    var target: String?
    /// Prefilled or last-used weight with its unit; nil when bodyweight.
    var weight: String?
    /// Present only while resting.
    var rest: RestState?
    /// The movement after this one; nil at the end of the session.
    var next: String?
    var progress: Progress
    /// The same numbers the set sheet would open with, as numbers.
    ///
    /// Added for the wrist, which has a stepper of its own: `weight` above is a
    /// rendered string ("1,200 lb", grouped for the reader's locale) and
    /// `target` is prose ("8-12 reps"), so a surface that has to add 2.5 to one
    /// of them would be parsing its own app's display text. Optional because a
    /// shell built before this field existed still decodes.
    var dose: Dose?

    enum Phase: String, Codable, Hashable {
        case work, rest, timed, complex, done
        /// A phase this build does not know about. See note 1 above.
        case unknown

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Phase(rawValue: raw) ?? .unknown
        }
    }

    struct SetPosition: Codable, Hashable {
        var index: Int
        var total: Int
    }

    struct RestState: Codable, Hashable {
        /// Epoch milliseconds. JavaScript's clock, not Foundation's.
        var until: Double
        /// Full length of this rest in milliseconds, for the ring's denominator.
        var total: Double
        /// Milliseconds left at the moment the user paused. Zero means running.
        var held: Double

        var isPaused: Bool { held > 0 }
        var deadline: Date { Date(timeIntervalSince1970: until / 1000) }
        var totalInterval: TimeInterval { total / 1000 }

        /// Seconds left, from a paused rest's frozen remainder or a live deadline.
        /// Never negative: an overrun rest reads as finished, not as a past date.
        func remaining(at now: Date = Date()) -> TimeInterval {
            if isPaused { return max(0, held / 1000) }
            return max(0, deadline.timeIntervalSince(now))
        }
    }

    /// What a remote Save would send, before anyone turns a dial.
    ///
    /// `loggable` is the phone's own answer to "can this set be saved from off
    /// the phone at all" — a timed hold and an unresolved complex are answered
    /// on the screen, and the wrist must not offer a button that will come back
    /// as "Log this one on the phone."
    struct Dose: Codable, Hashable {
        /// Prefilled reps: the last logged value, else the movement's target.
        var reps: Int?
        /// Prefilled weight in `unit`; nil or zero for bodyweight.
        var weight: Double?
        /// "kg" or "lb", whichever the account is set to.
        var unit: String
        /// One press of the weight stepper: 2.5 kg or 5 lb, from the phone.
        var step: Double
        var loggable: Bool

        /// Never below zero and never past the engine's own clamp, so a wrist
        /// cannot send a figure the sheet would have refused.
        func steppedWeight(_ by: Double) -> Double {
            let next = (weight ?? 0) + by * step
            return min(9999, max(0, (next * 10).rounded() / 10))
        }

        func steppedReps(_ by: Int) -> Int {
            min(999, max(0, (reps ?? 0) + by))
        }
    }

    struct Progress: Codable, Hashable {
        /// Sets logged this session.
        var done: Int
        /// Sets the session plans in total.
        var total: Int

        /// 0...1, safe to hand a ProgressView. A plan of zero sets reads as empty
        /// rather than as a division by zero.
        var fraction: Double {
            guard total > 0 else { return 0 }
            return min(1, max(0, Double(done) / Double(total)))
        }
    }

    var startedDate: Date { SpotterISO8601.date(startedAt) ?? Date() }
    var restDeadline: Date? { rest?.deadline }
}

// Sent once when the session ends, by finishing or by walking away from it.
// The activity and the watch use it to show a closing frame and then retire.
struct LiveSummary: Codable, Hashable {
    var v: Int
    var title: String
    var startedAt: String
    var endedAt: String
    var sets: Int
    var prs: Int
    /// True when the user finished; false when the session was abandoned.
    var completed: Bool

    var startedDate: Date { SpotterISO8601.date(startedAt) ?? Date() }
    var endedDate: Date { SpotterISO8601.date(endedAt) ?? Date() }
    var duration: TimeInterval { max(0, endedDate.timeIntervalSince(startedDate)) }
}

// Native to JavaScript: a tap on the Lock Screen, the wrist or a notification.
//
// Encoding is deliberately hand-written so `id` is always present as a key,
// null when absent, which is what the contract promises the web side. The
// synthesised encoder would drop the key entirely for nil.
struct LiveAction: Codable, Hashable {
    var kind: Kind
    var source: Source
    /// Notification identifier, deep link, or whatever else names this action.
    var id: String?
    /// A `.set` dialled on the wrist before it was sent. Nil means "whatever the
    /// phone had prefilled", which is what every other surface sends: the Lock
    /// Screen has no stepper and must not invent a number.
    var reps: Int?
    /// The same, in the account's unit. The engine clamps both on arrival.
    var weight: Double?

    enum Kind: String, Codable, Hashable {
        /// Log the current set exactly as the sheet's Save button would.
        case set
        /// End the rest now — doneRest().
        case skipRest
        /// Pause or resume the running rest.
        case toggleRest
        case finish
        /// Bring the session forward on the phone.
        case open
        case notification
        case unknown

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .unknown
        }
    }

    enum Source: String, Codable, Hashable {
        case activity, watch, notification
        case unknown

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Source(rawValue: raw) ?? .unknown
        }
    }

    init(kind: Kind, source: Source, id: String? = nil, reps: Int? = nil, weight: Double? = nil) {
        self.kind = kind
        self.source = source
        self.id = id
        self.reps = reps
        self.weight = weight
    }

    enum CodingKeys: String, CodingKey { case kind, source, id, reps, weight }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(source, forKey: .source)
        if let id = id {
            try container.encode(id, forKey: .id)
        } else {
            try container.encodeNil(forKey: .id)
        }
        // Omitted rather than sent as null: app.ts asks `typeof a.reps ===
        // "number"` and falls back to its own prefill for anything else, so an
        // absent key and a null key mean the same thing to it — but a key that
        // is only ever present when a dial was actually turned is the honest
        // wire record of what the wrist did.
        if let reps = reps { try container.encode(reps, forKey: .reps) }
        if let weight = weight { try container.encode(weight, forKey: .weight) }
    }
}

// One place that agrees with JavaScript about what a timestamp looks like.
//
// app.ts writes `new Date().toISOString()`, which always carries milliseconds.
// ISO8601DateFormatter without .withFractionalSeconds rejects that string
// outright, and a shell that silently fell back to "now" would draw an elapsed
// timer starting from zero on every update. Both formatters are kept because a
// future caller (or a hand-written fixture) may well omit the fraction.
enum SpotterISO8601 {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func date(_ string: String) -> Date? {
        fractional.date(from: string) ?? plain.date(from: string)
    }

    static func string(_ date: Date) -> String {
        fractional.string(from: date)
    }
}
