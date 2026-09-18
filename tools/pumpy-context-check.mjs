// Regression checks for the actual server context functions; no model or network calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
const source = fs.readFileSync('supabase/functions/spotter/index.ts', 'utf8');
function lift(name) {
  const match = source.match(new RegExp('^(?:export )?function '+name+'\\(', 'm'));
  assert(match, name);
  return source.slice(match.index,source.indexOf('\n}',match.index)+2).replace(/^export /,'');
}
const ctx=vm.createContext({PUMPY_MAX_REFS:6,PUMPY_MESSAGE_CHARS:1200,PUMPY_TOOL_RESULT_CHARS:16000,
  isUuid:s=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s),
  handleOf:id=>'h'+id.replaceAll('-','').slice(0,6)});
vm.runInContext(transformSync(['pumpyReferenceIds','pumpyInputError','pumpyToolContext','pumpyHistoryContext','pumpyAttachmentError','pumpyProposalSizeError','pumpyRefBlock'].map(lift).join('\n'),{loader:'ts',format:'cjs'}).code,ctx);
const ids=Array.from({length:7},(_,i)=>`${i}0000000-0000-4000-8000-000000000000`);
assert.match(ctx.pumpyInputError({workout_ids:ids}),/up to 6/);
assert.equal(ctx.pumpyInputError({workout_ids:Array(7).fill(ids[0])}),null);
assert.match(ctx.pumpyInputError({workout_ids:[ids[0],'missing']}),/invalid/);
assert.match(ctx.pumpyInputError({workout_ids:'not an array'}),/picker/);
assert.match(ctx.pumpyInputError({message:'x'.repeat(1200)+' no barbell'}),/1200/);
assert.equal(ctx.pumpyInputError({message:'Only dumbbells',workout_ids:ids.slice(0,6)}),null);
assert.equal(ctx.pumpyReferenceIds({workout_ids:[]},ids[0]).length,0);
const exercises=Array.from({length:65},(_,i)=>({name:`Exercise ${i}`,sets:3,reps:null,duration_seconds:30,rest_seconds:45,
  equipment:'one kettlebell',weight:'12 kg',as_performed:{grip:'neutral',laterality:'unilateral'},
  recommendation:{reps:'8',note:'Creator did not prescribe repetitions'},edited_by_user:true}));
const block=JSON.parse(ctx.pumpyRefBlock({id:ids[0],title:'Complete session',blocks:[{type:'circuit',rounds:4,rest_seconds:90,exercises}]}));
assert.equal(block.blocks[0].exercises.length,65);
assert.equal(block.blocks[0].exercises[64].sets,3);
assert.equal(block.blocks[0].exercises[64].rest_seconds,45);
assert.equal(block.blocks[0].exercises[64].weight,'12 kg');
assert.equal(block.blocks[0].exercises[64].as_performed.laterality,'unilateral');
assert.equal(block.blocks[0].exercises[64].recommendation.note,'Creator did not prescribe repetitions');
assert.equal(block.blocks[0].rest_seconds,90);
assert.equal(block.blocks[0].exercises[64].exercise_index,64);
assert.equal(block.equipment,undefined);
const history=ctx.pumpyHistoryContext([{role:'user',content:'Details '.repeat(80)+'Do not include jumping.'}]);
assert(history[0].endsWith('Do not include jumping.'));
const complete=JSON.parse(ctx.pumpyToolContext({exercises:exercises.slice(0,20)}));
assert.equal(complete.exercises.length,20);
const unavailable=JSON.parse(ctx.pumpyToolContext({notes:'a'.repeat(20000)}));
assert.equal(unavailable.available,false);
assert.equal(unavailable.error,'context_too_large');
assert.match(ctx.pumpyAttachmentError([{blocks:[null]}]),/incomplete/);
assert.match(ctx.pumpyAttachmentError([{blocks:[{exercises:[null]}]}]),/incomplete/);
assert.equal(JSON.parse(ctx.pumpyRefBlock({id:ids[0],blocks:[null]})).available,false);
assert.equal(ctx.pumpyAttachmentError([{blocks:[{exercises}]}]),null);
assert.match(ctx.pumpyProposalSizeError({kind:'create_workout',blocks:[{exercises}]}),/too large/);
assert.match(ctx.pumpyProposalSizeError({kind:'create_workout',blocks:Array(13).fill({exercises:[]})}),/too large/);
assert.match(ctx.pumpyProposalSizeError({kind:'append_exercises',exercises:Array(21).fill({name:'Squat'})}),/20/);
assert.equal(ctx.pumpyProposalSizeError({kind:'create_workout',blocks:[{exercises:exercises.slice(0,15)}]}),null);
console.log('PASS: Pumpy preserves full operational context and trailing constraints; invalid/oversized inputs fail explicitly.');
