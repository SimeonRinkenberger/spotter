// Deterministic races against the actual app functions, with controllable database promises.
// Run from repo root: node tools/performance-harness.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
function fn(name) {
  const start = source.indexOf('  function '+name+'(');
  assert(start>=0,name);
  return source.slice(start,source.indexOf('\n  }',start)+4);
}
let checks=0;
const flush = async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup() {
  const requests=[], toasts=[], timers=[];
  const nodes = new Map();
  const state={user:{id:'alice'},workouts:[],collections:[],colItems:[],logs:null,plan:[{id:'known'}],planLogs:[]};
  const c=vm.createContext({console,Promise,Date,JSON,AbortController,Response,TextDecoder,
    state,accountEpoch:1,reads:{},libraryRev:0,logsRev:0,planRev:0,
    current:null,today:{at:0,shown:false},planMode:'week',monthStart:new Date(2026,8,1),planSig:'',
    pendTimer:null,pendPolls:0,pendBusy:false,document:{hidden:false}, renders:0,plans:0,
    $:id=>{if(!nodes.has(id))nodes.set(id,{classList:{contains:()=>false}});return nodes.get(id);},
    render(){c.renders++;},renderPlan(){c.plans++;},renderToday(){},refreshDetail(){},
    idle(){},writeCache(){},toast:m=>toasts.push(m),
    setTimeout:(f,ms)=>{const t={f,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cancelled=true;},
    sb:{from(table){
      const q={table,filters:[]};const b={};
      for(const method of ['select','eq','in','order','limit','gte','lte','maybeSingle']) b[method]=(...args)=>{q.filters.push([method,...args]);return b;};
      b.then=(ok,bad)=>{requests.push(q);return new Promise((resolve,reject)=>Object.assign(q,{resolve,reject})).then(ok,bad);};
      return b;
    }}
  });
  for(const name of ['accountNow','readOnce','invalidateLogs','load','isPending','watchPending','pollPending','loadLogs','loadPlan','repaintPlan','planRange','ymd','mondayOf','addDays','monthOfWeek','firstOf','restorePlan'])vm.runInContext(fn(name),c);
  c.planShape=()=>JSON.stringify(c.state.plan);
  c.state.weekStart=new Date(2026,8,7);
  return {c,requests,toasts,timers,run:s=>vm.runInContext(s,c)};
}
async function test(name,body){await body();checks++;console.log('PASS',name);}
await test('overlapping library reads share three requests; rows present before collections',async()=>{
  const x=setup(),p=x.run('load()'),q=x.run('load()');await flush();
  assert.equal(p,q);assert.equal(x.requests.length,3);
  x.requests[0].resolve({data:[{id:'new'}]});await flush();assert.equal(x.c.state.workouts[0].id,'new');assert.equal(x.c.renders,1);
  x.requests.slice(1).forEach(r=>r.resolve({data:[]}));await p;
  assert.equal(x.c.renders,1);
});
await test('late library rows cannot flash after account changes',async()=>{
  const x=setup(),p=x.run('load()');await flush();x.c.accountEpoch++;x.c.state.user={id:'bob'};
  x.requests.forEach(r=>r.resolve({data:[{id:'alice-secret'}]}));await p;
  assert.equal(x.c.state.workouts.length,0);assert.equal(x.c.renders,0);
});
await test('a newer realtime revision wins and triggers reconciliation',async()=>{
  const x=setup(),p=x.run('load()');await flush();x.c.libraryRev++;x.c.state.workouts=[{id:'socket'}];
  x.requests.slice().forEach(r=>r.resolve({data:[]}));await flush();assert.equal(x.c.state.workouts[0].id,'socket');
  assert.equal(x.requests.length,6);x.requests.slice(3).forEach(r=>r.resolve({data:r.table==='workouts'?[{id:'socket'}]:[]}));await p;
});
await test('failed collection reads retain known membership',async()=>{
  const x=setup();x.c.state.collections=[{id:'col'}];x.c.state.colItems=[{workout_id:'w',collection_id:'col'}];
  const p=x.run('load()');await flush();x.requests[0].resolve({data:[]});x.requests.slice(1).forEach(r=>r.resolve({error:{status:503}}));await p;
  assert.equal(x.c.state.collections[0].id,'col');assert.equal(x.c.state.colItems.length,1);
});
await test('history shares requests and retries failed reads without caching empty data',async()=>{
  const x=setup(),p=x.run('loadLogs()'),q=x.run('loadLogs()');await flush();assert.equal(p,q);assert.equal(x.requests.length,1);
  x.requests[0].resolve({error:{status:503}});await p;assert.equal(x.c.state.logs,null);assert.equal(x.toasts.length,1);
  const retry=x.run('loadLogs()');await flush();x.requests[1].resolve({data:[{id:'log'}]});await retry;assert.equal(x.c.state.logs[0].id,'log');
});
await test('a completion invalidates an earlier history request',async()=>{
  const x=setup(),p=x.run('loadLogs()');await flush();x.run('invalidateLogs()');x.requests[0].resolve({data:[]});await flush();
  assert.equal(x.requests.length,2);x.requests[1].resolve({data:[{id:'completed'}]});await p;assert.equal(x.c.state.logs[0].id,'completed');
});
await test('late history cannot populate another account',async()=>{
  const x=setup(),p=x.run('loadLogs()');await flush();x.c.accountEpoch++;x.c.state.user={id:'bob'};
  x.requests[0].resolve({data:[{id:'private'}]});await p;assert.equal(x.c.state.logs,null);
});
await test('Plan shares identical ranges and discards a reversed week response',async()=>{
  const x=setup(),old=x.run('loadPlan(true)'),same=x.run('loadPlan(true)');await flush();assert.equal(old,same);assert.equal(x.requests.length,2);
  x.c.state.weekStart=new Date(2026,8,14);const fresh=x.run('loadPlan()');await flush();assert.equal(x.requests.length,4);
  x.requests[2].resolve({data:[{id:'current-week'}]});x.requests[3].resolve({data:[]});await fresh;
  x.requests[0].resolve({data:[{id:'old-week'}]});x.requests[1].resolve({data:[]});await old;
  assert.equal(x.c.state.plan[0].id,'current-week');assert.equal(x.c.plans,1);
});
await test('Plan read failure preserves known rows and shows recovery',async()=>{
  const x=setup(),p=x.run('loadPlan()');await flush();x.requests.forEach(r=>r.resolve({error:{status:503}}));await p;
  assert.equal(x.c.state.plan[0].id,'known');assert.equal(x.toasts.length,1);
});
await test('optimistic Plan repaint invalidates earlier reads',async()=>{
  const x=setup(),p=x.run('loadPlan()');await flush();x.c.state.plan=[{id:'optimistic'}];x.run('repaintPlan()');
  x.requests.forEach(r=>r.resolve({data:[]}));await p;assert.equal(x.c.state.plan[0].id,'optimistic');
});
await test('polling reads pending ids only, shares no collections, reconciles deletion',async()=>{
  const x=setup();x.c.state.workouts=[{id:'pending',ingest_status:'processing'},{id:'gone',ingest_status:'processing'},{id:'ready',ingest_status:'ready'}];
  const events=[];x.c.onWorkoutChange=p=>events.push(p);
  const p=x.run('pollPending()');await flush();assert.equal(x.requests.length,1);assert.equal(x.requests[0].table,'workouts');
  assert.deepEqual(JSON.parse(JSON.stringify(x.requests[0].filters.find(f=>f[0]==='in')[2])),['pending','gone']);
  x.requests[0].resolve({data:[{id:'pending',ingest_status:'ready'}]});await p;
  assert.equal(events[0].eventType,'UPDATE');assert.equal(events[1].eventType,'DELETE');assert.equal(events[1].old.id,'gone');
});
await test('hidden tabs and busy polls perform no background reads',async()=>{
  const x=setup();x.c.state.workouts=[{id:'p',ingest_status:'processing'}];x.c.document.hidden=true;
  await x.run('pollPending()');x.run('watchPending()');assert.equal(x.requests.length,0);assert.equal(x.timers.length,0);
  x.c.document.hidden=false;x.c.pendBusy=true;await x.run('pollPending()');assert.equal(x.requests.length,0);
});
await test('poll errors do not delete processing cards and schedule recovery',async()=>{
  const x=setup();x.c.state.workouts=[{id:'p',ingest_status:'processing'}];x.c.onWorkoutChange=()=>assert.fail('must not reconcile failure');
  const p=x.run('pollPending()');await flush();x.requests[0].resolve({error:{status:503}});await p;
  assert.equal(x.c.state.workouts.length,1);assert.equal(x.c.pendBusy,false);assert.equal(x.timers[0].ms,4000);
});
await test('deadline aborts once without replaying an ambiguous operation',async()=>{
  const x=setup();vm.runInContext(fn('deadline'),x.c);let calls=0,signal;x.c.work=s=>{calls++;signal=s;return new Promise(()=>{});};
  const p=x.run('deadline(work, 15000)');await flush();x.timers[0].f();await assert.rejects(p,/timed out/);assert.equal(calls,1);assert.equal(signal.aborted,true);
});
await test('account teardown clears old counts, chips, chat, panels and toast',async()=>{
  const x=setup(),nodes=new Map();
  let motionCancelled=false;
  x.c.$=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'old-private-content',textContent:'old-private-title',classList:{add(){},remove(){}}});return nodes.get(id);};
  Object.assign(x.c,{wkChannel:null,pendingMotion:null,wo:null,woTimer:null,hist:{},histReady:true,strava:{},
    pumpy:{openSeq:3,wired:true,messages:[{content:'old'}]},billing:{said:'plus'},toastTimer:null,
    undoTimer:{},undoFn:()=>assert.fail('old account delete'),detailCloseTimer:null,woCloseTimer:null,
    pumpyReset:{animations:[{cancel(){motionCancelled=true;}}]},clearInterval(){},stopRest(){},releaseWake(){},guideClear(){},guideStill(){},dropCache(){},saveDraft(){}});
  vm.runInContext(fn('cancelPumpyReset'),x.c);
  x.c.document.querySelectorAll=()=>[];vm.runInContext(fn('clearAccount'),x.c);x.run('clearAccount()');
  for(const id of ['grid','chips','colbar','libcount','pumpylog','planview','progressview'])assert.equal(nodes.get(id).innerHTML,'',id);
  assert.equal(nodes.get('toast').textContent,'');assert.equal(x.c.state.workouts.length,0);assert.equal(x.c.pumpy.messages.length,0);
  assert.equal(x.c.pumpy.openSeq,4);assert.equal(x.c.billing.said,null);assert.equal(x.c.accountEpoch,2);
  assert.equal(x.c.undoFn,null);assert.equal(x.c.undoTimer,null);
  assert.equal(motionCancelled,true);assert.equal(x.c.pumpyReset,null);
});
await test('navigation starts reads before arrival but never grants a help visit',async()=>{
  const x=setup();let planReads=0;
  Object.assign(x.c,{VIEWS:['library','plan','progress','pumpy'],drawn:{},quietly:p=>p,
    guide:{visit:null},loadPlan:()=>{planReads++;return Promise.resolve();},countStats(){}});
  vm.runInContext(fn('preparePage'),x.c);x.run('preparePage(1)');assert.equal(planReads,1);assert.equal(x.c.guide.visit,null);assert.equal(x.run('ymd(state.weekStart)'),x.run('ymd(mondayOf(new Date()))'));assert.equal(x.c.planMode,'week');
});
await test('Plan opens on the local current week across Sunday, Monday and year boundaries', async()=>{
  for(const [day, expected] of [['2026-09-06T17:00:00','2026-08-31'],['2026-09-07T00:01:00','2026-09-07'],['2027-01-01T12:00:00','2026-12-28']]) {
    const x=setup();x.c.Date=class extends Date {constructor(...args){super(...(args.length?args:[day]));}};
    x.c.planMode='month';x.c.state.weekStart=new Date(2020,0,1);x.run('restorePlan()');
    assert.equal(x.run('ymd(state.weekStart)'),expected);assert.equal(x.c.planMode,'week');
  }
});
function transport(response) {
  const x=setup();let calls=0;
  Object.assign(x.c,{API:'https://fixture.invalid/',inFlight:{},SHARED:{explain:1},fetch:async()=>{calls++;return response;}});
  x.c.sb.auth={getSession:async()=>({data:{session:{access_token:'fixture-only'}}})};
  for(const name of ['deadline','api','apiStream'])vm.runInContext(fn(name),x.c);
  return Object.assign(x,{calls:()=>calls});
}
await test('stream delivers fragmented UTF-8 and final exactly once',async()=>{
  const bytes=new TextEncoder().encode('{"t":"delta","text":"café"}\n{"t":"final","status":"ok"}\n');
  const response=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
  const x=transport(response),events=[];x.c.onEvent=e=>events.push(e);
  await x.run('apiStream("pumpy/chat", {}, onEvent)');assert.equal(events.length,2);assert.equal(events[0].text,'café');assert.equal(x.calls(),1);
});
await test('malformed stream keeps already delivered text and rejects without replay',async()=>{
  const x=transport(new Response('{"t":"delta","text":"partial"}\ninvalid\n',{headers:{'content-type':'application/x-ndjson'}})),events=[];
  x.c.onEvent=e=>events.push(e);await assert.rejects(x.run('apiStream("pumpy/chat", {}, onEvent)'),/Interrupted answer/);
  assert.equal(events[0].text,'partial');assert.equal(x.calls(),1);
});
await test('stream 401 expires visibly; 429/503 JSON refusals reach recovery once',async()=>{
  for(const status of [401,429,503]){
    const x=transport(new Response(JSON.stringify({status:'error',message:'fixture refusal'}),{status,headers:{'content-type':'application/json'}})),events=[];
    x.c.onEvent=e=>events.push(e);const p=x.run('apiStream("pumpy/chat", {}, onEvent)');
    if(status===401){await assert.rejects(p,/401/);assert.equal(x.toasts.length,1);assert.equal(events.length,0);}
    else{await p;assert.equal(events[0].t,'final');assert.equal(events[0].status,'error');}
    assert.equal(x.calls(),1);
  }
});
await test('stream retires on account change without old events or expiry toast',async()=>{
  const x=transport(new Response('{}',{status:401}));let resolve;
  x.c.fetch=()=>new Promise(r=>{resolve=r;});x.c.onEvent=()=>assert.fail('old event');
  const p=x.run('apiStream("pumpy/chat", {}, onEvent)');await flush();x.c.accountEpoch++;
  resolve(new Response('{}',{status:401}));await assert.rejects(p,/Account changed/);assert.equal(x.toasts.length,0);
});
console.log(checks+' performance/freshness checks passed');
