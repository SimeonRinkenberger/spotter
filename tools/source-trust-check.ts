// Execute the real persistence helper and reread admission together; no network.
const src=await Deno.readTextFile(new URL('../supabase/functions/spotter/index.ts',import.meta.url));
const helper=src.slice(src.indexOf('async function dbInsert('),src.indexOf('async function dbInsertMany('));
const handler=src.slice(src.indexOf('async function handleReprocess('),src.indexOf('// ---------- corrections ----------'));
const cache=src.slice(src.indexOf('async function captionMayOverwriteCache('),src.indexOf('// ---------- escalating a thin card'));
// handleReprocess replays a cached Video Context Pack rather than paying to read
// the video again, so the real gate comes along for the ride instead of a stub.
const packGate=src.slice(src.indexOf('function usablePack('),src.indexOf('function mediaSeed('));
const setup=`
import {PACK_V} from '${new URL('../supabase/functions/spotter/pack.ts',import.meta.url).href}';
type Pack=any;
type Cors=any;type Counts=any;type UserCaps=any;type Parsed=any;type AiCtx=any;type Meta=any;type Card=any;
const SUPPLIED_CAPTION_MAX=10000; const CARD_V=8; const dbHeaders={};
export const state:any={inserted:0,reads:0};
class GuardError extends Error {};
const aiActor={getStore:()=>null};
function rest(t:string){return 'https://fixture.invalid/'+t;}
async function fetch(){state.inserted++;return Response.json([{id:42}]);}
// index.ts's db helpers call rest.ts's serviceFetch (one retry on a 401 PGRST303): here, the stub above.
function serviceFetch(i:any,o?:any){return fetch(i,o);}
async function dbSelect(t:string){if(t==='workouts')return [{id:'w',platform:'tiktok',ingest_status:'ready',shortcode:'tt-test',url:'https://example.com'}];return [];}
async function settledAll(a:any[]){return Promise.all(a);}
async function countsFor(){return {extracts:0};}
async function capsFor(){return {plan:'free',caps:{extract:10}};}
function providerFor(){return {media:true};}
async function premiumAccess(){return false;}
function cacheForAccess(row:any){return row ?? null;}
function overCap(){return false;}
async function fetchMeta(){state.reads++;return {caption:'Squat 3x10',author:'Trainer'};}
async function buildCard(){throw new GuardError('test stops at provider boundary');}
`;
const m=await import('data:application/typescript,'+encodeURIComponent(setup+helper+handler+cache+packGate+'\nexport {handleReprocess,captionMayOverwriteCache};'));
let n=0;function check(c:unknown,s:string){if(!c)throw new Error(s);n++;}
try{await m.handleReprocess('w','u',new Request('https://fixture.invalid',{method:'POST',body:'{}'}),{});}catch(e){check(String(e).includes('test stops at provider boundary'),'successful row reservation reaches provider boundary');}
check(m.state.inserted===1&&m.state.reads===1,'one row reservation followed by one source read');
for(const meta of [{supplied:true},{source:'phone-html'},{source:'user-caption'},{source:'personal-fallback'},{supplied:true,source:'phone-html,network'}])check(!await m.captionMayOverwriteCache('same-post',meta),'private input cannot enter shared cache');
check(await m.captionMayOverwriteCache('same-post',{source:'tiktok-embed'}),'server-origin content remains cacheable');
console.log('PASS '+n+' source trust and real database-helper contract checks');
