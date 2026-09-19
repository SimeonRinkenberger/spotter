import SwiftUI

// What the watch says when there is nothing to mirror.
//
// D replaces this with the running session (movement, set, rest ring, log and
// skip). It stays as the idle state underneath: a watch app that opens to a
// blank screen reads as broken, and the honest answer — the session starts on
// the phone — is one short sentence.
//
// Colours come from WidgetTheme's dark column, which is the palette the app
// already uses on dark surfaces; watchOS has no light appearance to switch to.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(WidgetTheme.ember)
            Text("Open Spotter on your iPhone to start a workout.")
                .font(WidgetTheme.display(14, weight: .medium))
                .foregroundStyle(WidgetTheme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WidgetTheme.paper.ignoresSafeArea())
    }
}

#Preview {
    ContentView()
}
