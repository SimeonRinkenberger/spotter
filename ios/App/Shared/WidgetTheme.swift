import SwiftUI

#if canImport(UIKit) && !os(watchOS)
import UIKit
#endif

// Spotter's stylesheet, ported to the surfaces that cannot load a stylesheet.
//
// The values are copied verbatim from the `:root` block in
// supabase/functions/spotter/style.ts and its prefers-color-scheme: dark
// override. They are duplicated rather than derived because a widget extension
// has no access to the web bundle, and drifting by a few percent is exactly how
// a Home Screen widget starts looking like a different app than the one behind
// it. If a token changes in style.ts, change it here in the same commit.
//
// Two platform facts shape this file:
//
//   - A widget follows the system appearance, so every colour is a dynamic
//     UIColor that resolves per trait collection rather than a fixed value
//     picked at build time.
//   - watchOS has one appearance (dark) and no dynamic-provider UIColor, so it
//     takes the dark column directly. That is not a compromise: the watch face
//     is always dark, and the dark column is the palette that was designed for
//     dark surfaces.
//
// Typography is SF, not Cabinet Grotesk + Inter. An extension cannot fetch a
// webfont and bundling Fontshare into every target is weight for a surface that
// shows six words. SF Pro at semibold is the closest honest match for the
// display face; .rounded with monospaced digits is used for anything that
// counts, so a timer does not jitter as its glyphs change width.
enum WidgetTheme {
    private struct Swatch {
        let r: Double, g: Double, b: Double, a: Double

        init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
            self.r = r / 255
            self.g = g / 255
            self.b = b / 255
            self.a = a
        }
    }

    private static func dual(_ light: Swatch, _ dark: Swatch) -> Color {
        #if os(watchOS)
        return Color(.sRGB, red: dark.r, green: dark.g, blue: dark.b, opacity: dark.a)
        #else
        return Color(uiColor: UIColor { traits in
            let s = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: s.r, green: s.g, blue: s.b, alpha: s.a)
        })
        #endif
    }

    // MARK: - Surfaces

    /// --paper: the page behind everything.
    static let paper = dual(Swatch(245, 246, 248), Swatch(16, 18, 20))
    /// --card: a raised surface on paper.
    static let card = dual(Swatch(255, 255, 255), Swatch(25, 29, 33))
    /// --sand: a recessed surface — fields, tracks, empty slots.
    static let sand = dual(Swatch(233, 236, 241), Swatch(35, 41, 49))

    // MARK: - Text

    /// --ink: primary text.
    static let ink = dual(Swatch(20, 23, 26), Swatch(238, 242, 246))
    /// --ink-2: secondary text, still comfortably readable.
    static let ink2 = dual(Swatch(88, 98, 110), Swatch(175, 186, 198))
    /// --muted: small print. AA on paper at the sizes it is used.
    static let muted = dual(Swatch(104, 114, 126), Swatch(124, 135, 148))

    // MARK: - Rules

    /// --line: hairline separators.
    static let line = dual(Swatch(20, 23, 26, 0.09), Swatch(238, 242, 246, 0.10))
    /// --line-2: a border that is meant to be seen.
    static let line2 = dual(Swatch(20, 23, 26, 0.18), Swatch(238, 242, 246, 0.19))

    // MARK: - Ember

    /// --ember: every fill, glow and lit muscle in the app is made of this.
    static let ember = dual(Swatch(232, 85, 31), Swatch(255, 122, 69))
    /// --ember-ink: ember as text, dark enough to read on paper.
    static let emberInk = dual(Swatch(190, 63, 14), Swatch(255, 145, 102))
    /// --ember-soft: ember as a background wash.
    static let emberSoft = dual(Swatch(253, 237, 230), Swatch(51, 25, 15))
    /// --on-ember: text and glyphs sitting on an ember fill.
    static let onEmber = dual(Swatch(23, 16, 12), Swatch(23, 16, 12))
    /// --good: the one non-ember accent, for a met goal.
    static let good = dual(Swatch(23, 128, 85), Swatch(63, 208, 150))

    // MARK: - Type

    /// Movement names, workout titles, anything that carries the screen.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight)
    }

    /// Anything that counts: timers, set positions, week totals. Monospaced
    /// digits keep a running number from shifting the layout every tick.
    static func numeral(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }

    /// Labels above a number — small, wide, quiet. The app's `.count` style.
    static func label(_ size: CGFloat = 10.5) -> Font {
        .system(size: size, weight: .bold)
    }
}
