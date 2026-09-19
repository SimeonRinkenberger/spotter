import Foundation

// What the Home Screen and Lock Screen widgets are allowed to know.
//
// The app publishes this whenever the week, the plan or the streak changes and
// the widget reads it back out of SharedStore; the widget process never talks
// to Supabase, so this is the entire world as far as it is concerned. Keep it
// to numbers and short strings — it is stored in the Keychain with
// AfterFirstUnlockThisDeviceOnly so a Lock Screen widget can render before the
// first unlock of the day, and nothing that would embarrass someone reading a
// locked phone over your shoulder belongs in it.
//
// Every field except `v` and `updatedAt` is optional, which is not laziness:
// sign-out publishes `{ v, updatedAt, signedOut: true }` and nothing else, and
// that payload has to decode into the same struct so the widgets can clear
// themselves instead of showing the previous account's week forever.
struct WidgetSummary: Codable, Hashable {
    var v: Int
    /// ISO 8601, written by the phone at publish time.
    var updatedAt: String
    var week: Week?
    /// Consecutive weeks that met the goal — the number the Progress tab shows.
    var streak: Int?
    /// Today's planned row, if the plan has one.
    var today: Planned?
    /// The next planned day after today.
    var next: NextDay?
    /// The last session that was actually completed.
    var last: LastSession?
    /// A workout is running right now.
    var active: Bool?
    /// Nobody is signed in. Widgets show their empty state and stop.
    var signedOut: Bool?

    struct Week: Codable, Hashable {
        /// Monday of this week, YYYY-MM-DD. Also the cache key.
        var key: String
        var done: Int
        var goal: Int
        /// Days a session was logged, Monday through Sunday. Shorter or longer
        /// arrays are tolerated on read.
        var days: [Bool]?
        /// Days the plan still asks for, Monday through Sunday — today and
        /// ahead only, which is the app's own dot language: a planned day that
        /// went by unanswered is a free day, not a failure.
        var planned: [Bool]?
        /// The week is behind the pace that would still meet the goal.
        var atRisk: Bool?

        /// Exactly seven flags, Monday first, whatever arrived.
        var dayFlags: [Bool] { Week.seven(days) }

        /// The same, for the planned ring. Absent in a payload written before
        /// the widgets shipped, which reads as a week with nothing planned
        /// rather than as a decode failure.
        var plannedFlags: [Bool] { Week.seven(planned) }

        private static func seven(_ raw: [Bool]?) -> [Bool] {
            var flags = raw ?? []
            if flags.count > 7 { flags = Array(flags.prefix(7)) }
            while flags.count < 7 { flags.append(false) }
            return flags
        }

        var isAtRisk: Bool { atRisk ?? false }

        /// 0...1 for a ring or bar. A goal of zero reads as complete rather than
        /// as a division by zero — a person with no goal is not behind on it.
        var fraction: Double {
            guard goal > 0 else { return done > 0 ? 1 : 0 }
            return min(1, max(0, Double(done) / Double(goal)))
        }
    }

    struct Planned: Codable, Hashable {
        var id: String
        var title: String
        /// Estimated length; nil when the card does not say.
        var minutes: Int?
    }

    struct NextDay: Codable, Hashable {
        var id: String
        var title: String
        /// The plan row's own day, YYYY-MM-DD. Formatted into a weekday on the
        /// Swift side so it follows the reader's locale rather than the page's.
        var day: String
    }

    struct LastSession: Codable, Hashable {
        var title: String
        /// ISO 8601 instant the session finished.
        var at: String

        var date: Date? { SpotterISO8601.date(at) }
    }

    var isSignedOut: Bool { signedOut == true }
    var isActive: Bool { active ?? false }
    var streakWeeks: Int { streak ?? 0 }
    var updatedDate: Date? { SpotterISO8601.date(updatedAt) }

    /// Nothing worth drawing: signed out, or a payload with no week in it.
    var isEmpty: Bool { isSignedOut || week == nil }

    init(v: Int = 1,
         updatedAt: String,
         week: Week? = nil,
         streak: Int? = nil,
         today: Planned? = nil,
         next: NextDay? = nil,
         last: LastSession? = nil,
         active: Bool? = nil,
         signedOut: Bool? = nil) {
        self.v = v
        self.updatedAt = updatedAt
        self.week = week
        self.streak = streak
        self.today = today
        self.next = next
        self.last = last
        self.active = active
        self.signedOut = signedOut
    }
}
