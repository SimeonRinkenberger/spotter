import Capacitor
import Foundation

@objc(ShareAccessPlugin)
public class ShareAccessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareAccessPlugin"
    public let jsName = "ShareAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "contactSheet", returnType: CAPPluginReturnPromise)
    ]

    @objc func configure(_ call: CAPPluginCall) {
        let key = call.getString("key")
        if let key = key, key.range(of: "^[0-9a-f]{32}$", options: .regularExpression) == nil {
            call.reject("Invalid share credential"); return
        }
        do { try ShareCredential.write(key); call.resolve() }
        catch { call.reject("Could not prepare sharing. Open Spotter again to retry.") }
    }

    /**
     * Cut frames for a save happening inside the app.
     *
     * The same `SheetPipeline` the Share Extension runs, with the one difference
     * that matters: in here there is a signed-in Supabase session, so the sheet is
     * authorised and uploaded as the user rather than through the extension's save
     * key. The page never sees the JPEG — only the `frames` block to add to its
     * own ingest body — which keeps a 600 KB image off the JavaScript bridge.
     *
     * Resolves with `ok: false` rather than rejecting when the phone could not cut
     * frames. It is not an error: it is the ordinary answer for a private video, a
     * CDN that moved, a slow connection, or a link that is not TikTok, and the
     * caller's response to every one of those is the same — save without frames.
     */
    @objc func contactSheet(_ call: CAPPluginCall) {
        let token = call.getString("token") ?? ""
        guard !token.isEmpty else { call.resolve(["ok": false, "reason": "no-session"]); return }
        let uid = call.getString("uid")
        let shortcode = call.getString("shortcode") ?? ""
        let html = call.getString("html")
        let file = call.getString("path") ?? ""
        let link = URL(string: call.getString("url") ?? "")
        // The page may shorten the budget (it knows how long the user has been
        // staring at a spinner) but may not extend it past half a minute.
        let budget = min(call.getDouble("timeout") ?? SheetSpec.budgetMs, 30_000)
        let deadline = Date().addingTimeInterval(budget / 1000)

        Task {
            var outcome: SheetOutcome?
            if !file.isEmpty, !shortcode.isEmpty {
                let url = URL(fileURLWithPath: file)
                outcome = await SheetPipeline.runLocal(file: url, shortcode: shortcode, uid: uid,
                                                       auth: .bearer(token), deadline: deadline)
                // A file the page handed over for this purpose is ours to clean up.
                try? FileManager.default.removeItem(at: url)
            } else if let link = link {
                outcome = await SheetPipeline.run(pageURL: link, html: html, uid: uid,
                                                  auth: .bearer(token), deadline: deadline)
            }
            guard let sheet = outcome else { call.resolve(["ok": false, "reason": "no-frames"]); return }
            call.resolve([
                "ok": true,
                "frames": [
                    "source": "device",
                    "duration_s": sheet.durationS,
                    "sheets": [[
                        "path": sheet.path, "cols": sheet.cols, "rows": sheet.rows,
                        "cell_w": sheet.cellW, "cell_h": sheet.cellH, "times": sheet.times
                    ] as JSObject]
                ] as JSObject,
                "bytes": sheet.bytes,
                "ms": sheet.milliseconds,
                "kept": sheet.times.count,
                "requested": sheet.framesRequested
            ])
        }
    }
}
