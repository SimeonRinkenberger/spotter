import { aiActor, createGuardedFetch, GuardError, openaiInputBound, tokenCost } from '../supabase/functions/spotter/ai-guard.ts';
let checks=0;
function ok(value: unknown,label:string){if(!value)throw new Error(label);checks++;}
const request={method:'POST',body:JSON.stringify({model:'gpt-5.6-luna',messages:[{role:'user',content:'read these sets'}],max_completion_tokens:4000})};
const url='https://api.openai.com/v1/chat/completions';
const actor=()=>({userId:'fixture-user',workKey:crypto.randomUUID()});
function fixture(reply:()=>Promise<Response>,admission='ok') {
 const calls:{name:string,args:any}[]=[];let network=0;
 const fetcher=createGuardedFetch(async(name,args)=>{calls.push({name,args});return name==='ai_reserve'?admission:null;},async()=>{network++;return await reply();});
 return {calls,fetcher,get network(){return network;}};
}
const response=()=>Promise.resolve(Response.json({choices:[],usage:{prompt_tokens:100,completion_tokens:30}}));
ok(tokenCost('gpt-5.6-luna',5000,1000)===.0022,'Luna pricing');
ok(tokenCost('gemini-3.6-flash',1000,1000)>0,'Gemini is priced');
const img=openaiInputBound({messages:[{content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'x'.repeat(900000),detail:'high'}}]}]});
ok(img<6000&&img>4096,'base64 is not mistaken for text tokens');
let f=fixture(response,'daily_budget');
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,request);throw new Error('allowed');}catch(e){ok(e instanceof GuardError,'budget rejection typed');}});
ok(f.network===0,'denial makes zero paid requests');
f=fixture(response);
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[0].name==='ai_reserve'&&f.calls[1].name==='ai_settle','reserve before generation then settle');
ok(f.calls[1].args.p_usd===tokenCost('gpt-5.6-luna',100,30),'settles reported usage');
f=fixture(async()=>{throw new Error('timeout');});
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,request);}catch{}});
ok(f.calls[1].args.p_usd===null,'network uncertainty retains dollars');
f=fixture(()=>Promise.resolve(new Response('',{status:429,headers:{'retry-after':'90'}})));
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[1].args.p_cooldown===90&&f.calls[1].args.p_usd===0,'429 cooldown and rejected call reconciled');
f=fixture(()=>Promise.resolve(new Response('broken json')));
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[1].args.p_usd===null,'malformed usage cannot be logged as free');
f=fixture(response);
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,{...request,body:request.body.replace('gpt-5.6-luna','unknown-model')});}catch(e){ok(e instanceof GuardError,'unknown price refused');}});
ok(f.network===0,'unknown model never called');
const data='data: '+JSON.stringify({usage:{prompt_tokens:100,completion_tokens:30}})+'\n\ndata: [DONE]\n\n';
f=fixture(()=>Promise.resolve(new Response(data,{headers:{'content-type':'text/event-stream'}})));
await aiActor.run(actor(),async()=>{const r=await f.fetcher(url,{...request,body:JSON.stringify({...JSON.parse(request.body),stream:true})});ok(await r.text()===data,'SSE bytes preserved');});
ok(f.calls[1].args.p_usd===tokenCost('gpt-5.6-luna',100,30),'stream reports actual usage');
f=fixture(()=>Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {}\n\n'));}}),{headers:{'content-type':'text/event-stream'}})));
await aiActor.run(actor(),async()=>{const r=await f.fetcher(url,{...request,body:JSON.stringify({...JSON.parse(request.body),stream:true})});await r.body!.cancel();});
ok(f.calls[1].args.p_usd===null,'cancelled stream retains unknown charge');
let operations:string[]=[];
const gemini=createGuardedFetch(async(name,args)=>{operations.push(name);return 'ok';},async(input)=>{
 if(String(input).includes('countTokens')){operations.push('countTokens');return Response.json({totalTokens:1000});}
 operations.push('generate');return Response.json({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:20}});
});
await aiActor.run(actor(),()=>gemini('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{method:'POST',body:JSON.stringify({contents:[{parts:[{text:'read'}]}],generationConfig:{maxOutputTokens:4000}})}));
ok(operations.join(',')==='countTokens,ai_reserve,generate,ai_settle','Gemini uses input token preflight before paid generation');
const unavailable=createGuardedFetch(async()=>{throw new Error('DB down');},async()=>{throw new Error('network must not run');});
await aiActor.run(actor(),async()=>{try{await unavailable(url,request);}catch(e){ok(String(e).includes('DB down')||e instanceof GuardError,'accounting outage refuses calls');}});
f=fixture(response);
await aiActor.run(actor(),async()=>{try{await f.fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',body:new FormData()});}catch(e){ok(e instanceof GuardError,'unbounded duration-priced audio refused');}});
ok(f.network===0&&f.calls.length===0,'audio refusal makes no paid call or speculative charge');
console.log(`${checks} AI transport checks passed; mocked providers, no paid calls.`);
