// The third implementation of the contact-sheet math.
//
// native/sheet-spec.json is the contract; ios/App/Shared/SheetSpec.swift and
// android/.../SheetSpec.java are the two copies that actually run on a phone.
// This file reads the JSON and derives the answers independently, so each
// platform check is "the phone agrees with the contract" rather than "the phone
// agrees with itself". Both sheet-check scripts drive the same case list, which
// is what makes iOS and Android provably identical without either one importing
// the other.

import fs from 'node:fs';

export const spec = JSON.parse(fs.readFileSync('native/sheet-spec.json', 'utf8'));

const F = spec.frames, C = spec.cell, G = spec.grid;

export function frameCount(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return F.min;
  return Math.min(F.max, Math.max(F.min, Math.ceil(duration / F.seconds_per_frame)));
}

export function times(raw) {
  const duration = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const n = frameCount(duration);
  const first = Math.min(F.edge_inset_s, Math.max(0, duration / 2));
  const last = Math.max(first, duration - F.edge_inset_s);
  const step = n > 1 ? (last - first) / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => first + step * i);
}

export function cell(w, h) {
  if (!(w > 0) || !(h > 0)) return [C.portrait.w, C.portrait.h];
  const ratio = w / h;
  if (ratio > 1 + C.square_band) return [C.landscape.w, C.landscape.h];
  if (ratio < 1 - C.square_band) return [C.portrait.w, C.portrait.h];
  return [C.square.w, C.square.h];
}

export const rows = count => Math.max(1, Math.ceil(Math.max(1, count) / G.cols));

export function canvas(count, box) {
  const c = Math.min(G.cols, Math.max(1, count));
  return [c * box[0] + (c - 1) * G.gutter_px, rows(count) * box[1] + (rows(count) - 1) * G.gutter_px];
}

export const origin = (i, box) =>
  [(i % G.cols) * (box[0] + G.gutter_px), Math.floor(i / G.cols) * (box[1] + G.gutter_px)];

export function keep(times) {
  const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b] || a - b);
  const out = [];
  let last = -Infinity;
  for (const i of order) {
    if (!Number.isFinite(times[i]) || times[i] < 0 || times[i] - last < F.min_gap_s) continue;
    out.push(i); last = times[i];
  }
  return out;
}

export function label(seconds) {
  const whole = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

export const objectPath = (uid, shortcode, i) => `${uid}/pack/${shortcode}/sheet-${i + 1}.jpg`;

// Durations that matter: zero and nonsense (a retriever that could not read the
// header), the WODfather clip the design is built on, the floor and the cap, and
// the clip too short to hold the half-second inset at both ends.
export const DURATIONS = [0, -5, NaN, 0.8, 1, 12, 28, 28.1, 84.3, 87.5, 200];
export const SIZES = [[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1100], [1100, 1080], [0, 0]];
export const COUNTS = [1, 3, 5, 8, 24, 25];
export const LABEL_SECONDS = [0, 0.4, 4, 9.5, 59.6, 83.8, 125, 599];
// Arrival order, not time order: a duplicate sync sample (3.5 twice), a frame
// that came back early, one negative and one NaN from a generator that failed
// that time, and a pair 0.04 s apart — closer than one frame of 24 fps video.
export const ARRIVALS = [[0.5, 4.0, 3.5, 3.5, 7.5, -1, NaN, 11.0, 11.04, 14.5]];

/** What both platforms must print, as one comparable object. */
export function expected() {
  return {
    constants: {
      min: F.min, max: F.max, secondsPerFrame: F.seconds_per_frame, edgeInset: F.edge_inset_s,
      cols: G.cols, gutter: G.gutter_px,
      labelFontSize: spec.label.font_px, labelInset: spec.label.inset_px,
      labelPillAlpha: spec.label.pill_alpha, labelPillRadius: spec.label.pill_radius_px,
      labelPadX: spec.label.pill_pad_x_px, labelPadY: spec.label.pill_pad_y_px,
      jpegMaxBytes: spec.jpeg.max_bytes, budgetMs: spec.budget.wall_clock_ms,
      budgetBytes: spec.budget.download_bytes, minGap: F.min_gap_s
    },
    keeps: ARRIVALS.map(keep),
    counts: DURATIONS.map(frameCount),
    times: DURATIONS.map(times),
    cells: SIZES.map(([w, h]) => cell(w, h)),
    canvases: COUNTS.map(n => canvas(n, [C.portrait.w, C.portrait.h])),
    origins: [0, 4, 5, 24].map(i => origin(i, [C.portrait.w, C.portrait.h])),
    labels: LABEL_SECONDS.map(label),
    path: objectPath('11111111-2222-3333-4444-555555555555', 'tt-7679960172495785246', 0)
  };
}

/** Deep compare with a tolerance, so a float printed by Swift or Java matches. */
export function same(a, b, path = '') {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return `${path}: length ${a?.length} vs ${b?.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const bad = same(a[i], b[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return '';
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9 ? '' : `${path}: ${a} vs ${b}`;
  }
  if (a && b && typeof a === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const bad = same(a[key], b[key], `${path}.${key}`);
      if (bad) return bad;
    }
    return '';
  }
  return a === b ? '' : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

/** The invariants the server validates, asserted on whatever the phone produced. */
export function contractHolds(duration) {
  const t = times(duration), n = frameCount(duration);
  if (t.length !== n) return 'time count';
  for (let i = 1; i < t.length; i++) if (!(t[i] >= t[i - 1])) return 'times not ascending';
  if (duration > 1 && (t[0] < 0 || t[t.length - 1] > duration)) return 'time outside duration';
  if (n < spec.frames.min || n > spec.frames.max) return 'frame count outside bounds';
  if (n > spec.grid.cols * rows(n)) return 'grid too small';
  return '';
}
