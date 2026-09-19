import SwiftUI
import WidgetKit

// The one timeline provider behind every Spotter widget, and the little model
// that turns a stored WidgetSummary into something drawable.
//
// All three widget kinds — the small week, the medium today, the Lock Screen
// accessories — read the same key out of SharedStore and want the same handful
// of derived strings, so there is one provider and one `Glance`. A second
// provider would be a second idea of what "stale" means within a week.
//
// The widget process never talks to Supabase and never computes a week: the app
// publishes `WidgetSummary` whenever the numbers change and calls
// `WidgetCenter.reloadAllTimelines()`. Everything here is a read of the last
// thing the app managed to write down.

struct SummaryEntry: TimelineEntry {
    let date: Date
    let summary: WidgetSummary?
}

struct SummaryProvider: TimelineProvider {
    /// The redacted state the system shows while it waits for a real entry. It
    /// gets a plausible summary rather than nothing, because
    /// redacted(.placeholder) draws the shape of whatever is there — and the
    /// shape of nothing is a blank square.
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: Date(), summary: SummaryProvider.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        let stored = SummaryProvider.stored()
        completion(SummaryEntry(date: Date(), summary: context.isPreview ? (stored ?? SummaryProvider.sample) : stored))
    }

    /// Two entries: now, and the next local midnight.
    ///
    /// Nothing between those two moments changes without the app changing it
    /// too, and the app's publish already reloads every timeline. Midnight is
    /// the one turn the widget has to make on its own — the week strip moves on
    /// a day and "today" stops meaning what it meant — so it is the only entry
    /// that is scheduled rather than pushed.
    ///
    /// Apple budgets a widget 40 to 70 reloads a day and asks for entries at
    /// least five minutes apart; a self-scheduled tick would spend that budget
    /// on a number that had not moved. A reload requested while the containing
    /// app is in the foreground — which is when Spotter publishes — is not
    /// charged against the budget at all.
    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        let stored = SummaryProvider.stored()
        let now = Date()
        var entries = [SummaryEntry(date: now, summary: stored)]
        let midnight = SummaryProvider.nextMidnight(after: now)
        if let midnight = midnight {
            entries.append(SummaryEntry(date: midnight, summary: stored))
        }
        // No midnight means a calendar that could not answer, which is not a
        // reason to stop updating: fall back to asking again in an hour.
        completion(Timeline(entries: entries,
                            policy: .after(midnight ?? now.addingTimeInterval(3600))))
    }

    /// Read on every call rather than cached in the provider: the extension
    /// process outlives a single timeline, and a cached summary is how a widget
    /// keeps showing the previous account after a sign-out.
    static func stored() -> WidgetSummary? {
        SharedStore.readJSON(WidgetSummary.self, key: SharedStore.Key.widgetSummary)
    }

    static func nextMidnight(after date: Date) -> Date? {
        var calendar = Calendar.current
        calendar.timeZone = .current
        return calendar.nextDate(after: date,
                                 matching: DateComponents(hour: 0, minute: 0, second: 0),
                                 matchingPolicy: .nextTime)
    }

    /// A Wednesday three sessions into a four-session week, with today planned
    /// and Friday next. Every family has something to lay out at every size,
    /// which is what makes the placeholder read as a design rather than a fault.
    static let sample = WidgetSummary(v: 1,
                                      updatedAt: SpotterISO8601.string(Date()),
                                      week: WidgetSummary.Week(key: "2026-09-14",
                                                               done: 3,
                                                               goal: 4,
                                                               days: [true, false, true, false, false, false, false],
                                                               planned: [false, false, false, true, true, false, false],
                                                               atRisk: false),
                                      streak: 6,
                                      today: WidgetSummary.Planned(id: "sample", title: "Push day", minutes: 42),
                                      next: WidgetSummary.NextDay(id: "sample-2", title: "Pull day", day: "2026-09-18"),
                                      last: nil,
                                      active: false,
                                      signedOut: nil)
}

// MARK: - Glance

/// One entry, read at one moment, answered in the words the widgets print.
///
/// Every widget view takes a Glance and nothing else. The alternative — each
/// view reaching into the optional chain of WidgetSummary for itself — is how
/// the small widget ends up calling a week stale at 24 hours while the
/// rectangular one calls it stale at 48.
struct Glance {
    let summary: WidgetSummary?
    /// The moment this entry is rendered for, which is not always now: the
    /// midnight entry is built hours before it is shown.
    let date: Date

    init(_ entry: SummaryEntry) {
        self.summary = entry.summary
        self.date = entry.date
    }

    /// Older than this and the widget says when it last heard from the app.
    /// A day and a half rather than a day: a phone left alone overnight has not
    /// done anything wrong, and a widget that nags about it at breakfast is one
    /// the reader removes.
    private static let staleAfter: TimeInterval = 36 * 3600

    // MARK: Availability

    /// Nothing to draw: no payload, a payload from a signed-out phone, or one
    /// with no week in it. Every family answers this with one calm line.
    var isEmpty: Bool { summary?.isEmpty ?? true }

    var week: WidgetSummary.Week? { summary?.week }

    var isStale: Bool {
        guard let at = summary?.updatedDate else { return false }
        return date.timeIntervalSince(at) > Glance.staleAfter
    }

    /// True once the entry's local day has moved past the day the summary was
    /// computed on — the midnight entry, or a phone that slept through one.
    var dayTurned: Bool {
        guard let at = summary?.updatedDate else { return false }
        return !Calendar.current.isDate(at, inSameDayAs: date)
    }

    // MARK: The week

    var done: Int { week?.done ?? 0 }
    var goal: Int { max(1, week?.goal ?? 1) }
    var isAtRisk: Bool { week?.isAtRisk ?? false }
    var streak: Int { summary?.streakWeeks ?? 0 }
    var isActive: Bool { summary?.isActive ?? false }

    enum Dot { case done, planned, free }

    /// Monday first, in the app's own dot language: filled is a session, a ring
    /// is a day the plan still asks for, sand is a free day. A planned day that
    /// went by unanswered is sand here exactly as it is in the app — the week
    /// being lived in is never asked to be finished.
    var dots: [Dot] {
        guard let week = week else { return Array(repeating: .free, count: 7) }
        let done = week.dayFlags, planned = week.plannedFlags
        return (0..<7).map { i in done[i] ? .done : (planned[i] ? .planned : .free) }
    }

    /// "3 of 4". The numeral the Progress ring shows, in the same order.
    var countText: String { String(done) + " of " + String(goal) }

    /// "3/4", for the one line an inline accessory gets.
    var slashText: String { String(done) + "/" + String(goal) }

    /// The eyebrow under the count. A week at risk says what is left rather
    /// than what is behind: the app never scolds and neither does this.
    var countCaption: String {
        if done >= goal { return "week complete" }
        if isAtRisk { return String(goal - done) + " to go" }
        return "this week"
    }

    var streakText: String {
        streak > 0 ? String(streak) + "-week streak" : "New streak"
    }

    /// What the footer says: the streak, unless the numbers are old enough that
    /// when they were last true matters more than what they were.
    var footerText: String {
        isStale ? asOfText : streakText
    }

    /// "as of Tue" — the weekday, because a stale widget is being read against
    /// "did I train since then", not against a clock.
    var asOfText: String {
        guard let at = summary?.updatedDate else { return "as of earlier" }
        return "as of " + at.formatted(.dateTime.weekday(.abbreviated))
    }

    // MARK: Today

    /// Today's planned row, or the one the plan names for this entry's date.
    ///
    /// The widget cannot recompute a plan; it can only read the two rows it was
    /// handed. So when the day has turned under a summary, `next` is promoted
    /// into the today slot if and only if it is dated for this entry's day.
    /// Anything less certain than that falls through to the empty copy, which
    /// is the honest answer to "I have not heard from the app since yesterday".
    var today: WidgetSummary.Planned? {
        guard let summary = summary, !summary.isEmpty else { return nil }
        if !dayTurned { return summary.today }
        guard let next = summary.next, let day = Glance.day(next.day),
              Calendar.current.isDate(day, inSameDayAs: date) else { return nil }
        return WidgetSummary.Planned(id: next.id, title: next.title, minutes: nil)
    }

    /// The next planned day, once it is genuinely still in the future.
    var next: WidgetSummary.NextDay? {
        guard let next = summary?.next else { return nil }
        if today?.id == next.id { return nil }
        guard let day = Glance.day(next.day) else { return next }
        return Calendar.current.startOfDay(for: day) > Calendar.current.startOfDay(for: date) ? next : nil
    }

    /// The headline of the today slot.
    var todayTitle: String {
        if let today = today { return today.title }
        return hasWeekPlan ? "Rest day" : "Nothing planned"
    }

    /// "42 min", or nothing when the card never said how long it runs.
    var todayLength: String? {
        guard let minutes = today?.minutes, minutes > 0 else { return nil }
        return String(minutes) + " min"
    }

    /// Is there any shape to this week at all — a session logged or a day the
    /// plan still asks for? That is the difference between a rest day and an
    /// empty plan, and it is answerable from the dot row without a new field.
    private var hasWeekPlan: Bool {
        guard let week = week else { return false }
        return week.dayFlags.contains(true) || week.plannedFlags.contains(true)
    }

    /// "Next · Pull day · Thu". The weekday is formatted here rather than sent,
    /// so it follows the reader's locale and calendar; a day string that is not
    /// a date (a future publisher sending "Thu" directly) is printed as it came.
    var nextText: String? {
        guard let next = next else { return nil }
        return "Next · " + next.title + " · " + Glance.dayLabel(next.day, from: date)
    }

    // MARK: The action

    enum Action {
        case start(String)
        /// Today is already answered. Same route — the app's own Today card
        /// keeps its start button too — with the app's own word on it.
        case again(String)
        case resume
        case browse

        var title: String {
            switch self {
            case .start: return "Start"
            case .again: return "Log another"
            case .resume: return "Resume"
            case .browse: return "Pick a workout"
            }
        }

        var url: URL? {
            switch self {
            case .start(let id), .again(let id):
                return URL(string: "spotter://start/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id))
            case .resume:
                return URL(string: "spotter://resume")
            case .browse:
                return URL(string: "spotter://tab/library")
            }
        }
    }

    /// A session already running is the only thing the pill offers, whatever the
    /// plan says: starting a second one is the one thing the app will refuse.
    var action: Action {
        if isActive { return .resume }
        if let today = today { return trainedToday ? .again(today.id) : .start(today.id) }
        return .browse
    }

    /// Was a session logged today? The dot row already knows — Monday first,
    /// so the weekday maps straight onto it — and a field for something the
    /// payload already carries is a field that can disagree with itself.
    ///
    /// False the moment the day has turned under the summary: those dots belong
    /// to the day the app last looked, not to this one.
    var trainedToday: Bool {
        guard !dayTurned, let week = week else { return false }
        let weekday = Calendar.current.component(.weekday, from: date)   // 1 = Sunday
        return week.dayFlags[(weekday + 5) % 7]
    }

    /// The eyebrow over the today slot: what state today is in, in one word.
    var todayLabel: String {
        if isActive { return "NOW" }
        return trainedToday ? "DONE TODAY" : "TODAY"
    }

    /// The line above the pill when a session is running. It replaces the plan
    /// rather than sitting beside it — two headlines is two answers.
    var runningTitle: String? { isActive ? "Workout running" : nil }

    // MARK: Dates

    private static let ymd: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func day(_ string: String) -> Date? { ymd.date(from: string) }

    /// "Thu" inside the coming week, "Sep 28" beyond it — an abbreviated weekday
    /// stops being a date once there is more than one of them ahead.
    static func dayLabel(_ string: String, from date: Date) -> String {
        guard let day = day(string) else { return string }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day],
                                           from: calendar.startOfDay(for: date),
                                           to: calendar.startOfDay(for: day)).day ?? 0
        if days >= 0 && days < 7 { return day.formatted(.dateTime.weekday(.abbreviated)) }
        return day.formatted(.dateTime.month(.abbreviated).day())
    }
}
