// Compiles ios/App/Shared/SheetSpec.swift against the macOS SDK — the same
// trick share-check.mjs plays on SharedLink.swift — and makes the real iOS
// arithmetic answer the case list in tools/sheet-cases.mjs. Nothing here draws
// or downloads anything: this is the half of the contact sheet that has to be
// identical on iOS, on Android and in the server's validator.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spec, expected, same, contractHolds, DURATIONS, SIZES, COUNTS, FRAME_TOTALS, LABEL_SECONDS, ARRIVALS } from '../sheet-cases.mjs';

const dir = mkdtempSync(join(tmpdir(), 'spotter-sheet-test-'));

writeFileSync(join(dir, 'main.swift'), `
import Foundation

let durations: [Double] = [${DURATIONS.map(d => Number.isFinite(d) ? d : 'Double.nan').join(', ')}]
let sizes: [[Double]] = [${SIZES.map(([w, h]) => `[${w}, ${h}]`).join(', ')}]
let counts: [Int] = [${COUNTS.join(', ')}]
let totals: [Int] = [${FRAME_TOTALS.join(', ')}]
let labelSeconds: [Double] = [${LABEL_SECONDS.join(', ')}]
let arrivals: [[Double]] = [${ARRIVALS.map(a => '[' + a.map(v => Number.isFinite(v) ? v : 'Double.nan').join(', ') + ']').join(', ')}]
let box = (w: SheetSpec.portrait.w, h: SheetSpec.portrait.h)

let out: [String: Any] = [
  "constants": [
    "min": SheetSpec.minFrames, "max": SheetSpec.maxFrames,
    "secondsPerFrame": SheetSpec.secondsPerFrame, "edgeInset": SheetSpec.edgeInset,
    "cols": SheetSpec.cols, "gutter": SheetSpec.gutter,
    "labelFontSize": SheetSpec.labelFontSize, "labelInset": SheetSpec.labelInset,
    "labelPillAlpha": SheetSpec.labelPillAlpha, "labelPillRadius": SheetSpec.labelPillRadius,
    "labelPadX": SheetSpec.labelPadX, "labelPadY": SheetSpec.labelPadY,
    "jpegMaxBytes": SheetSpec.jpegMaxBytes, "budgetMs": SheetSpec.budgetMs,
    "budgetBytes": SheetSpec.budgetBytes, "minGap": SheetSpec.minGap,
    "rowsPerSheet": SheetSpec.rowsPerSheet, "cellsPerSheet": SheetSpec.cellsPerSheet,
    "maxSheets": SheetSpec.maxSheets
  ],
  "sheetCounts": totals.map { SheetSpec.sheetCount(frames: $0) },
  "lastSheetCells": totals.map { SheetSpec.cells(inSheet: SheetSpec.sheetCount(frames: $0) - 1, frames: $0) },
  "frames": [0, 3, 4, 11].map { i -> [Int] in let f = SheetSpec.frame(index: i, cell: box); return [f.x, f.y, f.w, f.h] },
  "keeps": arrivals.map { SheetSpec.keep(times: $0) },
  "counts": durations.map { SheetSpec.frameCount(duration: $0) },
  "times": durations.map { SheetSpec.times(duration: $0) },
  "cells": sizes.map { s -> [Int] in let c = SheetSpec.cell(videoWidth: s[0], videoHeight: s[1]); return [c.w, c.h] },
  "canvases": counts.map { n -> [Int] in let c = SheetSpec.canvas(count: n, cell: box); return [c.w, c.h] },
  "origins": [0, 3, 4, 11].map { i -> [Int] in let o = SheetSpec.origin(index: i, cell: box); return [o.x, o.y] },
  "labels": labelSeconds.map { SheetSpec.label(seconds: $0) }
]
// Portrait cells are what a TikTok save actually produces; the landscape box has
// to tile without overlap too, so it is checked on the way past.
let wide = (w: SheetSpec.landscape.w, h: SheetSpec.landscape.h)
let o4 = SheetSpec.origin(index: 4, cell: wide)
precondition(o4.x == 0 && o4.y == wide.h, "landscape row wrap")
let full = SheetSpec.canvas(count: 12, cell: wide)
precondition(full.w == 4 * wide.w && full.h == 3 * wide.h, "landscape canvas")
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
`);

const xcode = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
const build = spawnSync(`${xcode}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc`, [
  '-sdk', `${xcode}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`,
  '-target', process.arch === 'arm64' ? 'arm64-apple-macosx14.0' : 'x86_64-apple-macosx14.0',
  '-module-cache-path', join(dir, 'cache'),
  'ios/App/Shared/SheetSpec.swift', join(dir, 'main.swift'), '-o', join(dir, 'check')
], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);

const run = spawnSync(join(dir, 'check'), [], { encoding: 'utf8', maxBuffer: 4e6 });
assert.equal(run.status, 0, run.stderr);
const actual = JSON.parse(run.stdout);

const mismatch = same(expected(), actual, 'swift');
assert.equal(mismatch, '', mismatch);

// The server rejects a frames block whose times are not ascending and inside the
// duration, so the phone must never be able to build one. Asserted on the
// numbers Swift itself returned, not on the JavaScript copy of them.
for (let i = 0; i < DURATIONS.length; i++) {
  const t = actual.times[i], d = DURATIONS[i];
  for (let k = 1; k < t.length; k++) assert(t[k] >= t[k - 1], `times descend at ${d}`);
  if (Number.isFinite(d) && d > 1) {
    assert(t[0] >= 0 && t[t.length - 1] <= d, `times outside 0..${d}`);
  }
  assert(t.length >= spec.frames.min && t.length <= spec.frames.max, `frame count at ${d}`);
  assert.equal(contractHolds(d), '', `contract at ${d}`);
}

// Cells must tile the canvas exactly: every cell inside it, the last one flush
// against its far edge, and the picture inside each cell inset by half a gutter
// so neighbours are two black pixels apart.
const box = [spec.cell.portrait.w, spec.cell.portrait.h];
for (const n of COUNTS) {
  const [w, h] = actual.canvases[COUNTS.indexOf(n)];
  assert.equal(w, Math.min(spec.grid.cols, n) * box[0], `canvas width at ${n}`);
  assert.equal(h, Math.ceil(n / spec.grid.cols) * box[1], `canvas height at ${n}`);
}
const full = actual.canvases[COUNTS.indexOf(12)];
assert.deepEqual(full, [1080, 1440], 'a full portrait sheet is the 1080x1440 the contract names');
assert.deepEqual(actual.origins[3], [3 * box[0], 2 * box[1]], 'last cell of a full sheet');
const inset = spec.grid.gutter_px / 2;
assert.deepEqual(actual.frames[0], [inset, inset, box[0] - spec.grid.gutter_px, box[1] - spec.grid.gutter_px]);
for (let i = 0; i < 4; i++) {
  const [x, y, w, h] = actual.frames[i];
  assert(x >= 0 && y >= 0 && x + w <= full[0] && y + h <= full[1], 'picture outside its sheet');
}
// Every frame lands on exactly one cell of exactly one sheet, and no sheet holds
// more cells than its grid: this is the invariant the server counts on.
for (const n of FRAME_TOTALS) {
  const sheets = actual.sheetCounts[FRAME_TOTALS.indexOf(n)];
  assert(sheets >= 1 && sheets <= spec.grid.max_sheets, `sheet count at ${n}`);
  assert.equal(actual.lastSheetCells[FRAME_TOTALS.indexOf(n)],
    n - (sheets - 1) * spec.grid.cells_per_sheet, `last sheet cells at ${n}`);
}
assert.deepEqual(actual.sheetCounts, [1, 1, 1, 2, 2, 3, 3, 3]);
assert.deepEqual(actual.lastSheetCells, [1, 8, 12, 1, 12, 1, 11, 12]);
assert.deepEqual(actual.labels, ['0:00', '0:00', '0:04', '0:10', '1:00', '1:24', '2:05', '9:59']);

// A duplicate sync sample, a NaN and a negative from a generator that gave up on
// one time must all leave the kept frames strictly ascending — the server rejects
// a frames block whose times are not.
assert.deepEqual(actual.keeps[0], [0, 2, 1, 4, 7, 9]);
for (const kept of actual.keeps) {
  const t = kept.map(i => ARRIVALS[0][i]);
  for (let i = 1; i < t.length; i++) assert(t[i] - t[i - 1] >= spec.frames.min_gap_s, 'kept frames too close');
}

console.log('PASS iOS sheet spec: frame count floor/cap/NaN, uniform times inside the duration, portrait/landscape/square cells, 4x3 tiling with inside-cell gutters, 1 to 3 sheets with every frame placed once, M:SS labels across the minute boundary — all against native/sheet-spec.json');
