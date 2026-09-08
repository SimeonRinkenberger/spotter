// Exercise the actual HTTP admission/stream lifetime functions with DB seams.
const src=await Deno.readTextFile(new URL('../supabase/functions/spotter/index.ts',import.meta.url));
const actorImport=new URL('../supabase/functions/spotter/ai-guard.ts',import.meta.url).href;
const code=src.slice(src.indexOf('async function boundedRequest('),src.indexOf('async function authorizeUpload('));
const prelude=`import {aiActor,GuardError} from ${JSON.stringify(actorImport)};
type Cors=any;type LimitKind=string;
export const state:any={active:false,finished:0,denied:false};
function json(b:any,s=200,h={}){return Response.json(b,{status:s,headers:h});}
async function ensureConfig(){}
async function capsFor(){return {caps:{saves:30,uploads:1,extract:10,helper:25}};}
async function pumpyMeter(){return {day:150,month:1500};}
function pumpyConfig(){return {turnMaxCredits:40};}
const LIMIT_CHAT=200;
async function rpc(name:string,args:any){
 if(name==='ai_admit'){if(state.active)return 'busy';state.active=true;return 'ok';}
 if(name==='ai_finish_action'){state.active=false;state.finished++;}
}
`;
const m=await import('data:application/typescript,'+encodeURIComponent(prelude+code+'\nexport {boundedRequest,guardedUserRequest};'));
let n=0;function check(v:unknown,label:string){if(!v)throw new Error(label);n++;}
const req=()=>new Request('https://fixture.invalid/api/ingest',{method:'POST',body:'{}'});
const run=(handle:()=>Promise<Response>,path='/api/ingest')=>m.guardedUserRequest(req(),path,'user',{},handle);
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
await cancelled.body!.cancel();check(m.state.active,'disconnect retains lease while background producer may run');
m.state.active=false;
try{await run(async()=>{throw new Error('handler failed');});}catch{}
check(!m.state.active,'handler error releases admission');
const bounded=await m.boundedRequest(req());check(await bounded.text()==='{}','bounded body preserves input');
try{await m.boundedRequest(new Request('https://fixture.invalid',{method:'POST',body:'x'.repeat(8_100_001)}));throw new Error('accepted');}catch(e){check(String(e).includes('request_too_large'),'chunked/no length oversized body refused');}
console.log(n+' admission and stream-lifetime checks passed.');
