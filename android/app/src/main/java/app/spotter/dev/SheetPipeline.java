package app.spotter.dev;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Page to frames to storage to the `frames` block of a save.
 *
 * Best effort by construction: every failure returns null and the caller saves
 * without frames, because a save that failed because a CDN changed a cookie name
 * would be a far worse product than a card the server reads with Gemini instead.
 *
 * Android has one caller where iOS has two. A share from another app arrives as
 * ACTION_SEND on MainActivity and is handed to the web layer (SpotterAndroid's
 * sharedUrl event), so the in-app save flow is the share flow — there is no
 * second, extension-shaped copy of this to keep in step, and no WorkManager job
 * either: the Activity is in the foreground the whole time the sheet is being
 * cut, on this executor rather than the main thread, so there is nothing for an
 * expedited worker to protect against.
 */
public final class SheetPipeline {
    private SheetPipeline() {}

    static final String FUNCTION_BASE = "https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter";
    static final String STORAGE_BASE = "https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1";
    /** The same public anon key the web page ships with; Storage wants it present. */
    static final String ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10emV2b3h4cHNrdG1yYmJ1eHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjM5ODgsImV4cCI6MjEwMzc5OTk4OH0._vpNhLJtv2bVGgXXClva9O5cX8Y5eJdTgbgAO81NnmU";

    public static final class Outcome {
        public final JSONObject frames;
        public final String path;
        public final int bytes, kept, requested;
        public final long milliseconds;
        Outcome(JSONObject frames, String path, int bytes, int kept, int requested, long milliseconds) {
            this.frames = frames; this.path = path; this.bytes = bytes;
            this.kept = kept; this.requested = requested; this.milliseconds = milliseconds;
        }
    }

    /** The TikTok path. No download: the retriever reads ranges off the CDN itself. */
    public static Outcome run(String pageUrl, String uid, String token, long deadline) {
        long started = System.currentTimeMillis();
        try {
            if (!TikTokPage.isTikTok(pageUrl)) return null;
            TikTokPage.Page page = TikTokPage.fetch(pageUrl);
            String shortcode = TikTokPage.shortcode(page.url);
            if (shortcode == null) shortcode = TikTokPage.shortcode(pageUrl);
            TikTokPage.Video video = TikTokPage.parse(page.html, page.cookie);
            if (shortcode == null || video == null || System.currentTimeMillis() >= deadline) return null;
            Map<String, String> headers = TikTokPage.headers(page.cookie);
            return finish(ContactSheet.build(video.playAddr, headers, deadline),
                    shortcode, uid, token, started);
        } catch (Exception e) {
            return null;
        }
    }

    /** The upload path: a file already on the phone, same builder from here on. */
    public static Outcome runLocal(String file, String shortcode, String uid, String token, long deadline) {
        long started = System.currentTimeMillis();
        try {
            return finish(ContactSheet.build(file, null, deadline), shortcode, uid, token, started);
        } catch (Exception e) {
            return null;
        }
    }

    private static Outcome finish(ContactSheet.Result built, String shortcode,
                                  String uid, String token, long started) throws Exception {
        // Uploaded in order and counted as they land. After an upload that would
        // not go, whatever is already up is what goes with the save — the sheets
        // are in time order, so a short set is the first part of the video rather
        // than a hole in the middle of it.
        JSONArray sheets = new JSONArray();
        String first = null;
        int bytes = 0, kept = 0;
        for (int i = 0; i < built.pages.size(); i++) {
            ContactSheet.Page page = built.pages.get(i);
            String path = upload(page.jpeg, shortcode, i, uid, token);
            if (path == null) break;
            if (first == null) first = path;
            JSONArray times = new JSONArray();
            for (double t : page.times) times.put(t);
            sheets.put(new JSONObject()
                    .put("path", path).put("cols", page.cols).put("rows", page.rows)
                    .put("cell_w", built.cellW).put("cell_h", built.cellH).put("times", times));
            bytes += page.jpeg.length;
            kept += page.times.length;
        }
        if (sheets.length() == 0) return null;

        JSONObject frames = new JSONObject()
                .put("source", "device")
                .put("duration_s", built.durationS)
                .put("sheets", sheets);
        return new Outcome(frames, first, bytes, kept, built.requested,
                System.currentTimeMillis() - started);
    }

    /**
     * Authorise, then put the bytes. Returns the object path the server accepted.
     *
     * What /api/uploads/authorize answers TODAY is {status:"ok", path} and the
     * direct Storage write that follows needs the user's session, which this
     * caller has. An `upload_url` in the reply is used instead when it is there —
     * that is the field the iOS Share Extension needs, and reading it here keeps
     * the two clients on one contract.
     */
    private static String upload(byte[] jpeg, String shortcode, int index, String uid, String token)
            throws Exception {
        JSONObject body = new JSONObject()
                .put("bytes", jpeg.length)
                .put("content_type", SheetSpec.CONTENT_TYPE)
                .put("kind", "pack")
                .put("shortcode", shortcode)
                .put("sheet", index + 1);
        String guess = null;
        if (uid != null && !uid.isEmpty()) {
            guess = SheetSpec.objectPath(uid, shortcode, index);
            body.put("path", guess);
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(FUNCTION_BASE + "/api/uploads/authorize").openConnection();
        JSONObject reply;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (connection.getResponseCode() != 200) return null;
            reply = new JSONObject(read(connection.getInputStream()));
        } finally {
            connection.disconnect();
        }
        if (!"ok".equals(reply.optString("status"))) return null;
        String path = reply.optString("path", guess == null ? "" : guess);
        if (path.isEmpty()) return null;

        String signed = reply.optString("upload_url", "");
        HttpURLConnection put = (HttpURLConnection) new URL(
                signed.isEmpty() ? STORAGE_BASE + "/object/uploads/" + path : signed).openConnection();
        try {
            put.setInstanceFollowRedirects(false);
            put.setConnectTimeout(8000);
            put.setReadTimeout(20000);
            put.setRequestMethod("PUT");
            put.setDoOutput(true);
            put.setFixedLengthStreamingMode(jpeg.length);
            put.setRequestProperty("Content-Type", SheetSpec.CONTENT_TYPE);
            put.setRequestProperty("apikey", ANON_KEY);
            put.setRequestProperty("x-upsert", "false");
            String bearer = reply.optString("token", "");
            put.setRequestProperty("Authorization", "Bearer " + (bearer.isEmpty() ? token : bearer));
            try (OutputStream out = put.getOutputStream()) { out.write(jpeg); }
            int status = put.getResponseCode();
            return status >= 200 && status < 300 ? path : null;
        } finally {
            put.disconnect();
        }
    }

    private static String read(InputStream stream) throws Exception {
        try (stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1 && out.size() < 256 * 1024) out.write(buffer, 0, count);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
