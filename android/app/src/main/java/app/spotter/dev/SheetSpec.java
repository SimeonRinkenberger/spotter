package app.spotter.dev;

import java.util.Locale;

/**
 * The contact-sheet arithmetic, and nothing else.
 *
 * No android.* import on purpose: tools/android/sheet-check.mjs compiles this
 * single file with plain javac and asserts every number in it against
 * native/sheet-spec.json, the same way the iOS check does with its Swift twin
 * (ios/App/Shared/SheetSpec.swift). The three copies are kept honest by the two
 * checks — change a number in one place and the harness says so.
 */
public final class SheetSpec {
    private SheetSpec() {}

    public static final int MIN_FRAMES = 8;
    public static final int MAX_FRAMES = 25;
    public static final double SECONDS_PER_FRAME = 3.5;
    public static final double EDGE_INSET = 0.5;

    public static final int PORTRAIT_W = 216, PORTRAIT_H = 384;
    public static final int LANDSCAPE_W = 384, LANDSCAPE_H = 216;
    public static final int SQUARE_W = 300, SQUARE_H = 300;
    public static final double SQUARE_BAND = 0.05;

    public static final int COLS = 5;
    public static final int GUTTER = 2;

    public static final double LABEL_FONT_SIZE = 14;
    public static final double LABEL_INSET = 6;
    public static final double LABEL_PILL_ALPHA = 0.6;
    public static final double LABEL_PILL_RADIUS = 6;
    public static final double LABEL_PAD_X = 6;
    public static final double LABEL_PAD_Y = 3;

    public static final int JPEG_QUALITY = 70;
    public static final int JPEG_FALLBACK_QUALITY = 60;
    public static final int JPEG_MAX_BYTES = 614400;

    public static final long BUDGET_MS = 8000;
    public static final long BUDGET_BYTES = 26214400L;

    public static final String CONTENT_TYPE = "image/jpeg";

    /** One frame per 3.5 s, floored at 8 and capped at one 5x5 sheet. */
    public static int frameCount(double duration) {
        if (Double.isNaN(duration) || Double.isInfinite(duration) || duration <= 0) return MIN_FRAMES;
        int wanted = (int) Math.ceil(duration / SECONDS_PER_FRAME);
        return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, wanted));
    }

    /**
     * Uniform times from 0.5 s to duration - 0.5 s inclusive. A clip too short to
     * hold the inset on both ends collapses to its own middle rather than asking
     * the retriever for a negative time.
     */
    public static double[] times(double raw) {
        // Normalised once, here, so a header that could not be read (0, NaN)
        // behaves the same on both platforms instead of relying on each
        // language's opinion about max(0, NaN).
        double duration = Double.isFinite(raw) && raw > 0 ? raw : 0;
        int n = frameCount(duration);
        double first = Math.min(EDGE_INSET, Math.max(0, duration / 2));
        double last = Math.max(first, duration - EDGE_INSET);
        double step = n > 1 ? (last - first) / (n - 1) : 0;
        double[] out = new double[n];
        for (int i = 0; i < n; i++) out[i] = first + step * i;
        return out;
    }

    /** The fixed box a frame of these pixel dimensions is fitted into: {w, h}. */
    public static int[] cell(double videoWidth, double videoHeight) {
        if (videoWidth <= 0 || videoHeight <= 0) return new int[] { PORTRAIT_W, PORTRAIT_H };
        double ratio = videoWidth / videoHeight;
        if (ratio > 1 + SQUARE_BAND) return new int[] { LANDSCAPE_W, LANDSCAPE_H };
        if (ratio < 1 - SQUARE_BAND) return new int[] { PORTRAIT_W, PORTRAIT_H };
        return new int[] { SQUARE_W, SQUARE_H };
    }

    public static int rows(int count) {
        return Math.max(1, (int) Math.ceil(Math.max(1, count) / (double) COLS));
    }

    /** Canvas size {w, h}. No outer margin; gutters live between cells only. */
    public static int[] canvas(int count, int[] cell) {
        int r = rows(count);
        int c = Math.min(COLS, Math.max(1, count));
        return new int[] { c * cell[0] + (c - 1) * GUTTER, r * cell[1] + (r - 1) * GUTTER };
    }

    /** Top-left {x, y} of cell index, row-major, so reading order is time order. */
    public static int[] origin(int index, int[] cell) {
        return new int[] { (index % COLS) * (cell[0] + GUTTER), (index / COLS) * (cell[1] + GUTTER) };
    }

    public static final double MIN_GAP = 0.05;

    /**
     * Which of the frames that came back are worth a cell.
     *
     * The retriever is asked for the closest sync sample, so two neighbouring
     * requests can land on the same one and hand back the same picture twice. A
     * duplicate cell is a wasted 216x384 of the model's attention and would also
     * make the times array stop ascending, which the server rejects. Both
     * problems die the same way: keep the first of any pair closer together than
     * MIN_GAP, drop the rest. Returns indices in time order.
     */
    public static int[] keep(double[] times) {
        Integer[] order = new Integer[times.length];
        for (int i = 0; i < times.length; i++) order[i] = i;
        java.util.Arrays.sort(order, (a, b) -> times[a] == times[b] ? a - b : Double.compare(times[a], times[b]));
        int[] out = new int[times.length];
        int n = 0;
        double last = -Double.MAX_VALUE;
        for (int i : order) {
            if (!Double.isFinite(times[i]) || times[i] < 0 || times[i] - last < MIN_GAP) continue;
            out[n++] = i;
            last = times[i];
        }
        return java.util.Arrays.copyOf(out, n);
    }

    /** M:SS of the frame's own time, which is what the server prompt reads. */
    public static String label(double seconds) {
        long whole = Math.max(0, Math.round(Double.isFinite(seconds) ? seconds : 0));
        return whole / 60 + String.format(Locale.US, ":%02d", whole % 60);
    }

    /** {@code <uid>/pack/<shortcode>/sheet-<n>.jpg}, 1-based, per the server contract. */
    public static String objectPath(String uid, String shortcode, int index) {
        return uid + "/pack/" + shortcode + "/sheet-" + (index + 1) + ".jpg";
    }
}
