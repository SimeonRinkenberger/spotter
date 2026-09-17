// No network/model: regressions for source attribution, uncertainty and scorer validity.
import { assemblePack, packBlock, parseFrames, readObservation, sheetsPrompt,
  universalRepPrescriptions, validatePack, type Observation } from '../../supabase/functions/spotter/pack.ts';
import { hasAffirmedPhrase, score, type Fixture } from './score.ts';
let checks = 0;
function check(ok: unknown, message: string) { checks++; if (!ok) throw new Error(message); }
const observation: Observation = { duration_s: 30, session: { format: null, scheme: '5 reps each',
  equipment_seen: ['kettlebell'], equipment_count: { kettlebell: 1 }, setting: null }, on_screen: [],
  segments: [{ t0: '1.25', t1: '10.75', movement: 'close grip push up', contact: 'hands on kettlebell',
    hand_placement: 'hands close together on bell', foot_placement: 'feet together', load_position: '',
    range_of_motion: 'chest to bell', tempo: 'slow eccentric', reps_visible: null, unilateral: false, confidence: .8 }] };
function pack(text: string, obs = observation) {
  return assemblePack({shortcode: 'test', platform: 'tiktok', observation: obs,
    transcript: [{ t0: 0, t1: 1, text }], transcriptSource: 'tiktok_vtt'});
}
const p = pack('Do five reps for every exercise.');
check(p.exercises[0].reps_seen === null && p.exercises[0].provenance.reps === 'none', 'prescribed reps must not become visible count');
check(p.exercises[0].reps_prescribed === 5, 'explicit global prescription must survive');
check(p.exercises[0].canonical_id === 'push-up', 'narrow bell support is not a diamond hand shape');
check(validatePack(p).ok, 'source-backed pack verifies');
const counted = pack('Do eight reps for every exercise.', {...observation, segments: [{...observation.segments[0], reps_visible: 2}]});
check(counted.exercises[0].reps_seen === 2 && counted.exercises[0].reps_prescribed === 8 && counted.exercises[0].provenance.reps === 'seen', 'two observed reps and eight prescribed remain independent');
check(pack('Do five reps for every exercise. Do eight reps for every exercise.').exercises[0].reps_prescribed === null, 'conflicting instructions do not silently choose a dose');
for (const text of ['Do not do five reps for every exercise.', 'I performed five reps for every exercise.', 'If tired, five reps for every exercise.', 'Five reps each side.', 'For the first two exercises, five reps apiece.', 'Five reps per exercise except push-ups ten.', 'Five reps per exercise, but push-ups are ten.']) {
  check(universalRepPrescriptions(text, 'said', 0, 5).length === 0, 'ambiguous/conditional/demo scope: ' + text);
}
check(universalRepPrescriptions("We're doing five different exercises, five reps apiece.", 'said', 0, 5)[0]?.value === 5, 'declared exercise count matching video supports apiece');
check(universalRepPrescriptions("We're doing two different exercises, five reps apiece.", 'said', 0, 5).length === 0, 'subset cannot prescribe entire video');
const block = packBlock(p);
for (const text of ['tempo=slow eccentric', 'range_of_motion=chest to bell', 'stance=feet together', 'unilateral=false', 'not provided by the creator']) check(block.includes(text), 'pack preserves ' + text);
check(readObservation(observation)?.segments[0].t0 === '1.25', 'reader normalization retains subsecond times');
const bogus = structuredClone(p); bogus.exercises[0].rep_prescriptions![0].quote = 'made up';
check(!validatePack(bogus).ok, 'fabricated quoted prescription fails');
check(!hasAffirmedPhrase('kettlebell, not a barbell', 'barbell'), 'negated equipment not a violation');
check(!hasAffirmedPhrase('kettlebell rather than a barbell', 'barbell'), 'contrast equipment not a violation');
check(hasAffirmedPhrase('not a barbell; use a barbell', 'barbell'), 'later affirmative equipment is caught');
check(!hasAffirmedPhrase('barbells', 'barbell'), 'phrase scanner respects word boundaries');
const fx: Fixture = {shortcode:'test', platform:'tiktok', visual:'read', exercises:[{i:0,name_shown:'missing squat',canonical_id:'squat',t0:2,t1:8}]};
const scored = score(fx,p,null);
check(scored.timestamps.expected_boundaries === 2 && scored.timestamps.missing_boundaries === 2 && scored.timestamps.measured_boundaries === 0, 'missing movements stay in timing denominator');
const uid='tester', sc='test';
const manifest = {source:'android',duration_s:30,sheets:[{path:`${uid}/sheets/${sc}/1.jpg`,cols:2,rows:1,cell_w:270,cell_h:480,times:[1.25,28.5]}], evidence:{version:3,sampling:'sparse_uniform',timestamp_basis:'requested_nearest_keyframe',timing_uncertainty_s:null,requested_frames:2,captured_frames:2,uploaded_frames:2,sampling_complete:true}};
// Path contract comes from production, not a duplicate literal assertion.
const { sheetPathFor } = await import('../../supabase/functions/spotter/pack.ts');
manifest.sheets[0].path = sheetPathFor(uid,sc,1);
const parsed = parseFrames(manifest,uid,sc);
check('frames' in parsed && parsed.frames?.evidence?.timing_uncertainty_s === null, 'unknown Android displacement survives parsing');
if ('frames' in parsed && parsed.frames) {
 const prompt=sheetsPrompt(parsed.frames,[]);
 check(prompt.includes('1.25s') && prompt.includes('sparse samples') && prompt.includes('do not claim exact playback times'), 'prompt retains fractional manifest clock and uncertainty');
}
check('error' in parseFrames({...manifest,evidence:{...manifest.evidence,timing_uncertainty_s:0}},uid,sc), 'cannot forge precise Android clock');
check('error' in parseFrames({...manifest,evidence:{...manifest.evidence,uploaded_frames:1}},uid,sc), 'partial uploaded manifest rejected');
check('error' in parseFrames({...manifest,evidence:{...manifest.evidence,sampling_complete:false}},uid,sc), 'partial sampling rejected');
console.log(`PASS ${checks} source fidelity and sampling regressions`);
