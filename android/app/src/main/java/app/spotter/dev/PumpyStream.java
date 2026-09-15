package app.spotter.dev;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

@CapacitorPlugin(name = "PumpyStream")
public class PumpyStream extends Plugin {
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ExecutorService cancellations = Executors.newCachedThreadPool();
    private static final class Request {
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
    }
    private final ConcurrentHashMap<String, Request> requests = new ConcurrentHashMap<>();
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void start(PluginCall call) {
        String id = call.getString("id", "");
        String body = call.getString("body", "");
        String auth = call.getString("authorization", "");
        if (id.isEmpty() || body.length() > 200000 || !auth.startsWith("Bearer ")) { call.reject("Invalid coaching request."); return; }
        Request request = new Request();
        if (requests.putIfAbsent(id, request) != null) { call.reject("Duplicate coaching request."); return; }
        call.setKeepAlive(true);
        executor.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                if (request.cancelled) return;
                connection = (HttpsURLConnection) new URL("https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/pumpy/chat").openConnection();
                request.connection = connection;
                if (request.cancelled) return;
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000); connection.setReadTimeout(180000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", auth);
                try (var output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                call.resolve(new JSObject().put("type", "headers").put("status", status).put("contentType", connection.getContentType() == null ? "application/x-ndjson" : connection.getContentType()));
                InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
                if (stream != null) try (stream) {
                    byte[] buffer = new byte[4096]; int count;
                    while (!request.cancelled && (count = stream.read(buffer)) != -1) {
                        call.resolve(new JSObject().put("type", "data").put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)));
                    }
                }
                call.resolve(new JSObject().put("type", "end"));
            } catch (Exception error) {
                call.resolve(new JSObject().put("type", "error").put("message", "Could not finish the coaching response. Please try again."));
            } finally {
                requests.remove(id, request); if (connection != null) connection.disconnect();
                call.setKeepAlive(false); getBridge().releaseCall(call);
            }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        Request request = requests.get(call.getString("id", ""));
        if (request != null) {
            request.cancelled = true;
            HttpsURLConnection c = request.connection;
            // Disconnect must not queue behind the stream it is trying to stop.
            if (c != null) cancellations.execute(c::disconnect);
        }
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        for (Request request : requests.values()) {
            request.cancelled = true;
            if (request.connection != null) cancellations.execute(request.connection::disconnect);
        }
        requests.clear(); executor.shutdownNow(); cancellations.shutdown();
    }
}
