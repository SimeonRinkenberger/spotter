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
import { spec, expected, same, contractHolds, DURATIONS, SIZES, COUNTS, LABEL_SECONDS } from '../sheet-cases.mjs';

const dir = mkdtempSync(join(tmpdir(), 'spotter-sheet-test-'));

writeFileSync(join(dir, 'main.swift'), `
import Foundation

let durations: [Double] = [${DURATIONS.map(d => Number.isFinite(d) ? d : 'Double.nan').join(', ')}]
let sizes: [[Double]] = [${SIZES.map(([w, h]) => `[${w}, ${h}]`).join(', ')}]
let counts: [Int] = [${COUNTS.join(', ')}]
let labelSeconds: [Double] = [${LABEL_SECONDS.join(', ')}]
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
    "budgetBytes": SheetSpec.budgetBytes
  ],
  "counts": durations.map { SheetSpec.frameCount(duration: $0) },
  "times": durations.map { SheetSpec.times(duration: $0) },
  "cells": sizes.map { s -> [Int] in let c = SheetSpec.cell(videoWidth: s[0], videoHeight: s[1]); return [c.w, c.h] },
  "canvases": counts.map { n -> [Int] in let c = SheetSpec.canvas(count: n, cell: box); return [c.w, c.h] },
  "origins": [0, 4, 5, 24].map { i -> [Int] in let o = SheetSpec.origin(index: i, cell: box); return [o.x, o.y] },
  "labels": labelSeconds.map { SheetSpec.label(seconds: $0) },
  "path": SheetSpec.objectPath(uid: "11111111-2222-3333-4444-555555555555",
                               shortcode: "tt-7679960172495785246", index: 0)
]
// Portrait cells are what a TikTok save actually produces; the landscape box has
// to tile without overlap too, so it is checked on the way past.
let wide = (w: SheetSpec.landscape.w, h: SheetSpec.landscape.h)
let o5 = SheetSpec.origin(index: 5, cell: wide)
precondition(o5.x == 0 && o5.y == wide.h + SheetSpec.gutter, "landscape row wrap")
let c25 = SheetSpec.canvas(count: 25, cell: wide)
precondition(c25.w == 5 * wide.w + 4 * SheetSpec.gutter && c25.h == 5 * wide.h + 4 * SheetSpec.gutter, "landscape canvas")
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

// Cells must tile the canvas exactly: no cell may start outside it, and the last
// one must finish flush against its far edge.
const box = [spec.cell.portrait.w, spec.cell.portrait.h];
for (const n of COUNTS) {
  const [w, h] = actual.canvases[COUNTS.indexOf(n)];
  assert.equal(w, Math.min(spec.grid.cols, n) * box[0] + (Math.min(spec.grid.cols, n) - 1) * spec.grid.gutter_px);
  const rows = Math.ceil(n / spec.grid.cols);
  assert.equal(h, rows * box[1] + (rows - 1) * spec.grid.gutter_px);
}
assert.deepEqual(actual.origins[3], [4 * (box[0] + spec.grid.gutter_px), 4 * (box[1] + spec.grid.gutter_px)]);
assert.match(actual.path, /^[0-9a-f-]{36}\/pack\/[a-z0-9-]+\/sheet-1\.jpg$/);
assert.deepEqual(actual.labels, ['0:00', '0:00', '0:04', '0:10', '1:00', '1:24', '2:05', '9:59']);

console.log('PASS iOS sheet spec: frame count floor/cap/NaN, uniform times inside the duration, portrait/landscape/square cells, exact tiling with gutters, M:SS labels across the minute boundary, object path — all against native/sheet-spec.json');
