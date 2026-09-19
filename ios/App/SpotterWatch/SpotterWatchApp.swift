import SwiftUI

// The watch app, as a shell with the session already open.
//
// Single-target watchOS app (Xcode 14 style): no separate WatchKit extension,
// no storyboard, one bundle embedded in the phone app's Watch folder. The watch
// agent builds the running-session interface inside it.
//
// Activation happens in init rather than on the first view's appearance, because
// WatchConnectivity only delivers the context the phone left waiting once the
// session is active, and a wrist that is raised straight into a running workout
// should already have the state by the time it draws.
@main
struct SpotterWatchApp: App {
    init() {
        WatchLink.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
