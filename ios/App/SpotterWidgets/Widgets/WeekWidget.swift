import SwiftUI
import WidgetKit

// The week, on a square.
//
// One question — am I on pace — answered three ways at once so the answer
// survives a glance from across a desk: the shape of the dot row, the numeral,
// and the word under it. Nothing else fits, and the HIG is explicit that a
// small widget "typically show[s] a single piece of information".
//
// A week at risk changes the numeral's colour AND its caption. Colour alone
// would be a state nobody can see in the vibrant rendering mode, or in a tinted
// Home Screen, or with a colour vision deficiency.
struct WeekWidget: Widget {
    let kind = "SpotterWeek"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SummaryProvider()) { entry in
            WeekWidgetView(glance: Glance(entry))
        }
        .configurationDisplayName("This week")
        .description("Sessions against your weekly goal, and your streak.")
        .supportedFamilies([.systemSmall])
    }
}

struct WeekWidgetView: View {
    let glance: Glance
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .spotterContainer(family)
            .widgetURL(URL(string: "spotter://tab/progress"))
    }

    @ViewBuilder
    private var content: some View {
        if glance.isEmpty {
            EmptyGlance()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                DayDots(dots: glance.dots, size: 9)
                Spacer(minLength: 10)
                WeekCount(glance: glance, size: 30)
                Spacer(minLength: 6)
                GlanceFooter(glance: glance)
            }
        }
    }
}
