// Pure regressions lifted from the shipping server; no network or AI calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
const src = fs.readFileSync('supabase/functions/spotter/index.ts','utf8');
function fn(name) {
 const m = src.match(new RegExp('^(?:export )?(?:async )?function '+name+'\\(', 'm'));
 assert(m, name);
 const end = src.indexOf('\n}',m.index)+2;
 return src.slice(m.index,end).replace(/^export /,'');
}
// Read from source, never guessed: what we write and what we still serve are two
// different numbers now, and a harness that pins the wrong one stops testing the gate.
const packSrc = fs.readFileSync('supabase/functions/spotter/pack.ts','utf8');
const constant=(text,name)=>Number(text.match(new RegExp('(?:export )?const '+name+' = (\\d+)'))[1]);
const AI_CONSENT_VERSION=src.match(/const AI_CONSENT_VERSION = "([^"]+)"/)[1];
const c = vm.createContext({console, CARD_V:constant(src,'CARD_V'), MIN_USABLE_CARD_V:constant(src,'MIN_USABLE_CARD_V'),
 PACK_V:constant(packSrc,'PACK_V'), MIN_USABLE_PACK_V:constant(packSrc,'MIN_USABLE_PACK_V'), Date, Set, Map, JSON, Number, String});
const functions=['usablePack','visuallyRead','cacheStale','markCache','cacheForAccess','cacheEntitled','isDoseWordName','cardSound','basicMeta','readQuality','labelRecommendations','plusPlan'];
// The dose-word vocabulary cardSound reads, lifted as it is written.
const doseWords=src.slice(src.indexOf('const DOSE_WORDS = new Set(['),src.indexOf('function isDoseWordName('));
vm.runInContext(transformSync(doseWords+functions.map(fn).join('\n'),{loader:'ts',format:'cjs'}).code,c);
const pack={pack_v:1,reader:'sheets:gemini',exercises:[{name_shown:'Squat'}]};
const basic={title:'Basic',blocks:[]}, premium={title:'Plus',blocks:[{exercises:[{name:'Squat'}]}]};
c.row={pack,pack_v:1,card:premium,v:9,read_quality:'premium',media_source:'pack:video',media_text:'private visual transcript'};
assert.equal(vm.runInContext('cacheForAccess(row,false)',c),null,'free cannot copy a premium-only cached card');
assert.equal(vm.runInContext('cacheForAccess(row,true).card.title',c),'Plus');
c.row.basic_card=basic;c.row.basic_v=c.CARD_V;
const visible=vm.runInContext('cacheForAccess(row,false)',c);
assert.equal(visible.card.title,'Basic');assert.equal(visible.pack,null);assert.equal(visible.media_text,null);assert.equal(visible.media_source,null);
c.row.basic_v=c.MIN_USABLE_CARD_V-1;assert.equal(vm.runInContext('cacheForAccess(row,false)',c),null,'a Basic card below the readable minimum is rebuilt');
c.row.basic_v=c.MIN_USABLE_CARD_V;const stale=vm.runInContext('cacheForAccess(row,false)',c);
assert.equal(stale.card.title,'Basic','the shape we still read is served rather than paid for again');
assert.equal(stale.stale,c.MIN_USABLE_CARD_V<c.CARD_V,'and says whether it is behind what we write');
c.row={card:basic,v:9,read_quality:'basic'};
assert.equal(vm.runInContext('cacheForAccess(row,false).card.title',c),'Basic');
c.row={card:premium,v:9,media_source:'video:gemini',read_quality:'basic'};
assert.equal(vm.runInContext('cacheForAccess(row,false)',c),null,'legacy video result never becomes basic');
c.card={blocks:[{type:'straight',exercises:[{sets:null,reps:null,recommendation:{sets:2,reps:'8-12'}}]}]};c.meta={pack};
vm.runInContext('labelRecommendations(card,meta)',c);
assert.match(c.card.blocks[0].exercises[0].recommendation.note,/creator did not specify.*Pumpy suggests 2 sets, 8-12 reps/);
assert.equal(c.card.blocks[0].exercises[0].reps,null,'suggestions never become creator facts');
c.card.blocks[0].exercises[0].sets=3;c.card.blocks[0].exercises[0].reps='15';
vm.runInContext('labelRecommendations(card,meta)',c);assert.equal(c.card.blocks[0].exercises[0].recommendation,null);
c.card={blocks:[{type:'amrap',exercises:[{recommendation:{sets:3,reps:'10'}}]}]};c.meta={};vm.runInContext('labelRecommendations(card,meta)',c);
assert.equal(c.card.blocks[0].exercises[0].recommendation.sets,null);assert.match(c.card.blocks[0].exercises[0].recommendation.note,/available source/);
// All attached movements, including the last, must reach the coach.
c.handleOf=x=>x;c.w={id:'fixture',title:'Long workout',blocks:[{exercises:Array.from({length:60},(_,i)=>({name:'Exercise '+i+' '+ 'x'.repeat(35),sets:3,reps:'10'}))}]};
vm.runInContext(transformSync(fn('pumpyAttachmentError')+'\n'+fn('pumpyRefBlock'),{loader:'ts',format:'cjs'}).code,c);
assert.match(vm.runInContext('pumpyRefBlock(w)',c),/Exercise 59/);
console.log('PASS cache tier isolation, legacy media protection, stale Basic rebuild, honest recommendations, AMRAP structure and complete Pumpy attachments.');
// Run the actual completion path with another account processing the same URL.
// Its row must remain untouched: it has its own job and private source context.
const updates=[];
c.WORKER_ID='worker';c.qualityColumns=()=>({});c.visionWarning=()=>null;
c.premiumAccess=async uid=>uid==='plus';
c.dbSelect=async(table,query)=>{
 if(table==='workouts') {
  assert.match(query,/ingest_job_id=eq.job/);assert.match(query,/user_id=eq.plus/);
  return [{id:'owned',user_id:'plus'}];
 }
 return [];
};
c.rpc=async(name,args)=>{
 assert.equal(name,'finish_ingest_job');assert.equal(args.p_user,'plus');assert.equal(args.p_job,'job');
 updates.push({table:'workouts',query:'user_id=eq.'+args.p_user,body:args.p_payload});
 return {status:'done',filled:1};
};
c.dbPatchMany=async(table,query,body)=>{updates.push({table,query,body});return [{id:'owned'}];};
c.dbDelete=async()=>{};
// S9: the sentence a Basic card gets when its caption named nothing and a Plus
// read of the same video found the workout — lifted as written.
const hintConst=src.match(/const PLUS_READ_HINT = "[^"]+";/)[0];
vm.runInContext(transformSync(hintConst+'\n'+fn('countExercises')+'\n'+fn('plusReadHint')+'\n'+fn('finishJob'),{loader:'ts',format:'cjs'}).code,c);
c.job={id:'job',user_id:'plus'};c.p={shortcode:'same-video',platform:'tiktok',clean:'https://example.test/video',kind:'video'};
c.meta={pack,caption:'public caption',read_plan:'plus'};c.card=structuredClone(premium);
await vm.runInContext('finishJob(job,p,meta,card,null,false)',c);
const written=updates.filter(x=>x.table==='workouts');assert.equal(written.length,1);
assert.match(written[0].query,/user_id=eq.plus/);assert.equal(written[0].body.read_quality,'premium');
// A downgrade while a visual job runs must produce a new Basic card.
updates.length=0;c.premiumAccess=async()=>false;c.buildCard=async meta=>{assert.equal(meta.pack,undefined);return structuredClone(basic);};
c.aiActor={run:async(_,f)=>f(),getStore:()=>undefined};c.providerFor=()=>({cacheable:false});
await vm.runInContext('finishJob(job,p,meta,card,null,false)',c);
assert.equal(updates.find(x=>x.table==='workouts').body.title,'Basic');
assert.equal(updates.find(x=>x.table==='workouts').body.read_quality,'basic');
assert.equal(updates.find(x=>x.table==='workouts').body.ingest_error,
  'The caption lists no exercises. A Plus read of the video found 1 exercise — use one of your free Plus reads to see it.',
  'S9: an empty Basic card says a Plus read found the workout');
console.log('PASS owner/job-scoped completion, isolated simultaneous saves and downgrade during visual reading.');
// Preparing a native save must be read-only and never expose the cached card.
c.BLOCKED=Symbol('blocked');c.INSECURE=Symbol('insecure');c.resolveShare=async()=>({shortcode:'same',platform:'tiktok',kind:'video',clean:'https://www.tiktok.com/@fixture/video/1'});
c.json=(body)=>body;let plan='plus',cached=true,owned=false;
let consented=true;
c.capsFor=async()=>({plan});c.capsFrom=()=>({plan});let heldSave=false;c.dbSelect=async(table)=>table==='workouts'?(owned?[{id:'mine'}]:[]):table==='ingest_jobs'?(heldSave?[{id:'j',hold:true}]:[]):table==='profiles'?[{settings:consented?{ai_consent_version:AI_CONSENT_VERSION,ai_consent_at:'2026-09-20T00:00:00Z'}:{}}]:cached?[{pack,pack_v:1}]:[];
c.AI_CONSENT_VERSION=AI_CONSENT_VERSION;
vm.runInContext(transformSync([fn('aiConsented'),fn('handleIngestPrepare')].join('\n'),{loader:'ts',format:'cjs'}).code,c);
const prep=async(body)=>{c.req={json:async()=>body};return vm.runInContext('handleIngestPrepare(req,"fixture",{})',c);};
assert.equal((await prep({url:'x'})).needs_frames,false);
// The extension asks about AI permission before a download, from this answer.
assert.equal((await prep({url:'x'})).ai_consent,true);
consented=false;assert.equal((await prep({url:'x'})).ai_consent,false);consented=true;
cached=false;assert.equal((await prep({url:'x'})).needs_frames,true);
owned=true;assert.equal((await prep({url:'x'})).needs_frames,false);
// Saved first with frames_pending: the card is already owned and its job is held
// for exactly these frames, so the extension's after-the-save question says yes.
heldSave=true;assert.equal((await prep({url:'x'})).needs_frames,true);heldSave=false;
assert.equal((await prep({url:'x',reread:true})).needs_frames,true);
plan='free';owned=false;assert.equal((await prep({url:'x'})).needs_frames,false);
assert.equal((await prep({url:'x',preview:true})).needs_frames,true);
cached=true;const hint=await prep({url:'x',preview:true});assert.equal(hint.needs_frames,false);assert.equal(hint.card,undefined);
console.log('PASS native preflight: cache hits/duplicates skip decoding, new Plus reads and explicit rereads preserve frames, Basic gets no premium data.');

vm.runInContext(transformSync(fn('transcriptInPack'),{loader:'ts',format:'cjs'}).code,c);
c.meta={transcript:'00:01 Squat slowly.\n00:05 Rest 30 seconds.',pack:{transcript:[{text:'Squat slowly.'},{text:'Rest 30 seconds.'}]}};
assert.equal(vm.runInContext('transcriptInPack(meta)',c),true);
c.meta.transcript+=' One more instruction.';assert.equal(vm.runInContext('transcriptInPack(meta)',c),false);
c.meta.pack.transcript=Array.from({length:81},()=>({text:'x'}));c.meta.transcript='x '.repeat(81).trim();assert.equal(vm.runInContext('transcriptInPack(meta)',c),false);
console.log('PASS identical transcript emitted once; partial or truncated packs retain the complete source text.');
// The quota table has a composite primary key, so HEAD-count must select a real column.
c.dbHeaders={};c.rest=table=>'https://db.invalid/'+table;c.encodeURIComponent=encodeURIComponent;
c.fetch=async(url,opts)=>{assert.match(url,/select=shortcode$/);assert.equal(opts.method,'HEAD');return {ok:true,headers:{get:()=> '0-0/3'}};};
vm.runInContext(transformSync(fn('dbCount'),{loader:'ts',format:'cjs'}).code,c);
assert.equal(await vm.runInContext('dbCount("video_previews","user_id=eq.fixture","shortcode")',c),3);
console.log('PASS preview usage counts its actual composite-key table column.');
