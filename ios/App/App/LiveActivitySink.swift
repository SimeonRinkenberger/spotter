import ActivityKit
import Foundation

// The Live Activity's ear on the workout engine.
//
// Registered at launch by SpotterViewController, so ActivityKit work has
// somewhere to live from the first state the engine sends. Five jobs:
//
//   1. Own the activity's lifecycle — request one on the first real state,
//      update it, end it, and never let two exist at once (a resume is the one
//      deliberate hand-over, see `push`).
//   2. Coalesce. The engine calls saveDraft() on every change and one tap makes
//      three of them; JS collapses a burst inside one turn of the event loop,
//      and this collapses what is left to at most one ActivityKit update a
//      second. A phase change jumps the queue, because the difference between
//      "working" and "resting" is the whole point of the card.
//   3. Schedule and cancel the rest-end notification against the same absolute
//      deadline the activity draws from, so the nudge and the countdown cannot
//      disagree.
//   4. Answer the Lock Screen's buttons optimistically. See `install()`.
//   5. Hold the card's dial — the reps and weight a thumb has turned the next
//      set to. Those figures live here and nowhere else until Log set sends
//      them; a press on ± is a native update, not a bridge call.
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

    /// What the card's ± buttons have turned the next set to. Nil until
    /// touched, and nil again the moment the engine moves to a different set,
    /// movement or phase — a 12 left over from the last movement is how a card
    /// logs a lie. Applied on top of `dose` (the engine's prefill) at push
    /// time; never sent anywhere but inside the final `.set`.
    private var dial: (reps: Int?, weight: Double?) = (nil, nil)

    /// Armed when launch adopts a card the engine has not spoken for yet, and
    /// cancelled by the first state that arrives. See `armUnclaimed`.
    private var unclaimed: DispatchWorkItem?

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
    ///
    /// The dial is the exception to "every tap reaches the engine": a press on
    /// ± only changes what the card shows and what the eventual Log set will
    /// carry. `adjuster` applies it and pushes; `dialled` is how LogSetIntent
    /// reads the figures back when the set is finally sent.
    private func install() {
        LiveActionRouter.handler = { [weak self] action in
            #if DEBUG
            NSLog("Spotter Live Activity: action %@ reps=%@ weight=%@",
                  action.kind.rawValue,
                  action.reps.map(String.init) ?? "nil",
                  action.weight.map { String($0) } ?? "nil")
            #endif
            self?.optimistic(action)
            LiveStatePlugin.deliver(action)
        }
        LiveActionRouter.adjuster = { [weak self] field, delta in
            self?.adjust(field, by: delta)
        }
        LiveActionRouter.dialled = { [weak self] in
            self?.dial ?? (nil, nil)
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
                // The figures just went out inside the action; the next set
                // starts from the phone's prefill, not from this one's dial.
                self.dial = (nil, nil)
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

    /// One press of a ± button. Steps the figure the card is showing — the
    /// dial if it has been touched, the prefill if not — with the same clamp
    /// and rounding app.ts applies, and pushes at once: no coalescing, because
    /// the number has to change under the thumb that pressed it.
    ///
    /// Only during `work` and only for a loggable dose; a stray press from a
    /// card the system has not yet redrawn for the new phase is dropped rather
    /// than applied to a rest. The weight dial is refused for a bodyweight
    /// movement (the card does not draw one), so a press there cannot invent
    /// a load the engine never offered.
    private func adjust(_ field: DialField, by delta: Int) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let state = self.current ?? LiveStatePlugin.latest,
                  state.phase == .work,
                  let dose = state.dose, dose.loggable else { return }
            switch field {
            case .reps:
                self.dial.reps = dose.stepping(reps: self.dial.reps, by: delta)
            case .weight:
                guard dose.weight != nil else { return }
                self.dial.weight = dose.stepping(self.dial.weight, by: Double(delta))
            }
            #if DEBUG
            NSLog("Spotter Live Activity: dial %@ %+d -> reps=%@ weight=%@ (never sent)",
                  field.rawValue, delta,
                  self.dial.reps.map(String.init) ?? "nil",
                  self.dial.weight.map { String($0) } ?? "nil")
            #endif
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
        // A state from the engine is the engine claiming the card it was handed
        // at launch. See `armUnclaimed`.
        unclaimed?.cancel()
        unclaimed = nil

        // The dial belongs to one set of one movement in one phase. Compared
        // against the latest state received, not the latest pushed, because a
        // coalesced burst can move the set twice before anything is pushed.
        if let previous = pending ?? current, !Self.sameSet(previous, state) {
            dial = (nil, nil)
        }

        // The nudge is scheduled from every state, coalesced or not: it costs a
        // comparison when nothing changed, and a dropped reschedule would leave
        // an alert pointing at a deadline that has moved. A `paused` state has
        // no rest, so it lands in the cancel branch — no rest is running, and
        // an alert for one would be a lie with a sound.
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
        unclaimed?.cancel()
        unclaimed = nil
        pending = nil
        flushItem?.cancel()
        flushItem = nil
        current = nil
        dial = (nil, nil)
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

    /// Whether two states describe the same set of the same movement in the
    /// same phase — the identity the dial is allowed to survive. `progress.done`
    /// is in it because a set logged on the phone advances the position even
    /// when the index cannot (the extras past a plan keep the same total).
    private static func sameSet(_ a: LiveState, _ b: LiveState) -> Bool {
        a.phase == b.phase && a.exercise == b.exercise && a.set == b.set
            && a.progress.done == b.progress.done
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

        let content = ActivityContent(state: WorkoutActivityAttributes.content(state,
                                                                              dialReps: dial.reps,
                                                                              dialWeight: dial.weight),
                                      staleDate: Self.staleDate(for: state),
                                      relevanceScore: 100)

        if let activity = activity, activity.activityState == .active || activity.activityState == .stale {
            // A resume. The engine moves `startedAt` forward by the length of
            // the pause so the elapsed clock skips it — and `startedAt` is an
            // attribute, immutable for the life of the activity, because the
            // widget's timer is drawn straight from it. So the running card
            // cannot be updated into the resumed session; it is replaced. The
            // new one is requested first and the old one ended only once that
            // succeeded, with no closing frame: if the request is refused
            // (the app is not in front — a resume is a tap, so it should be,
            // but a boot-time reconcile can land here too), the old card
            // keeps being updated at its old elapsed rather than vanishing.
            if Self.differs(activity.attributes.startedAt, state.startedDate) {
                let (attributes, _) = WorkoutActivityAttributes.from(state)
                do {
                    self.activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                    Task { await activity.end(nil, dismissalPolicy: .immediate) }
                } catch {
                    NSLog("Spotter Live Activity: could not replace on resume — %@", String(describing: error))
                    Task { await activity.update(content) }
                }
                return
            }
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

    /// Two start instants that are not the same session start. Half a second
    /// of tolerance: the ISO string carries milliseconds and both sides parse
    /// the same string, so anything past rounding noise is a shifted start.
    private static func differs(_ a: Date, _ b: Date) -> Bool {
        abs(a.timeIntervalSince(b)) > 0.5
    }

    /// When the card should admit it may be out of date.
    ///
    /// For a running rest this is the deadline itself, and that is not a
    /// confession — it is the mechanism. Nothing native runs at the moment a
    /// rest ends: the engine that would send the next state is a web view in a
    /// suspended process, so with the app backgrounded the card sat on the rest
    /// presentation with its countdown pinned at 0:00 and an hourglass, until
    /// the app was opened (found on the 17 Pro, 19 Sept). ActivityKit re-renders
    /// an activity when its stale date passes and hands the view
    /// `context.isStale`, which is the one local wake-up an activity gets. So
    /// the deadline is the stale date, and the widget's stale branch draws the
    /// rest-over state. Five minutes past it — what this was — is five minutes
    /// of a card lying about what the person should be doing.
    ///
    /// Clamped a second into the future because an update can land after the
    /// deadline it describes (a `+15 s` undone, a resume), and ActivityKit
    /// ignores a stale date that is already past instead of firing at once.
    ///
    /// A timed hold keeps the old +5 min: its end is a set to log on the phone,
    /// not a cue to move, and nothing in the card would change at zero. Work has
    /// no deadline, so half an hour stands in for "nobody is doing this any
    /// more", which is long enough for a heavy single and short enough that a
    /// forgotten card stops claiming to be live.
    ///
    /// A paused session gets the far end of the activity's own life. Nothing
    /// on a paused card can go out of date — its clock is frozen by design —
    /// and the only thing a nearer stale date could do is what it must never
    /// do: flip a paused card into "rest over".
    private static func staleDate(for state: LiveState) -> Date {
        if state.phase == .paused {
            return Date().addingTimeInterval(8 * 60 * 60)
        }
        if let rest = state.rest, !rest.isPaused {
            let deadline = state.phase == .rest ? rest.deadline : rest.deadline.addingTimeInterval(5 * 60)
            return max(deadline, Date().addingTimeInterval(1))
        }
        return Date().addingTimeInterval(30 * 60)
    }

    /// The closing frame. `exercise` carries the headline and `target` the
    /// figures, which is the same shape every other phase uses, so the widget
    /// needs no special case beyond the colour.
    private static func doneContent(_ summary: LiveSummary) -> WorkoutActivityAttributes.ContentState {
        var parts = [WorkoutActivityAttributes.clock(summary.duration)]
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
            progress: LiveState.Progress(done: summary.sets, total: max(summary.sets, 1)),
            pausedAt: nil,
            dial: nil,
            loggable: false)
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
        // resume the draft and send its own. A stored `paused` state is the
        // common shape here — a session the process died in comes back as
        // paused — and it claims the card like any other state would.
        current = stored
        lastPush = Date()
        push(stored)
        syncNudge(stored)
        armUnclaimed()
    }

    /// The adoption above is provisional, and this is what makes it so.
    ///
    /// A stored state says a session was in progress when the process died. It
    /// does not say one is in progress now: the web app boots, offers "Tap to
    /// resume", and only a tap actually restores it. Nobody taps, and the card
    /// keeps a workout on the Lock Screen for the eight hours ActivityKit
    /// allows — counting a rest that ended, offering a button for a session
    /// that does not exist. Found on the 16e: relaunch after a kill mid-rest
    /// left exactly that card up with the app sitting in the library.
    ///
    /// So the card is on loan until the engine speaks. `update(_:)` cancels
    /// this the moment any real state arrives — including the one a resumed
    /// draft sends — and a resume after the deadline simply requests a new
    /// card, which is legal because a tap is a foreground event. The window is
    /// longer than the 30 s the resume toast stays up, so it can only fire once
    /// the offer itself has gone unanswered.
    private func armUnclaimed() {
        unclaimed?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.dropUnclaimed() }
        unclaimed = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: item)
    }

    private func dropUnclaimed() {
        unclaimed = nil
        // The card goes first and without a closing frame: nothing here is worth
        // a glance, it is a workout nobody is doing.
        let ghost = activity
        activity = nil
        current = nil
        dial = (nil, nil)
        cancelNudge()
        if let ghost = ghost { Task { await ghost.end(nil, dismissalPolicy: .immediate) } }
        // And the Lock Screen is not the only mirror. The wrist holds the same
        // session until something tells it otherwise, so the verdict is shared.
        LiveStatePlugin.abandon()
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
// States: work · bodyweight · rest · held · paused · resume · timed · complex ·
// done · ghost
//   work        a loggable set with a weight: both dials and Log set
//   bodyweight  the same set with no weight: the reps dial alone
//   rest        a rest counting down
//   held        a rest paused with 23 s left (the rest's own pause, not the
//               session's)
//   paused      the SESSION paused 40 s ago: frozen elapsed, no button
//   resume      paused, then three seconds later the resumed state with
//               `startedAt` shifted forward by the pause — exercises the
//               request-then-end hand-over in `push`
// SPOTTER_LIVE_FIXTURE_REST=<seconds> sets the rest's length, default 60. Added
// to measure WHEN the rest-over flip lands: the system schedules the "mark
// stale" wake no sooner than 120 s after the update that set the stale date, so
// a 30 s rest and a 300 s rest answer that question differently and the answer
// is the whole behaviour of this feature.
// SPOTTER_LIVE_FIXTURE_ELAPSED=<seconds> sets how long ago the session started,
// default 1090, so the compact island can be photographed at 0:18 and at 12:34.
// (The minimal presentation cannot be reached from here: it needs a second
// app's Live Activity, and a second one of Spotter's does not count — the
// island shows one activity per app. Tried on the 17 Pro, 20 Sept.)
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
            let state = Self.fixture(name == "ghost" ? "rest" : name == "resume" ? "paused" : name)
            self.drive(state)
            // An alerting update is the only way to make the system show the
            // expanded presentation without a long press, which is the one
            // gesture this machine cannot perform. Production never alerts:
            // the rest-end nudge is a local notification precisely so the same
            // event is not announced twice (HIG, "Starting, updating, ending").
            if ProcessInfo.processInfo.environment["SPOTTER_LIVE_FIXTURE_ALERT"] != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.alertForShot(state) }
            }
            // Prove the nudge: dump what is actually pending, then drive a
            // state that is not that rest and dump again. Scheduling and
            // cancelling are the two halves that go wrong silently.
            if env["SPOTTER_LIVE_FIXTURE_NOTIFY"] != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { Self.dumpPending("after rest") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    self.drive(Self.fixture("work"))
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Self.dumpPending("after work") }
                }
            }
            if name == "ghost" {
                // The card stays; the engine's record of it does not.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    SharedStore.remove(key: SharedStore.Key.liveState)
                    NSLog("Spotter fixture: stored live-state wiped, card orphaned")
                }
            }
            if name == "resume" {
                // What the engine sends when the person resumes: an ordinary
                // work state whose start has moved forward by the length of
                // the pause, so the elapsed clock does not count the gap.
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    var resumed = Self.fixture("work")
                    let paused = state.pausedDate ?? Date()
                    let gap = Date().timeIntervalSince(paused)
                    resumed.startedAt = SpotterISO8601.string(state.startedDate.addingTimeInterval(gap))
                    NSLog("Spotter fixture: resume after %.0f s, startedAt %@ -> %@",
                          gap, state.startedAt, resumed.startedAt)
                    self.drive(resumed)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        let ids = Activity<WorkoutActivityAttributes>.activities
                            .map { $0.id + ":" + String(describing: $0.activityState) }
                        NSLog("Spotter fixture: activities after resume = %@", ids.joined(separator: ", "))
                    }
                }
            }
        }
    }

    private static func dumpPending(_ when: String) {
        UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
            if reqs.isEmpty {
                NSLog("SPOTTERNUDGE %@: pending=0", when)
                return
            }
            for r in reqs {
                let fire = (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
                NSLog("SPOTTERNUDGE %@: id=%@ title=%@ body=%@ fires=%@",
                      when, r.identifier, r.content.title, r.content.body,
                      fire.map { String(format: "%.0fs away", $0.timeIntervalSinceNow) } ?? "no date")
            }
        }
    }

    /// Force the expanded Dynamic Island open for a screenshot. Fixture only.
    private func alertForShot(_ state: LiveState) {
        guard let activity = activity else { return }
        let content = ActivityContent(state: WorkoutActivityAttributes.content(state,
                                                                              dialReps: dial.reps,
                                                                              dialWeight: dial.weight),
                                      staleDate: nil, relevanceScore: 100)
        let alert = AlertConfiguration(title: "Rest over",
                                       body: "Goblet Squat, set 3 of 3",
                                       sound: .default)
        Task { await activity.update(content, alertConfiguration: alert) }
    }

    /// Mirror what LiveStatePlugin.update does on the way past — persist, then
    /// fan out — so launch reconciliation sees what it would really see.
    private func drive(_ state: LiveState) {
        try? SharedStore.writeJSON(state, key: SharedStore.Key.liveState)
        update(state)
    }

    private static func fixture(_ name: String) -> LiveState {
        let env = ProcessInfo.processInfo.environment
        let elapsed = Double(env["SPOTTER_LIVE_FIXTURE_ELAPSED"] ?? "") ?? 1090
        let started = Date().addingTimeInterval(-elapsed)
        let seconds = Double(env["SPOTTER_LIVE_FIXTURE_REST"] ?? "") ?? 60
        let rest = LiveState.RestState(until: Date().addingTimeInterval(seconds).timeIntervalSince1970 * 1000,
                                       total: seconds * 1000, held: 0)
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
                              progress: LiveState.Progress(done: 4, total: 10),
                              dose: LiveState.Dose(reps: 10, weight: 24, unit: "kg", step: 2.5, loggable: true),
                              pausedAt: nil)
        switch name {
        case "bodyweight":
            state.exercise = "Push-up"
            state.weight = nil
            state.dose = LiveState.Dose(reps: 12, weight: nil, unit: "kg", step: 2.5, loggable: true)
        case "rest":
            state.phase = .rest
            state.set = LiveState.SetPosition(index: 3, total: 3)
            state.rest = rest
        case "held":
            state.phase = .rest
            state.set = LiveState.SetPosition(index: 3, total: 3)
            state.rest = LiveState.RestState(until: rest.until, total: rest.total, held: 23_000)
        case "paused":
            state.phase = .paused
            state.pausedAt = SpotterISO8601.string(Date().addingTimeInterval(-40))
        case "timed":
            state.phase = .timed
            state.exercise = "Plank"
            state.set = nil
            state.target = "40 s"
            state.weight = nil
            state.rest = LiveState.RestState(until: Date().addingTimeInterval(40).timeIntervalSince1970 * 1000,
                                             total: 40_000, held: 0)
            state.dose = LiveState.Dose(reps: nil, weight: nil, unit: "kg", step: 2.5, loggable: false)
        case "complex":
            state.phase = .complex
            state.exercise = "Kettlebell Swing"
            state.block = "Round 2"
            state.set = nil
            state.target = "12 reps"
            state.dose = LiveState.Dose(reps: 12, weight: 24, unit: "kg", step: 2.5, loggable: false)
        default:
            break
        }
        return state
    }
}
#endif
