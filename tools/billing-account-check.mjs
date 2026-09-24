// Deferred real app functions: account changes must retire prices and purchase continuations.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
function lift(name) {
  const start=source.indexOf('  function '+name+'(');
  assert(start>=0,name);
  return source.slice(start,source.indexOf('\n  }',start)+4);
}
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function setup() {
  const prices=defer(),purchase=defer(),session=defer(),verification=defer();
  const calls=[],toasts=[],plans=[],storeCalls=[];
  const ctx=vm.createContext({state:{user:{id:'alice'}},accountEpoch:1,
    billing:{busy:false,interval:'year',prices:null,waiting:null},
    native:{purchases:{prices:()=>prices.promise,purchase:()=>{storeCalls.push('buy');return purchase.promise;},restore:()=>{storeCalls.push('restore');return purchase.promise;}}},
    sb:{auth:{getSession:()=>session.promise},functions:{invoke:(name,args)=>{calls.push({name,args});return verification.promise;}}},
    toast:s=>toasts.push(s),absorbPlan:r=>plans.push(r),planWord:s=>s,myPlan:()=>'free'});
  vm.runInContext('function accountNow(e,u){return e===accountEpoch && state.user && state.user.id===u;}\n'+['loadPrices','syncNativePurchase','nativePurchase'].map(lift).join('\n'),ctx);
  const switchAccount=(id='bob')=>{ctx.accountEpoch++;ctx.state.user={id};ctx.billing.prices={account:id};ctx.billing.busy=true;};
  return {ctx,prices,purchase,session,verification,calls,toasts,plans,storeCalls,switchAccount};
}
{
 const t=setup();
 Object.assign(t.ctx,{paintCtx(){},openSheet(){},paintPlans(){},paintPlanCode(){},loadCreator:()=>Promise.resolve(null),
   isFree:()=>true,planState:()=>'wait',loadCaps:()=>Promise.resolve(null),loadUse:()=>Promise.resolve(),loadSub:()=>Promise.resolve(null),
   $:()=>({value:'',classList:{contains:()=>false,add(){},remove(){},toggle(){}}})});
 vm.runInContext(lift('openPlans'),t.ctx);
 t.ctx.nativePurchase(false,{});t.ctx.openPlans(null);t.ctx.nativePurchase(false,{});
 assert.equal(t.storeCalls.length,1,'Reopening paywall must not reset the in-flight purchase lock');
}
{
 const t=setup(),request=t.ctx.loadPrices();t.switchAccount();t.prices.resolve({account:'alice'});await request;
 assert.equal(t.ctx.billing.prices.account,'bob');
}
{
 const t=setup(),request=t.ctx.loadPrices();t.switchAccount();t.prices.reject(new Error('offline'));await request;
 assert.equal(t.ctx.billing.prices.account,'bob');
}
for(const restore of [false,true]) {
 const t=setup(),button={disabled:false};t.ctx.nativePurchase(restore,button);t.switchAccount();t.purchase.resolve({});await flush();
 assert.equal(t.calls.length,0);assert.equal(t.plans.length,0);assert.equal(t.toasts.length,0);assert.equal(t.ctx.billing.busy,true);
}
{
 const t=setup();t.ctx.nativePurchase(false,{});t.purchase.resolve({});await flush();t.switchAccount('alice');
 t.session.resolve({data:{session:{user:{id:'alice'},access_token:'test-alice-token'}}});await flush();
 assert.equal(t.calls.length,0,'Same user with new session lifetime must retire old purchase');
}
{
 const t=setup();t.ctx.nativePurchase(false,{});t.purchase.resolve({});await flush();
 t.session.resolve({data:{session:{user:{id:'alice'},access_token:'test-alice-token'}}});await flush();
 assert.equal(t.calls[0].args.headers.Authorization,'Bearer test-alice-token');t.switchAccount();
 t.verification.resolve({data:{status:'ok',plan:'plus'}});await flush();
 assert.equal(t.plans.length,0);assert.equal(t.ctx.billing.busy,true);
}
{
 const t=setup(),button={disabled:false};t.ctx.nativePurchase(false,button);t.purchase.resolve({});await flush();
 t.session.resolve({data:{session:{user:{id:'alice'},access_token:'test-alice-token'}}});await flush();
 t.verification.resolve({data:{status:'ok',plan:'plus'}});await flush();
 assert.equal(t.plans.length,1);assert.equal(t.ctx.billing.busy,false);assert.equal(button.disabled,false);
}
console.log('PASS: stale prices, purchases, restores, same-user relogin and in-flight verification are account-fenced.');
