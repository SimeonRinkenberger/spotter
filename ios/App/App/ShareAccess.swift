import Capacitor
import Foundation

@objc(ShareAccessPlugin)
public class ShareAccessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareAccessPlugin"
    public let jsName = "ShareAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "contactSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeParkedShare", returnType: CAPPluginReturnPromise)
    ]

    /// Where a signed-out share leaves its link: the store the app and the Share
    /// Extension both open, JSON `{url, at}`. The extension writes it; only this
    /// method reads it, and it removes what it reads.
    static let parkedShareKey = "spotter.parkedShare"

    /**
     * The link a signed-out share parked, taken out so it is saved exactly once.
     * Resolves empty when nothing is parked or what is parked does not decode —
     * the page's answer to both is the same: there is nothing to save.
     */
    @objc func takeParkedShare(_ call: CAPPluginCall) {
        let key = ShareAccessPlugin.parkedShareKey
        guard let data = try? SharedStore.read(key: key) else { call.resolve([:]); return }
        SharedStore.remove(key: key)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let url = object["url"] as? String, !url.isEmpty else { call.resolve([:]); return }
        var out: JSObject = ["url": url]
        if let at = object["at"] as? String { out["at"] = at }
        else if let at = object["at"] as? Double { out["at"] = at }
        call.resolve(out)
    }

    @objc func configure(_ call: CAPPluginCall) {
        let key = call.getString("key")
        if let key = key, key.range(of: "^[0-9a-f]{32}$", options: .regularExpression) == nil {
            call.reject("Invalid share credential"); return
        }
        do { try ShareCredential.write(key); call.resolve() }
        catch { call.reject("Could not prepare sharing. Open Spotter again to retry."); return }
        // The plan beside the key, so the Share Extension can tell without a round
        // trip whether this account could want frames with a save at all. A hint,
        // never an entitlement — the server decides — and it goes with the key.
        let plan = call.getString("plan")
        if let plan = plan, key != nil, plan.range(of: "^[a-z]{1,16}$", options: .regularExpression) != nil {
            try? SharedStore.writeJSON(PlanHint(plan: plan, at: Date().timeIntervalSince1970),
                                       key: ShareAccessPlugin.planHintKey)
        } else {
            SharedStore.remove(key: ShareAccessPlugin.planHintKey)
        }
    }

    /// `{plan, at}` beside the save key: "free", "plus", "pro" or "staff".
    struct PlanHint: Codable { let plan: String; let at: Double }
    static let planHintKey = "spotter.planHint"

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
