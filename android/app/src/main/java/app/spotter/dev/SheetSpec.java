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
    public static final int MAX_FRAMES = 36;
    public static final double SECONDS_PER_FRAME = 2.5;
    public static final double EDGE_INSET = 0.5;

    public static final int PORTRAIT_W = 270, PORTRAIT_H = 480;
    public static final int LANDSCAPE_W = 480, LANDSCAPE_H = 270;
    public static final int SQUARE_W = 360, SQUARE_H = 360;
    public static final double SQUARE_BAND = 0.05;

    public static final int COLS = 4;
    public static final int ROWS_PER_SHEET = 3;
    public static final int CELLS_PER_SHEET = 12;
    public static final int MAX_SHEETS = 3;
    public static final int GUTTER = 2;

    public static final double LABEL_FONT_SIZE = 16;
    public static final double LABEL_INSET = 8;
    public static final double LABEL_PILL_ALPHA = 0.6;
    public static final double LABEL_PILL_RADIUS = 6;
    public static final double LABEL_PAD_X = 6;
    public static final double LABEL_PAD_Y = 3;

    public static final int JPEG_QUALITY = 72;
    public static final int JPEG_FALLBACK_QUALITY = 62;
    public static final int JPEG_MAX_BYTES = 614400;

    public static final long BUDGET_MS = 8000;
    public static final long BUDGET_BYTES = 26214400L;

    public static final String CONTENT_TYPE = "image/jpeg";

    /** One frame per 2.5 s, floored at 8 and capped at three full sheets. */
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

    /** Rows a sheet holding this many cells needs. */
    public static int rows(int count) {
        return Math.min(ROWS_PER_SHEET, Math.max(1, (int) Math.ceil(Math.max(1, count) / (double) COLS)));
    }

    /** Sheets this many frames are spread over, one to three. */
    public static int sheetCount(int frames) {
        return Math.min(MAX_SHEETS, Math.max(1, (int) Math.ceil(Math.max(1, frames) / (double) CELLS_PER_SHEET)));
    }

    /** Cells on sheet index — the last one is the short one. */
    public static int cellsInSheet(int index, int frames) {
        return Math.max(0, Math.min(CELLS_PER_SHEET, frames - index * CELLS_PER_SHEET));
    }

    /**
     * Canvas size {w, h} for a sheet of this many cells.
     *
     * Exactly cols x cell for a full sheet — 1080x1440 portrait, the number in
     * the contract — because the gutter is drawn INSIDE each cell by frame(),
     * not added between them. A short last sheet is proportionally shorter
     * rather than padded: empty black cells are pixels the reader pays tokens
     * for and learns nothing from.
     */
    public static int[] canvas(int count, int[] cell) {
        return new int[] { Math.min(COLS, Math.max(1, count)) * cell[0], rows(count) * cell[1] };
    }

    /** Top-left {x, y} of cell index within its sheet, row-major = time order. */
    public static int[] origin(int index, int[] cell) {
        return new int[] { (index % COLS) * cell[0], (index / COLS) * cell[1] };
    }

    /** Where the picture goes inside that cell: the gutter, split between neighbours. */
    public static int[] frame(int index, int[] cell) {
        int[] o = origin(index, cell);
        int inset = GUTTER / 2;
        return new int[] { o[0] + inset, o[1] + inset, cell[0] - GUTTER, cell[1] - GUTTER };
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
            if (!accepts(times[i], last)) continue;
            out[n++] = i;
            last = times[i];
        }
        return java.util.Arrays.copyOf(out, n);
    }

    /**
     * The same rule, one frame at a time, for a builder that renders a sheet as
     * soon as its twelve cells are full and never holds all thirty-six.
     */
    public static boolean accepts(double time, double previous) {
        return Double.isFinite(time) && time >= 0 && time - previous >= MIN_GAP;
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
