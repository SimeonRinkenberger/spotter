import SwiftUI
import WidgetKit

// Spotter on the Lock Screen.
//
// One widget kind for all three accessory families, named just "Spotter": the
// Lock Screen picker shows a row per kind that fits the slot being edited, and
// two differently-named Spotter rows would make the reader choose between them
// before seeing either. One row fills whichever slot they opened.
//
// Everything here is drawn in the vibrant rendering mode, which desaturates
// text, images and gauges and colours them for the wallpaper behind. So no
// state on this surface is carried by colour — "1 to go" is a word, the gauge
// is a proportion, and ember is a hint rather than the message.
struct LockWidget: Widget {
    let kind = "SpotterLock"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SummaryProvider()) { entry in
            LockWidgetView(glance: Glance(entry))
        }
        .configurationDisplayName("Spotter")
        .description("Your week and today's workout, on the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct LockWidgetView: View {
    let glance: Glance
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .spotterContainer(family)
            .widgetURL(URL(string: destination))
    }

    /// The circular gauge is a week, so it goes to Progress; the two families
    /// that lead with today's workout go to the Plan tab.
    private var destination: String {
        family == .accessoryCircular ? "spotter://tab/progress" : "spotter://tab/plan"
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .accessoryInline: inline
        default: rectangular
        }
    }

    // MARK: Circular

    /// A capacity gauge of sessions against the goal, with the session count in
    /// the middle. Ring and numeral say the same thing on purpose: the streak
    /// would be a second number in a second unit on a forty-point glyph, and
    /// nothing on it to say which was which.
    @ViewBuilder
    private var circular: some View {
        if glance.isEmpty {
            // Not an empty gauge, which would read as a goal of zero met zero
            // times. The mark says whose widget this is and nothing more.
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 18, weight: .semibold))
                .widgetAccentable()
                .accessibilityLabel(Text("Spotter. Open the app to see your week."))
        } else {
            Gauge(value: Double(min(glance.done, glance.goal)), in: 0...Double(glance.goal)) {
                Text("wk")
            } currentValueLabel: {
                Text(String(glance.done))
                    .font(WidgetTheme.numeral(17, weight: .bold))
                    .minimumScaleFactor(0.6)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(WidgetTheme.ember)
            .accessibilityLabel(Text(glance.countText + " sessions this week"))
        }
    }

    // MARK: Rectangular

    /// Two lines, the same two the reader would want at the door: what today
    /// is, and where the week stands.
    @ViewBuilder
    private var rectangular: some View {
        if glance.isEmpty {
            Text("Open Spotter to see your week")
                .font(.system(size: 13, weight: .medium))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Text(headline)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .widgetAccentable()
                Text(weekLine)
                    .font(.system(size: 13))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    /// "Push day · 42 min", or "Workout running", or the rest-day copy.
    private var headline: String {
        if let running = glance.runningTitle { return running }
        guard let length = glance.todayLength else { return glance.todayTitle }
        return glance.todayTitle + " · " + length
    }

    /// "3 of 4 this week · streak 6". A stale summary spends the streak's half
    /// of the line saying when it was last true instead — the streak is the
    /// claim most worth not overstating.
    private var weekLine: String {
        let week = glance.countText + " this week"
        if glance.isStale { return week + " · " + glance.asOfText }
        return glance.streak > 0 ? week + " · streak " + String(glance.streak) : week
    }

    // MARK: Inline

    /// One string, one tap target, no layout — the family the HIG describes as
    /// offering "only one tap target", rendered beside the clock.
    @ViewBuilder
    private var inline: some View {
        if glance.isEmpty {
            Text("Open Spotter")
        } else if let running = glance.runningTitle {
            Text(running + " · " + glance.slashText + " this week")
        } else {
            Text(glance.todayTitle + " today · " + glance.slashText + " this week")
        }
    }
}
