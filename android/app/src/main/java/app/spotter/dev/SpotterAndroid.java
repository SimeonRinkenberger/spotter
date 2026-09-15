package app.spotter.dev;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.*;

@CapacitorPlugin(name = "SpotterAndroid")
public class SpotterAndroid extends Plugin {
    private String pending;
    private boolean ready;
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
}
