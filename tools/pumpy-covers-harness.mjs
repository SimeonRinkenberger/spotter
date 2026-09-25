// Pumpy's covers on the client and on disk. No database, no network.
//
//   files     35 WebPs, 640x800 (the tile's 4:5), one per key, under the byte budget
//   lists     the migration's pumpy_cover_keys(), app.ts's list and the files agree
//   pumpyCover a stored key the build ships is used as is; none, or one this build
//             does not ship, falls back to the card id's drawing, the same on every paint
//   cardNode  the real function draws covers/<key>.webp on a Pumpy card, never a
//             category picture, and the Pumpy mark if the file will not load
//   surfaces  every place a card's picture is drawn asks cardArt
//
// node tools/pumpy-covers-harness.mjs
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const DIR = 'docs/assets/pumpy/covers/';
const BUDGET = 1.5 * 1024 * 1024;
const APP = readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const SQL = readFileSync('supabase/migrations/20260925100000_pumpy_covers.sql', 'utf8');
let passed = 0;
function ok(what) { passed++; console.log('PASS ' + what); }

// ---------- files ----------
const files = readdirSync(DIR).sort();
const names = files.filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5));
assert.equal(names.length, files.length, 'nothing but .webp in covers/');
assert.equal(names.length, 35);
let total = 0;
for (const f of files) {
  const b = readFileSync(DIR + f);
  total += b.length;
  assert.equal(b.toString('latin1', 0, 4), 'RIFF', f);
  assert.equal(b.toString('latin1', 8, 12), 'WEBP', f);
  assert.equal(b.toString('latin1', 12, 16), 'VP8 ', f + ' is lossy VP8');
  // VP8 key frame: start code 9d 01 2a at 23, then 14-bit width and height.
  assert.deepEqual([...b.subarray(23, 26)], [0x9d, 0x01, 0x2a], f);
  const w = b.readUInt16LE(26) & 0x3fff, h = b.readUInt16LE(28) & 0x3fff;
  assert.deepEqual([w, h], [640, 800], f + ' is 640x800');
  assert(b.length < 64 * 1024, f + ' ' + b.length + ' bytes');
}
assert(total <= BUDGET, 'all 35 in ' + total + ' bytes');
ok('files: 35 VP8 WebPs at 640x800, largest under 64 KB, ' + total + ' bytes in all (budget ' + BUDGET + ')');

// ---------- one list ----------
const sqlKeys = [...SQL.slice(SQL.indexOf('select array['), SQL.indexOf(']::text[]')).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
assert.deepEqual(sqlKeys, names, 'pumpy_cover_keys() lists the files in order');
const lift = (name) => {
  const at = APP.indexOf('\n  function ' + name + '(');
  assert(at >= 0, name);
  return APP.slice(at, APP.indexOf('\n  }\n', at) + 4);
};
const fnBody = (name) => lift(name);
const inApp = (ctx, src) => JSON.parse(vm.runInContext('JSON.stringify(' + src + ')', ctx));
const host = { hostname: 'localhost' };
const ctx = vm.createContext({ location: host });
vm.runInContext('var pumpyCoverList = null;' + ['pumpyCovers', 'pumpyCover', 'pumpyAsset', 'cardArt'].map(lift).join('\n'), ctx);
assert.deepEqual(inApp(ctx, 'pumpyCovers()'), names, 'app.ts lists the files in order');
ok('lists: the migration, app.ts and the directory name the same 35 drawings in the same order');

// ---------- pumpyCover / cardArt ----------
{
  const id = '3f2a9c10-1111-4111-8111-111111111111';
  const fallback = names[parseInt('3f2a9c10', 16) % 35];
  assert.equal(inApp(ctx, 'pumpyCover({ id: "' + id + '", pumpy_cover: "tire-flip" })'), 'tire-flip', 'a stored key is used');
  assert.equal(inApp(ctx, 'pumpyCover({ id: "' + id + '", pumpy_cover: null })'), fallback, 'no key: the id chooses');
  assert.equal(inApp(ctx, 'pumpyCover({ id: "' + id + '" })'), fallback, 'a row from a build-8 cache has no field at all');
  assert.equal(inApp(ctx, 'pumpyCover({ id: "' + id + '", pumpy_cover: "a-drawing-from-build-12" })'), fallback,
    'a key this build does not ship falls back instead of a broken image');
  const many = inApp(ctx, 'Array.apply(null, Array(50)).map(function () { return pumpyCover({ id: "' + id + '" }); })');
  assert(many.every((k) => k === fallback), 'stable across paints');
  assert.equal(inApp(ctx, 'pumpyCover({ id: "not-a-uuid" })'), names[0], 'an id that is not hex still draws something');
  assert.equal(inApp(ctx, 'pumpyCover({})'), names[0]);
  assert.equal(inApp(ctx, 'cardArt({ id: "' + id + '", platform: "pumpy", pumpy_cover: "deadlift", thumb_url: null })'),
    './assets/pumpy/covers/deadlift.webp?v=12');
  assert.equal(inApp(ctx, 'cardArt({ id: "x", platform: "tiktok", thumb_url: "https://x.supabase.co/t.jpg", pumpy_cover: "deadlift" })'),
    'https://x.supabase.co/t.jpg', 'a video card keeps its own thumbnail');
  assert.equal(inApp(ctx, 'cardArt({ id: "x", platform: "web", thumb_url: null })'), null);
  host.hostname = 'mtzevoxxpsktmrbbuxva.supabase.co';
  assert.equal(inApp(ctx, 'cardArt({ id: "' + id + '", platform: "pumpy", pumpy_cover: "deadlift" })'),
    'https://simeonrinkenberger.github.io/spotter/assets/pumpy/covers/deadlift.webp?v=12', 'served by the function, the art is on Pages');
  host.hostname = 'localhost';
  ok('pumpyCover: stored key used; missing, unknown or future keys fall back to the id, stably; cardArt leaves video cards alone');
}

// ---------- cardNode, the real one ----------
{
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.className = '';
      this.complete = false; this.naturalWidth = 0; this._html = '';
      const self = this;
      this.classList = {
        add(...c) { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
        remove(...c) { self.className = self.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
        contains(c) { return self.className.split(' ').includes(c); },
        toggle(c, on) { if (on) this.add(c); else this.remove(c); },
      };
    }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener() {}
    set innerHTML(v) { this._html = v; this.children = []; }
    get innerHTML() { return this._html; }
    find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find && c.find(pred); if (r) return r; } return null; }
  }
  const dom = vm.createContext({
    location: host,
    document: { createElement: (t) => new Node(t), createTextNode: (t) => ({ text: t }) },
    pendingMotion: null, PUMPY_MARK: '<svg data-mark></svg>',
    isPending: () => false, isFailed: () => false, cardIn() {}, stageOf: () => ({}), failedGlyph() {}, failedKick() {},
    ic: (name) => { const n = new Node('svg'); n.attrs.icon = name; return n; },
    cardMeta: () => '', openDetail() {}, fmtDur: () => null, capWord: (s) => s,
  });
  vm.runInContext('var pumpyCoverList = null;' + ['el', 'icon', 'pumpyCovers', 'pumpyCover', 'pumpyAsset', 'cardArt', 'noArt', 'cardNode'].map(lift).join('\n'), dom);
  const draw = (w) => { dom.w = w; return vm.runInContext('cardNode(w, 0)', dom); };
  const imgOf = (card) => card.find((n) => n.tagName === 'IMG');
  const fresh = { id: '0a000000-0000-4000-8000-000000000001', platform: 'pumpy', category: 'Legs', title: 'Legs', pumpy_cover: 'sled-push', ingest_status: 'ready' };
  assert.equal(imgOf(draw(fresh)).src, './assets/pumpy/covers/sled-push.webp?v=12');
  const legacy = { ...fresh, id: '0b000000-0000-4000-8000-000000000002', pumpy_cover: null, category: 'Core' };
  const a = imgOf(draw(legacy)).src, b = imgOf(draw(legacy)).src;
  assert.equal(a, b, 'an older card draws the same cover every time');
  assert.equal(a, './assets/pumpy/covers/' + names[0x0b000000 % 35] + '.webp?v=12');
  for (const category of ['Legs', 'Core', 'Upper', 'Other']) {
    assert(!/workout-(legs|core|upper)/.test(imgOf(draw({ ...legacy, category })).src), 'no category picture for ' + category);
  }
  assert.equal(imgOf(draw(fresh)).className, '', 'the cover fills the 4:5 tile like any card (no letterbox class)');
  // The file will not load: the tile says whose card it is, not a dumbbell.
  const card = draw(fresh), img = imgOf(card);
  img.onerror();
  assert(card.find((n) => n._html === '<svg data-mark></svg>' && /pumpyimg/.test(n.className)), 'the Pumpy mark stands in');
  const video = { id: 'v', platform: 'tiktok', thumb_url: 'https://x/t.jpg', ingest_status: 'ready' };
  const vcard = draw(video), vimg = imgOf(vcard);
  assert.equal(vimg.src, 'https://x/t.jpg');
  vimg.onerror();
  assert(vcard.find((n) => n.attrs.icon === 'dumbbell'), 'a video card still falls back to the dumbbell');
  ok('cardNode: covers/<key>.webp for a new card, a stable id-chosen cover for an older one, never a category picture, the Pumpy mark on a failed load');
}

// ---------- every surface that draws a card's picture ----------
{
  for (const fn of ['cardNode', 'fromChip', 'planItem', 'openPicker', 'renderRefList']) {
    assert(/cardArt\((w|src)\)/.test(fnBody(fn)), fn + ' asks cardArt');
  }
  const today = APP.slice(APP.indexOf('var thumb, art = cardArt(w);') - 400, APP.indexOf('var thumb, art = cardArt(w);') + 200);
  assert(/tthumb/.test(today), "Train's today card asks cardArt");
  assert(!/pumpyAsset\("workout-/.test(APP), 'no category picture is chosen anywhere in app.ts');
  // The source disclosure's .dphoto is the one picture still drawn from thumb_url:
  // it is the video's own photo, and a Pumpy card has no source disclosure.
  assert(!/\.thumb_url\) \{\s*(var )?(img|thumb) = el\("img"(, "tthumb")?\);/.test(APP), 'no card tile drawn straight from thumb_url any more');
  const decl = APP.slice(APP.indexOf('  var CARD_COLS = '), APP.indexOf('  var CARD_KEYS'));
  assert(/pumpy_cover/.test(decl), 'load() and pollPending read pumpy_cover');
  assert(/w\.thumb_url, w\.pumpy_cover,/.test(APP), "the grid's signature redraws a card whose cover arrives");
  assert(!/pumpy-cover/.test(readFileSync('supabase/functions/spotter/style.ts', 'utf8')), 'the letterbox rule is gone');
  ok('surfaces: Library grid, source chips, Train today card, plan rows, the day picker and the Pumpy reference list all ask cardArt; CARD_COLS and the grid signature carry pumpy_cover');
}

console.log('PASS ' + passed + ' Pumpy cover client checks');
