// Execute the real persistence helper and reread admission together; no network.
const src=await Deno.readTextFile(new URL('../supabase/functions/spotter/index.ts',import.meta.url));
const helper=src.slice(src.indexOf('async function dbInsert('),src.indexOf('async function dbInsertMany('));
const handler=src.slice(src.indexOf('async function handleReprocess('),src.indexOf('// ---------- corrections ----------'));
const cache=src.slice(src.indexOf('async function captionMayOverwriteCache('),src.indexOf('// ---------- escalating a thin card'));
const setup=`
type Cors=any;type Counts=any;type UserCaps=any;type Parsed=any;type AiCtx=any;type Meta=any;type Card=any;
const SUPPLIED_CAPTION_MAX=10000; const CARD_V=7; const dbHeaders={};
export const state:any={inserted:0,reads:0};
class GuardError extends Error {};
const aiActor={getStore:()=>null};
function rest(t:string){return 'https://fixture.invalid/'+t;}
async function fetch(){state.inserted++;return Response.json([{id:42}]);}
async function dbSelect(t:string){if(t==='workouts')return [{id:'w',platform:'tiktok',ingest_status:'ready',shortcode:'tt-test',url:'https://example.com'}];return [];}
async function settledAll(a:any[]){return Promise.all(a);}
async function countsFor(){return {extracts:0};}
async function capsFor(){return {caps:{extract:10}};}
function overCap(){return false;}
async function fetchMeta(){state.reads++;return {caption:'Squat 3x10',author:'Trainer'};}
async function buildCard(){throw new GuardError('test stops at provider boundary');}
`;
const m=await import('data:application/typescript,'+encodeURIComponent(setup+helper+handler+cache+'\nexport {handleReprocess,captionMayOverwriteCache};'));
let n=0;function check(c:unknown,s:string){if(!c)throw new Error(s);n++;}
try{await m.handleReprocess('w','u',new Request('https://fixture.invalid',{method:'POST',body:'{}'}),{});}catch(e){check(String(e).includes('test stops at provider boundary'),'successful row reservation reaches provider boundary');}
check(m.state.inserted===1&&m.state.reads===1,'one row reservation followed by one source read');
for(const meta of [{supplied:true},{source:'phone-html'},{source:'user-caption'},{source:'personal-fallback'},{supplied:true,source:'phone-html,network'}])check(!await m.captionMayOverwriteCache('same-post',meta),'private input cannot enter shared cache');
check(await m.captionMayOverwriteCache('same-post',{source:'tiktok-embed'}),'server-origin content remains cacheable');
console.log('PASS '+n+' source trust and real database-helper contract checks');
