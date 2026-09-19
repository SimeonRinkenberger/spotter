import SwiftUI
import WidgetKit

// The parts more than one Spotter widget is made of.
//
// The week strip and the count are drawn by the small widget and again on the
// right of the medium one; the empty line is drawn by every family. Writing
// them once is not only less code — it is the only way the two Home Screen
// widgets stay the same app when one of them is changed in a hurry.
//
// Nothing here sets an outer padding. Widgets get the system's default content
// margins (16 pt, the HIG's standard width) and `containerBackground` is what
// turns those on; adding a padding of our own would double them and cost the
// small widget a dot.

// MARK: - The dot language

/// Seven days, Monday first, in the app's own five-state dot language reduced
/// to the three states a week strip can say: filled is a session, a ring is a
/// day the plan still asks for, sand is a free day.
///
/// The dots are the accent group in the accented rendering mode (the Home
/// Screen's tinted appearance, and a watch complication), so a tinted widget
/// still reads as "these days, not those".
struct DayDots: View {
    let dots: [Glance.Dot]
    var size: CGFloat = 9
    /// Labels cost a line the small widget does not have; the medium has room.
    var labels: Bool = false

    private static let initials = ["M", "T", "W", "T", "F", "S", "S"]
    private static let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(dots.prefix(7).enumerated()), id: \.offset) { index, dot in
                VStack(spacing: 3) {
                    dotShape(dot)
                        .frame(width: size, height: size)
                    if labels {
                        Text(DayDots.initials[index])
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(WidgetTheme.muted)
                    }
                }
                // Equal columns rather than a fixed gap: seven dots have to fit
                // the narrowest small widget there is, and a gap that does not
                // shrink is what pushes the seventh one off the edge.
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text(DayDots.names[index] + ", " + label(dot)))
            }
        }
        .widgetAccentable()
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func dotShape(_ dot: Glance.Dot) -> some View {
        switch dot {
        case .done:
            Circle().fill(WidgetTheme.ember)
        case .planned:
            // 1.6 pt inset, the width the app draws its planned ring at.
            Circle().strokeBorder(WidgetTheme.ember, lineWidth: 1.6)
        case .free:
            Circle().fill(WidgetTheme.sand)
        }
    }

    private func label(_ dot: Glance.Dot) -> String {
        switch dot {
        case .done: return "trained"
        case .planned: return "planned"
        case .free: return "free"
        }
    }
}

// MARK: - The count

/// "3 of 4" over "this week". The numeral carries the widget, so it is the
/// largest thing on it and the only thing allowed to change colour.
struct WeekCount: View {
    let glance: Glance
    var size: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(glance.countText)
                .font(WidgetTheme.numeral(size, weight: .bold))
                .foregroundStyle(glance.isAtRisk ? WidgetTheme.emberInk : WidgetTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .widgetAccentable()
            Text(glance.countCaption)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(glance.isAtRisk ? WidgetTheme.emberInk : WidgetTheme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(glance.countText + " sessions " + glance.countCaption))
    }
}

/// The small print along the bottom: the streak, or when the numbers were last
/// true once they are old enough for that to be the more useful fact.
struct GlanceFooter: View {
    let glance: Glance

    var body: some View {
        Text(glance.footerText)
            .font(WidgetTheme.label(11))
            .foregroundStyle(WidgetTheme.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

// MARK: - Nothing to show

/// The signed-out and never-published state, which is a designed thing rather
/// than an apology: the ember mark, one line, and no button — a widget cannot
/// sign anybody in, so it does not pretend it can.
struct EmptyGlance: View {
    var line: String = "Open Spotter to see your week"
    var compact: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 8) {
            Circle()
                .fill(WidgetTheme.ember)
                .frame(width: 9, height: 9)
                .widgetAccentable()
            Text(line)
                .font(.system(size: compact ? 13 : 15, weight: .medium))
                .foregroundStyle(WidgetTheme.ink2)
                .lineLimit(3)
                .minimumScaleFactor(0.75)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Backgrounds

extension View {
    /// Paper behind a Home Screen widget, nothing behind an accessory one.
    ///
    /// A Lock Screen accessory is drawn in the vibrant rendering mode over the
    /// wallpaper; giving it a container background paints a grey slab on
    /// someone's photograph. `containerBackground` is still called with
    /// `Color.clear` rather than skipped, because a widget that never calls it
    /// gets the legacy inset on iOS 17 and loses its default margins.
    func spotterContainer(_ family: WidgetFamily) -> some View {
        let accessory = family == .accessoryCircular
            || family == .accessoryRectangular
            || family == .accessoryInline
        return containerBackground(for: .widget) {
            accessory ? Color.clear : WidgetTheme.paper
        }
    }
}
