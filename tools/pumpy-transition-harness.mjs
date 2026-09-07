// Real chat reset/render/transport code with controllable animation completion.
// node tools/pumpy-transition-harness.mjs (same Linkedom dependency as pumpy-harness.mjs)
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {parseHTML}=await import(pathToFileURL(process.env.SPOTTER_DOM_MODULE || '/private/tmp/spotter-qa/node_modules/linkedom/esm/index.js'));
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');assert(start>=0,name);return source.slice(start,source.indexOf('\n  }',start)+4);}
let checks=0;
function test(name,work){work();checks++;console.log('PASS',name);}
function setup(){
  const {document,HTMLElement}=parseHTML('<html><body><div id="pumpyview"><div id="pumpylog"></div><div id="pumpyannounce"></div><div id="pumpyctx"></div><textarea id="pumpyinput"></textarea><button id="pumpysend"></button></div></body></html>');
  const animations=[],timers=[],events=[];
  HTMLElement.prototype.animate=function(frames,options){const a={node:this,frames,options,cancelled:false,cancel(){this.cancelled=true;},finish(){if(this.onfinish)this.onfinish();}};animations.push(a);return a;};
  const c=vm.createContext({document,console,Date,JSON,Promise,
    state:{user:{id:'alice'},view:'pumpy'},pumpyReset:null,MAX_REFS:6,NO_TOUCH:false,QUICK_ASKS:['Plan my week'],reduced:false,
    $:id=>document.getElementById(id),el:(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;},
    lessMotion:()=>c.reduced,guidePage(){},guideLearn(){},renderPumpyCredits(){},
    renderPumpyCtx(){document.getElementById('pumpyctx').textContent=c.pumpy.refs.join(',');},
    pumpyArt:()=>document.createElement('span'),pumpyMark:()=>document.createElement('span'),
    getComputedStyle:()=>({getPropertyValue:k=>({'--t-1':'150ms','--t-3':'320ms','--e-in':'ease-in','--e-out':'ease-out'}[k]||'')}),
    setTimeout:(f,ms)=>{const t={f,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cancelled=true;},
    liveEvent:r=>events.push(r),toast:m=>events.push(m),ensurePumpyMeter(){},
    apiStream:(path,payload,receive)=>{c.receive=receive;c.payload=payload;return {then(f){c.after=f;return {catch(f){c.failed=f;}};}};}
  });
  c.pumpy={thread:{id:'old'},messages:[{id:1,role:'user',content:'Old question'}],refs:['workout'],refsRev:2,openSeq:4,loaded:true,busy:false,meter:{left:10},meterAsked:true,wired:true,threads:[{id:'old'}]};
  for(const name of ['cancelPumpyReset','newPumpyThread','renderPumpy','renderMsg','sendPumpy','loadPumpy','settlePumpy','lastRefs'])vm.runInContext(fn(name),c);
  const run=s=>vm.runInContext(s,c);run('renderPumpy()');
  const log=c.$('pumpylog'),box=c.$('pumpyinput'),page=c.$('pumpyview');box.value='My draft';page.scrollTop=1200;
  return {c,run,log,box,page,animations,timers,events};
}
test('old DOM stays mounted through exit while the new conversation is ready',()=>{
  const x=setup(),old=x.c.pumpy,node=x.log.firstChild;x.run('newPumpyThread()');
  assert.notEqual(x.c.pumpy,old);assert.equal(x.log.firstChild,node);assert.equal(x.log.inert,true);
  assert.equal(x.c.pumpy.thread,null);assert.equal(x.c.pumpy.openSeq,5);assert.equal(x.c.pumpy.refsRev,3);assert.equal(x.c.pumpy.refs.length,0);
  assert.equal(x.box.value,'My draft');assert.equal(x.c.$('pumpysend').disabled,false);assert.equal(x.page.scrollTop,1200);
  assert.equal(x.c.pumpy.meter,old.meter);assert.equal(x.c.pumpy.threads,old.threads);assert.equal(x.c.pumpy.wired,true);
});
test('exit completion swaps once, resets scroll, and releases all motion state',()=>{
  const x=setup();x.run('newPumpyThread()');const stale=x.animations[0].onfinish;x.animations[0].finish();
  const hello=x.log.firstChild;assert.equal(hello.className,'pumpyhello');assert.equal(x.page.scrollTop,0);assert.equal(x.log.inert,false);
  assert.equal(x.c.$('pumpyctx').textContent,'');stale();assert.equal(x.log.firstChild,hello);
  x.animations.at(-1).finish();assert.equal(x.c.pumpyReset,null);assert.equal(x.log.classList.contains('resetting'),false);assert(x.animations.every(a=>a.cancelled));
});
test('rapid taps and an already empty chat preserve greeting identity',()=>{
  const x=setup();x.run('newPumpyThread()');const owner=x.c.pumpy;x.run('newPumpyThread()');assert.equal(x.c.pumpy,owner);assert.equal(x.animations.length,2);
  x.animations[0].finish();const hello=x.log.firstChild;x.run('newPumpyThread()');assert.equal(x.log.firstChild,hello);x.animations.at(-1).finish();x.run('newPumpyThread()');assert.equal(x.log.firstChild,hello);
});
test('sending during the exit cancels it and sends into the new conversation',()=>{
  const x=setup();x.run('newPumpyThread()');const stale=x.animations[0].onfinish;x.run('sendPumpy("A new question")');stale();
  assert.equal(x.c.payload.thread_id,null);assert.equal(x.c.payload.workout_ids.length,0);assert.equal(x.c.pumpy.messages[0].content,'A new question');
  assert.equal(x.c.pumpyReset,null);assert.equal(x.log.inert,false);assert.equal(x.log.querySelector('.pumpyhello'),null);assert.equal(x.c.pumpy.busy,true);
});
test('late stream packets, final and failure cannot repaint a reset chat',()=>{
  const x=setup();x.run('sendPumpy("Old request")');const receive=x.c.receive,after=x.c.after,failed=x.c.failed;x.run('newPumpyThread()');
  receive({t:'delta',text:'stale'});receive({t:'final',status:'ok',thread_id:'old',messages:[{id:9,role:'assistant',content:'stale'}]});after();failed(new Error('late failure'));
  assert.equal(x.events.length,0);assert.equal(x.c.pumpy.messages.length,0);assert.equal(x.c.pumpy.busy,false);assert.equal(x.c.pumpy.live,null);
});
test('reduced motion, hidden pages and missing animation support reset immediately',()=>{
  for(const mode of ['reduced','hidden','away','unsupported']){const x=setup();if(mode==='reduced')x.c.reduced=true;if(mode==='hidden')x.c.document.hidden=true;if(mode==='away')x.c.state.view='library';if(mode==='unsupported')x.log.animate=null;
    x.run('newPumpyThread()');assert(x.log.querySelector('.pumpyhello'));assert.equal(x.c.pumpyReset,null);assert.equal(x.animations.length,0);assert.equal(x.page.scrollTop,0);}
});
test('navigation or another render interrupts without a delayed greeting overwrite',()=>{
  const x=setup();x.run('newPumpyThread()');const stale=x.animations[0].onfinish;x.c.state.view='library';x.run('renderPumpy()');
  x.c.pumpy.messages=[{id:4,role:'user',content:'Another conversation'}];x.run('renderPumpy()');stale();
  assert.equal(x.log.textContent,'Another conversation');assert.equal(x.c.pumpyReset,null);assert.equal(x.log.inert,false);
});
test('account teardown cleanup prevents a delayed private DOM render',()=>{
  const x=setup();x.run('newPumpyThread()');const stale=x.animations[0].onfinish;x.run('cancelPumpyReset()');x.c.pumpy={};x.log.innerHTML='';stale();
  assert.equal(x.log.textContent,'');assert.equal(x.log.inert,false);assert.equal(x.c.$('pumpyctx').inert,false);
});
test('fallback timers settle when the browser withholds animation events',()=>{
  const x=setup();x.run('newPumpyThread()');x.timers.find(t=>!t.cancelled).f();assert(x.log.querySelector('.pumpyhello'));x.timers.find(t=>!t.cancelled).f();assert.equal(x.c.pumpyReset,null);assert.equal(x.log.inert,false);
});
test('a reduced-motion change during exit suppresses the arrival animation',()=>{
  const x=setup();x.run('newPumpyThread()');x.c.reduced=true;x.animations[0].finish();assert.equal(x.animations.length,2);assert.equal(x.c.pumpyReset,null);
});
// Database completion is asynchronous, like a cold tab warmed before the New chat tap.
const x=setup();let resolve;
x.c.sb={from(){const q={};for(const k of ['select','order','limit'])q[k]=()=>q;q.then=f=>new Promise(r=>{resolve=r;}).then(f);return q;}};
x.c.pumpy.loaded=false;x.run('loadPumpy(true); newPumpyThread()');resolve({data:[{id:'late',pumpy_messages:[{role:'user',content:'stale'}]}]});
for(let i=0;i<10;i++)await Promise.resolve();
test('late initial history cannot undo New chat or leave it loading',()=>{assert.equal(x.c.pumpy.thread,null);assert.equal(x.c.pumpy.messages.length,0);assert.equal(x.c.pumpy.loading,false);});
console.log(checks+' checks passed');
