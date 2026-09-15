package app.spotter.dev;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuth extends Plugin {
    private PluginCall pending;
    private boolean left;
    @PluginMethod public void start(PluginCall call) {
        Uri url = Uri.parse(call.getString("url", ""));
        if (!"https".equals(url.getScheme()) || !"mtzevoxxpsktmrbbuxva.supabase.co".equals(url.getHost()) || !"/auth/v1/authorize".equals(url.getPath()) || !"google".equals(url.getQueryParameter("provider"))) {
            call.reject("Unexpected sign-in address."); return;
        }
        if (pending != null) { call.reject("Sign-in is already open."); return; }
        pending = call; left = false;
        getActivity().runOnUiThread(() -> {
            try { new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getContext(), url); }
            catch (Exception e) { pending = null; call.reject("Install a browser to sign in with Google."); }
        });
    }
    @Override protected void handleOnPause() { if (pending != null) left = true; }
    @Override protected void handleOnResume() {
        if (pending == null || !left) return;
        // onNewIntent arrives before resume for a successful Custom Tab return.
        final PluginCall current = pending;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pending == current) { pending = null; current.reject("Sign-in cancelled.", "AUTH_CANCELLED"); }
        }, 500);
    }
    @Override protected void handleOnNewIntent(Intent intent) {
        if (pending == null || intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri u = intent.getData();
        if (u == null || !"com.spotter.auth".equals(u.getScheme()) || !"callback".equals(u.getHost()) || (u.getPath() != null && !u.getPath().isEmpty()) || u.getFragment() != null || u.getUserInfo() != null || u.getPort() != -1) return;
        PluginCall call = pending; pending = null;
        call.resolve(new JSObject().put("url", u.toString()));
        intent.setData(null);
    }
    @Override protected void handleOnDestroy() {
        if (pending != null) { pending.reject("Sign-in interrupted.", "AUTH_CANCELLED"); pending = null; }
    }
}
