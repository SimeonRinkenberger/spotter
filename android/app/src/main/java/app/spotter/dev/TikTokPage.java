package app.spotter.dev;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The watch page, and the cookies it hands out.
 *
 * Fetched for two things at once, and they have to travel together: the
 * playAddr URL, and the cookies that page sets. The edge function measured the
 * pairing in September — playAddr answers 403 to a bare request and 206 to the
 * identical request carrying the cookies from a second earlier — and the field
 * names below are the same ones it reads, so a TikTok change breaks both halves
 * at once instead of letting them disagree quietly.
 */
public final class TikTokPage {
    private TikTokPage() {}

    /** The UA the edge function uses for the same page, so both see one TikTok. */
    public static final String DESKTOP_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private static final Pattern ID =
            Pattern.compile("tiktok\\.com/(?:@[^/]+/(?:video|photo)|v)/(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final int PAGE_CAP = 4 * 1024 * 1024;

    public static final class Page {
        public final String html, cookie, url;
        Page(String html, String cookie, String url) { this.html = html; this.cookie = cookie; this.url = url; }
    }

    public static final class Video {
        public final String playAddr;
        public final double duration, width, height;
        public final String cookie;
        Video(String playAddr, double duration, double width, double height, String cookie) {
            this.playAddr = playAddr; this.duration = duration;
            this.width = width; this.height = height; this.cookie = cookie;
        }
    }

    public static boolean isTikTok(String raw) {
        try {
            String host = new URL(raw).getHost().toLowerCase(Locale.US);
            return host.equals("tiktok.com") || host.endsWith(".tiktok.com");
        } catch (Exception e) {
            return false;
        }
    }

    /** {@code tt-<id>}, the key the server caches the pack under. */
    public static String shortcode(String raw) {
        if (raw == null) return null;
        Matcher m = ID.matcher(raw);
        return m.find() ? "tt-" + m.group(1) : null;
    }

    public static Page fetch(String raw) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(raw).openConnection();
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("User-Agent", DESKTOP_UA);
            connection.setRequestProperty("Accept", "text/html");
            connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            if (connection.getResponseCode() != 200) throw new IllegalStateException("page " + connection.getResponseCode());

            List<String> jar = new ArrayList<>();
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() == null || !header.getKey().equalsIgnoreCase("set-cookie")) continue;
                for (String line : header.getValue()) {
                    String pair = line.split(";")[0].trim();
                    if (pair.contains("=")) jar.add(pair);
                }
            }
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = stream.read(buffer)) != -1 && body.size() < PAGE_CAP) body.write(buffer, 0, count);
            }
            return new Page(body.toString(StandardCharsets.UTF_8.name()),
                    String.join("; ", jar), connection.getURL().toString());
        } finally {
            connection.disconnect();
        }
    }

    /**
     * itemStruct.video out of the rehydration blob. A photo carousel carries a
     * video object of all zeroes, and the zero duration fails the guard here —
     * which is right: there are no frames in a carousel to cut.
     */
    public static Video parse(String html, String cookie) {
        try {
            int open = html.indexOf("id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"");
            if (open < 0) return null;
            int start = html.indexOf('>', open);
            int end = html.indexOf("</script>", start);
            if (start < 0 || end < 0) return null;
            JSONObject video = new JSONObject(html.substring(start + 1, end))
                    .getJSONObject("__DEFAULT_SCOPE__")
                    .getJSONObject("webapp.video-detail")
                    .getJSONObject("itemInfo")
                    .getJSONObject("itemStruct")
                    .getJSONObject("video");

            String addr = video.optString("playAddr", "");
            if (addr.isEmpty()) addr = video.optString("downloadAddr", "");
            addr = addr.replace("\\u0026", "&").replace("\\/", "/");
            double duration = video.optDouble("duration", 0);
            if (!addr.startsWith("https://") || !(duration > 0)) return null;
            return new Video(addr, duration, video.optDouble("width", 0), video.optDouble("height", 0), cookie);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * What MediaMetadataRetriever re-sends on every range request it makes.
     * Referer is the one AVFoundation cannot set on iOS and the one TikTok's CDN
     * refuses to serve without.
     */
    public static Map<String, String> headers(String cookie) {
        Map<String, String> headers = new HashMap<>();
        headers.put("User-Agent", DESKTOP_UA);
        headers.put("Referer", "https://www.tiktok.com/");
        headers.put("Accept", "*/*");
        if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);
        return headers;
    }
}
