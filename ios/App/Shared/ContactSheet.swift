import AVFoundation
import UIKit

/**
 * The phone cuts the frames.
 *
 * Up to three JPEG grids of timestamped stills are what the reader (Luna) gets
 * instead of a video, and cutting them here costs nothing: AVAssetImageGenerator
 * on a local file runs at roughly 12-64 ms a frame, so thirty-six frames are
 * about a second of the phone's own time and zero cents of anybody's API budget.
 *
 * Two constraints shape every decision below, and both come from the Share
 * Extension rather than the app: an app extension is killed somewhere around 120
 * MB, and it has no time to spare. So `maximumSize` makes AVFoundation decode
 * straight down to cell size — a full 1080x1920 frame is never held — and a sheet
 * is drawn and encoded the moment its twelve cells are full, which means peak
 * memory is twelve frames and one canvas (about 12 MB) rather than all
 * thirty-six. Everything gives up politely at the deadline rather than trying
 * harder, and whatever sheets are already finished go with the save.
 *
 * Shared verbatim by the extension and by the in-app plugin; `SheetSpec` holds
 * every number and is mirrored on Android.
 */

struct SheetPage {
    let jpeg: Data
    let times: [Double]
    let cols: Int
    let rows: Int
}

struct ContactSheetResult {
    let pages: [SheetPage]
    let cellW: Int
    let cellH: Int
    /// Frames asked for, so a caller can log how much of the clip it actually saw.
    let requested: Int
    let duration: Double
}

enum ContactSheetError: Error {
    case noVideoTrack
    case noFrames
    case encodeFailed
}

enum ContactSheetBuilder {
    /// Below this, a sheet says less than nothing — better to save without frames
    /// and let the server decide whether to spend a Gemini read on the video.
    static let minUsableFrames = 4

    static func build(mp4: URL, duration hinted: Double, deadline: Date) async throws -> ContactSheetResult {
        let asset = AVURLAsset(url: mp4, options: [AVURLAssetPreferPreciseDurationAndTimingKey: false])
        let (display, measured) = try await describe(asset)
        let duration = hinted > 0 ? hinted : measured
        let cell = SheetSpec.cell(videoWidth: display.width, videoHeight: display.height)
        let wanted = SheetSpec.times(duration: duration)

        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: cell.w, height: cell.h)
        // Half a second of slack turns "decode from the last keyframe forward" into
        // "hand me the nearest keyframe", which is the whole difference between 12
        // ms and 200 ms a frame. What the model is told is the time it actually got.
        let slack = CMTime(seconds: SheetSpec.edgeInset, preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = slack
        generator.requestedTimeToleranceAfter = slack

        var pages: [SheetPage] = []
        var chunk: [(time: Double, image: CGImage)] = []
        var last = -Double.greatestFiniteMagnitude
        var kept = 0

        // Twelve cells make a sheet; the sheet is drawn and the frames released
        // before the next twelve are asked for.
        func flush() throws {
            guard !chunk.isEmpty, pages.count < SheetSpec.maxSheets else { chunk = []; return }
            pages.append(try render(frames: chunk, cell: cell))
            chunk = []
        }
        func take(_ time: Double, _ image: CGImage) throws -> Bool {
            guard SheetSpec.accepts(time, after: last) else { return true }
            chunk.append((time, image)); last = time; kept += 1
            if chunk.count == SheetSpec.cellsPerSheet { try flush() }
            return pages.count < SheetSpec.maxSheets
        }

        if #available(iOS 16.0, *) {
            let times = wanted.map { CMTime(seconds: $0, preferredTimescale: 600) }
            for await result in generator.images(for: times) {
                if case let .success(_, image, actual) = result {
                    if try !take(actual.seconds, image) { break }
                }
                // The budget is the user's patience, not a correctness property:
                // whatever has arrived by now is the sheet, and the rest is dropped.
                if Date() >= deadline { break }
            }
            generator.cancelAllCGImageGeneration()
        } else {
            for frame in await legacyImages(generator: generator, times: wanted, deadline: deadline) {
                if try !take(frame.time, frame.image) { break }
            }
        }
        try flush()

        guard kept >= minUsableFrames, !pages.isEmpty else { throw ContactSheetError.noFrames }
        return ContactSheetResult(pages: pages, cellW: cell.w, cellH: cell.h,
                                  requested: wanted.count, duration: duration)
    }

    // MARK: - drawing

    private static func render(frames: [(time: Double, image: CGImage)],
                               cell: (w: Int, h: Int)) throws -> SheetPage {
        let canvas = SheetSpec.canvas(count: frames.count, cell: cell)
        let format = UIGraphicsImageRendererFormat.default()
        // scale 1 because these are pixels for a model, not points for a screen;
        // at scale 3 the same sheet would be nine times the memory and no more
        // information. Opaque and standard-range for the same reason: no alpha
        // channel and no wide-gamut buffer to carry through the encode.
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard

        let size = CGSize(width: canvas.w, height: canvas.h)
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: SheetSpec.labelFontSize, weight: .bold),
            .foregroundColor: UIColor.white
        ]

        let draw: (UIGraphicsImageRendererContext) -> Void = { context in
            // Black under everything: the gutters, the bars beside an aspect-fitted
            // frame, and any cell the last row does not reach.
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))

            for (index, frame) in frames.enumerated() {
                let slot = SheetSpec.frame(index: index, cell: cell)
                let box = CGRect(x: slot.x, y: slot.y, width: slot.w, height: slot.h)
                let w = CGFloat(frame.image.width), h = CGFloat(frame.image.height)
                if w > 0, h > 0 {
                    // Fit, never fill. A crop is exactly where the second kettlebell
                    // at the edge of the frame would have gone missing.
                    let scale = min(box.width / w, box.height / h)
                    let fitted = CGRect(x: box.midX - w * scale / 2, y: box.midY - h * scale / 2,
                                        width: w * scale, height: h * scale)
                    UIImage(cgImage: frame.image).draw(in: fitted)
                }

                let text = SheetSpec.label(seconds: frame.time) as NSString
                let measured = text.size(withAttributes: attributes)
                let pill = CGRect(
                    x: box.minX + SheetSpec.labelInset,
                    y: box.maxY - SheetSpec.labelInset - measured.height - SheetSpec.labelPadY * 2,
                    width: measured.width + SheetSpec.labelPadX * 2,
                    height: measured.height + SheetSpec.labelPadY * 2)
                UIColor(white: 0, alpha: SheetSpec.labelPillAlpha).setFill()
                UIBezierPath(roundedRect: pill, cornerRadius: SheetSpec.labelPillRadius).fill()
                text.draw(at: CGPoint(x: pill.minX + SheetSpec.labelPadX, y: pill.minY + SheetSpec.labelPadY),
                          withAttributes: attributes)
            }
        }

        var data = renderer.jpegData(withCompressionQuality: SheetSpec.jpegQuality, actions: draw)
        // One retry, not a search: a second encode is another full pass over a
        // megapixel and a half, and the frames are best-effort anyway.
        if data.count > SheetSpec.jpegMaxBytes {
            data = renderer.jpegData(withCompressionQuality: SheetSpec.jpegFallbackQuality, actions: draw)
        }
        guard !data.isEmpty else { throw ContactSheetError.encodeFailed }
        return SheetPage(jpeg: data, times: frames.map(\.time),
                         cols: min(SheetSpec.cols, frames.count),
                         rows: SheetSpec.rows(count: frames.count))
    }

    // MARK: - asset facts

    /// Display size after the track's rotation, and the duration, on both OS eras.
    private static func describe(_ asset: AVURLAsset) async throws -> (CGSize, Double) {
        if #available(iOS 16.0, *) {
            guard let track = try await asset.loadTracks(withMediaType: .video).first else {
                throw ContactSheetError.noVideoTrack
            }
            let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
            let duration = try await asset.load(.duration)
            return (natural.applying(transform).absolute, duration.seconds)
        }
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw ContactSheetError.noVideoTrack
        }
        return (track.naturalSize.applying(track.preferredTransform).absolute, asset.duration.seconds)
    }

    /**
     * iOS 15 has no `images(for:)`; the callback form does the same job, at the
     * cost of holding every frame at once — which is why it is the fallback and
     * not the path. iOS 16 shipped in 2022; almost nobody arrives here.
     */
    private static func legacyImages(generator: AVAssetImageGenerator, times: [Double],
                                     deadline: Date) async -> [(time: Double, image: CGImage)] {
        let values = times.map { NSValue(time: CMTime(seconds: $0, preferredTimescale: 600)) }
        return await withCheckedContinuation { continuation in
            var collected: [(time: Double, image: CGImage)] = []
            var remaining = values.count
            var resumed = false
            let lock = NSLock()
            generator.generateCGImagesAsynchronously(forTimes: values) { _, image, actual, _, _ in
                lock.lock()
                if let image = image { collected.append((actual.seconds, image)) }
                remaining -= 1
                let finish = (remaining <= 0 || Date() >= deadline) && !resumed
                if finish { resumed = true }
                let out = collected.sorted { $0.time < $1.time }
                lock.unlock()
                if finish {
                    generator.cancelAllCGImageGeneration()
                    continuation.resume(returning: out)
                }
            }
        }
    }
}

private extension CGSize {
    /// A 90-degree preferredTransform flips a size negative; only magnitude matters.
    var absolute: CGSize { CGSize(width: abs(width), height: abs(height)) }
}
