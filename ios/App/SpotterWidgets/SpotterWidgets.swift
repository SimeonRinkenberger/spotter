import SwiftUI
import WidgetKit

// The Home Screen widget, as a placeholder that is still a designed thing.
//
// The widgets agent replaces this with the real families (streak, week vs goal,
// today's planned workout, and the Lock Screen accessory sizes). Until then the
// gallery has to show something, and an empty rectangle would read as a broken
// install. So it shows the wordmark on paper with the ember mark, in the app's
// own colours, sized so it does not clip at any Dynamic Type setting.
//
// It reads the published summary if one is already there, which makes this a
// live proof that the Keychain hand-off between app and extension works before
// any of the real widgets exist.
struct SpotterWidgets: Widget {
    let kind = "SpotterWidgets"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SummaryProvider()) { entry in
            SpotterMarkView(entry: entry)
        }
        .configurationDisplayName("Spotter")
        .description("Your week, your streak and today's workout.")
        .supportedFamilies([.systemSmall])
    }
}

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
        let stored = SharedStore.readJSON(WidgetSummary.self, key: SharedStore.Key.widgetSummary)
        completion(SummaryEntry(date: Date(), summary: context.isPreview ? (stored ?? SummaryProvider.sample) : stored))
    }

    /// One entry, no schedule. Nothing in this placeholder changes with time;
    /// the app reloads timelines when it publishes a new summary.
    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        let stored = SharedStore.readJSON(WidgetSummary.self, key: SharedStore.Key.widgetSummary)
        completion(Timeline(entries: [SummaryEntry(date: Date(), summary: stored)], policy: .never))
    }

    static let sample = WidgetSummary(v: 1,
                                      updatedAt: SpotterISO8601.string(Date()),
                                      week: WidgetSummary.Week(key: "2026-09-14",
                                                               done: 3,
                                                               goal: 4,
                                                               days: [true, false, true, false, true, false, false],
                                                               atRisk: false),
                                      streak: 5,
                                      today: nil,
                                      next: nil,
                                      last: nil,
                                      active: false,
                                      signedOut: nil)
}

struct SpotterMarkView: View {
    let entry: SummaryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Circle()
                .fill(WidgetTheme.ember)
                .frame(width: 10, height: 10)
            Spacer(minLength: 8)
            Text("Spotter")
                .font(WidgetTheme.display(22))
                .foregroundStyle(WidgetTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(caption)
                .font(.system(size: 12))
                .foregroundStyle(WidgetTheme.muted)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(WidgetTheme.paper, for: .widget)
    }

    /// Says what it honestly knows. Three states, none of them a spinner: a
    /// published week, a signed-out account, or no summary yet.
    private var caption: String {
        guard let summary = entry.summary else { return "Open Spotter to set up your week." }
        if summary.isSignedOut { return "Sign in to see your week." }
        guard let week = summary.week else { return "Open Spotter to set up your week." }
        return String(week.done) + " of " + String(week.goal) + " this week"
    }
}
