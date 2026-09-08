// Execute the real job coordinator against in-memory persistence and reader seams.
const source = await Deno.readTextFile(new URL('../supabase/functions/spotter/index.ts', import.meta.url));
const jobCode = source.slice(source.indexOf('async function runJob('), source.indexOf('async function handleWorkerTick('));
const stubs = `
type Job=any; type Parsed=any; type AiCtx=any; type Meta=any; type Card=any; type MediaTier=any; type VisionProgress=any;
const CARD_V=6;
const aiActor={run:(_a:any,f:any)=>f(),getStore:()=>null};
class GuardError extends Error {}
export const state:any={cached:[],result:null,steps:[],finished:[],seed:null};
class SoftFailure extends Error { constructor(public userMessage:string, message:string){super(message);} }
function providerFor(){return {cacheable:true};}
async function dbSelect(){return state.cached;}
async function finishJob(...args:any[]){state.finished.push(args);}
async function topUpMeta(_p:any,m:any){return m;}
async function jobStep(_id:any,step:any,extra:any){state.steps.push({step,...extra});}
async function fetchMeta(){return {caption:'Workout',author:'Trainer',images:['a','b']};}
async function buildCard(_m:any,_p:any,_c:any,checkpoint:any,_cursor:any,seed:any){
 state.seed=seed; await checkpoint(2,state.result);return state.result;
}
function minimalCard(){throw new Error('unexpected fallback');}
function visionLimit(_k:any,d:any){return d;}
function countExercises(c:any){return c.blocks.flatMap((b:any)=>b.exercises).length;}
async function escalateToMedia(_j:any,_p:any,meta:any,card:any){return {meta,card,ran:[]};}
async function storeThumb(){return 'thumb';}
async function captionMayOverwriteCache(){return true;}
async function dbUpsert(){}
`;
const m=await import('data:application/typescript,'+encodeURIComponent(stubs+'\nexport '+jobCode));
let checks=0;
function check(v:unknown,n:string){checks++;if(!v)throw new Error(n);}
const partial={title:'Workout',blocks:[{exercises:[{name:'Squat'}]}],vision:{total:2,completed:[0],missing:[1]}};
async function run(attempts:number,result:any,cached:any[]=[],seed?:any){
 Object.assign(m.state,{cached,result,steps:[],finished:[],seed:null});
 let failed=false;
 try{await m.runJob({id:'job',user_id:'user',platform:'tiktok',shortcode:'tt-test',kind:'photo',url:'https://example.com',step:seed?'vision:2':'meta',card:seed,meta:seed?{caption:'Workout',images:['a','b']}:null,attempts,max_attempts:4});}catch(e){failed=String(e).includes('incomplete carousel');}
 return failed;
}
check(await run(1,partial),'incomplete first attempt must retry');
check(m.state.finished.length===0,'incomplete attempt cannot finish');
check(m.state.steps.some((s:any)=>s.card?.vision?.completed?.[0]===0),'successful page checkpoint persists before retry');
check(!await run(4,partial),'useful partial may finish at attempt cap');
check(m.state.finished[0][3].vision.missing[0]===1,'partial warning data survives completion');
check(await run(4,{...partial,blocks:[]}),'entirely unreadable post fails at attempt cap');
check(await run(2,partial,[{card:partial}],partial),'partial cache cannot short circuit retry');
check(m.state.seed===partial,'resumed reader receives persisted partial card');
const complete={...partial,vision:{total:2,completed:[0,1],missing:[]}};
check(!await run(2,complete,[],partial) && m.state.finished.length===1,'successful retry finishes');
check(!await run(1,null,[{card:complete}]) && !m.state.steps.length,'complete cache remains free');
console.log('PASS '+checks+' ingest coverage checks; no production writes.');
