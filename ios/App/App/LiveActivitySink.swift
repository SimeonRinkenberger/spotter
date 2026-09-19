import ActivityKit
import Foundation

// The Live Activity's ear on the workout engine.
//
// Registered at launch by SpotterViewController, so ActivityKit work has
// somewhere to live from the first state the engine sends. Four jobs:
//
//   1. Own the activity's lifecycle — request one on the first real state,
//      update it, end it, and never let two exist at once.
//   2. Coalesce. The engine calls saveDraft() on every change and one tap makes
//      three of them; JS collapses a burst inside one turn of the event loop,
//      and this collapses what is left to at most one ActivityKit update a
//      second. A phase change jumps the queue, because the difference between
//      "working" and "resting" is the whole point of the card.
//   3. Schedule and cancel the rest-end notification against the same absolute
//      deadline the activity draws from, so the nudge and the countdown cannot
//      disagree.
//   4. Answer the Lock Screen's buttons optimistically. See `install()`.
//
// Everything it needs is in the state it is handed; it never reaches back into
// the bridge for more.
final class LiveActivitySink: LiveStateSink {
    /// The id every rest-end nudge is scheduled under. One id, so re-scheduling
    /// replaces rather than stacks, and one cancel clears whatever is pending.
    private static let nudgeID = "rest-end"

    private var activity: Activity<WorkoutActivityAttributes>?

    /// The last state actually pushed to ActivityKit. Also the base the
    /// optimistic update mutates, so a button press is applied to what is on
    /// screen rather than to something the engine has since replaced.
    private var current: LiveState?

    private var pending: LiveState?
    private var flushItem: DispatchWorkItem?
    private var lastPush = Date.distantPast

    /// `rest.until` of the rest the nudge is currently scheduled for. Zero means
    /// nothing is scheduled. Comparing deadlines rather than a Bool is what
    /// makes "+15 s" reschedule and a pause-then-resume not stack two alerts.
    private var nudgeDeadline: Double = 0

    init() {
        install()
        // A nudge can outlive the process that scheduled it — the app was
        // killed mid-rest, or the rest ended while the app was gone. Whatever
        // is pending belongs to a session this object knows nothing about.
        NotificationsHost.shared.cancel(id: Self.nudgeID)
        reconcile()
        #if DEBUG
        runFixtureIfAsked()
        LiveActivityShots.runIfAsked()
        #endif
    }

    // MARK: - Buttons

    /// Wire the Lock Screen's buttons to the engine, through a native update
    /// that does not wait for it.
    ///
    /// A `LiveActivityIntent` runs in the app's process, so the app is woken (or
    /// already awake) when the tap arrives — but its WKWebView content process
    /// is not, and JavaScript does not run until the app is foregrounded. The
    /// action is still delivered with `retainUntilConsumed: true`, so the engine
    /// applies it for real the moment the web view wakes; the two can only
    /// disagree about *when*, never about *what*. Until then the card would sit
    /// on a rest it has already been told to end, so it is corrected here.
    ///
    /// Order matters: the optimistic frame goes out first so the card changes
    /// under the thumb that tapped it.
    private func install() {
        LiveActionRouter.handler = { [weak self] action in
            self?.optimistic(action)
            LiveStatePlugin.deliver(action)
        }
    }

    private func optimistic(_ action: LiveAction) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  var state = self.current ?? LiveStatePlugin.latest else { return }
            switch action.kind {
            case .skipRest:
                guard state.rest != nil else { return }
                state.rest = nil
                if state.phase == .rest { state.phase = .work }
                self.cancelNudge()
            case .set:
                // The engine will start a rest of a length only it knows, so
                // this claims the set and nothing else. One frame later either
                // the engine's own state lands, or it does when the app wakes.
                guard state.phase == .work else { return }
                state.progress.done += 1
                if var set = state.set, set.index < set.total {
                    set.index += 1
                    state.set = set
                }
            default:
                return
            }
            self.current = state
            self.lastPush = Date()
            self.pending = nil
            self.flushItem?.cancel()
            self.flushItem = nil
            self.push(state)
        }
    }

    // MARK: - LiveStateSink

    func update(_ state: LiveState) {
        // The nudge is scheduled from every state, coalesced or not: it costs a
        // comparison when nothing changed, and a dropped reschedule would leave
        // an alert pointing at a deadline that has moved.
        syncNudge(state)

        let phaseChanged = current?.phase != state.phase
        pending = state
        flushItem?.cancel()
        flushItem = nil

        let since = Date().timeIntervalSince(lastPush)
        if phaseChanged || since >= 1 {
            flush()
            return
        }
        let item = DispatchWorkItem { [weak self] in self?.flush() }
        flushItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + (1 - since), execute: item)
    }

    func end(_ summary: LiveSummary) {
        pending = nil
        flushItem?.cancel()
        flushItem = nil
        current = nil
        cancelNudge()

        guard let activity = activity else { return }
        self.activity = nil

        // A session walked away from with nothing logged is a mistake, not a
        // result — it leaves at once. Anything with a set in it earns a closing
        // frame worth glancing at on the way past the phone.
        let policy: ActivityUIDismissalPolicy = (!summary.completed && summary.sets == 0)
            ? .immediate
            : .after(Date().addingTimeInterval(15 * 60))
        let content = ActivityContent(state: Self.doneContent(summary), staleDate: nil)
        Task { await activity.end(content, dismissalPolicy: policy) }
    }

    // MARK: - The activity

    private func flush() {
        flushItem = nil
        guard let state = pending else { return }
        pending = nil
        lastPush = Date()
        current = state
        push(state)
    }

    private func push(_ state: LiveState) {
        // A phone with Live Activities switched off in Settings is a supported
        // configuration, not an error: the rest of the app works, and the nudge
        // above still fires.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let content = ActivityContent(state: WorkoutActivityAttributes.content(state),
                                      staleDate: Self.staleDate(for: state),
                                      relevanceScore: 100)

        if let activity = activity, activity.activityState == .active || activity.activityState == .stale {
            Task { await activity.update(content) }
            return
        }

        // Nothing running. A finished session must not raise a card nobody will
        // ever see end, and `request` is only legal from the foreground — which
        // is the only place this is ever called from, because the only caller is
        // a JavaScript bridge call.
        guard state.phase != .done else { return }
        let (attributes, _) = WorkoutActivityAttributes.from(state)
        do {
            activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
        } catch {
            NSLog("Spotter Live Activity: could not start — %@", String(describing: error))
        }
    }

    /// When the card should admit it may be out of date.
    ///
    /// A rest has a deadline, and five minutes past it means the phone never
    /// came back — the engine would have sent something by then. Work has no
    /// deadline, so half an hour stands in for "nobody is doing this any more",
    /// which is long enough for a heavy single and short enough that a forgotten
    /// card stops claiming to be live.
    private static func staleDate(for state: LiveState) -> Date {
        if let rest = state.rest, !rest.isPaused {
            return rest.deadline.addingTimeInterval(5 * 60)
        }
        return Date().addingTimeInterval(30 * 60)
    }

    /// The closing frame. `exercise` carries the headline and `target` the
    /// figures, which is the same shape every other phase uses, so the widget
    /// needs no special case beyond the colour.
    private static func doneContent(_ summary: LiveSummary) -> WorkoutActivityAttributes.ContentState {
        var parts = [clock(summary.duration)]
        parts.append(String(summary.sets) + (summary.sets == 1 ? " set" : " sets"))
        if summary.prs > 0 { parts.append(String(summary.prs) + (summary.prs == 1 ? " PR" : " PRs")) }
        return WorkoutActivityAttributes.ContentState(
            phase: .done,
            exercise: summary.completed ? "Workout saved" : "Session ended",
            block: nil,
            set: nil,
            target: parts.joined(separator: "  ·  "),
            weight: nil,
            rest: nil,
            next: nil,
            progress: LiveState.Progress(done: summary.sets, total: max(summary.sets, 1)))
    }

    /// mm:ss, or h:mm:ss past an hour. Hand-rolled because DateComponentsFormatter
    /// would localise "42:10" into "42 minutes, 10 seconds" at some locales and
    /// this has to fit on one line beside a checkmark.
    private static func clock(_ interval: TimeInterval) -> String {
        let total = Int(max(0, interval.rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        let mm = String(format: "%02d", m), ss = String(format: "%02d", s)
        return h > 0 ? String(h) + ":" + mm + ":" + ss : String(m) + ":" + ss
    }

    // MARK: - Launch reconciliation

    /// An activity can outlive the process that started it — the app is killed
    /// with a card on the Lock Screen, and ActivityKit keeps drawing a workout
    /// nobody is doing. On launch, the stored state is the arbiter: no state, or
    /// a finished one, means every running card is a ghost.
    private func reconcile() {
        let running = Activity<WorkoutActivityAttributes>.activities
        guard !running.isEmpty else { return }

        let stored = SharedStore.readJSON(LiveState.self, key: SharedStore.Key.liveState)
        guard let stored = stored, stored.phase != .done else {
            for ghost in running {
                Task { await ghost.end(nil, dismissalPolicy: .immediate) }
            }
            return
        }

        // A session really is in progress. Adopt one card and retire any others:
        // two cards for one workout is worse than none, and only one of them
        // would ever be updated again.
        activity = running.first
        for extra in running.dropFirst() {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
        // The stored state is as old as the kill. Pushing it refreshes the
        // staleDate immediately rather than waiting for the web app to boot,
        // resume the draft and send its own.
        current = stored
        lastPush = Date()
        push(stored)
        syncNudge(stored)
    }

    // MARK: - The rest-end nudge

    /// One local notification at the rest's own deadline, and only while that
    /// exact rest is what the engine is doing.
    ///
    /// It is a local notification rather than an alerting activity update
    /// because the HIG asks apps not to "use push notifications alongside Live
    /// Activities for the same updates" — so the activity's rest updates carry
    /// no alert configuration at all, and the rest ending makes exactly one
    /// sound. When the app is in front, NotificationsHost's willPresent keeps
    /// even that silent: the screen and the haptic have already said so.
    private func syncNudge(_ state: LiveState) {
        guard state.phase == .rest, let rest = state.rest, !rest.isPaused else {
            cancelNudge()
            return
        }
        guard rest.until != nudgeDeadline else { return }
        nudgeDeadline = rest.until

        let body = Self.nudgeBody(state)
        let deadline = rest.deadline
        // Never asks. Permission is the web app's to request, from a tap, in
        // the one moment the nudge is about.
        //
        // `.provisional` counts. Spotter never requests a provisional
        // authorization today, so in production this reads as "granted only" —
        // but if one ever arrives, a rest that lands quietly in Notification
        // Centre is strictly better than a rest that says nothing, and a
        // predicate that silently dropped it would be a bug nobody could see.
        NotificationsHost.shared.status { status in
            guard status == .granted || status == .provisional else { return }
            NotificationsHost.shared.schedule(id: Self.nudgeID,
                                              title: "Rest over",
                                              body: body,
                                              at: deadline)
        }
    }

    private func cancelNudge() {
        guard nudgeDeadline != 0 else { return }
        nudgeDeadline = 0
        NotificationsHost.shared.cancel(id: Self.nudgeID)
    }

    /// "Goblet Squat, set 3 of 4" — the movement first, because that is what a
    /// person reads off a banner before deciding whether to pick the phone up.
    private static func nudgeBody(_ state: LiveState) -> String {
        var parts = [state.exercise]
        if let set = state.set {
            parts.append("set " + String(set.index) + " of " + String(set.total))
        } else if let next = state.next {
            parts = [next]
        }
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
import UserNotifications

// A way to see the Lock Screen card without an account.
//
// This exists because the Live Activity is only reachable through the web
// engine, the web engine is only reachable behind a sign-in, and the machine
// this was built on could not send a tap or a keystroke to the Simulator — no
// accessibility permission for osascript, no simulator-control permission for
// the agent. Every visual state in design/native/live-activity.md was verified
// through this door instead.
//
// It is not a back door into production behaviour. It is compiled out of
// Release entirely, it starts nothing unless an environment variable names a
// state, and it drives the SAME `update(_:)` / `end(_:)` the bridge calls — so
// what it renders is the real sink, the real coalescer and the real widget, not
// a preview of them.
//
//   SIMCTL_CHILD_SPOTTER_LIVE_FIXTURE=rest xcrun simctl launch <udid> <bundle id>
//
// States: work · rest · paused · timed · complex · done · ghost
// `ghost` starts a card and then wipes the stored state, which is the shape the
// app is in after being killed mid-session; relaunching with no variable set
// must end that card rather than adopt it.
extension LiveActivitySink {
    func runFixtureIfAsked() {
        let env = ProcessInfo.processInfo.environment
        guard let name = env["SPOTTER_LIVE_FIXTURE"], !name.isEmpty else { return }

        // A provisional authorization is the only one obtainable without a tap.
        // It delivers quietly to Notification Centre, which is enough to prove
        // the nudge is scheduled against the right deadline with the right copy.
        if env["SPOTTER_LIVE_FIXTURE_NOTIFY"] != nil {
            UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .provisional]) { granted, _ in
                    NSLog("Spotter fixture: provisional notifications granted=%@", String(granted))
                }
        }

        // Activity.request is only legal from the foreground, and the scene is
        // still connecting when the view controller is built.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self else { return }
            guard name != "done" else {
                self.drive(Self.fixture("work"))
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    self.end(LiveSummary(v: 1, title: "Lock Screen Test",
                                         startedAt: SpotterISO8601.string(Date().addingTimeInterval(-2530)),
                                         endedAt: SpotterISO8601.string(Date()),
                                         sets: 18, prs: 2, completed: true))
                }
                return
            }
            let state = Self.fixture(name == "ghost" ? "rest" : name)
            self.drive(state)
            if name == "ghost" {
                // The card stays; the engine's record of it does not.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    SharedStore.remove(key: SharedStore.Key.liveState)
                    NSLog("Spotter fixture: stored live-state wiped, card orphaned")
                }
            }
        }
    }

    /// Mirror what LiveStatePlugin.update does on the way past — persist, then
    /// fan out — so launch reconciliation sees what it would really see.
    private func drive(_ state: LiveState) {
        try? SharedStore.writeJSON(state, key: SharedStore.Key.liveState)
        update(state)
    }

    private static func fixture(_ name: String) -> LiveState {
        let started = Date().addingTimeInterval(-1090)
        let rest = LiveState.RestState(until: Date().addingTimeInterval(60).timeIntervalSince1970 * 1000,
                                       total: 60_000, held: 0)
        var state = LiveState(v: 1,
                              title: "Lock Screen Test",
                              startedAt: SpotterISO8601.string(started),
                              phase: .work,
                              exercise: "Goblet Squat",
                              block: "Main",
                              set: LiveState.SetPosition(index: 2, total: 3),
                              target: "10 reps",
                              weight: "24 kg",
                              rest: nil,
                              next: "Bench Press",
                              progress: LiveState.Progress(done: 4, total: 10))
        switch name {
        case "rest":
            state.phase = .rest
            state.set = LiveState.SetPosition(index: 3, total: 3)
            state.rest = rest
        case "paused":
            state.phase = .rest
            state.set = LiveState.SetPosition(index: 3, total: 3)
            state.rest = LiveState.RestState(until: rest.until, total: 60_000, held: 23_000)
        case "timed":
            state.phase = .timed
            state.exercise = "Plank"
            state.set = nil
            state.target = "40 s"
            state.weight = nil
            state.rest = LiveState.RestState(until: Date().addingTimeInterval(40).timeIntervalSince1970 * 1000,
                                             total: 40_000, held: 0)
        case "complex":
            state.phase = .complex
            state.exercise = "Kettlebell Swing"
            state.block = "Round 2"
            state.set = nil
            state.target = "12 reps"
        default:
            break
        }
        return state
    }
}
#endif
