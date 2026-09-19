import SwiftUI
import WidgetKit

// Today, and one thing to do about it.
//
// The medium is the only family with room for a sentence and an action, so it
// is the only one that gets a button. The HIG asks that a widget interaction
// "opens your app at the right location", and each of the three actions here
// lands on exactly the screen the pill names: the card ready to start, the
// session already running, or the library.
//
// Two tap targets, which is the most a medium widget should have: the pill is a
// `Link`, and one `widgetURL` catches everything else and opens the Plan tab.
// (`widgetURL` is documented as undefined behaviour if a hierarchy has more
// than one, so the background link is set once, at the top.)
struct TodayWidget: Widget {
    let kind = "SpotterToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SummaryProvider()) { entry in
            TodayWidgetView(glance: Glance(entry))
        }
        .configurationDisplayName("Today")
        .description("Today's workout, with your week beside it.")
        .supportedFamilies([.systemMedium])
    }
}

struct TodayWidgetView: View {
    let glance: Glance
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .spotterContainer(family)
            .widgetURL(URL(string: "spotter://tab/plan"))
    }

    @ViewBuilder
    private var content: some View {
        if glance.isEmpty {
            EmptyGlance()
        } else {
            HStack(alignment: .top, spacing: 14) {
                plan
                divider
                week
            }
        }
    }

    // MARK: Left — what today asks for

    private var plan: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(glance.todayLabel)
                .font(WidgetTheme.label(10))
                .tracking(0.7)
                // The one place --good is spent: a day already answered. The
                // app's Today card marks it with the same colour and word.
                .foregroundStyle(glance.trainedToday && !glance.isActive ? WidgetTheme.good : WidgetTheme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            Text(glance.runningTitle ?? glance.todayTitle)
                .font(WidgetTheme.display(19))
                .foregroundStyle(WidgetTheme.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.65)
                .fixedSize(horizontal: false, vertical: true)
            if let detail = detail {
                Text(detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WidgetTheme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 2)
            }
            Spacer(minLength: 8)
            pill
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// The length of today's session, or — when today has nothing on it — the
    /// next day that does. One line either way, so the pill never moves.
    private var detail: String? {
        if glance.isActive { return glance.today?.title }
        if let length = glance.todayLength { return length }
        return glance.nextText
    }

    private var pill: some View {
        Link(destination: glance.action.url ?? URL(string: "spotter://open")!) {
            Text(glance.action.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WidgetTheme.onEmber)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(WidgetTheme.ember))
        }
        .widgetAccentable()
        .accessibilityLabel(Text(glance.action.title + " " + glance.todayTitle))
    }

    // MARK: Right — the week, compact

    private var divider: some View {
        Rectangle()
            .fill(WidgetTheme.line)
            .frame(width: 1)
            .frame(maxHeight: .infinity)
    }

    private var week: some View {
        VStack(alignment: .leading, spacing: 0) {
            WeekCount(glance: glance, size: 22)
            Spacer(minLength: 8)
            DayDots(dots: glance.dots, size: 8, labels: true)
            Spacer(minLength: 8)
            GlanceFooter(glance: glance)
        }
        // The right column is the week's, not half the widget's: a fixed share
        // keeps a long workout title from squeezing the dots into each other.
        .frame(width: 128, alignment: .leading)
    }
}
