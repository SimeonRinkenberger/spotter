// Focused regressions for explicit AI intent, source access, and scheduling races.
// Uses the same optional DOM package as tools/pumpy-harness.mjs.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {parseHTML}=await import(pathToFileURL(process.env.SPOTTER_DOM_MODULE||'/private/tmp/spotter-qa/node_modules/linkedom/esm/index.js'));
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const markup=fs.readFileSync('supabase/functions/spotter/markup.ts','utf8');
function fn(name){const i=source.indexOf('  function '+name+'(');assert(i>=0,name);return source.slice(i,source.indexOf('\n  }',i)+4);}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
let checks=0;
async function test(name,body){await body();checks++;console.log('PASS',name);}
function setup(){
 const {document}=parseHTML('<html><body>'+markup.slice(markup.indexOf('export const MARKUP_BODY'))+'</body></html>');
 const requests=[], streams=[], fills=[],closed=[],messages=[];
 const c=vm.createContext({document,console,Date,Promise,JSON,Array,
  $:id=>document.getElementById(id), el:(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;},
  state:{user:{id:'alice'}},accountEpoch:1,scheduleCtx:null,today:{at:42},
  expKey:'',expCache:{},vidCache:{},expWaiting:{},EXFAIL:'Unavailable',
  sourceOf:()=>null,saidNode:()=>null,vidKey:ex=>ex.name,
  api:(path,body)=>new Promise((resolve,reject)=>requests.push({path,body,resolve,reject})),
  apiStream:(path,body,cb)=>{streams.push({path,body});cb({status:'ok',text:'A requested explanation'});return Promise.resolve();},
  window:{},vidFill:r=>fills.push(r),limitHit(){},
  openSheet:id=>document.getElementById(id).classList.add('open'),
  closeSheet:id=>{closed.push(id);document.getElementById(id).classList.remove('open');},
  accountNow:(epoch,uid)=>c.accountEpoch===epoch&&c.state.user?.id===uid,
  planAdd:(day,id)=>new Promise((resolve,reject)=>requests.push({day,id,resolve,reject})),
  toast:m=>messages.push(m),loadPlan(){},loadToday(){},
  ymd:d=>d.toISOString().slice(0,10),
  embedNode:(w,t)=>{const n=document.createElement('div');n.setAttribute('data-second',t);return n;},fitEmbed(){}
 });
 const run=s=>vm.runInContext(s,c);
 run(fn('explain'));run(fn('watchBit'));
 run(source.slice(source.indexOf('  var scheduleCtx ='),source.indexOf('  // ---------- logs, progress, history')));
 return {c,run,document,requests,streams,fills,closed,messages};
}
await test('opening a demo never spends an explanation request; explicit intent does',async()=>{
 const x=setup();x.run('explain({name:"Squat"},{title:"Leg day"})');
 assert.deepEqual(x.requests.map(r=>r.path),['demo-video']);assert.equal(x.streams.length,0);
 x.document.getElementById('explainask').onclick();await flush();
 assert.equal(x.streams.length,1);assert.equal(x.document.getElementById('explaintext').textContent,'A requested explanation');
});
await test('a late demo cannot replace a different exercise',async()=>{
 const x=setup();x.run('explain({name:"Squat"}); explain({name:"Row"})');
 x.requests[0].resolve({status:'ok',video:{id:'squat'}});await flush();assert.equal(x.fills.length,0);
 x.requests[1].resolve({status:'ok',video:{id:'row'}});await flush();assert.equal(x.fills[0].video.id,'row');
});
await test('source timestamps open a player without replacing workout content',()=>{
 const x=setup();x.document.getElementById('dinner').innerHTML='<h2>Workout title</h2>';
 x.run('watchBit({platform:"youtube"},12)');
 assert.equal(x.document.querySelector('#dinner h2').textContent,'Workout title');
 assert.equal(x.document.querySelector('#watchbody div').getAttribute('data-second'),'12');
 assert(x.document.getElementById('watchsheet').classList.contains('open'));
});
await test('scheduling rejects missing dates and deduplicates a pending tap',()=>{
 const x=setup();x.run('scheduleWorkout({id:"w",title:"Workout"})');
 const date=x.document.getElementById('scheduledate'),go=x.document.getElementById('schedulego');
 date.value='';go.onclick();assert.equal(x.requests.length,0);
 date.value='2026-09-09';go.onclick();go.onclick();assert.equal(x.requests.length,1);assert(go.disabled);
});
await test('failed schedule remains recoverable and does not claim success',async()=>{
 const x=setup();x.run('scheduleWorkout({id:"w",title:"Workout"})');
 const go=x.document.getElementById('schedulego');go.onclick();x.requests[0].resolve({error:{message:'offline'}});await flush();
 assert.equal(go.disabled,false);assert.equal(x.closed.length,0);assert.equal(x.messages.length,0);
 go.onclick();x.requests[1].resolve({error:null});await flush();assert.deepEqual(x.closed,['schedulesheet']);assert.equal(x.messages.length,1);
});
await test('a completed write cannot paint into another account or a newer schedule',async()=>{
 for(const change of ['accountEpoch++','scheduleWorkout({id:"next",title:"Next"})']){
  const x=setup();x.run('scheduleWorkout({id:"w",title:"Workout"})');x.document.getElementById('schedulego').onclick();
  x.run(change);x.requests[0].resolve({error:null});await flush();assert.equal(x.messages.length,0);assert.equal(x.closed.length,0);
 }
});
await test('network failure leaves schedule date and retry button available',async()=>{
 const x=setup();x.run('scheduleWorkout({id:"w",title:"Workout"})');const date=x.document.getElementById('scheduledate').value;
 x.document.getElementById('schedulego').onclick();x.requests[0].reject(new Error('offline'));await flush();
 assert.equal(x.document.getElementById('scheduledate').value,date);assert.equal(x.document.getElementById('schedulego').disabled,false);
 assert(x.document.getElementById('scheduleerror').textContent.includes('Try again'));
});
await test('four navigation destinations remain and stylesheet ends inside its tag',()=>{
 const x=setup();assert.equal(x.document.querySelectorAll('.tabbar [role=tab]').length,4);
 const style=fs.readFileSync('supabase/functions/spotter/style.ts','utf8');assert.equal(style.slice(style.indexOf('</style>')+8).trim(),'`;');
});
console.log(checks+' simplification checks passed');
