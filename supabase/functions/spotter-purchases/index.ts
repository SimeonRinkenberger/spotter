import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { verifiedEntitlement } from './entitlement.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const origins = new Set(['https://localhost','capacitor://localhost','https://simeonrinkenberger.github.io']);
async function equalSecret(a: string, b: string) {
  const hash = (v: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  const xx = new Uint8Array(x), yy = new Uint8Array(y);
  let different = 0; for (let i=0;i<xx.length;i++) different |= xx[i]^yy[i];
  return different === 0;
}
async function sync(uid: string) {
  // Customer-info reads use the project app's public SDK key. No privileged
  // RevenueCat key capable of granting purchases is needed by this service.
  const apiKey = Deno.env.get('REVENUECAT_API_KEY');
  if (!apiKey) throw new Error('Store verification is not configured');
  const observed = new Date().toISOString();
  const result = await fetch('https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(uid), {
    headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(15000)
  });
  if (!result.ok) throw new Error('Store verification unavailable');
  const customer = (await result.json()).subscriber;
  const verified = verifiedEntitlement(customer, Date.now(), Deno.env.get('REVENUECAT_ALLOW_SANDBOX') === 'true');
  const { error } = await db.rpc('sync_store_entitlement', {
    uid, is_active: verified.active, expiry: verified.expiry, store: verified.source,
    product: verified.product, observed
  });
  if (error) throw new Error('Could not save verified access');
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
      for (const uid of ids) {
        const {data} = await db.from('profiles').select('id').eq('id',uid).maybeSingle();
        if (data) await sync(uid);
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
    const subscription = store.data?.active ? {source:store.data.source,status:'active',plan:'plus',current_period_end:store.data.expires_at} : legacy.data;
    return reply({status:'ok',plan:profile.data.plan,subscription});
  } catch (_) {
    return reply({status:'error',message:'Could not verify the subscription. Your purchase remains in your store account; please try Restore purchase again.'},503);
  }
});
