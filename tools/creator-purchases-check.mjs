// The RevenueCat webhook keeps the creator ledger. No network, no database: the
// shipped function is executed against a fake supabase client and a fake
// RevenueCat, and every RPC it makes is recorded and asserted, the way
// tools/ios/purchases-check.mjs drives the store adapter against a fake SDK.
//
// What has to hold: a paid production purchase records an earning with the
// store's transaction id and the price in cents; a store offer code attributes
// the account first, and only when it has no referral yet; sandbox, zero-price
// and unknown-store events record nothing; a customer-support cancellation
// refunds exactly what the ledger holds; and a ledger failure is a log line,
// never a failed webhook, because the entitlement sync it follows already
// succeeded and a 503 would make RevenueCat resend it.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';

const src=fs.readFileSync('supabase/functions/spotter-purchases/index.ts','utf8').replace(/^import .*;\n/gm,'');
const code=transformSync(src,{loader:'ts'}).code;

const uid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
function setup({env={},tables={},rpc={}}={}) {
  const calls=[],logs=[],errors=[];
  let handler=null;
  const data={profiles:[{id:uid}],creator_referrals:[],creator_earnings:[],...tables};
  const answers={
    sync_store_entitlement:{data:null,error:null},
    redeem_creator_code:{data:[{status:'ok',code:'MARIA',creator_name:'Maria',redeemed_at:'2026-09-18T10:00:00Z'}],error:null},
    record_creator_earning:{data:'ok',error:null},
    ...rpc};
  const from=(table)=>{const filters=[];const chain={
    select(){return chain;},
    eq(col,val){filters.push([col,val]);return chain;},
    async maybeSingle(){calls.push(['select',table,Object.fromEntries(filters)]);
      const rows=(data[table]||[]).filter(r=>filters.every(([c,v])=>r[c]===v));return {data:rows[0]??null,error:null};},
    async single(){const r=await chain.maybeSingle();return r.data?r:{data:null,error:{message:'no row'}};},
  };return chain;};
  // Args cross the vm boundary with the context's Object prototype; JSON brings them home for deepEqual.
  const db={from,rpc:async(name,args)=>{calls.push(['rpc',name,JSON.parse(JSON.stringify(args))]);const a=answers[name];return typeof a==='function'?a(args):a;},
    auth:{getUser:async()=>({data:{user:null},error:{message:'unused'}})}};
  const environment={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',REVENUECAT_API_KEY:'rc-key',REVENUECAT_WEBHOOK_AUTH:'hook-secret',...env};
  const ctx=vm.createContext({
    console:{log:(...a)=>logs.push(a.join(' ')),error:(...a)=>errors.push(a.join(' ')),warn:(...a)=>logs.push(a.join(' '))},
    Deno:{env:{get:k=>environment[k]},serve:fn=>{handler=fn;}},
    createClient:()=>db,
    verifiedEntitlement:()=>({active:true,expiry:'2027-01-01T00:00:00.000Z',source:'apple',product:'plus_month'}),
    fetch:async(url)=>{calls.push(['fetch',String(url)]);return {ok:true,json:async()=>({subscriber:{}})};},
    crypto,TextEncoder,Uint8Array,Response,Request,URL,AbortSignal,Set,Date,Math,Number,String,JSON,Array,Promise,Error,Object,
  });
  vm.runInContext(code,ctx);
  assert(handler,'Deno.serve received the handler');
  const hook=async(event,auth='hook-secret')=>handler(new Request('https://fn.invalid/spotter-purchases/webhook',
    {method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify({event})}));
  const rpcs=(name)=>calls.filter(c=>c[0]==='rpc'&&(!name||c[1]===name)).map(c=>({name:c[1],args:c[2]}));
  return {hook,calls,logs,errors,rpcs,data};
}
const purchase=(over={})=>({type:'INITIAL_PURCHASE',app_user_id:uid,environment:'PRODUCTION',store:'APP_STORE',price:6.99,
  currency:'USD',transaction_id:'t1',purchased_at_ms:Date.parse('2026-09-18T10:00:00Z'),period_type:'NORMAL',...over});
const ok=async(response)=>{assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});};

// A first purchase with the store's offer code: attributed, then recorded.
{
  const t=setup();
  await ok(await t.hook(purchase({offer_code:'maria'})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','redeem_creator_code','record_creator_earning'],'the entitlement is synced before any bookkeeping');
  assert.deepEqual(t.rpcs('redeem_creator_code')[0].args,{uid,p_code:'MARIA',p_source:'store'},'upper-cased, and marked as the store path');
  assert.deepEqual(t.rpcs('record_creator_earning')[0].args,
    {uid,p_source:'apple',p_external_id:'rc:t1',p_paid_at:'2026-09-18T10:00:00.000Z',p_gross_cents:699},'the price in cents, keyed by the store transaction');
  assert.equal(t.errors.length,0);
}
// The same purchase for an account that already has a code: no second attribution.
{
  const t=setup({tables:{creator_referrals:[{user_id:uid}]}});
  await ok(await t.hook(purchase({offer_code:'OTHER'})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','record_creator_earning'],'first code wins; the earning is still recorded');
}
// No offer code at all: the earning still lands, because the referral may have come from the app.
{
  const t=setup();
  await ok(await t.hook(purchase()));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','record_creator_earning']);
}
// An offer code that is not shaped like a creator code never reaches the database.
{
  const t=setup();
  await ok(await t.hook(purchase({offer_code:'summer sale!'})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','record_creator_earning']);
  assert.ok(!t.calls.some(c=>c[0]==='select'&&c[1]==='creator_referrals'));
}
// An offer code the database does not know is logged, and the earning is still attempted.
{
  const t=setup({rpc:{redeem_creator_code:{data:[{status:'unknown_code'}],error:null},record_creator_earning:{data:'no_referral',error:null}}});
  await ok(await t.hook(purchase({offer_code:'SUMMER'})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','redeem_creator_code','record_creator_earning']);
  assert.ok(t.logs.some(l=>/not attributed unknown_code/.test(l)));
  assert.equal(t.errors.length,0,'no referral is the ordinary case, not an error');
}
// Renewals and one-off purchases count; Play maps to google.
{
  const t=setup();
  await ok(await t.hook(purchase({type:'RENEWAL',store:'PLAY_STORE',price:50,transaction_id:'GPA.1',purchased_at_ms:Date.parse('2026-10-01T00:00:00Z')})));
  assert.deepEqual(t.rpcs('record_creator_earning')[0].args,{uid,p_source:'google',p_external_id:'rc:GPA.1',p_paid_at:'2026-10-01T00:00:00.000Z',p_gross_cents:5000});
  await ok(await t.hook(purchase({type:'NON_RENEWING_PURCHASE',transaction_id:'t9'})));
  assert.equal(t.rpcs('record_creator_earning').length,2);
}
// Nothing is owed for a sandbox purchase, a free period, or a store the ledger does not know.
for (const [why,over,env] of [
  ['sandbox',{environment:'SANDBOX'},{}],
  ['a trial',{price:0,period_type:'TRIAL'},{}],
  ['a null price',{price:null},{}],
  ['a negative price',{price:-1},{}],
  ['an unknown store',{store:'STRIPE'},{}],
  ['a missing transaction id',{transaction_id:''},{}],
  ['an expiration',{type:'EXPIRATION'},{}],
  ['an ordinary cancellation',{type:'CANCELLATION',cancel_reason:'UNSUBSCRIBE'},{}],
]) {
  const t=setup({env});
  await ok(await t.hook(purchase({offer_code:'MARIA',...over})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement'],why+' records nothing');
}
// Unless sandbox is explicitly allowed, the same way entitlement.ts allows it.
{
  const t=setup({env:{REVENUECAT_ALLOW_SANDBOX:'true'}});
  await ok(await t.hook(purchase({environment:'SANDBOX'})));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement','record_creator_earning']);
}
// An account this database has never seen gets neither a sync nor a ledger row.
{
  const t=setup({tables:{profiles:[]}});
  await ok(await t.hook(purchase({offer_code:'MARIA'})));
  assert.equal(t.rpcs().length,0);
}
// A refund gives back exactly what the ledger recorded, to the account it recorded it for.
{
  const t=setup({tables:{creator_earnings:[{external_id:'rc:t1',user_id:other,source:'google',gross_cents:699}]}});
  await ok(await t.hook({type:'CANCELLATION',cancel_reason:'CUSTOMER_SUPPORT',app_user_id:uid,environment:'PRODUCTION',store:'APP_STORE',transaction_id:'t1',price:null}));
  const refund=t.rpcs('record_creator_earning');
  assert.equal(refund.length,1);
  assert.equal(refund[0].args.uid,other,'the ledger row names the account, not the event');
  assert.equal(refund[0].args.p_source,'google','and the store it was recorded from');
  assert.equal(refund[0].args.p_external_id,'rc:refund:t1');
  assert.equal(refund[0].args.p_gross_cents,-699);
  assert.ok(Number.isFinite(Date.parse(refund[0].args.p_paid_at)),'refunded now, not at the purchase date');
}
// A refund of a payment the ledger never held, or of a refund row, writes nothing.
{
  const t=setup();
  await ok(await t.hook({type:'CANCELLATION',cancel_reason:'CUSTOMER_SUPPORT',app_user_id:uid,environment:'PRODUCTION',store:'APP_STORE',transaction_id:'never'}));
  assert.deepEqual(t.rpcs().map(r=>r.name),['sync_store_entitlement']);
  const u=setup({tables:{creator_earnings:[{external_id:'rc:r1',user_id:uid,source:'apple',gross_cents:-699}]}});
  await ok(await u.hook({type:'CANCELLATION',cancel_reason:'CUSTOMER_SUPPORT',app_user_id:uid,environment:'PRODUCTION',store:'APP_STORE',transaction_id:'r1'}));
  assert.deepEqual(u.rpcs().map(r=>r.name),['sync_store_entitlement']);
}
// A ledger failure of any kind is a log line; the webhook still answers ok.
for (const [why,rpc] of [
  ['an RPC error',{record_creator_earning:{data:null,error:{message:'boom'}}}],
  ['an RPC that throws',{record_creator_earning:()=>{throw new Error('connection reset');}}],
  ['a redeem error',{redeem_creator_code:{data:null,error:{message:'locked'}}}],
]) {
  const t=setup({rpc});
  await ok(await t.hook(purchase({offer_code:'MARIA'})));
  assert.equal(t.rpcs('sync_store_entitlement').length,1);
  assert.ok(t.errors.some(e=>/creator ledger failed INITIAL_PURCHASE t1/.test(e)),why+' is logged with the event named');
}
// What was there before is untouched: TEST events, the shared secret, transfers, and a failed sync.
{
  const t=setup();
  await ok(await t.hook({type:'TEST'}));
  assert.equal(t.calls.length,0);
  assert.equal((await t.hook(purchase(),'wrong')).status,401);
  assert.equal(t.calls.length,0);
  const u=setup({tables:{profiles:[{id:uid},{id:other}]}});
  await ok(await u.hook(purchase({type:'TRANSFER',transferred_from:[other],transferred_to:[uid],price:null})));
  assert.equal(u.rpcs('sync_store_entitlement').length,2,'both sides of a transfer are re-queried');
  assert.equal(u.rpcs('record_creator_earning').length,0);
  const v=setup({rpc:{sync_store_entitlement:{data:null,error:{message:'down'}}}});
  const failed=await v.hook(purchase({offer_code:'MARIA'}));
  assert.equal(failed.status,503,'the sync is the thing that must succeed, and it still says so when it does not');
  assert.equal(v.rpcs('record_creator_earning').length,0,'no bookkeeping about a sync that failed');
}
console.log('PASS creator ledger: paid production purchases record the store transaction in cents, store offer codes attribute once and first, sandbox/trial/unknown-store/unknown-account events record nothing, sandbox honoured only when allowed, customer-support cancellations refund what the ledger holds, ledger failures log and never fail the webhook, and TEST/secret/transfer/failed-sync behaviour is unchanged.');
