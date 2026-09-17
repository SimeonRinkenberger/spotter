// Execute the real handler with owned fixture attachments and no configured model.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
import {deterministicCombine} from '../supabase/functions/spotter/pumpy-combine.ts';
const src=fs.readFileSync('supabase/functions/spotter/index.ts','utf8');
function lift(name){const m=src.match(new RegExp('^(?:export )?(?:async )?function '+name+'\\(','m'));assert(m,name);return src.slice(m.index,src.indexOf('\n}',m.index)+2).replace(/^export /,'');}
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const refs=ids.map(id=>({id,title:'Source '+id,category:'Strength',muscle_groups:['legs'],equipment:['dumbbell'],blocks:[{type:'circuit',rounds:3,rest_seconds:60,exercises:Array.from({length:17},(_,i)=>({name:'Movement '+i,sets:2,duration_seconds:30,rest_seconds:15}))}]}));
const writes=[],usage=[];let existing=false,aiChecks=0;
const c=vm.createContext({console,Request,Response,deterministicCombine,
 PUMPY_MESSAGE_CHARS:1200,PUMPY_MAX_REFS:6,PUMPY_CONTEXT_CHARS:60000,LIMIT_CHAT:200,
 isUuid:s=>/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s),handleOf:s=>'h'+s.slice(0,6),
 json:(v,status=200)=>Response.json(v,{status}),wantsStream:()=>false,ensureConfig:async()=>{},
 pumpyConfig:()=>({perMinute:10}),pumpyMeter:async()=>({plan:'plus',totals:{minute:0,day:0,month:0},day:100,month:1000}),
 plusPlan:p=>p==='plus',dbCount:async()=>0,utcMidnight:()=>'',
 dbSelect:async(table,query)=>{assert.match(query,/user_id=eq.owner/);return table==='workouts'?refs:existing?[{id:ids[0]}]:[];},
 dbInsert:async(table,row)=>{writes.push({table,row});return {...row,id:writes.length};},dbPatch:async()=>{},
 pumpyRecordUsage:async(...args)=>usage.push(args),pumpyBlock:()=>({}),
 PUMPY_TRIVIAL:/^thanks$/i,haveAI:()=>{aiChecks++;return false;},
});
vm.runInContext(transformSync(['pumpyInputError','pumpyReferenceIds','pumpyAttachmentError','pumpyRefBlock','handlePumpyChat'].map(lift).join('\n'),{loader:'ts',format:'cjs'}).code,c);
const req=body=>new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)});
let response=await c.handlePumpyChat(req({message:'Combine these workouts',workout_ids:ids}),'owner',{});
assert.equal(response.status,200);let out=await response.json();
assert.equal(aiChecks,0);assert.equal(out.usage.calls,0);assert.equal(out.messages[0].meta.proposal.blocks[0].exercises.length,17);
assert.equal(out.messages[0].meta.proposal.blocks[1].exercises.length,17);
assert.equal(out.messages[0].meta.status,'pending');assert(writes.every(x=>x.table!=='workouts'),'No workout is saved before confirmation');
existing=true;
response=await c.handlePumpyChat(req({message:'Combine these workouts',workout_ids:ids,thread_id:ids[0]}),'owner',{});
assert.equal(response.status,503);assert.equal(aiChecks,1,'Existing conversation must not skip earlier constraints');
console.log('PASS: real chat route offers all 34 exercise entries without inference; existing threads retain normal context handling.');
