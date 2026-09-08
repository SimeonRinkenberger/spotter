// Offline transport contract tests; never contacts a provider or needs a key.
import { readVisionImage, parseVisionOutput, type VisionReaderOptions } from '../supabase/functions/spotter/vision-reader.ts';
let checks = 0;
function check(ok: unknown, name: string) { checks++; if (!ok) throw new Error(name); }
const workout = {title:'Leg day',blocks:[{type:'straight',exercises:[{name:'Squat',sets:3,reps:'8'}]}]};
const reply = (provider: string, raw: unknown, finish?: string) => new Response(JSON.stringify(provider === 'openai' ? {
  choices:[{finish_reason:finish ?? 'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:1200,completion_tokens:200,prompt_tokens_details:{cached_tokens:300}}
} : {candidates:[{finishReason:finish ?? 'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:200,thoughtsTokenCount:20}}));
function fixture(responses: Array<Response | Error | 'timeout'>, overrides: Partial<VisionReaderOptions> = {}) {
  const seen: Array<{url:string,body:any}> = [], costs: any[] = [];
  const options: VisionReaderOptions = {
    openaiKey:'test',geminiKey:'test',openaiModel:'gpt-5.6-luna',geminiModel:'gemini-test',timeoutMs:100,
    allowed:async()=>true,record:async(...args)=>{costs.push(args);},
    fetcher:async (url, init) => {
      seen.push({url:String(url),body:JSON.parse(String(init?.body))});
      const r=responses.shift();
      if(r==='timeout')return await new Promise((_resolve,reject)=>{
        init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});
      });
      if(r instanceof Error)throw r;
      if(!r)throw new Error('unexpected provider call');
      return r;
    }, ...overrides,
  };
  return {seen,costs,read:()=>readVisionImage('ZmFrZQ==','image/png','Extract workout JSON.',options)};
}
{
  const f=fixture([reply('openai',workout)]),r=await f.read();
  check(r.by==='vision:openai:gpt-5.6-luna','correct provenance');
  check(f.seen.length===1,'no redundant Gemini call');
  const b=f.seen[0].body;
  check(b.reasoning_effort==='none' && b.max_completion_tokens===4000,'bounded economical request');
  check(b.messages[1].content[0].image_url.detail==='high','readable bounded image detail');
  check(f.costs[0][2].cachedTok===300 && f.costs[0][3]===true,'actual usage recorded');
}
for(const failure of [new Response('',{status:429}),new Response('',{status:503}),new Error('network'), 'timeout',reply('openai',workout,'length'),reply('openai',{unreadable:true}),reply('openai',{}),new Response('{broken')]) {
  const f=fixture([failure as any,reply('gemini',workout)]),r=await f.read();
  check(r.by==='vision:gemini:gemini-test' && f.seen.length===2,'one fallback after failure');
  check(f.costs.length===2 && !f.costs[0][3] && f.costs[1][3],'failure and success both recorded');
}
{
  const f=fixture([reply('openai',{none:true})]);const r=await f.read();
  check(r.raw.none===true && f.seen.length===1,'valid empty slide stops without paying twice');
}
{
  const f=fixture([new Response('',{status:429}),new Response('',{status:503})]);let failed=false;
  try{await f.read();}catch{failed=true;}
  check(failed && f.seen.length===2,'both providers failed: never report empty or loop through aliases');
}
{
  const f=fixture([reply('gemini',workout)],{allowed:async p=>p==='gemini'});await f.read();
  check(f.seen.length===1 && f.seen[0].url.includes('googleapis'),'spend gate respected');
  const blocked=fixture([],{allowed:async()=>false});let failed=false;
  try{await blocked.read();}catch{failed=true;}check(failed && !blocked.seen.length,'no spend when all providers disallowed');
}
for(const bad of [null,[],{}, {blocks:[]},{unreadable:true},{blocks:[{exercises:[{name:''}]}]}]) {
  let failed=false;try{parseVisionOutput(JSON.stringify(bad));}catch{failed=true;}
  check(failed,'reject invalid output instead of declaring a successful read');
}
console.log('PASS '+checks+' vision reader checks; no live requests.');
