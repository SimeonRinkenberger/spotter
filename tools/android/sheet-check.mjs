// The Android half of the same proof: compile SheetSpec.java with plain javac —
// no Android SDK, no emulator, no gradle — and make it answer the identical case
// list from tools/sheet-cases.mjs. Passing both this and tools/ios/sheet-check.mjs
// means the two phones and the server's validator agree on every number.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spec, expected, same, contractHolds, DURATIONS, SIZES, COUNTS, LABEL_SECONDS, ARRIVALS } from '../sheet-cases.mjs';

// The same JDK gradle uses when it is there, so the harness cannot pass on a
// compiler the app is never built with; any JDK on PATH otherwise.
const homes = [process.env.JAVA_HOME, '/Applications/Android Studio.app/Contents/jbr/Contents/Home'];
const tool = name => homes.map(h => h && join(h, 'bin', name)).find(p => p && existsSync(p)) || name;

const dir = mkdtempSync(join(tmpdir(), 'spotter-sheet-test-'));
const literal = d => Number.isFinite(d) ? `${d}` : 'Double.NaN';

writeFileSync(join(dir, 'SheetCheck.java'), `
package app.spotter.dev;

public final class SheetCheck {
    static StringBuilder o = new StringBuilder();
    static void arr(String name, double[] v) {
        o.append("\\"").append(name).append("\\":[");
        for (int i = 0; i < v.length; i++) { if (i > 0) o.append(','); o.append(v[i]); }
        o.append("],");
    }
    public static void main(String[] a) {
        double[] durations = { ${DURATIONS.map(literal).join(', ')} };
        double[][] sizes = { ${SIZES.map(([w, h]) => `{ ${w}, ${h} }`).join(', ')} };
        int[] counts = { ${COUNTS.join(', ')} };
        double[] labelSeconds = { ${LABEL_SECONDS.join(', ')} };
        double[][] arrivals = { ${ARRIVALS.map(a => '{ ' + a.map(v => Number.isFinite(v) ? v : 'Double.NaN').join(', ') + ' }').join(', ')} };
        int[] box = { SheetSpec.PORTRAIT_W, SheetSpec.PORTRAIT_H };

        o.append('{');
        o.append("\\"constants\\":{");
        o.append("\\"min\\":").append(SheetSpec.MIN_FRAMES);
        o.append(",\\"max\\":").append(SheetSpec.MAX_FRAMES);
        o.append(",\\"secondsPerFrame\\":").append(SheetSpec.SECONDS_PER_FRAME);
        o.append(",\\"edgeInset\\":").append(SheetSpec.EDGE_INSET);
        o.append(",\\"cols\\":").append(SheetSpec.COLS);
        o.append(",\\"gutter\\":").append(SheetSpec.GUTTER);
        o.append(",\\"labelFontSize\\":").append(SheetSpec.LABEL_FONT_SIZE);
        o.append(",\\"labelInset\\":").append(SheetSpec.LABEL_INSET);
        o.append(",\\"labelPillAlpha\\":").append(SheetSpec.LABEL_PILL_ALPHA);
        o.append(",\\"labelPillRadius\\":").append(SheetSpec.LABEL_PILL_RADIUS);
        o.append(",\\"labelPadX\\":").append(SheetSpec.LABEL_PAD_X);
        o.append(",\\"labelPadY\\":").append(SheetSpec.LABEL_PAD_Y);
        o.append(",\\"jpegMaxBytes\\":").append(SheetSpec.JPEG_MAX_BYTES);
        o.append(",\\"budgetMs\\":").append(SheetSpec.BUDGET_MS);
        o.append(",\\"budgetBytes\\":").append(SheetSpec.BUDGET_BYTES);
        o.append(",\\"minGap\\":").append(SheetSpec.MIN_GAP);
        o.append("},");

        o.append("\\"keeps\\":[");
        for (int i = 0; i < arrivals.length; i++) {
            if (i > 0) o.append(',');
            int[] k = SheetSpec.keep(arrivals[i]);
            o.append('[');
            for (int j = 0; j < k.length; j++) { if (j > 0) o.append(','); o.append(k[j]); }
            o.append(']');
        }
        o.append("],");

        o.append("\\"counts\\":[");
        for (int i = 0; i < durations.length; i++) { if (i > 0) o.append(','); o.append(SheetSpec.frameCount(durations[i])); }
        o.append("],\\"times\\":[");
        for (int i = 0; i < durations.length; i++) {
            if (i > 0) o.append(',');
            double[] t = SheetSpec.times(durations[i]);
            o.append('[');
            for (int k = 0; k < t.length; k++) { if (k > 0) o.append(','); o.append(t[k]); }
            o.append(']');
        }
        o.append("],\\"cells\\":[");
        for (int i = 0; i < sizes.length; i++) {
            if (i > 0) o.append(',');
            int[] c = SheetSpec.cell(sizes[i][0], sizes[i][1]);
            o.append('[').append(c[0]).append(',').append(c[1]).append(']');
        }
        o.append("],\\"canvases\\":[");
        for (int i = 0; i < counts.length; i++) {
            if (i > 0) o.append(',');
            int[] c = SheetSpec.canvas(counts[i], box);
            o.append('[').append(c[0]).append(',').append(c[1]).append(']');
        }
        o.append("],\\"origins\\":[");
        int[] want = { 0, 4, 5, 24 };
        for (int i = 0; i < want.length; i++) {
            if (i > 0) o.append(',');
            int[] p = SheetSpec.origin(want[i], box);
            o.append('[').append(p[0]).append(',').append(p[1]).append(']');
        }
        o.append("],\\"labels\\":[");
        for (int i = 0; i < labelSeconds.length; i++) {
            if (i > 0) o.append(',');
            o.append("\\"").append(SheetSpec.label(labelSeconds[i])).append("\\"");
        }
        o.append("],\\"path\\":\\"")
         .append(SheetSpec.objectPath("11111111-2222-3333-4444-555555555555", "tt-7679960172495785246", 0))
         .append("\\"}");

        int[] wide = { SheetSpec.LANDSCAPE_W, SheetSpec.LANDSCAPE_H };
        int[] o5 = SheetSpec.origin(5, wide);
        if (o5[0] != 0 || o5[1] != wide[1] + SheetSpec.GUTTER) throw new AssertionError("landscape row wrap");
        int[] c25 = SheetSpec.canvas(25, wide);
        if (c25[0] != 5 * wide[0] + 4 * SheetSpec.GUTTER || c25[1] != 5 * wide[1] + 4 * SheetSpec.GUTTER) {
            throw new AssertionError("landscape canvas");
        }
        System.out.print(o);
    }
}
`);

const build = spawnSync(tool('javac'), [
  '-d', dir, 'android/app/src/main/java/app/spotter/dev/SheetSpec.java', join(dir, 'SheetCheck.java')
], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);

const run = spawnSync(tool('java'), ['-cp', dir, 'app.spotter.dev.SheetCheck'], { encoding: 'utf8', maxBuffer: 4e6 });
assert.equal(run.status, 0, run.stderr);
const actual = JSON.parse(run.stdout);

const mismatch = same(expected(), actual, 'java');
assert.equal(mismatch, '', mismatch);

for (let i = 0; i < DURATIONS.length; i++) {
  const t = actual.times[i], d = DURATIONS[i];
  for (let k = 1; k < t.length; k++) assert(t[k] >= t[k - 1], `times descend at ${d}`);
  if (Number.isFinite(d) && d > 1) assert(t[0] >= 0 && t[t.length - 1] <= d, `times outside 0..${d}`);
  assert(t.length >= spec.frames.min && t.length <= spec.frames.max, `frame count at ${d}`);
  assert.equal(contractHolds(d), '', `contract at ${d}`);
}

const box = [spec.cell.portrait.w, spec.cell.portrait.h];
for (const n of COUNTS) {
  const [w, h] = actual.canvases[COUNTS.indexOf(n)];
  const c = Math.min(spec.grid.cols, n), rows = Math.ceil(n / spec.grid.cols);
  assert.equal(w, c * box[0] + (c - 1) * spec.grid.gutter_px);
  assert.equal(h, rows * box[1] + (rows - 1) * spec.grid.gutter_px);
}
assert.deepEqual(actual.origins[3], [4 * (box[0] + spec.grid.gutter_px), 4 * (box[1] + spec.grid.gutter_px)]);
assert.match(actual.path, /^[0-9a-f-]{36}\/pack\/[a-z0-9-]+\/sheet-1\.jpg$/);
assert.deepEqual(actual.labels, ['0:00', '0:00', '0:04', '0:10', '1:00', '1:24', '2:05', '9:59']);
assert.deepEqual(actual.keeps[0], [0, 2, 1, 4, 7, 9]);
for (const kept of actual.keeps) {
  const t = kept.map(i => ARRIVALS[0][i]);
  for (let i = 1; i < t.length; i++) assert(t[i] - t[i - 1] >= spec.frames.min_gap_s, 'kept frames too close');
}

console.log('PASS Android sheet spec: identical frame counts, times, cells, tiling and M:SS labels to the iOS build and to native/sheet-spec.json');
