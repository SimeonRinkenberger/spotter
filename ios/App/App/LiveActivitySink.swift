import ActivityKit
import Foundation
import UIKit

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

    /// Intents holding their `perform()` open for the engine's answer, by
    /// their own timeout ticket. Resolved in `flush()` when a state from the
    /// engine goes out, or by the ticket when it does not. Main thread only.
    private var settling: [UUID: CheckedContinuation<Void, Never>] = [:]

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
    /// already awake) when the tap arrives, and — measured on the 17 Pro, 21
    /// Sept — so is its WKWebView: the engine answered a Next move 50 ms after
    /// the tap, inside the ~100 ms the system keeps the process up for the
    /// intent. That window is why `perform()` waits on `settle` and why
    /// `update(_:)` never coalesces in the background. The action is still
    /// delivered with `retainUntilConsumed: true`, so an engine that was not
    /// there to hear it (a web view mid-reload, a boot) applies it for real
    /// when it wakes; the two can only disagree about *when*, never about
    /// *what*. Until then the card would sit on a rest it has already been
    /// told to end, so it is corrected here.
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
        LiveActionRouter.settler = { [weak self] seconds in
            await self?.settle(within: seconds)
        }
        LiveActionRouter.typist = { [weak self] field in
            self?.type(field)
        }
    }

    /// A tap on a dial figure: the phone opens (the intent's `openAppWhenRun`)
    /// and this hands the engine the link that opens the set sheet on that
    /// field with the dial's figures in it — `spotter://set/weight?reps=6&
    /// weight=55`. Delivered as a routed link, exactly as a tapped reminder's
    /// `url` is, so it goes through `openLink()` → `openDeepLink()` →
    /// `openSetLink()` in app.ts and is retained until the web view is
    /// listening. The figures are the dial's if it was turned, the prefill's
    /// otherwise: whatever the card was showing. Only digits and a dot ever
    /// go in the query.
    private func type(_ field: DialField) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let state = self.current ?? LiveStatePlugin.latest else { return }
            let dose = state.dose
            var query = "reps=" + String(self.dial.reps ?? dose?.reps ?? 0)
            if let weight = self.dial.weight ?? dose?.weight {
                query += "&weight=" + (weight == weight.rounded() ? String(Int(weight)) : String(format: "%.1f", weight))
            }
            let url = "spotter://set/" + field.rawValue + "?" + query
            #if DEBUG
            NSLog("Spotter Live Activity: type %@ -> %@", field.rawValue, url)
            #endif
            LiveStatePlugin.deliver(LiveAction(kind: .notification, source: .activity, id: url))
        }
    }

    /// Hold an intent's `perform()` open until the engine's answer has been
    /// pushed to the card, or `seconds` have passed — whichever is first.
    ///
    /// The system wakes the app for a Lock Screen tap and suspends it again
    /// about 100 ms after `perform()` returns (measured, 21 Sept). The web
    /// engine answers inside that window, but its state arrived at the sink
    /// after the optimistic push and was coalesced a second into a future the
    /// process did not have; it went out on the NEXT tap. Waiting here is
    /// what buys the round trip its second: the intent is still running, so
    /// the process is still awake, until `flush()` resolves the ticket. The
    /// timeout is the bound for an engine that never answers — a session
    /// nobody is signed into, an action the phone drops as off-screen.
    private func settle(within seconds: TimeInterval) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            // Work items rather than closures: a closure handed to
            // DispatchQueue from an async context is @Sendable, and this
            // class is not.
            let file = DispatchWorkItem { [weak self] in
                guard let self = self else { continuation.resume(); return }
                self.hold(continuation, for: seconds)
            }
            DispatchQueue.main.async(execute: file)
        }
    }

    /// Main thread: file the continuation under a ticket that expires.
    private func hold(_ continuation: CheckedContinuation<Void, Never>, for seconds: TimeInterval) {
        let ticket = UUID()
        settling[ticket] = continuation
        let expire = DispatchWorkItem { [weak self] in
            self?.settling.removeValue(forKey: ticket)?.resume()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: expire)
    }

    /// The engine has spoken and the card has it: let every waiting intent go.
    private func settled() {
        let waiting = settling
        settling = [:]
        for continuation in waiting.values { continuation.resume() }
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
            case .mark, .round:
                // The complex's counter, stepped the way the phone steps it
                // (`Complex.count`): a mark that completes the round is the
                // round, and either starts the cap under the thumb the way
                // `cxGo()` starts it on the phone. Applied to `current`, so a
                // second tap before the engine answers stacks on the first
                // rather than repeating it. The engine's own state lands a
                // moment later and wins, as with `.set` — and it is the only
                // thing that can name the next movement, which a card that
                // knows one name cannot.
                guard state.phase == .complex, var complex = state.complex else { return }
                complex.count(action.kind)
                state.complex = complex
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

        // The coalescer is for the foreground, where one thumb makes three
        // states a second and ActivityKit charges for each. In the background
        // there is no burst — a state arriving there is the engine answering
        // a Lock Screen or wrist tap inside the ~100 ms the system keeps the
        // process awake for it — and a timer set for a second from now fires
        // on the next wake, which is the next tap (measured, 21 Sept: a Next
        // move's own state reached the card only when Round done was pressed).
        // So while the app is not in front, every state goes out at once.
        let awake = UIApplication.shared.applicationState == .active
        let since = Date().timeIntervalSince(lastPush)
        if phaseChanged || since >= 1 || !awake {
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
        // A state from the engine: once the card has it, the intents waiting
        // for it can return and the process can sleep. Only here — an
        // optimistic push must not release an intent that is waiting for the
        // engine to answer that very tap.
        push(state) { [weak self] in self?.settled() }
    }

    /// `done` runs on the main thread once ActivityKit has been handed the
    /// frame (or refused it), whichever branch the state took.
    private func push(_ state: LiveState, done: (() -> Void)? = nil) {
        let finished = { if let done = done { DispatchQueue.main.async(execute: done) } }
        // A phone with Live Activities switched off in Settings is a supported
        // configuration, not an error: the rest of the app works, and the nudge
        // above still fires.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { finished(); return }

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
                    Task { await activity.end(nil, dismissalPolicy: .immediate); finished() }
                } catch {
                    NSLog("Spotter Live Activity: could not replace on resume — %@", String(describing: error))
                    Task { await activity.update(content); finished() }
                }
                return
            }
            Task { await activity.update(content); finished() }
            return
        }

        // Nothing running. A finished session must not raise a card nobody will
        // ever see end, and `request` is only legal from the foreground — which
        // is the only place this is ever called from, because the only caller is
        // a JavaScript bridge call.
        guard state.phase != .done else { finished(); return }
        let (attributes, _) = WorkoutActivityAttributes.from(state)
        do {
            activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
        } catch {
            NSLog("Spotter Live Activity: could not start — %@", String(describing: error))
        }
        finished()
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
    ///
    /// A complex's cap, while it runs, is a rest's deadline all over again:
    /// nothing native runs at the instant it reaches zero, so the deadline is
    /// the stale date and the widget's stale branch draws "Time" — the same
    /// flip, the same 120 s system floor, the same reasoning. What a cap does
    /// NOT get is the rest-end nudge (`syncNudge` only ever schedules for
    /// `phase == .rest`): the phone's own tone at zero is `cxTick()`'s job,
    /// a cap ending is not a cue to lift again, and the one notification this
    /// app posts is named "Rest over" with the next set in its body — sharing
    /// it with a cap would be a banner that said the wrong thing loudly.
    private static func staleDate(for state: LiveState) -> Date {
        if state.phase == .paused {
            return Date().addingTimeInterval(8 * 60 * 60)
        }
        if state.phase == .complex, let complex = state.complex, complex.isRunning {
            return max(complex.deadline, Date().addingTimeInterval(1))
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
            // Time Sensitive, and this is the only notification in the app
            // that is: the gym is exactly where a Fitness or Do Not Disturb
            // Focus is on, and a rest ending under a Focus was delivered
            // silently — "it should vibrate the phone and buzz the watch
            // when the rest is up" (owner, 20 Sept). The reminders stay at
            // the ordinary level; nothing about "plan day" is urgent.
            NotificationsHost.shared.schedule(id: Self.nudgeID,
                                              title: "Rest over",
                                              body: body,
                                              at: deadline,
                                              timeSensitive: true)
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
// States: work · bodyweight · zero · rest · held · paused · resume · timed ·
// complex · complexIdle · complexHeld · complexOver · complexCounted · done · ghost
//   work        a loggable set with a weight: both dials and Log set
//   bodyweight  the same set with no weight: the reps dial alone
//   zero        the same set from the current engine, never loaded: the
//               weight dial on 0, as the phone's sheet opens it
//   rest        a rest counting down
//   held        a rest paused with 23 s left (the rest's own pause, not the
//               session's)
//   paused      the SESSION paused 40 s ago: frozen elapsed, no button
//   resume      paused, then three seconds later the resumed state with
//               `startedAt` shifted forward by the pause — exercises the
//               request-then-end hand-over in `push`
//   complex     a complex mid-round — 2 rounds + 1 movement — with the cap
//               running (SPOTTER_LIVE_FIXTURE_REST is the seconds left, so
//               the "Time" flip can be measured like the rest-over one)
//   complexIdle the same complex before the clock was started: 0 rounds,
//               the full cap static, Next move / Round 1 done
//   complexHeld the cap paused with 4:10 left
//   complexOver the cap ran out: 3 rounds + 2 movements, "Time"
//   complexCounted  a complex with no clock at all: elapsed instead
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
        case "zero":
            // What the engine sends since 21 Sept for a movement never loaded:
            // no display weight, and a dose whose weight is 0 rather than null.
            state.weight = nil
            state.dose = LiveState.Dose(reps: 10, weight: 0, unit: "kg", step: 2.5, loggable: true)
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
        case "complex", "complexIdle", "complexHeld", "complexOver", "complexCounted":
            // Complex Fives, as the engine describes it: five movements, a
            // fifteen-minute cap, the round up to its second movement. The
            // block is nil because the card has one block, as the real one
            // does; `target` and `weight` are the block's first movement's,
            // which is the engine's shape and why the card does not print
            // them on a complex.
            state.title = "Complex Fives"
            state.phase = .complex
            state.exercise = "Kettlebell Swing"
            state.block = nil
            state.set = nil
            state.target = "5 reps"
            state.next = nil
            state.progress = LiveState.Progress(done: 11, total: 15)
            state.dose = LiveState.Dose(reps: 5, weight: 24, unit: "kg", step: 2.5, loggable: false)
            var complex = LiveState.Complex(rounds: 2, marked: 1, moves: 5, move: "Kettlebell Swing",
                                            cap: 15 * 60 * 1000, until: 0, held: 0, over: false)
            switch name {
            case "complexIdle":
                complex.rounds = 0
                complex.marked = 0
                complex.move = "Deadlift"
                state.exercise = "Deadlift"
                state.progress = LiveState.Progress(done: 0, total: 15)
            case "complexHeld":
                complex.held = 250_000
            case "complexOver":
                complex.rounds = 3
                complex.marked = 2
                complex.over = true
                state.progress = LiveState.Progress(done: 17, total: 17)
            case "complexCounted":
                complex.cap = 0
            default:
                complex.until = rest.until
            }
            state.complex = complex
        default:
            break
        }
        return state
    }
}
#endif
