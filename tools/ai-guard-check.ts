import { aiActor, createGuardedFetch, GuardError, openaiInputBound, tokenCost } from '../supabase/functions/spotter/ai-guard.ts';
let checks=0;
function ok(value: unknown,label:string){if(!value)throw new Error(label);checks++;}
const request={method:'POST',body:JSON.stringify({model:'gpt-5.6-luna',messages:[{role:'user',content:'read these sets'}],max_completion_tokens:4000})};
const url='https://api.openai.com/v1/chat/completions';
const actor=()=>({userId:'fixture-user',workKey:crypto.randomUUID()});
function fixture(reply:()=>Promise<Response>,admission='ok') {
 const calls:{name:string,args:any}[]=[];let network=0;
 const fetcher=createGuardedFetch(async(name,args)=>{calls.push({name,args});return name==='ai_reserve'?admission:true;},async()=>{network++;return await reply();});
 return {calls,fetcher,get network(){return network;}};
}
const response=()=>Promise.resolve(Response.json({choices:[],usage:{prompt_tokens:100,completion_tokens:30}}));
ok(tokenCost('gpt-5.6-luna',5000,1000)===.0022,'Luna pricing');
// GPT-6 Luna, read 2026-09-23: $0.10 in, $0.50 out, $0.01 cached, per million.
ok(tokenCost('gpt-6-luna',5000,1000)===.001,'GPT-6 Luna pricing');
ok(Math.abs(tokenCost('gpt-6-luna',5000,1000,4000)-.00064)<1e-12,'GPT-6 Luna cached input at a tenth');
ok(tokenCost('gpt-6-luna',1e6,0)===.10&&tokenCost('gpt-6-luna',0,1e6)===.50,'GPT-6 Luna per-million rates');
// Pumpy's cap went from 1,500 to 6,000 in the same change. The reservation is
// input bound + cap, so on GPT-6 it must not exceed what 5.6 reserved at 1,500
// for any prompt the size of Pumpy's static half (measured > 12 KB) or larger.
for (const bytes of [12_000,20_000,60_000,200_000])
 ok(tokenCost('gpt-6-luna',bytes,6000)<=tokenCost('gpt-5.6-luna',bytes,1500),'GPT-6 at 6,000 reserves no more than 5.6 at 1,500 for '+bytes+' bytes');
ok(tokenCost('gemini-3.6-flash',1000,1000)>0,'Gemini is priced');
const img=openaiInputBound({messages:[{content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'x'.repeat(900000),detail:'high'}}]}]});
ok(img<6000&&img>4096,'base64 is not mistaken for text tokens');
let f=fixture(response,'daily_budget');
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,request);throw new Error('allowed');}catch(e){ok(e instanceof GuardError,'budget rejection typed');}});
ok(f.network===0,'denial makes zero paid requests');
f=fixture(response);
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[0].name==='ai_reserve'&&f.calls[1].name==='ai_record_attempt'&&f.calls[2].args.p_final===true,'reserve before generation then settle');
ok(f.calls[2].args.p_usd===tokenCost('gpt-5.6-luna',100,30),'settles reported usage');
{
 // The same path on GPT-6: reserved at its own price for input bound + cap, and
 // settled on what the provider reports.
 const g6=fixture(()=>Promise.resolve(Response.json({model:'gpt-6-luna',choices:[],usage:{prompt_tokens:100,completion_tokens:30}})));
 const body={...JSON.parse(request.body),model:'gpt-6-luna',max_completion_tokens:6000,reasoning_effort:'low'};
 await aiActor.run(actor(),()=>g6.fetcher(url,{...request,body:JSON.stringify(body)}));
 const want=Math.ceil(tokenCost('gpt-6-luna',openaiInputBound(body),6000)*1e6)/1e6;
 ok(g6.calls[0].name==='ai_reserve'&&g6.calls[0].args.p_model==='gpt-6-luna'&&g6.calls[0].args.p_usd===want,'GPT-6 reserves input bound + 6,000 at its own price');
 ok(g6.calls[1].args.p_meta.price_version.endsWith('gpt-6-luna:0.1/0.5/0.01'),'GPT-6 attempt records its unit prices');
 ok(g6.calls[2].args.p_usd===tokenCost('gpt-6-luna',100,30),'GPT-6 settles reported usage');
 // The guard's own ceiling: the bigger Pumpy cap and its one retry stay inside it.
 const over=fixture(response);
 await aiActor.run(actor(),async()=>{try{await over.fetcher(url,{...request,body:JSON.stringify({...body,max_completion_tokens:8001})});throw new Error('allowed');}catch(e){ok(e instanceof GuardError&&e.reason==='invalid_output_bound','a cap above 8,000 is refused before reserving');}});
 ok(over.network===0&&over.calls.length===0,'refused cap spends nothing');
 const top=fixture(response);
 await aiActor.run(actor(),()=>top.fetcher(url,{...request,body:JSON.stringify({...body,max_completion_tokens:8000})}));
 ok(top.network===1,'the 8,000 retry cap is admitted');
}
f=fixture(async()=>{throw new Error('timeout');});
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,request);}catch{}});
ok(f.calls[2].args.p_usd===null,'network uncertainty retains dollars');
f=fixture(()=>Promise.resolve(new Response('',{status:429,headers:{'retry-after':'90'}})));
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[2].args.p_cooldown===90&&f.calls[2].args.p_usd===0,'429 cooldown and rejected call reconciled');
f=fixture(()=>Promise.resolve(new Response('broken json')));
await aiActor.run(actor(),()=>f.fetcher(url,request));
ok(f.calls[2].args.p_usd===null,'malformed usage cannot be logged as free');
f=fixture(response);
await aiActor.run(actor(),async()=>{try{await f.fetcher(url,{...request,body:request.body.replace('gpt-5.6-luna','unknown-model')});}catch(e){ok(e instanceof GuardError,'unknown price refused');}});
ok(f.network===0,'unknown model never called');
const data='data: '+JSON.stringify({usage:{prompt_tokens:100,completion_tokens:30}})+'\n\ndata: [DONE]\n\n';
f=fixture(()=>Promise.resolve(new Response(data,{headers:{'content-type':'text/event-stream'}})));
await aiActor.run(actor(),async()=>{const r=await f.fetcher(url,{...request,body:JSON.stringify({...JSON.parse(request.body),stream:true})});ok(await r.text()===data,'SSE bytes preserved');});
ok(f.calls[2].args.p_usd===tokenCost('gpt-5.6-luna',100,30),'stream reports actual usage');
f=fixture(()=>Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {}\n\n'));}}),{headers:{'content-type':'text/event-stream'}})));
await aiActor.run(actor(),async()=>{const r=await f.fetcher(url,{...request,body:JSON.stringify({...JSON.parse(request.body),stream:true})});await r.body!.cancel();});
ok(f.calls[2].args.p_usd===null,'cancelled stream retains unknown charge');
let operations:string[]=[];
const gemini=createGuardedFetch(async(name,args)=>{operations.push(name);return name==='ai_reserve'?'ok':true;},async(input)=>{
 if(String(input).includes('countTokens')){operations.push('countTokens');return Response.json({totalTokens:1000});}
 operations.push('generate');return Response.json({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:20}});
});
await aiActor.run(actor(),()=>gemini('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{method:'POST',body:JSON.stringify({contents:[{parts:[{fileData:{fileUri:'https://generativelanguage.googleapis.com/v1beta/files/fixture',mimeType:'video/mp4'}},{text:'read'}]}],generationConfig:{maxOutputTokens:4000}})}));
ok(operations.join(',')==='countTokens,ai_reserve,ai_record_attempt,generate,ai_record_attempt','Gemini uses input token preflight before paid generation');
for (const parts of [[{text:'private chat'}],[{inline_data:{mime_type:'image/png',data:'fixture'}}],[{fileData:{fileUri:'fixture',mimeType:'image/png'}}]]) {
 const denied=fixture(response);
 await aiActor.run(actor(),async()=>{try{await denied.fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{method:'POST',body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:4000}})});}catch(e){ok(e instanceof GuardError && e.reason==='gemini_media_only','Google rejects text/image input');}});
 ok(denied.network===0&&denied.calls.length===0,'disallowed Google request never reserves or reaches network');
}
const unavailable=createGuardedFetch(async()=>{throw new Error('DB down');},async()=>{throw new Error('network must not run');});
await aiActor.run(actor(),async()=>{try{await unavailable(url,request);}catch(e){ok(String(e).includes('DB down')||e instanceof GuardError,'accounting outage refuses calls');}});
f=fixture(response);
await aiActor.run(actor(),async()=>{try{await f.fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',body:new FormData()});}catch(e){ok(e instanceof GuardError,'unbounded duration-priced audio refused');}});
ok(f.network===0&&f.calls.length===0,'audio refusal makes no paid call or speculative charge');
const scoped=fixture(response);
await aiActor.run({...actor(),userId:'account-a',workKey:'same-video'},()=>scoped.fetcher(url,request));
await aiActor.run({...actor(),userId:'account-b',workKey:'same-video'},()=>scoped.fetcher(url,request));
const scopes=scoped.calls.filter(c=>c.name==='ai_reserve').map(c=>c.args.p_work);
ok(scopes.length===2&&scopes[0]!==scopes[1],'same video has an account-scoped work allowance');
const liteAudio=fixture(response);
await aiActor.run(actor(),async()=>{
  try { await liteAudio.fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',{
    method:'POST',body:JSON.stringify({contents:[{parts:[{fileData:{fileUri:'fixture',mimeType:'video/mp4'}}]}],generationConfig:{maxOutputTokens:4000}})}); }
  catch(e) { ok(e instanceof GuardError&&e.reason==='unsupported_audio_pricing','unpriced Lite audio/video refuses before inference'); }
});
ok(liteAudio.network===0&&liteAudio.calls.length===0,'unsupported modality spends nothing');
// Attribution must remain local when parallel responses settle out of order.
const attributed=fixture(()=>Promise.resolve(Response.json({id:'completion-id',model:'gpt-5.6-luna',usage:{prompt_tokens:100,completion_tokens:30,prompt_tokens_details:{cached_tokens:20}}},{headers:{'x-request-id':'provider-request'}})));
const actionId=crypto.randomUUID(),jobId=crypto.randomUUID();
await aiActor.run({...actor(),purpose:'pack_eval',actionId,jobId,experimentId:'smoke-20260917'},()=>attributed.fetcher(url,request));
const initial=attributed.calls[1].args.p_meta,terminal=attributed.calls[2].args.p_meta;
ok(initial.environment==='experiment'&&initial.purpose==='pack_eval'&&initial.action_id===actionId&&initial.job_id===jobId,'explicit experiment and action/job attribution');
ok(terminal.provider_request_id==='provider-request'&&terminal.provider_response_id==='completion-id'&&terminal.http_status===200,'provider identity and status retained');
ok(terminal.cached_input_tokens===20&&terminal.input_tokens===100&&terminal.output_tokens===30&&terminal.usage_complete,'normalized usage retained');
ok(!JSON.stringify(attributed.calls).includes('read these sets'),'metadata contains no prompt content');
const unknownEnv=fixture(response);await aiActor.run(actor(),()=>unknownEnv.fetcher(url,request));
ok(unknownEnv.calls[1].args.p_meta.environment==='unclassified','missing classification never means production');
let sends=0;
const missingMetadata=createGuardedFetch(async(name)=>{if(name==='ai_reserve')return 'ok';throw new Error('metadata unavailable');},async()=>{sends++;return response();});
await aiActor.run(actor(),async()=>{try{await missingMetadata(url,request);}catch(e){ok(e instanceof GuardError,'metadata outage fails closed');}});
ok(sends===0,'no inference when initial attempt record fails');
const parallelCalls:any[]=[];
const parallel=createGuardedFetch(async(name,args)=>{parallelCalls.push({name,args});return name==='ai_reserve'?'ok':true;},async(_input,init)=>{
 const marker=JSON.parse(String(init?.body)).messages[0].content;
 if(marker==='slow')await new Promise(resolve=>setTimeout(resolve,10));
 return Response.json({usage:{prompt_tokens:marker==='slow'?101:202,completion_tokens:1}},{headers:{'x-request-id':marker}});
});
await Promise.all(['slow','fast'].map(purpose=>aiActor.run({...actor(),purpose},()=>parallel(url,{...request,body:JSON.stringify({...JSON.parse(request.body),messages:[{role:'user',content:purpose}]})}))));
for(const purpose of ['slow','fast']) {
 const start=parallelCalls.find(c=>c.name==='ai_record_attempt'&&!c.args.p_final&&c.args.p_meta.purpose===purpose);
 const end=parallelCalls.find(c=>c.name==='ai_record_attempt'&&c.args.p_final&&c.args.p_id===start.args.p_id);
 ok(end.args.p_meta.provider_request_id===purpose&&end.args.p_meta.input_tokens===(purpose==='slow'?101:202),'parallel usage correlated by its reservation '+purpose);
}
console.log(`${checks} AI transport checks passed; mocked providers, no paid calls.`);
