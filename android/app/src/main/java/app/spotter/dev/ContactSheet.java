package app.spotter.dev;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.media.MediaMetadataRetriever;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The phone cuts the frames — the Android half.
 *
 * One real difference from iOS, and it is in Android's favour:
 * MediaMetadataRetriever.setDataSource(url, headers) re-sends those headers on
 * every HTTP range request it makes (AOSP MediaHTTPConnection), so the MP4 never
 * has to be downloaded at all. The retriever reads the ranges it needs around
 * each keyframe straight off TikTok's CDN with the Cookie and Referer that make
 * the CDN answer, and nothing lands on disk to be forgotten about.
 *
 * The other difference is a cost: the retriever will not say WHICH frame it gave
 * you. OPTION_CLOSEST_SYNC is the fast path (OPTION_CLOSEST decodes forward from
 * the previous keyframe and is far too slow for a save), but it snaps to the
 * nearest sync sample without reporting where that was, so the label says the
 * time that was asked for, within one keyframe interval of the picture — and two
 * neighbouring requests can land on the same keyframe and return the same
 * picture twice. Hence the sameAs() check: a duplicate cell is wasted attention,
 * so the second copy is dropped and its time with it.
 *
 * Every number comes from SheetSpec, which is asserted against
 * native/sheet-spec.json — and therefore against the iOS build — by
 * tools/android/sheet-check.mjs.
 */
public final class ContactSheet {
    private ContactSheet() {}

    /** Below this a sheet says less than nothing; the save goes without frames. */
    public static final int MIN_USABLE_FRAMES = 4;

    public static final class Result {
        public final byte[] jpeg;
        public final double[] times;
        public final int cols, rows, cellW, cellH, requested;
        public final double durationS;

        Result(byte[] jpeg, double[] times, int cols, int rows,
               int cellW, int cellH, int requested, double durationS) {
            this.jpeg = jpeg; this.times = times; this.cols = cols; this.rows = rows;
            this.cellW = cellW; this.cellH = cellH; this.requested = requested;
            this.durationS = durationS;
        }
    }

    /**
     * @param source  a remote MP4 URL, or an absolute path to a local file
     * @param headers Cookie / Referer / User-Agent for the remote case; null locally
     * @param deadline System.currentTimeMillis() past which whatever has been cut is the sheet
     */
    public static Result build(String source, Map<String, String> headers, long deadline) throws Exception {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        List<Bitmap> frames = new ArrayList<>();
        List<Double> kept = new ArrayList<>();
        try {
            if (headers != null && !headers.isEmpty()) retriever.setDataSource(source, headers);
            else retriever.setDataSource(source);

            double duration = number(retriever, MediaMetadataRetriever.METADATA_KEY_DURATION) / 1000.0;
            double width = number(retriever, MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            double height = number(retriever, MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            int rotation = (int) number(retriever, MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            // A portrait phone video is often stored landscape with a 90 degree
            // rotation flag; the frames come back upright, so the box has to be
            // chosen from the upright dimensions rather than the stored ones.
            if (rotation == 90 || rotation == 270) { double swap = width; width = height; height = swap; }
            if (duration <= 0) throw new IllegalStateException("no duration");

            int[] cell = SheetSpec.cell(width, height);
            double[] wanted = SheetSpec.times(duration);
            Bitmap previous = null;

            for (double t : wanted) {
                if (System.currentTimeMillis() >= deadline) break;
                Bitmap frame = frameAt(retriever, (long) (t * 1_000_000L), cell[0], cell[1]);
                if (frame == null) continue;
                if (previous != null && frame.sameAs(previous)) { frame.recycle(); continue; }
                frames.add(frame);
                kept.add(t);
                previous = frame;
            }
            if (frames.size() < MIN_USABLE_FRAMES) throw new IllegalStateException("too few frames");

            double[] times = new double[kept.size()];
            for (int i = 0; i < times.length; i++) times[i] = kept.get(i);
            byte[] jpeg = draw(frames, times, cell);
            return new Result(jpeg, times, Math.min(SheetSpec.COLS, times.length),
                    SheetSpec.rows(times.length), cell[0], cell[1], wanted.length, duration);
        } finally {
            for (Bitmap b : frames) if (!b.isRecycled()) b.recycle();
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }

    private static byte[] draw(List<Bitmap> frames, double[] times, int[] cell) {
        int[] size = SheetSpec.canvas(times.length, cell);
        Bitmap sheet = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(sheet);
            // Black under everything: the gutters, the bars beside an aspect-fitted
            // frame, and any cell the last row does not reach.
            canvas.drawColor(Color.BLACK);

            Paint image = new Paint(Paint.FILTER_BITMAP_FLAG);
            Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
            pill.setColor(Color.argb((int) Math.round(SheetSpec.LABEL_PILL_ALPHA * 255), 0, 0, 0));
            Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
            text.setColor(Color.WHITE);
            text.setTextSize((float) SheetSpec.LABEL_FONT_SIZE);
            text.setFakeBoldText(true);
            float ascent = text.ascent(), descent = text.descent();
            float lineHeight = descent - ascent;

            for (int i = 0; i < frames.size(); i++) {
                Bitmap frame = frames.get(i);
                int[] origin = SheetSpec.origin(i, cell);
                // Fit, never fill: a crop is exactly where the second kettlebell at
                // the edge of the frame would have gone missing.
                float scale = Math.min(cell[0] / (float) frame.getWidth(), cell[1] / (float) frame.getHeight());
                float w = frame.getWidth() * scale, h = frame.getHeight() * scale;
                float left = origin[0] + (cell[0] - w) / 2f, top = origin[1] + (cell[1] - h) / 2f;
                canvas.drawBitmap(frame, new Rect(0, 0, frame.getWidth(), frame.getHeight()),
                        new RectF(left, top, left + w, top + h), image);

                String label = SheetSpec.label(times[i]);
                float pillW = text.measureText(label) + (float) SheetSpec.LABEL_PAD_X * 2;
                float pillH = lineHeight + (float) SheetSpec.LABEL_PAD_Y * 2;
                float pillX = origin[0] + (float) SheetSpec.LABEL_INSET;
                float pillY = origin[1] + cell[1] - (float) SheetSpec.LABEL_INSET - pillH;
                canvas.drawRoundRect(new RectF(pillX, pillY, pillX + pillW, pillY + pillH),
                        (float) SheetSpec.LABEL_PILL_RADIUS, (float) SheetSpec.LABEL_PILL_RADIUS, pill);
                canvas.drawText(label, pillX + (float) SheetSpec.LABEL_PAD_X,
                        pillY + (float) SheetSpec.LABEL_PAD_Y - ascent, text);
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            sheet.compress(Bitmap.CompressFormat.JPEG, SheetSpec.JPEG_QUALITY, out);
            // One retry, not a search: a second encode is another full pass over
            // eight megapixels and the frames are best effort anyway.
            if (out.size() > SheetSpec.JPEG_MAX_BYTES) {
                out = new ByteArrayOutputStream();
                sheet.compress(Bitmap.CompressFormat.JPEG, SheetSpec.JPEG_FALLBACK_QUALITY, out);
            }
            return out.toByteArray();
        } finally {
            sheet.recycle();
        }
    }

    /**
     * API 27 scales inside the decoder, which is the whole performance story: a
     * 1080x1920 frame is never materialised. Below that the frame arrives full
     * size and is scaled and released immediately, so peak memory is one frame
     * rather than twenty-five.
     */
    private static Bitmap frameAt(MediaMetadataRetriever retriever, long timeUs, int w, int h) {
        if (Build.VERSION.SDK_INT >= 27) {
            return retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, w, h);
        }
        Bitmap full = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        if (full == null) return null;
        float scale = Math.min(w / (float) full.getWidth(), h / (float) full.getHeight());
        Bitmap scaled = Bitmap.createScaledBitmap(full,
                Math.max(1, Math.round(full.getWidth() * scale)),
                Math.max(1, Math.round(full.getHeight() * scale)), true);
        if (scaled != full) full.recycle();
        return scaled;
    }

    private static double number(MediaMetadataRetriever retriever, int key) {
        try {
            String raw = retriever.extractMetadata(key);
            return raw == null ? 0 : Double.parseDouble(raw.trim());
        } catch (Exception e) {
            return 0;
        }
    }
}
