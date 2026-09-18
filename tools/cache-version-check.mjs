// What a version bump is allowed to cost. No network, no AI, no database.
//
// CARD_V/PACK_V are what the reader WRITES; MIN_USABLE_CARD_V/MIN_USABLE_PACK_V
// are what it still SERVES. If a bump ever moves both together the shared cache
// empties at cutover and every save of an already-read video becomes a fresh paid
// extraction — tens of them spend the whole $0.50 daily guard. These assertions
// are the fence around that, exercised on the shipping source.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const src = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
const packSrc = fs.readFileSync('supabase/functions/spotter/pack.ts', 'utf8');
const num = (text, name) => {
  const m = text.match(new RegExp('(?:export )?const ' + name + ' = (\\d+)'));
  assert(m, name + ' is missing');
  return Number(m[1]);
};
function fn(text, name) {
  const m = text.match(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
  assert(m, name);
  return text.slice(m.index, text.indexOf('\n}', m.index) + 2).replace(/^export /, '');
}

const CARD_V = num(src, 'CARD_V');
const MIN_USABLE_CARD_V = num(src, 'MIN_USABLE_CARD_V');
const PACK_V = num(packSrc, 'PACK_V');
const MIN_USABLE_PACK_V = num(packSrc, 'MIN_USABLE_PACK_V');

// ---------- the constants themselves ----------
assert(MIN_USABLE_CARD_V <= CARD_V, 'the minimum card version cannot exceed what we write');
assert(MIN_USABLE_PACK_V <= PACK_V, 'the minimum pack version cannot exceed what we write');
assert(CARD_V - MIN_USABLE_CARD_V <= 1,
  'more than one card shape behind: either widen deliberately or retire the old shape, do not drift');
// The rule is only useful if the next person to bump a version reads it, so it
// lives between the two constants and is asserted to still be there.
const rule = src.slice(src.indexOf('const CARD_V ='), src.indexOf('const MIN_USABLE_CARD_V ='));
for (const word of ['WRITE', 'READ', 'stale', 'mass re-read', 'FIELDS ABSENT']) {
  assert(rule.includes(word), 'the rule where the constants live no longer explains: ' + word);
}

// ---------- the three cache-hit gates, and the two upgrade points ----------
const gates = src.match(/v=gte\.\$\{MIN_USABLE_CARD_V\}/g) ?? [];
assert.equal(gates.length, 3, 'save, worker seed and handleReadVideo all read from the minimum');
assert.equal((src.match(/v=gte\.\$\{CARD_V\}/g) ?? []).length, 1,
  'only handleReprocess — an explicit paid re-read — still demands the current shape');
assert.match(src, /const usable = cached && Number\(cached\.v\) >= CARD_V && cached\.card;/,
  'mediaSeed rebuilds an old card instead of re-stamping it as current');
assert.match(src, /pack_v=gte\.\$\{MIN_USABLE_PACK_V\}&pack_v=lte\.\$\{PACK_V\}/,
  'the coach reads the readable range of pack shapes, not one exact shape');

// ---------- the decisions, run ----------
const c = vm.createContext({ console, CARD_V, MIN_USABLE_CARD_V, PACK_V, MIN_USABLE_PACK_V, Date, Set, Map, JSON, Number, String, Array, Promise, structuredClone, encodeURIComponent });
const decisions = ['usablePack', 'visuallyRead', 'cacheStale', 'markCache', 'cacheForAccess', 'plusPlan', 'readQuality', 'labelRecommendations', 'basicMeta'];
vm.runInContext(transformSync(decisions.map((n) => fn(src, n)).join('\n'), { loader: 'ts', format: 'cjs' }).code, c);

// The row the whole finding is about: written by the deployed build, one card
// shape and one pack shape behind everything this build writes.
const v1pack = {
  pack_v: MIN_USABLE_PACK_V, reader: 'sheets:gemini-3.6-flash', shortcode: 'legacy-1',
  visual: 'read', transcript_source: 'tiktok_vtt', transcript: [{ t0: 1, t1: 3, text: 'Squat slowly.' }],
  on_screen: [], session: { format: null, scheme: null, rounds: null, setting: null, load_seen: null },
  exercises: [{
    i: 0, name_shown: 'Goblet Squat', name_said: 'goblet squat', canonical_id: 'goblet-squat',
    t0: 1, t1: 9, reps_seen: 8, variant: { equipment: ['kettlebell'], load_position: 'front rack' },
    delta_from_standard: null, creator_cues: [{ t: 1, quote: 'Squat slowly.' }],
    seen_not_said: ['Kettlebell held at the chest'], needs_requery: false,
    provenance: { name: 'said', reps: 'said', variant: 'seen', cues: 'said' },
  }],
};
const premium = { title: 'Plus card', blocks: [{ type: 'straight', exercises: [{ name: 'Goblet Squat', canonical_id: 'goblet-squat', sets: 3, reps: null }] }] };
const legacyRow = {
  shortcode: 'legacy-1', card: premium, v: MIN_USABLE_CARD_V, pack: v1pack, pack_v: MIN_USABLE_PACK_V,
  read_quality: 'premium', read_plan: 'plus', media_source: 'pack:sheets', caption: 'A caption', thumb_url: null, author: 'fixture',
  basic_card: { title: 'Basic card', blocks: [] }, basic_v: MIN_USABLE_CARD_V,
};

c.row = legacyRow;
assert(vm.runInContext('usablePack(row)', c), 'a pack one shape behind is still a reading somebody paid for');
assert.equal(vm.runInContext('visuallyRead(row)', c), true, 'so the video counts as watched');
assert.equal(vm.runInContext('cacheStale(row)', c), true, 'and it is marked as older than what we write');
const plus = vm.runInContext('cacheForAccess(row, true)', c);
assert(plus, 'a Plus save of a legacy row is a cache HIT, not a fresh extraction');
assert.equal(plus.stale, true);
assert.equal(plus.card.title, 'Plus card');
const free = vm.runInContext('cacheForAccess(row, false)', c);
assert(free, 'and so is a Basic one');
assert.equal(free.card.title, 'Basic card');
assert.equal(free.stale, true);
assert.equal(free.pack, null, 'entitlement still decides what a Basic account may see');

c.row = { ...legacyRow, v: CARD_V, basic_v: CARD_V, pack_v: PACK_V, pack: { ...v1pack, pack_v: PACK_V } };
assert.equal(vm.runInContext('cacheStale(row)', c), false, 'a current row is not marked stale');
c.row = { ...legacyRow, pack_v: PACK_V + 1, pack: { ...v1pack, pack_v: PACK_V + 1 } };
assert.equal(vm.runInContext('usablePack(row)', c), undefined, 'a shape from the future is ignored, not half-read');
c.row = { ...legacyRow, card: null, v: MIN_USABLE_CARD_V - 1, basic_card: { title: 'Ancient' }, basic_v: MIN_USABLE_CARD_V - 1, pack: null, pack_v: null, media_source: null };
assert.equal(vm.runInContext('cacheForAccess(row, false)', c), null, 'below the minimum is still rebuilt');
console.log('PASS legacy card and pack shapes are served, marked stale, and entitlement-filtered as before.');

// ---------- a free preview of a legacy row reserves nothing ----------
const calls = [];
c.json = (body) => body;
c.providerFor = () => ({ media: true, cacheable: true });
c.parseFrames = () => ({ error: 'no frames in this fixture' });
c.deleteSheets = async () => { calls.push('deleteSheets'); };
c.countsFor = async () => ({ extracts: 0, saves: 0 });
c.capsFor = async () => ({ plan: 'free', caps: { extract: 60, media: 15, saves: 200, library: 200 } });
c.premiumAccess = async () => false;
c.mergeNoDowngrade = (_w, card) => structuredClone(card);
c.overCap = () => false;
c.mediaCapReached = async () => null;
// The monthly allowance has its own check (tools/allowance-table-check.ts); here
// the account has room left, so what is under test stays the cache cutover.
c.monthReadsReached = async () => null;
c.allowanceLimit = async () => ({ status: 'limit', scope: 'month' });
c.paidAllowed = async () => true;
c.extractLimitResponse = async () => ({ status: 'limit' });
c.capLimit = async () => ({ status: 'limit' });
c.dbDelete = async () => { calls.push('dbDelete'); };
c.dbPatch = async () => {};
c.kickWorker = () => {};
c.jobStep = async () => {};
c.mediaSeed = () => ({ step: 'card', meta: {}, card: null });
let cacheRow = legacyRow;
c.dbSelect = async (table) => table === 'workouts'
  ? [{ id: 'w1', user_id: 'u1', shortcode: 'legacy-1', platform: 'tiktok', ingest_status: 'ready', blocks: [], title: 'Mine' }]
  : [cacheRow];
c.rpc = async (name) => {
  calls.push(name);
  if (name === 'complete_cached_preview') return { status: 'ok', workout: { id: 'w1' } };
  if (name === 'reserve_video_preview') return true;
  return [undefined];
};
vm.runInContext(transformSync(fn(src, 'handleReadVideo'), { loader: 'ts', format: 'cjs' }).code, c);
c.req = { json: async () => ({ preview: true }) };
const served = await vm.runInContext('handleReadVideo("w1","u1",req,{})', c);
assert.equal(served.cached, true, 'the preview is answered from the legacy row');
assert.deepEqual(calls, ['complete_cached_preview'],
  'no reservation, no requeue, no paid read: a stale hit costs nothing and consumes no preview');

// The discrimination check: the same route on a row this build genuinely cannot
// read does reserve a preview, so the assertion above is about the version gate
// and not about a fixture that never reaches the paid path.
calls.length = 0;
cacheRow = { ...legacyRow, pack_v: PACK_V + 1, pack: { ...v1pack, pack_v: PACK_V + 1 } };
await vm.runInContext('handleReadVideo("w1","u1",req,{})', c);
assert(calls.includes('reserve_video_preview'), 'an unreadable row costs a preview, which is the cost being avoided');
console.log('PASS a legacy card and pack answer a free preview with no reservation and no paid work.');

// ---------- and the save path does no paid upgrade on one ----------
//
// handleIngest's cache hit calls upgradeCachedCard, which is where a Plus save
// decides whether to pay to read the video after all. A legacy row that was
// visually read must come out of that as "nothing to do": the reading exists, it
// is one shape old, and paying to redo it is the whole cost this change avoids.
calls.length = 0;
c.requeue = null;
c.rpc = async (name) => { calls.push(name); return [c.requeue]; };
c.settledAll = (all) => Promise.all(all);
c.setMediaStage = async () => {};
c.upgradeSpy = () => calls;
vm.runInContext(transformSync(fn(src, 'upgradeCachedCard'), { loader: 'ts', format: 'cjs' }).code, c);
c.legacy = legacyRow;
assert.equal(await vm.runInContext('upgradeCachedCard("u1", { platform: "tiktok", shortcode: "legacy-1" }, legacy, "w1", {})', c), null,
  'a Plus save of a legacy row that was already watched queues no paid read');
assert.deepEqual(calls, [], 'and reserves nothing');
// The discrimination case again: a row nobody ever watched still upgrades.
c.premiumAccess = async () => true;
c.requeue = { job_id: 'j1', job_created: true };
c.thin = { ...legacyRow, pack: null, pack_v: null, media_source: null, media_tried: false };
const queued = await vm.runInContext('upgradeCachedCard("u1", { platform: "tiktok", shortcode: "legacy-1" }, thin, "w1", {})', c);
assert(queued, 'a thin card is still upgraded, so the assertion above is about the pack and not about a dead path');
assert(calls.includes('requeue_ingest'));
console.log('PASS a legacy row is a save-path cache hit with no paid upgrade; a thin one still upgrades.');

// ---------- consumers of a legacy pack degrade to "field absent" ----------
c.normText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
c.packInTimeOrder = () => true;
c.sharesHeadNoun = (a, b) => c.normText(a).split(' ').some((w) => c.normText(b).split(' ').includes(w));
c.bestSeenFact = (facts) => facts?.[0] ?? null;
c.Math = Math;
vm.runInContext(transformSync([fn(src, 'matchPackExercise'), fn(src, 'packEvidence'), fn(src, 'applyPack')].join('\n'), { loader: 'ts', format: 'cjs' }).code, c);
c.card = structuredClone(premium);
c.pack = v1pack;
vm.runInContext('applyPack(card, pack)', c);
const stamped = c.card.blocks[0].exercises[0];
assert.equal(stamped.reps, null, 'a pack with no prescription leaves the dose null, never 0');
assert.equal(stamped.dose_evidence, undefined, 'and claims no evidence it does not have');
assert.deepEqual(stamped.as_performed, v1pack.exercises[0].variant, 'everything the old shape does carry still lands');
assert.equal(stamped.evidence.quote, 'Squat slowly.');
assert.equal(stamped.t0, 1);
console.log('PASS applyPack reads a legacy pack as fields absent, not as zeroes.');

console.log('All cache version checks passed. Old shapes are served, marked, and upgraded only by paid paths that already exist.');
