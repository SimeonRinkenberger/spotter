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
    public static Outcome run(String pageUrl, String token, long deadline) {
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
                    shortcode, token, started);
        } catch (Exception e) {
            return null;
        }
    }

    /** The upload path: a file already on the phone, same builder from here on. */
    public static Outcome runLocal(String file, String shortcode, String token, long deadline) {
        long started = System.currentTimeMillis();
        try {
            return finish(ContactSheet.build(file, null, deadline), shortcode, token, started);
        } catch (Exception e) {
            return null;
        }
    }

    private static Outcome finish(ContactSheet.Result built, String shortcode,
                                  String token, long started) throws Exception {
        // One authorize for the whole save, then the bytes. Uploaded in order and
        // counted as they land: after a PUT that would not go, whatever is already
        // up is what goes with the save — the sheets are in time order, so a short
        // set is the first part of the video rather than a hole in the middle.
        int[] sizes = new int[built.pages.size()];
        for (int i = 0; i < sizes.length; i++) sizes[i] = built.pages.get(i).jpeg.length;
        Slot[] slots = authorize(shortcode, sizes, token);

        JSONArray sheets = new JSONArray();
        String first = null;
        int bytes = 0, kept = 0;
        for (int i = 0; i < built.pages.size() && i < slots.length; i++) {
            ContactSheet.Page page = built.pages.get(i);
            if (!put(page.jpeg, slots[i].url)) break;
            String path = slots[i].path;
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

    /** A place the server has agreed to accept one sheet. */
    private static final class Slot {
        final String path, url;
        Slot(String path, String url) { this.path = path; this.url = url; }
    }

    /**
     * One authorize for the whole save.
     *
     * Every sheet's size goes up together and the server answers with a
     * pre-signed address for each; the PUTs that follow carry no session header,
     * because the token in the address is the whole authority and it is good for
     * fifteen minutes — a hundred times the budget this all has to fit inside.
     */
    private static Slot[] authorize(String shortcode, int[] sizes, String token) throws Exception {
        JSONArray wanted = new JSONArray();
        for (int size : sizes) wanted.put(new JSONObject().put("bytes", size));
        JSONObject body = new JSONObject()
                .put("kind", "pack").put("shortcode", shortcode).put("sheets", wanted);

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
            if (connection.getResponseCode() != 200) return new Slot[0];
            reply = new JSONObject(read(connection.getInputStream()));
        } finally {
            connection.disconnect();
        }

        JSONArray granted = reply.optJSONArray("sheets");
        if (granted == null) return new Slot[0];
        Slot[] slots = new Slot[granted.length()];
        int n = 0;
        for (int i = 0; i < granted.length(); i++) {
            JSONObject sheet = granted.optJSONObject(i);
            if (sheet == null) break;
            String path = sheet.optString("path", ""), address = sheet.optString("upload_url", "");
            if (path.isEmpty() || address.isEmpty()) break;
            // The token may already be in the address; a second copy would be the
            // kind of bug that only shows up on the server's next refactor.
            String ticket = sheet.optString("token", "");
            if (!ticket.isEmpty() && !address.contains("token=")) {
                address += (address.contains("?") ? "&" : "?") + "token=" + ticket;
            }
            slots[n++] = new Slot(path, address);
        }
        return java.util.Arrays.copyOf(slots, n);
    }

    private static boolean put(byte[] jpeg, String address) {
        HttpURLConnection put = null;
        try {
            put = (HttpURLConnection) new URL(address).openConnection();
            put.setInstanceFollowRedirects(false);
            put.setConnectTimeout(8000);
            put.setReadTimeout(20000);
            put.setRequestMethod("PUT");
            put.setDoOutput(true);
            put.setFixedLengthStreamingMode(jpeg.length);
            put.setRequestProperty("Content-Type", SheetSpec.CONTENT_TYPE);
            try (OutputStream out = put.getOutputStream()) { out.write(jpeg); }
            int status = put.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (put != null) put.disconnect();
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
