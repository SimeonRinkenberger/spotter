import SwiftUI
import WatchKit

// The running session on the wrist.
//
// Two pages, horizontal, controls on the LEFT of the metrics — that order is
// Apple's, from the Workout app and the workouts section of the watchOS HIG,
// and it is worth matching exactly because it is the one gesture every Apple
// Watch owner already has in their thumb.
//
// A note on the Digital Crown, because watchOS 10 gave two things a claim on
// it. Vertical paging (TabView's .verticalPage style, which the Activity app
// uses) turns the crown into the navigation between pages; the brief also wants
// the crown on the reps value, which is the precise-adjustment use the same
// watchOS 10 guidance describes. Both cannot have it. Paging here is therefore
// horizontal — which is what Apple's own Workout app does anyway — and the
// crown belongs to the number the wearer is about to log.
struct SessionView: View {
    let state: LiveState
    @ObservedObject var link: WatchLink
    @ObservedObject var keeper: WorkoutKeeper

    enum Page: Hashable { case controls, metrics }
    @State private var page: Page = .metrics

    var body: some View {
        TabView(selection: $page) {
            ControlsPage(state: state, link: link)
                .tag(Page.controls)
            MetricsPage(state: state, link: link, keeper: keeper)
                .tag(Page.metrics)
        }
        .tabViewStyle(.page)
        // Rest is the thing the wearer came to look at; if it starts while they
        // are on the controls page, bring them back to it.
        .onChange(of: state.rest != nil) { _, resting in
            if resting { page = .metrics }
        }
    }
}

// Page 2: what this set is, and the button that logs it.
struct MetricsPage: View {
    let state: LiveState
    @ObservedObject var link: WatchLink
    @ObservedObject var keeper: WorkoutKeeper

    /// What the dials say right now. Nil until someone moves one, which is also
    /// what gets sent: the phone's prefill is authoritative until the wrist
    /// disagrees with it, so an untouched Log set cannot drift from the sheet.
    @State private var reps: Int?
    @State private var weight: Double?
    @State private var crown: Double = 0

    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        if state.rest != nil {
            RestView(state: state, link: link, keeper: keeper)
        } else {
            work
        }
    }

    private var dose: LiveState.Dose? { state.dose }
    private var shownReps: Int? { reps ?? dose?.reps }
    private var shownWeight: Double? { weight ?? dose?.weight }

    /// Everything that makes this a different set from the last one. When it
    /// changes the dials go back to the phone's prefill, because a 12 left over
    /// from the previous movement is how a wrist logs a lie.
    private var identity: String {
        state.exercise + "#" + String(state.set?.index ?? 0) + "#" + String(state.progress.done)
    }

    private var work: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                header

                Text(state.exercise)
                    .font(WidgetTheme.display(19, weight: .semibold))
                    .foregroundStyle(WidgetTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .fixedSize(horizontal: false, vertical: true)

                Text(subtitle)
                    .font(WidgetTheme.display(13, weight: .medium))
                    .foregroundStyle(WidgetTheme.ink2)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)

                if let dose = dose, dose.loggable {
                    dials(dose)
                    logButton
                } else {
                    Text("Log this one on the phone.")
                        .font(WidgetTheme.display(12, weight: .medium))
                        .foregroundStyle(WidgetTheme.muted)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .padding(.top, 2)
                }

                if link.stalled { WaitingNote() }
            }
            .padding(.horizontal, 2)
        }
        .onChange(of: identity) { _, _ in
            reps = nil
            weight = nil
            crown = Double(dose?.reps ?? 0)
        }
        .onAppear { crown = Double(shownReps ?? 0) }
    }

    /// Elapsed, the block, and the heart if HealthKit is on. Small and quiet:
    /// the movement name is what this page is for.
    private var header: some View {
        HStack(spacing: 6) {
            Text(timerInterval: state.startedDate...state.startedDate.addingTimeInterval(86_400),
                 pauseTime: nil, countsDown: false, showsHours: false)
                .font(WidgetTheme.numeral(13, weight: .medium))
                .foregroundStyle(WidgetTheme.ink2)
                .lineLimit(1)

            if let rate = keeper.heartRate {
                Label(String(Int(rate.rounded())), systemImage: "heart.fill")
                    .font(WidgetTheme.numeral(12, weight: .medium))
                    .foregroundStyle(dimmed ? WidgetTheme.muted : WidgetTheme.emberInk)
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let block = state.block {
                Text(block)
                    .font(WidgetTheme.label(10))
                    .foregroundStyle(WidgetTheme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let set = state.set { parts.append("Set " + String(set.index) + " of " + String(set.total)) }
        if let target = state.target { parts.append(target) }
        if parts.isEmpty, let next = state.next { parts.append("Next: " + next) }
        return parts.joined(separator: " · ")
    }

    private func dials(_ dose: LiveState.Dose) -> some View {
        VStack(spacing: 6) {
            // The crown lives on reps: it is the number that changes most often
            // and the one a glove can turn without looking.
            StepperRow(label: "reps",
                       value: String(shownReps ?? 0),
                       down: { reps = dose.stepping(reps: shownReps, by: -1); crown = Double(reps ?? 0) },
                       up: { reps = dose.stepping(reps: shownReps, by: 1); crown = Double(reps ?? 0) })
                .focusable()
                .digitalCrownRotation($crown, from: 0, through: 999, by: 1,
                                      sensitivity: .low, isContinuous: false,
                                      isHapticFeedbackEnabled: true)
                .onChange(of: crown) { _, turned in
                    let stepped = min(999, max(0, Int(turned.rounded())))
                    if stepped != shownReps { reps = stepped }
                }

            if dose.weight != nil {
                StepperRow(label: dose.unit,
                           value: format(shownWeight ?? 0),
                           down: { weight = dose.stepping(shownWeight, by: -1) },
                           up: { weight = dose.stepping(shownWeight, by: 1) })
            }
        }
        .padding(.top, 2)
    }

    private var logButton: some View {
        Button {
            link.send(.set, reps: reps, weight: weight)
        } label: {
            Text(link.pending?.kind == .set ? "Logged" : "Log set")
                .font(WidgetTheme.display(15, weight: .semibold))
                .foregroundStyle(WidgetTheme.onEmber)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
        }
        .buttonStyle(.borderedProminent)
        .tint(dimmed ? WidgetTheme.emberSoft : WidgetTheme.ember)
        .disabled(link.pending != nil)
        .padding(.top, 2)
    }

    /// 60, not 60.0; 62.5 keeps its half. Matches the sheet's own stepper.
    private func format(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}

// A value between two round buttons. The watch's answer to the app's stepper.
struct StepperRow: View {
    let label: String
    let value: String
    let down: () -> Void
    let up: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            round("minus", action: down)
            VStack(spacing: -1) {
                Text(value)
                    .font(WidgetTheme.numeral(20, weight: .semibold))
                    .foregroundStyle(WidgetTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(label)
                    .font(WidgetTheme.label(9))
                    .foregroundStyle(WidgetTheme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            round("plus", action: up)
        }
        .frame(height: 40)
    }

    private func round(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(WidgetTheme.ink)
                .frame(width: 36, height: 36)
                .background(WidgetTheme.sand, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(symbol == "minus" ? "Decrease " + label : "Increase " + label)
    }
}

// Page 1: the things that end or interrupt the session.
//
// Apple puts End and Pause on their own page for one reason — nothing here
// should be a thumb's width from the button somebody presses forty times a
// session — and End is confirmed on top of that.
struct ControlsPage: View {
    let state: LiveState
    @ObservedObject var link: WatchLink
    @State private var confirmingEnd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(state.title)
                    .font(WidgetTheme.display(15, weight: .semibold))
                    .foregroundStyle(WidgetTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)

                Text(String(state.progress.done) + " of " + String(state.progress.total) + " sets")
                    .font(WidgetTheme.display(12, weight: .medium))
                    .foregroundStyle(WidgetTheme.ink2)
                    .lineLimit(1)

                if let rest = state.rest {
                    action("Skip rest", tint: WidgetTheme.sand, ink: WidgetTheme.ink) {
                        link.send(.skipRest)
                    }
                    action(rest.isPaused ? "Resume rest" : "Pause rest",
                           tint: WidgetTheme.sand, ink: WidgetTheme.ink) {
                        link.send(.toggleRest)
                    }
                }

                action(link.ending ? "Ending…" : "End workout",
                       tint: WidgetTheme.emberSoft, ink: WidgetTheme.emberInk) {
                    confirmingEnd = true
                }
                .disabled(link.ending)

                if link.stalled { WaitingNote() }
            }
            .padding(.horizontal, 2)
        }
        .confirmationDialog("End this workout?", isPresented: $confirmingEnd) {
            Button("End workout", role: .destructive) { link.send(.finish) }
            Button("Keep going", role: .cancel) {}
        }
    }

    private func action(_ title: String, tint: Color, ink: Color,
                        perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Text(title)
                .font(WidgetTheme.display(14, weight: .semibold))
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .background(tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
