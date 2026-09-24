// Exercise the actual HTTP admission/stream lifetime functions with DB seams.
const src=await Deno.readTextFile(new URL('../supabase/functions/spotter/index.ts',import.meta.url));
const actorImport=new URL('../supabase/functions/spotter/ai-guard.ts',import.meta.url).href;
const code=src.slice(src.indexOf('async function boundedRequest('),src.indexOf('async function authorizeUpload('));
const prelude=`import {aiActor,GuardError} from ${JSON.stringify(actorImport)};
import { AsyncLocalStorage } from "node:async_hooks";
type Cors=any;type LimitKind=string;
export const state:any={active:false,finished:0,denied:false,consent:true,patched:[] as any[],unit:"kg",admits:0,refuse:null as string|null};
async function dbSelect(){return [{settings: state.consent ? {unit:state.unit,ai_consent_version:"2026-09-19",ai_consent_at:"2026-09-19T12:00:00Z"}: {unit:state.unit}}];}
async function dbPatch(_t:string,q:string,body:any){state.patched.push({q,body});state.consent=!!body.settings?.ai_consent_at;return body;}
function json(b:any,s=200,h={}){return Response.json(b,{status:s,headers:h});}
async function ensureConfig(){}
async function capsFor(){return {caps:{saves:30,uploads:1,extract:10,helper:25}};}
async function pumpyMeter(){return {day:150,month:1500};}
function pumpyConfig(){return {turnMaxCredits:40};}
const LIMIT_CHAT=200;
async function rpc(name:string,args:any){
 if(name==='ai_admit'){state.admits++;if(state.refuse)return state.refuse;if(state.active)return 'busy';state.active=true;return 'ok';}
 if(name==='ai_finish_action'){state.active=false;state.finished++;}
}
`;
const m=await import('data:application/typescript,'+encodeURIComponent(prelude+code+'\nexport {boundedRequest,guardedUserRequest,handleAiConsent,AI_CONSENT_VERSION,admitNow};'));
let n=0;function check(v:unknown,label:string){if(!v)throw new Error(label);n++;}
const req=()=>new Request('https://fixture.invalid/api/ingest',{method:'POST',body:'{}'});
// Admitted up front: every AI route except the two that admit late (below).
const run=(handle:()=>Promise<Response>,path='/api/explain')=>m.guardedUserRequest(req(),path,'user',{},handle);
let release!:()=>void;const wait=new Promise<void>(r=>release=r);
const first=run(async()=>{await wait;return Response.json({status:'ok'});});
await new Promise(r=>setTimeout(r,0));
let reached=false;const second=await run(async()=>{reached=true;return Response.json({});});
check(second.status===429&&!reached,'simultaneous reread stopped before handler');
release();await first;check(!m.state.active,'ordinary response releases lease');
const ctrl:{c?:ReadableStreamDefaultController<Uint8Array>}={};
const streaming=await run(async()=>new Response(new ReadableStream({start(c){ctrl.c=c;}}),{headers:{'content-type':'application/x-ndjson'}}),'/api/pumpy/chat');
check(m.state.active,'NDJSON headers do not release admission');
check((await run(async()=>Response.json({}))).status===429,'second call blocked while coach streaming');
const consumed=streaming.text();ctrl.c!.enqueue(new TextEncoder().encode('{"done":true}\n'));ctrl.c!.close();await consumed;
check(!m.state.active,'complete stream releases admission');
const cancelled=await run(async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/x-ndjson'}}));
await cancelled.body!.cancel();check(!m.state.active,'a cancelled stream releases the lease: the next share is not refused for three minutes');
m.state.active=false;
try{await run(async()=>{throw new Error('handler failed');});}catch{}
check(!m.state.active,'handler error releases admission');
const bounded=await m.boundedRequest(req());check(await bounded.text()==='{}','bounded body preserves input');
try{await m.boundedRequest(new Request('https://fixture.invalid',{method:'POST',body:'x'.repeat(8_100_001)}));throw new Error('accepted');}catch(e){check(String(e).includes('request_too_large'),'chunked/no length oversized body refused');}
// ---- late admission: /api/ingest and /media ask only when they are about to spend ----
m.state.admits=0;
const cheap=await run(async()=>Response.json({status:'exists'}),'/api/ingest');
check(cheap.status===200&&m.state.admits===0&&!m.state.active,'a duplicate or cache hit is answered with no admission and no lease');
let seen:Response|null=null;
const paid=await run(async()=>{seen=await m.admitNow();const again=await m.admitNow();return again??Response.json({status:'processing'},{status:202});},'/api/ingest');
check(paid.status===202&&seen===null&&m.state.admits===1,'a paid save is admitted exactly once, however often it asks');
check(!m.state.active&&m.state.finished>0,'and its lease is released with the response');
// Somebody else's request holds the lease: the save is told why, in a sentence about sharing.
let hold!:()=>void;const held=new Promise<void>(r=>hold=r);
const holder=run(async()=>{await held;return Response.json({status:'ok'});});
await new Promise(r=>setTimeout(r,0));
const busy=await run(async()=>(await m.admitNow())??Response.json({status:'processing'}),'/api/ingest');
const busyBody=await busy.json();
check(busy.status===429&&busyBody.code==='busy'&&busyBody.message==='Still saving your last share — try again in a few seconds.','busy has its own sentence and code for a share');
hold();await holder;
m.state.refuse='minute';
const minute=await (await run(async()=>(await m.admitNow())??Response.json({}),'/api/ingest')).json();
check(minute.code==='minute'&&/one minute/.test(minute.message),'minute has its own sentence');
const other=await (await run(async()=>Response.json({}))).json();
check(other.code==='minute'&&!/share/.test(other.message),'and a non-save route is not told about shares');
m.state.refuse=null;
const readVideo=await run(async()=>Response.json({status:'ok'}),'/api/workouts/00000000-0000-4000-8000-000000000001/media');
check(readVideo.status===200&&!m.state.active,'/media admits late too: a held save\'s frames or a cached preview spend no admission');
console.log(n+' admission and stream-lifetime checks passed.');

m.state.consent=false;
let invoked=false;
const blocked=await run(async()=>{invoked=true;return Response.json({});});
check(blocked.status===403&&!invoked,'AI processing blocked before admission without explicit saved consent');
const manual=await run(async()=>Response.json({status:'ok'}),'/api/account/delete');
check(manual.status===200,'non-AI account operations remain available after declining');

// The Share Extension's way in: it records the agreement itself, with the save
// key, and the next save goes through. A merge, not a whole-column write, and only
// for the wording it showed.
const consent=(body:unknown,path='/api/ai-consent')=>m.handleAiConsent(new Request('https://fixture.invalid'+path,{method:'POST',body:JSON.stringify(body)}),'user',{});
const stale=await consent({enabled:true,version:'2026-01-01'});
check(stale.status===409&&(await stale.json()).code==='ai_consent_version'&&m.state.patched.length===0,'agreement to other wording is refused, nothing written');
const missing=await consent({enabled:true});
check(missing.status===409&&m.state.patched.length===0,'agreement without a version is refused');
const granted=await consent({enabled:true,version:m.AI_CONSENT_VERSION});
const grantedBody=await granted.json();
check(granted.status===200&&grantedBody.status==='ok'&&grantedBody.ai_consent_version===m.AI_CONSENT_VERSION&&!isNaN(Date.parse(grantedBody.ai_consent_at)),'agreement recorded with the current version and a timestamp');
check(m.state.patched[0].q==='id=eq.user'&&m.state.patched[0].body.settings.unit==='kg','recorded as a merge into the row: other settings survive');
let ran=false;
const after=await run(async()=>{ran=true;return Response.json({status:'ok'});});
check(after.status===200&&ran,'the next AI request is admitted after the extension records agreement');
const revoked=await consent({enabled:false});
check(revoked.status===200&&m.state.patched[1].body.settings.ai_consent_at===null&&m.state.patched[1].body.settings.ai_consent_version===null&&m.state.patched[1].body.settings.unit==='kg','revocation nulls both keys and keeps the rest');
check((await run(async()=>Response.json({}))).status===403,'AI requests stop again once revoked');
console.log('AI permission route: version-checked, merged, effective at once, revocable.');
