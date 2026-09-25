import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { sandboxPolicy, storeAccess, verifiedEntitlement } from './entitlement.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The two Capacitor shells: Android's WebView and iOS's WKWebView. Only the native
// app syncs a store purchase; the web app on GitHub Pages is retired, so its origin
// is no longer allowed (that origin is shared with another app).
const origins = new Set(['https://localhost','capacitor://localhost']);
async function equalSecret(a: string, b: string) {
  const hash = (v: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  const xx = new Uint8Array(x), yy = new Uint8Array(y);
  let different = 0; for (let i=0;i<xx.length;i++) different |= xx[i]^yy[i];
  return different === 0;
}
// A QA account is one the owner flagged with profiles.limits.store_qa = true.
// `limits` is the per-account override column only the service role can write
// (authenticated may update display_name and settings, nothing else), so no
// client can flag itself. Asked only when a policy could use the answer.
async function isQa(uid: string) {
  const { data, error } = await db.from('profiles').select('limits').eq('id', uid).maybeSingle();
  if (error) throw new Error('Could not read the account');
  return data?.limits?.store_qa === true;
}
async function sync(uid: string) {
  // Customer-info reads use the project app's public SDK key. No privileged
  // RevenueCat key capable of granting purchases is needed by this service.
  const apiKey = Deno.env.get('REVENUECAT_API_KEY');
  if (!apiKey) throw new Error('Store verification is not configured');
  const policy = sandboxPolicy(k => Deno.env.get(k));
  const access = storeAccess(policy, policy !== 'off' && await isQa(uid));
  const observed = new Date().toISOString();
  const headers: Record<string,string> = { Authorization: 'Bearer ' + apiKey };
  if (access.xcode) headers['X-Is-Sandbox'] = 'true';
  const result = await fetch('https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(uid), {
    headers, signal: AbortSignal.timeout(15000)
  });
  if (!result.ok) throw new Error('Store verification unavailable');
  const customer = (await result.json()).subscriber;
  const verified = verifiedEntitlement(customer, Date.now(), access);
  const { error } = await db.rpc('sync_store_entitlement', {
    uid, is_active: verified.active, expiry: verified.expiry, store: verified.source,
    product: verified.product, observed, environment: verified.environment, will_renew: verified.willRenew
  });
  if (error) throw new Error('Could not save verified access');
}

// ---------- the creator ledger ----------
//
// After the entitlement is synced, and never in its way: a paid store event for
// an account somebody sent writes one creator_earnings row, and a refund of one
// writes its mirror. Two RPCs do the deciding (window, duplicates, no referral);
// this side only translates the event. Everything here is inside a try in the
// handler below, so a ledger failure is a log line and the webhook still says ok.
//
// Only production events count, whatever the sandbox policy lets unlock Plus: a
// sandbox, TestFlight, App Review or Test Store purchase is nobody's money, and a
// creator must not be owed commission on it.
const PURCHASE_EVENTS = new Set(['INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE']);
const CREATOR_CODE = /^[A-Za-z0-9]{3,20}$/;
const storeSource = (store: unknown) => store === 'APP_STORE' ? 'apple' : store === 'PLAY_STORE' ? 'google' : null;
async function creatorLedger(event: any) {
  const uid = event?.app_user_id;
  if (typeof uid !== 'string' || !UUID.test(uid)) return;
  if (event.environment !== 'PRODUCTION') return;
  const tid = typeof event.transaction_id === 'string' ? event.transaction_id.trim() : '';
  if (!tid) return;
  if (PURCHASE_EVENTS.has(event.type)) {
    const source = storeSource(event.store);
    const price = Number(event.price);
    if (!source || !(price > 0)) return;
    const paidAt = Number.isFinite(Number(event.purchased_at_ms)) ? new Date(Number(event.purchased_at_ms)) : new Date();
    // The store's own offer code, typed in the store and never in the app. First
    // code wins, so only an account with no referral is attributed this way.
    const offer = typeof event.offer_code === 'string' ? event.offer_code.trim() : '';
    if (CREATOR_CODE.test(offer)) {
      const {data: referral} = await db.from('creator_referrals').select('user_id').eq('user_id',uid).maybeSingle();
      if (!referral) {
        const {data, error} = await db.rpc('redeem_creator_code', { uid, p_code: offer.toUpperCase(), p_source: 'store' });
        if (error) throw new Error('redeem_creator_code: ' + error.message);
        const status = Array.isArray(data) ? data[0]?.status : data?.status;
        if (status !== 'ok') console.log('creator ledger: store offer code not attributed', status);
      }
    }
    const {data, error} = await db.rpc('record_creator_earning', {
      uid, p_source: source, p_external_id: 'rc:' + tid, p_paid_at: paidAt.toISOString(), p_gross_cents: Math.round(price * 100)
    });
    if (error) throw new Error('record_creator_earning: ' + error.message);
    if (data !== 'ok' && data !== 'no_referral') console.log('creator ledger:', data, 'rc:' + tid);
    return;
  }
  if (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT') {
    // A refund. Only a payment the ledger holds can be given back, and it is
    // given back at exactly what was recorded, whatever the event says now.
    const {data: earning} = await db.from('creator_earnings').select('user_id,source,gross_cents').eq('external_id','rc:' + tid).maybeSingle();
    if (!earning || !(earning.gross_cents > 0)) return;
    const {data, error} = await db.rpc('record_creator_earning', {
      uid: earning.user_id ?? uid, p_source: earning.source, p_external_id: 'rc:refund:' + tid,
      p_paid_at: new Date().toISOString(), p_gross_cents: -earning.gross_cents
    });
    if (error) throw new Error('record_creator_earning: ' + error.message);
    if (data !== 'ok') console.log('creator ledger: refund', data, 'rc:refund:' + tid);
  }
}
Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const cors: Record<string,string> = { 'Vary':'Origin', 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods':'POST,OPTIONS' };
  if (origin && origins.has(origin)) cors['Access-Control-Allow-Origin']=origin;
  const reply = (data: unknown,status=200) => Response.json(data,{status,headers:cors});
  if (origin && !origins.has(origin)) return reply({error:'Origin not allowed'},403);
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if (req.method!=='POST') return reply({error:'Method not allowed'},405);
  try {
    const token = req.headers.get('authorization') || '';
    const webhook = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
    const isHook = new URL(req.url).pathname.endsWith('/webhook');
    if (isHook) {
      if (!webhook || !await equalSecret(token, webhook)) return reply({error:'Unauthorized'},401);
      const body = await req.text();
      if (body.length>100000) return reply({error:'Payload too large'},413);
      const event = JSON.parse(body).event;
      if (event?.type==='TEST') return reply({status:'ok'});
      // Re-query current state rather than trusting event order or receipt claims.
      const ids = [...new Set([event?.app_user_id, ...(event?.transferred_from || []), ...(event?.transferred_to || [])])]
        .filter((id): id is string => typeof id==='string' && UUID.test(id));
      if (ids.length>20) return reply({error:'Too many accounts'},400);
      let known = false;
      for (const uid of ids) {
        const {data} = await db.from('profiles').select('id').eq('id',uid).maybeSingle();
        if (data) { await sync(uid); if (uid===event?.app_user_id) known = true; }
      }
      // The ledger is bookkeeping about the sync that just succeeded. It must not
      // be able to turn that success into a retry: a 503 here would make
      // RevenueCat resend the event, and the entitlement it describes is already saved.
      if (known) {
        try { await creatorLedger(event); }
        catch (e) { console.error('creator ledger failed', event?.type, event?.transaction_id, e); }
      }
      return reply({status:'ok'});
    }
    if (!token.startsWith('Bearer ')) return reply({error:'Unauthorized'},401);
    const {data: auth,error} = await db.auth.getUser(token.slice(7));
    if (error || !auth.user) return reply({error:'Unauthorized'},401);
    await sync(auth.user.id);
    const [profile,store,legacy] = await Promise.all([
      db.from('profiles').select('plan').eq('id',auth.user.id).single(),
      db.from('store_entitlements').select('*').eq('user_id',auth.user.id).maybeSingle(),
      db.from('subscriptions').select('source,status,plan,current_period_end,cancel_at_period_end').eq('user_id',auth.user.id).maybeSingle()
    ]);
    if (profile.error) throw new Error('Could not read verified access');
    // cancel_at_period_end is the name every build's Settings already reads, so a
    // store subscription with auto-renew off says "ends" there instead of "renews".
    const subscription = store.data?.active ? {source:store.data.source,status:'active',plan:'plus',current_period_end:store.data.expires_at,
      cancel_at_period_end:store.data.will_renew === false,environment:store.data.environment ?? null} : legacy.data;
    return reply({status:'ok',plan:profile.data.plan,subscription});
  } catch (_) {
    return reply({status:'error',message:'Could not verify the subscription. Your purchase remains in your store account; please try Restore purchase again.'},503);
  }
});
