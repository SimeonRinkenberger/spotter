import SwiftUI

// The root. Three states, one of them at a time: nothing running, a session,
// a session that just ended.
//
// The router is where the workout session is started and stopped, not inside a
// view that a page swipe could take off screen — WorkoutKeeper is what keeps
// this app in the foreground and lets its haptics play, so its lifetime has to
// match the workout's, not a subview's.
//
// Colours come from WidgetTheme's dark column, which is the palette the app
// already uses on dark surfaces; watchOS has no light appearance to switch to.
struct ContentView: View {
    @ObservedObject private var link = WatchLink.shared
    @StateObject private var keeper = WorkoutKeeper()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            WidgetTheme.paper.ignoresSafeArea()
            content
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: link.state == nil)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: link.done == nil)
        // A session is running exactly while the phone says one is. Starting the
        // HealthKit session on the first state and ending it on the summary
        // means a phone that dies mid-workout leaves the watch holding a session
        // open — which is the right failure: the wearer can end it from the
        // controls page, and an app that let go the moment the link dropped
        // would be the one that loses the countdown.
        .onChange(of: link.state != nil) { _, running in
            if running { keeper.start() } else { keeper.stop() }
        }
        .onAppear { if link.state != nil { keeper.start() } }
    }

    @ViewBuilder
    private var content: some View {
        if let state = link.display, state.phase != .done {
            SessionView(state: state, link: link, keeper: keeper)
                .transition(.opacity)
        } else if let summary = link.done {
            DoneView(summary: summary) { link.dismissDone() }
                .transition(.opacity)
        } else {
            IdleView(summary: link.summary)
                .transition(.opacity)
        }
    }
}

// What the watch says when there is nothing to mirror.
//
// The honest answer — the session starts on the phone — is one short sentence,
// and nothing here is tappable: this app cannot start a workout (the engine,
// the library and the plan all live in the phone's web view), and a button that
// looked like it could would be a promise the wrist cannot keep. What it CAN do
// is be useful about what is planned, which is why the last published summary
// is worth holding on to.
struct IdleView: View {
    let summary: WidgetSummary?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(WidgetTheme.ember)

            Text("Start a workout on your iPhone")
                .font(WidgetTheme.display(14, weight: .medium))
                .foregroundStyle(WidgetTheme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.7)

            if let line = plannedLine {
                Text(line)
                    .font(WidgetTheme.display(12, weight: .medium))
                    .foregroundStyle(WidgetTheme.emberInk)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 2)
            } else if let week = summary?.week {
                Text(String(week.done) + " of " + String(week.goal) + " this week")
                    .font(WidgetTheme.display(12, weight: .medium))
                    .foregroundStyle(WidgetTheme.ink2)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Today's plan if there is one, else the next planned day, else the last
    /// session — in that order, because the useful sentence on a wrist at 6am is
    /// what is on for today.
    private var plannedLine: String? {
        guard let summary = summary, !summary.isSignedOut else { return nil }
        if let today = summary.today {
            guard let minutes = today.minutes else { return today.title }
            return today.title + " · " + String(minutes) + " min"
        }
        if let next = summary.next { return next.day + " · " + next.title }
        if let last = summary.last { return "Last: " + last.title }
        return nil
    }
}

// The one line that admits the phone has gone quiet.
//
// Deliberately a footnote and not an alert: the wrist's optimistic state is
// still the most likely truth, and a modal would be a bigger claim than
// "nothing has come back yet".
struct WaitingNote: View {
    var body: some View {
        Text("Waiting for iPhone…")
            .font(WidgetTheme.display(11, weight: .medium))
            .foregroundStyle(WidgetTheme.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .transition(.opacity)
    }
}

#Preview("Idle") {
    IdleView(summary: WidgetSummary(
        updatedAt: "2026-09-18T17:41:52.109Z",
        week: WidgetSummary.Week(key: "2026-09-14", done: 3, goal: 4,
                                 days: [true, false, true, false, false, false, false], atRisk: false),
        streak: 5,
        today: WidgetSummary.Planned(id: "pl-812", title: "Push day", minutes: 42)))
}
