import SwiftUI
import WidgetKit

// One extension, every WidgetKit surface Spotter offers.
//
// A Live Activity and a Home Screen widget are both WidgetKit, and Apple's
// guidance is to ship them from a single extension rather than one per feature:
// fewer processes, one asset catalog, one copy of the theme. The bundle is the
// list; each entry owns its own file.
@main
struct SpotterWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WorkoutLiveActivity()
        WeekWidget()
        TodayWidget()
        LockWidget()
    }
}
