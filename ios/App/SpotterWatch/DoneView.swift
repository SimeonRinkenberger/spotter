import SwiftUI

// The closing frame.
//
// It is shown for half a minute and then the watch goes back to being idle,
// because a summary that stays up forever is a watch face someone has to
// dismiss — and the session it describes is already saved on the phone, which
// is where anyone would go to read it properly. Tapping it dismisses it early.
struct DoneView: View {
    let summary: LiveSummary
    let dismiss: () -> Void

    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var timeout: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 4) {
            Text(summary.completed ? "Nice work" : "Session ended")
                .font(WidgetTheme.display(17, weight: .semibold))
                .foregroundStyle(WidgetTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(duration)
                .font(WidgetTheme.numeral(30, weight: .semibold))
                .foregroundStyle(dimmed ? WidgetTheme.emberInk : WidgetTheme.ember)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            Text(tally)
                .font(WidgetTheme.display(13, weight: .medium))
                .foregroundStyle(WidgetTheme.ink2)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)

            Text(summary.title)
                .font(WidgetTheme.display(11, weight: .medium))
                .foregroundStyle(WidgetTheme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.top, 2)
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { dismiss() }
        .task {
            timeout?.cancel()
            try? await Task.sleep(for: .seconds(30))
            if !Task.isCancelled { dismiss() }
        }
    }

    private var duration: String {
        let seconds = Int(summary.duration.rounded())
        let minutes = seconds / 60
        if minutes >= 60 {
            return String(minutes / 60) + "h " + String(minutes % 60) + "m"
        }
        return String(minutes) + " min"
    }

    private var tally: String {
        var parts = [String(summary.sets) + (summary.sets == 1 ? " set" : " sets")]
        if summary.prs > 0 { parts.append(String(summary.prs) + (summary.prs == 1 ? " PR" : " PRs")) }
        return parts.joined(separator: " · ")
    }
}

#Preview("Done") {
    DoneView(summary: LiveSummary(v: 1, title: "Kettlebell Circuit",
                                  startedAt: "2026-09-18T17:04:11.482Z",
                                  endedAt: "2026-09-18T17:41:52.109Z",
                                  sets: 12, prs: 1, completed: true), dismiss: {})
}
