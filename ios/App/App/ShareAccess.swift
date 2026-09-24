import Capacitor
import Foundation

@objc(ShareAccessPlugin)
public class ShareAccessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareAccessPlugin"
    public let jsName = "ShareAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "contactSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeParked", returnType: CAPPluginReturnPromise)
    ]

    /// `plan` is optional and only a hint for the Share Extension (see
    /// ShareCredential.writePlan). A call without it leaves the stored hint as it
    /// was; signing out (no key) clears both, so the next account starts clean.
    @objc func configure(_ call: CAPPluginCall) {
        let key = call.getString("key")
        if let key = key, key.range(of: "^[0-9a-f]{32}$", options: .regularExpression) == nil {
            call.reject("Invalid share credential"); return
        }
        let plan = call.getString("plan").flatMap { $0.range(of: "^[a-z_]{1,24}$", options: .regularExpression) == nil ? nil : $0 }
        do {
            try ShareCredential.write(key)
            if key == nil { try? ShareCredential.writePlan(nil) }
            else if let plan = plan { try? ShareCredential.writePlan(plan) }
            call.resolve()
        }
        catch { call.reject("Could not prepare sharing. Open Spotter again to retry.") }
    }

    /**
     * One link the Share Extension parked while nobody was signed in, removed
     * as it is handed over: `{url, at}` (at = ms since 1970), or `{}` when there
     * is none. The page calls this after sign-in and again until it answers `{}`,
     * saving each link the way a share would.
     */
    @objc func takeParked(_ call: CAPPluginCall) {
        guard let item = ParkedShare.take() else { call.resolve([:]); return }
        call.resolve(["url": item.url, "at": item.at])
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
                outcome = await SheetPipeline.runLocal(file: url, shortcode: shortcode,
                                                       auth: .bearer(token), deadline: deadline)
                // A file the page handed over for this purpose is ours to clean up.
                try? FileManager.default.removeItem(at: url)
            } else if let link = link {
                outcome = await SheetPipeline.run(pageURL: link, html: html,
                                                  auth: .bearer(token), deadline: deadline)
            }
            guard let sheet = outcome else { call.resolve(["ok": false, "reason": "no-frames"]); return }
            let sheets: [JSObject] = sheet.sheets.map { page in
                ["path": page.path, "cols": page.cols, "rows": page.rows,
                 "cell_w": page.cellW, "cell_h": page.cellH, "times": page.times]
            }
            call.resolve([
                "ok": true,
                "frames": [
                    "source": "device",
                    "duration_s": sheet.durationS,
                    "sheets": sheets
                ] as JSObject,
                "bytes": sheet.bytes,
                "ms": sheet.milliseconds,
                "kept": sheet.framesKept,
                "requested": sheet.framesRequested
            ])
        }
    }
}
