import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const lift = name => { const start = source.indexOf('  function '+name+'('); assert(start>=0); return source.slice(start,source.indexOf('\n  }',start)+4); };
const defer = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = () => new Promise(setImmediate);
function setup() {
  const prepare=defer(),session=defer(),capture=defer(),response=defer();
  const calls=[],toasts=[],absorbed=[];
  const ctx={accountEpoch:1,state:{user:{id:'alice'},workouts:[]},current:null,
    isFree:()=>false,api:(path)=>{calls.push(path);return path==='ingest/prepare'?prepare.promise:response.promise;},
    native:{contactSheet:opts=>{calls.push('capture:'+opts.token);return capture.promise;}},
    sb:{auth:{getSession:()=>session.promise}},toast:s=>toasts.push(s),absorbWorkout:w=>absorbed.push(w),
    openDetail:()=>{},render:()=>{},watchPending:()=>{},limitHit:()=>{throw new Error('unexpected limit UI');}};
  ctx.accountNow=(e,u)=>e===ctx.accountEpoch&&ctx.state.user?.id===u;
  vm.createContext(ctx);vm.runInContext(['deviceFrames','readVideo','retryWorkout'].map(lift).join('\n'),ctx);
  const change=()=>{ctx.accountEpoch++;ctx.state.user={id:'bob'};};
  return {ctx,prepare,session,capture,response,calls,toasts,absorbed,change};
}
{
 const t=setup(),result=t.ctx.deviceFrames({url:'old-url'});t.change();t.prepare.reject(new Error('Account changed'));
 await assert.rejects(result,/Account changed/);assert(!t.calls.some(c=>c.startsWith('capture:')));
}
{
 const t=setup(),result=t.ctx.deviceFrames({url:'old-url'});t.prepare.resolve({needs_frames:true});await flush();t.change();
 t.session.resolve({data:{session:{user:{id:'bob'},access_token:'bob-test'}}});
 await assert.rejects(result,/Account changed/);assert(!t.calls.some(c=>c.startsWith('capture:')));
}
{
 const t=setup(),button={};t.ctx.readVideo({id:'w',url:'old-url'},button,true);
 t.prepare.resolve({needs_frames:true});t.session.resolve({data:{session:{user:{id:'alice'},access_token:'alice-test'}}});await flush();
 t.change();t.capture.resolve({ok:true,frames:{}});await flush();
 assert(!t.calls.some(c=>c.endsWith('/media')));assert.equal(t.toasts.length,0);
}
{
 const t=setup(),button={};t.ctx.retryWorkout({id:'w'},button);t.change();t.response.reject(new Error('Account changed'));await flush();
 assert.equal(t.toasts.length,0);assert.equal(button.textContent,'Queued…');
}
{
 const t=setup(),w={id:'w',url:'url',user_edit_revision:2,blocks:['old']};
 t.ctx.state.workouts=[w];t.ctx.readVideo(w,{},true);t.prepare.resolve({needs_frames:false});await flush();
 const edited={...w,user_edit_revision:3,blocks:['personal edit'],user_workout_override:{blocks:['personal edit']}};
 t.ctx.state.workouts=[edited];t.response.resolve({status:'ok',workout:w});await flush();
 assert.equal(t.absorbed[0],edited);assert.match(t.toasts[0],/personal exercise list was kept/);
}
{
 const t=setup(),result=t.ctx.deviceFrames({url:'url'});t.prepare.reject(new Error('offline'));
 t.session.resolve({data:{session:{user:{id:'alice'},access_token:'alice-test'}}});await flush();t.capture.reject(new Error('decoder unavailable'));
 assert.equal(await result,null,'ordinary capture failure retains fallback');
}
console.log('PASS reader account fences: prepare/session/capture transitions, no wrong-account upload/request/UI, stale edit revision, ordinary fallback.');
