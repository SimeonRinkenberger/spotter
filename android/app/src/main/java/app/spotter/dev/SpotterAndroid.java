package app.spotter.dev;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.*;

@CapacitorPlugin(name = "SpotterAndroid")
public class SpotterAndroid extends Plugin {
    private String pending;
    private boolean ready;
    // Frame cutting is seconds of decoding. ANR is five seconds of blocked input,
    // so it never goes near the main thread; one thread because two saves at once
    // would only fight over the same decoder.
    private final ExecutorService sheets = Executors.newSingleThreadExecutor();
    @Override public void load() { capture(getActivity().getIntent()); }
    private void capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.length() > 100000) return;
        Matcher match = Pattern.compile("https?://[^\\s\"'<>]+").matcher(text);
        if (!match.find()) return;
        String url = match.group().replaceAll("[.,;:!?)\\]]+$", "");
        if (url.length() > 8192) return;
        intent.setAction(null); intent.removeExtra(Intent.EXTRA_TEXT);
        if (ready) notifyListeners("sharedUrl", new JSObject().put("url", url), true);
        else pending = url;
    }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent); }
    @PluginMethod public void takeShare(PluginCall call) {
        ready = true;
        JSObject result = new JSObject(); if (pending != null) result.put("url", pending);
        pending = null; call.resolve(result);
    }
    @PluginMethod public void background(PluginCall call) {
        getActivity().runOnUiThread(() -> { getActivity().moveTaskToBack(true); call.resolve(); });
    }

    /**
     * Cut frames for a save and hand back the `frames` block to put in its body.
     *
     * Resolves with ok:false rather than rejecting when the phone could not cut
     * them. That is not an error — it is the ordinary answer for a private video,
     * a CDN that moved, a slow connection or a link that is not TikTok — and the
     * caller's response to every one of those is the same: save without frames.
     * The JPEG itself never crosses the bridge; only the block that names it.
     */
    @PluginMethod public void contactSheet(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty()) { call.resolve(new JSObject().put("ok", false).put("reason", "no-session")); return; }
        String url = call.getString("url", "");
        String file = call.getString("path", "");
        String shortcode = call.getString("shortcode", "");
        // The page may shorten the budget — it knows how long the user has been
        // watching a spinner — but may not extend it past half a minute.
        double budget = Math.min(call.getDouble("timeout", (double) SheetSpec.BUDGET_MS), 30000);
        long deadline = System.currentTimeMillis() + (long) budget;

        sheets.execute(() -> {
            SheetPipeline.Outcome outcome = null;
            if (!file.isEmpty() && !shortcode.isEmpty()) {
                outcome = SheetPipeline.runLocal(file, shortcode, token, deadline);
                // A file the page handed over for this purpose is ours to clean up.
                try { new File(file).delete(); } catch (Exception ignored) {}
            } else if (!url.isEmpty()) {
                outcome = SheetPipeline.run(url, token, deadline);
            }
            if (outcome == null) { call.resolve(new JSObject().put("ok", false).put("reason", "no-frames")); return; }
            call.resolve(new JSObject()
                    .put("ok", true)
                    .put("frames", outcome.frames)
                    .put("bytes", outcome.bytes)
                    .put("ms", outcome.milliseconds)
                    .put("kept", outcome.kept)
                    .put("requested", outcome.requested));
        });
    }

    @Override protected void handleOnDestroy() { sheets.shutdownNow(); }
}
