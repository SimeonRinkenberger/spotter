import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const handler=source.slice(source.indexOf('  var rereading = {};'),source.indexOf('  $("wclose").onclick'));
function fixture(){
 const button={disabled:false,textContent:'Read it again',setAttribute(k,v){this[k]=v;}};
 const calls=[],opened=[]; let resolve,reject;
 const c={current:{id:'a'},$:()=>button,isPending:w=>w.ingest_status==='processing',isFailed:()=>false,retryWorkout:()=>{},api:(path)=>{calls.push(path);return new Promise((a,b)=>{resolve=a;reject=b;});},state:{workouts:[{id:'a'}]},load:()=>Promise.resolve(),openDetail:w=>opened.push(w.id),render:()=>{},watchPending:()=>{},toast:()=>{},limitHit:()=>{}};
 vm.createContext(c); vm.runInContext(handler,c);
 return {c,button,calls,opened,resolve:v=>resolve(v),reject:()=>reject(new Error('offline'))};
}
const flush=()=>new Promise(r=>setImmediate(r));
for(const outcome of ['ok','error','reject','processing']){
 const x=fixture();x.button.onclick();x.button.onclick();
 assert.equal(x.calls.length,1);assert.equal(x.button.textContent,'Reading…');assert.equal(x.button.disabled,true);assert.equal(x.button['aria-busy'],'true');
 if(outcome==='reject')x.reject();else x.resolve({status:outcome,workout:{id:'a'}});
 await flush();assert.equal(x.button.textContent,'Read it again');assert.equal(x.button['aria-busy'],'false');
}
for(const outcome of ['ok','processing']){
 const x=fixture(),original=x.c.current;x.button.onclick();x.c.current={id:'b'};x.c.syncRereadButton(x.c.current);
 x.resolve({status:outcome,workout:{id:'a'}});await flush();assert.deepEqual(x.opened,[]);assert.equal(x.c.current.ingest_status,undefined);
 if(outcome==='processing')assert.equal(original.ingest_status,'processing');
}
console.log('PASS: stationary busy label, duplicate-click guard, success/error/rejection cleanup, queued response, and navigation during reread.');
