import Foundation
import Darwin

/**
 * Runs the REAL contact-sheet code — SheetSpec.swift, ContactSheet.swift and
 * TikTokMedia.swift, the same files both iOS targets compile — inside the iOS
 * Simulator, and reports what it cost.
 *
 * It exists because the three numbers the owner asked for (wall clock, peak
 * memory, JPEG bytes) cannot be had from a unit test on the Mac: UIKit's
 * renderer and AVFoundation's simulator decoders are what the phone will
 * actually use, and the Share Extension's memory ceiling is the whole reason the
 * builder is shaped the way it is. `tools/ios/sheet-probe.mjs` compiles this
 * against the iphonesimulator SDK and runs it with `simctl spawn`.
 *
 * Usage (inside the simulator):
 *   sheet-probe <out-dir> url  <tiktok watch page url>
 *   sheet-probe <out-dir> file <path to a local mp4>
 */

// phys_footprint is the number Xcode's memory gauge shows and the number jetsam
// kills an extension for, so it is the one worth sampling.
func footprint() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    return result == KERN_SUCCESS ? UInt64(info.phys_footprint) : 0
}

final class Peak: @unchecked Sendable {
    private(set) var bytes: UInt64 = 0
    private var running = true
    private let lock = NSLock()
    func start() {
        let thread = Thread { [self] in
            while true {
                lock.lock(); let go = running; lock.unlock()
                if !go { return }
                let now = footprint()
                lock.lock(); if now > bytes { bytes = now }; lock.unlock()
                usleep(5_000)
            }
        }
        thread.stackSize = 64 * 1024
        thread.start()
    }
    func stop() { lock.lock(); running = false; lock.unlock() }
}

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write(Data("usage: sheet-probe <out-dir> url|file <target>\n".utf8))
    exit(2)
}
let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
let mode = args[2], target = args[3]

let baseline = footprint()
let peak = Peak()
peak.start()

let done = DispatchSemaphore(value: 0)
var status: Int32 = 0

Task {
    defer { done.signal() }
    var report: [String: Any] = ["mode": mode, "target": target]
    let clock = Date()
    var mp4: URL
    var duration = 0.0
    var downloaded = 0

    do {
        if mode == "url" {
            guard let page = URL(string: target) else { throw ContactSheetError.noFrames }
            let config = URLSessionConfiguration.ephemeral
            let session = URLSession(configuration: config)
            let fetched = try await TikTokMedia.page(page, session: session)
            report["page_ms"] = Int(Date().timeIntervalSince(clock) * 1000)
            report["cookies"] = fetched.cookie.split(separator: ";").count
            guard let video = TikTokMedia.video(html: fetched.html, cookie: fetched.cookie) else {
                throw ContactSheetError.noFrames
            }
            report["play_addr_host"] = URL(string: video.playAddr.absoluteString)?.host ?? "?"
            report["duration_s"] = video.duration
            report["video_w"] = video.width
            report["video_h"] = video.height
            duration = video.duration
            let downloadStarted = Date()
            mp4 = try await TikTokMedia.download(video, cap: SheetSpec.budgetBytes,
                                                 deadline: Date().addingTimeInterval(60))
            downloaded = (try? FileManager.default.attributesOfItem(atPath: mp4.path)[.size] as? Int) ?? 0 ?? 0
            report["download_ms"] = Int(Date().timeIntervalSince(downloadStarted) * 1000)
            report["download_bytes"] = downloaded
        } else {
            mp4 = URL(fileURLWithPath: target)
        }

        let buildStarted = Date()
        let sheet = try await ContactSheetBuilder.build(
            mp4: mp4, duration: duration, deadline: Date().addingTimeInterval(600))
        report["build_ms"] = Int(Date().timeIntervalSince(buildStarted) * 1000)
        report["total_ms"] = Int(Date().timeIntervalSince(clock) * 1000)
        report["cell_w"] = sheet.cellW
        report["cell_h"] = sheet.cellH
        report["requested"] = sheet.requested
        report["duration_measured_s"] = sheet.duration

        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        var pages: [[String: Any]] = []
        for (index, page) in sheet.pages.enumerated() {
            let file = outDir.appendingPathComponent("sheet-\(index + 1).jpg")
            try page.jpeg.write(to: file)
            pages.append(["path": file.path, "bytes": page.jpeg.count, "cols": page.cols,
                          "rows": page.rows, "cells": page.times.count,
                          "times": page.times.map { (($0 * 100).rounded()) / 100 }])
        }
        report["sheets"] = pages
        report["kept"] = sheet.pages.reduce(0) { $0 + $1.times.count }
        if mode == "url" { try? FileManager.default.removeItem(at: mp4) }
    } catch {
        report["error"] = String(describing: error)
        status = 1
    }

    peak.stop()
    usleep(20_000)
    report["baseline_bytes"] = baseline
    report["peak_bytes"] = peak.bytes
    report["peak_over_baseline_bytes"] = peak.bytes > baseline ? peak.bytes - baseline : 0
    let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

done.wait()
exit(status)
