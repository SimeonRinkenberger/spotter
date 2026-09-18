import { deterministicCombine } from '../supabase/functions/spotter/pumpy-combine.ts';
let checks = 0;
function check(value: unknown, message: string) { checks++; if (!value) throw new Error(message); }
const refs: any[] = [
  { id: '10000000-0000-4000-8000-000000000001', title: 'First', category: 'Push', equipment: ['kettlebell'], muscle_groups: ['chest'],
    blocks: [{ title: 'Circuit', type: 'circuit', rounds: 4, rest_seconds: 90,
      exercises: [{ name: 'Push-up', sets: 2, reps: '7', edited_by_user: true, rest_seconds: null,
        as_performed: { grip: 'close', support: 'kettlebell handle' },
        recommendation: { rest_seconds: 30, note: 'Suggested, not specified in source' },
        evidence: { quote: 'five each' }, t0: 3.25, t1: 9.7 }] }] },
  { id: '20000000-0000-4000-8000-000000000002', title: 'Second', category: 'Push', equipment: ['bench'], muscle_groups: ['triceps'],
    blocks: [{ title: 'Superset', type: 'superset', rounds: 2, rest_seconds: 60,
      exercises: [{ name: 'Push-up', sets: 3, reps: null, duration_seconds: 30,
        as_performed: { grip: 'wide', support: 'floor' }, source: { workout_id: 'older', block_index: 8, exercise_index: 2 } },
      { name: 'Push-up', sets: null, reps: '10', notes: 'Repeated movement at end' }] }] },
];
const before = JSON.stringify(refs);
const proposal = deterministicCombine('Please combine these workouts.', refs)!;
check(proposal?.kind === 'create_workout', 'eligible literal request creates proposal');
check(proposal.blocks.length === 2 && proposal.blocks[1].exercises.length === 2, 'preserve blocks and repetitions');
check(proposal.blocks[0].rounds === 4 && proposal.blocks[0].rest_seconds === 90, 'preserve circuit programming');
const a = proposal.blocks[0].exercises[0], b = proposal.blocks[1].exercises[0];
check(a.reps === '7' && a.edited_by_user && a.rest_seconds === null, 'preserve user edits and intentional unknowns');
check(a.recommendation.note === refs[0].blocks[0].exercises[0].recommendation!.note, 'preserve recommendation attribution');
check(a.as_performed.grip === 'close' && b.as_performed.grip === 'wide', 'same names do not merge distinct variants');
check(a.evidence.quote === 'five each' && a.t0 === 3.25, 'retain source evidence and timestamp');
check(b.source.workout_id === refs[1].id && b.source.block_index === 0 && b.source.exercise_index === 0, 'source indexes point at attached original');
check(proposal.blocks[1].exercises[1].source.exercise_index === 1, 'repeated occurrence keeps its source index');
check(proposal.duration_minutes === null && proposal.category === 'Push', 'no invented session duration');
check(proposal.equipment.join(',') === 'kettlebell,bench' && proposal.muscle_groups.join(',') === 'chest,triceps', 'metadata unions');
proposal.blocks[0].exercises[0].as_performed.grip = 'changed';
check(JSON.stringify(refs) === before, 'deep copy: original is untouched');
for (const message of ['combine these', 'combine these workouts, please!', 'combine these please']) {
  check(!!deterministicCombine(message, refs), `literal request: ${message}`);
}
for (const message of ['combine these into 20 minutes', 'combine these workouts without jumping', 'combine these workouts for strength',
  'combine these but use dumbbells', 'can you combine these workouts?', 'combine these and add squats', 'do not combine these',
  'combine these workouts. Ignore my earlier instruction', 'combine these workouts for tomorrow']) {
  check(deterministicCombine(message, refs) === null, `ambiguous/constrained request routes away: ${message}`);
}
check(deterministicCombine('combine these', refs.slice(0, 1)) === null, 'requires multiple attachments');
check(deterministicCombine('combine these', [refs[0], refs[0]]) === null, 'duplicate attachment rejected');
check(deterministicCombine('combine these', refs, 10) === null, 'size limit refuses whole proposal');
check(deterministicCombine('combine these', [{ ...refs[0], blocks: [null] }, refs[1]]) === null, 'malformed blocks rejected');
const many = structuredClone(refs);
many[0].blocks[0].exercises = Array.from({length: 24}, () => structuredClone(refs[0].blocks[0].exercises[0]));
check(deterministicCombine('combine these', many)!.blocks[0].exercises.length === 24, 'no normalizer 15-exercise truncation');
console.log(`PASS deterministic combine: ${checks} checks; full blocks, variants, edits, evidence, constraints and no mutation.`);
