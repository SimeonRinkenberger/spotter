import Foundation

/**
 * The contact-sheet arithmetic, and nothing else.
 *
 * Deliberately Foundation-only and free of AVFoundation and UIKit, for two
 * reasons: `tools/ios/sheet-check.mjs` compiles this one file against the macOS
 * SDK and asserts every number in it against `native/sheet-spec.json` (the same
 * trick `share-check.mjs` plays on SharedLink.swift), and the Share Extension
 * pays no import cost for the half of the work that is multiplication.
 *
 * Android's `SheetSpec.java` is a line-for-line mirror. If you change a number
 * here, change it there and in the JSON, or both harness checks fail — which is
 * the point of having three copies.
 */
enum SheetSpec {
    static let minFrames = 8
    static let maxFrames = 25
    static let secondsPerFrame = 3.5
    static let edgeInset = 0.5

    static let portrait = (w: 216, h: 384)
    static let landscape = (w: 384, h: 216)
    static let square = (w: 300, h: 300)
    static let squareBand = 0.05

    static let cols = 5
    static let gutter = 2

    static let labelFontSize = 14.0
    static let labelInset = 6.0
    static let labelPillAlpha = 0.6
    static let labelPillRadius = 6.0
    static let labelPadX = 6.0
    static let labelPadY = 3.0

    static let jpegQuality = 0.7
    static let jpegFallbackQuality = 0.6
    static let jpegMaxBytes = 614_400

    static let budgetMs = 8_000.0
    static let budgetBytes = 26_214_400

    static let contentType = "image/jpeg"

    /// One frame per 3.5 s, floored at 8 and capped at one 5x5 sheet.
    static func frameCount(duration: Double) -> Int {
        guard duration.isFinite, duration > 0 else { return minFrames }
        let wanted = Int(ceil(duration / secondsPerFrame))
        return min(maxFrames, max(minFrames, wanted))
    }

    /**
     * Uniform times from 0.5 s to duration - 0.5 s inclusive.
     *
     * A clip shorter than 2 s cannot hold that inset on both ends, so the span
     * collapses to the middle of the clip rather than asking the generator for a
     * negative time — an eight-frame sheet of the same instant is useless but
     * harmless, and a crash inside a share extension is neither.
     */
    static func times(duration raw: Double) -> [Double] {
        // Normalised once, here, so a header that could not be read (0, NaN)
        // behaves the same on both platforms instead of relying on each
        // language's opinion about max(0, NaN).
        let duration = raw.isFinite && raw > 0 ? raw : 0
        let n = frameCount(duration: duration)
        let first = min(edgeInset, max(0, duration / 2))
        let last = max(first, duration - edgeInset)
        let step = n > 1 ? (last - first) / Double(n - 1) : 0
        var out: [Double] = []
        out.reserveCapacity(n)
        for i in 0..<n { out.append(first + step * Double(i)) }
        return out
    }

    /// The fixed box a frame of these pixel dimensions is fitted into.
    static func cell(videoWidth: Double, videoHeight: Double) -> (w: Int, h: Int) {
        guard videoWidth > 0, videoHeight > 0 else { return portrait }
        let ratio = videoWidth / videoHeight
        if ratio > 1 + squareBand { return landscape }
        if ratio < 1 - squareBand { return portrait }
        return square
    }

    static func rows(count: Int) -> Int {
        max(1, Int(ceil(Double(max(1, count)) / Double(cols))))
    }

    /// Canvas size. No outer margin; gutters live between cells only.
    static func canvas(count: Int, cell: (w: Int, h: Int)) -> (w: Int, h: Int) {
        let r = rows(count: count)
        let c = min(cols, max(1, count))
        return (w: c * cell.w + (c - 1) * gutter,
                h: r * cell.h + (r - 1) * gutter)
    }

    /// Top-left of cell `index`, row-major, so reading order is time order.
    static func origin(index: Int, cell: (w: Int, h: Int)) -> (x: Int, y: Int) {
        let col = index % cols, row = index / cols
        return (x: col * (cell.w + gutter), y: row * (cell.h + gutter))
    }

    /**
     * Which of the frames that came back are worth a cell.
     *
     * The generator is allowed half a second of slack either way, so two
     * neighbouring requests can land on the same sync sample and hand back the
     * same picture twice. A duplicate cell is a wasted 216x384 of the model's
     * attention and would also make the `times` array stop ascending, which the
     * server rejects outright. Both problems die the same way: keep the first of
     * any pair closer together than `minGap`, drop the rest.
     *
     * Takes the times in arrival order, returns the indices to keep in time
     * order, so the caller can pick the matching images without re-sorting them.
     */
    static let minGap = 0.05

    static func keep(times: [Double]) -> [Int] {
        let order = times.indices.sorted { times[$0] == times[$1] ? $0 < $1 : times[$0] < times[$1] }
        var out: [Int] = []
        var last = -Double.greatestFiniteMagnitude
        for i in order where times[i].isFinite && times[i] >= 0 && times[i] - last >= minGap {
            out.append(i); last = times[i]
        }
        return out
    }

    /// `M:SS` of the frame's own time, which is what the server prompt reads.
    static func label(seconds: Double) -> String {
        let whole = max(0, Int((seconds.isFinite ? seconds : 0).rounded()))
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }

    /// `<uid>/pack/<shortcode>/sheet-<n>.jpg`, 1-based, per the server contract.
    static func objectPath(uid: String, shortcode: String, index: Int) -> String {
        "\(uid)/pack/\(shortcode)/sheet-\(index + 1).jpg"
    }
}
