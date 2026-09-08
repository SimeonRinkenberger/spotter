import { AsyncLocalStorage } from 'node:async_hooks';

export type Actor = { userId: string | null; workKey: string; actionId?: string; blocked?: string; deadline?: number };
export const aiActor = new AsyncLocalStorage<Actor>();
type Rpc = (name: string, args: Record<string, unknown>) => Promise<any>;
export class GuardError extends Error {
  constructor(public reason: string) { super('AI work paused: ' + reason); }
}
// Explicit models only. Unknown aliases must not silently inherit cheaper rates.
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://ai.google.dev/gemini-api/docs/pricing (2026 promotional period)
export function tokenPrice(model: string, now = new Date()): [number, number, number] | null {
  if (model === 'gpt-5.6-luna') return [.20, 1.20, .02];
  if (model === 'gemini-3.6-flash') return now < new Date('2027-01-01T00:00:00Z') ? [.75,3.75,.075] : [1.50,7.50,.15];
  return null;
}
export function tokenCost(model: string, input: number, output: number, cached = 0): number {
  const p = tokenPrice(model);
  if (!p || ![input,output,cached].every(n=>Number.isFinite(n)&&n>=0)) throw new GuardError('unknown_price');
  const c = Math.min(input,cached);
  return ((input-c)*p[0]+output*p[1]+c*p[2])/1e6;
}

// Count text conservatively as UTF-8 bytes, with room for message framing. Image
// requests are limited to high-detail Luna inputs; each is bounded separately.
export function openaiInputBound(body: any): number {
  let images = 0;
  const serialized = JSON.stringify(body.messages, (key,value) => {
    if (key === 'image_url') {
      if (value?.detail !== 'high' || !/^data:image\//.test(value?.url ?? '')) throw new GuardError('unsupported_image');
      images++;
      return '[image]';
    }
    return value;
  });
  return new TextEncoder().encode(serialized).length + 1024 + images * 4096;
}

function usageCost(model: string, body: any): number | null {
  if (model === 'whisper-large-v3-turbo') {
    const duration = Number(body?.duration);
    return Number.isFinite(duration)&&duration>=0 ? Math.max(10,duration)/3600*.04 : null;
  }
  const u = body?.usageMetadata ?? body?.usage ?? body?.x_groq?.usage;
  if (!u) return null;
  const input = u.prompt_tokens ?? u.promptTokenCount;
  const output = u.completion_tokens ?? ((u.candidatesTokenCount ?? 0)+(u.thoughtsTokenCount ?? 0));
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return tokenCost(model,input,output,u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 0);
}

export function createGuardedFetch(rpc: Rpc, nativeFetch: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const actor = aiActor.getStore();
    if (!actor) throw new GuardError('missing_actor');
    if (actor.blocked) throw new GuardError(actor.blocked);
    if (actor.deadline && actor.deadline <= Date.now()) { actor.blocked='deadline'; throw new GuardError('deadline'); }
    let model: string, provider: string, reserve: number;
    const headers = new Headers(init?.headers);
    const signal = AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(135_000, (actor.deadline ?? Date.now()+135_000)-Date.now()))), ...(init?.signal ? [init.signal] : [])]);
    let body: any = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions') {
      provider='openai'; model=body?.model;
      const output = Number(body?.max_completion_tokens);
      if (!(output>0&&output<=8000)) throw new GuardError('invalid_output_bound');
      const inputBound = openaiInputBound(body);
      if (inputBound > 200_000) throw new GuardError("input_too_large");
      reserve=tokenCost(model,inputBound,output);
    } else if (url.hostname === 'generativelanguage.googleapis.com' && /:(?:generateContent|streamGenerateContent)$/.test(url.pathname)) {
      provider='gemini'; model=decodeURIComponent(url.pathname.split('/models/')[1].split(':')[0]);
      if (!tokenPrice(model)) throw new GuardError('unknown_price');
      const output=Number(body?.generationConfig?.maxOutputTokens);
      if (!(output>0&&output<=8000)) throw new GuardError('invalid_output_bound');
      // countTokens is a non-generating preflight and supports the same uploaded
      // media. It avoids guessing duration/tokenization from compressed bytes.
      const countUrl=new URL(url); countUrl.pathname=countUrl.pathname.replace(/:[^:]+$/,':countTokens'); countUrl.search='';
      const count=await nativeFetch(countUrl, {method:'POST',headers,signal,
        body:JSON.stringify({generateContentRequest:{...body,model:'models/'+model}})});
      if (!count.ok) { await count.body?.cancel(); throw new GuardError('media_token_count_unavailable'); }
      const tokens=Number((await count.json()).totalTokens);
      if (!Number.isFinite(tokens)||tokens<0||tokens>2_000_000) throw new GuardError('invalid_input_bound');
      reserve=tokenCost(model,tokens+1024,output); // include framing beyond the preflight count
    } else throw new GuardError('unpriced_provider');
    reserve=Math.max(.000001,Math.ceil(reserve*1e6)/1e6);
    const id=crypto.randomUUID();
    let admitted: unknown;
    try { admitted=await rpc('ai_reserve',{p_id:id,p_user:actor.userId,p_work:actor.workKey,p_provider:provider,p_model:model,p_usd:reserve}); }
    catch { actor.blocked="accounting_unavailable"; throw new GuardError(actor.blocked); }
    if (admitted!=='ok') { actor.blocked=String(admitted); throw new GuardError(String(admitted)); }
    const settle=async(cost: number|null,cooldown=0)=>{
      // On a lost settlement, the reservation stays charged. Never refund a
      // timed-out request merely because the client stopped waiting for it.
      try { await rpc('ai_settle',{p_id:id,p_usd:cost,p_cooldown:cooldown}); }
      catch { console.error('AI settlement unavailable',id); }
    };
    let response: Response;
    try { response=await nativeFetch(input,{...init,signal}); }
    catch(e) { await settle(null,30); throw e; }
    if (!response.ok) {
      const retry=Number(response.headers.get('retry-after'));
      const cooldown=response.status===429||response.status>=500 ? Math.min(300,Math.max(30,Number.isFinite(retry)?retry:30)) : 0;
      await settle([400,401,403,404,413,422,429].includes(response.status)?0:null,cooldown);
      return response;
    }
    if (body?.stream || response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader=response.body?.getReader();
      if (!reader) { await settle(null); return response; }
      let pending='', observed: number|null=null, finished=false;
      const decoder=new TextDecoder();
      const finish=async()=>{if(!finished){finished=true;await settle(observed);}};
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const {done,value}=await reader.read();
            if(done){await finish();controller.close();return;}
            pending+=decoder.decode(value,{stream:true});
            const lines=pending.split('\n'); pending=lines.pop() ?? '';
            if(pending.length>1_000_000) throw new GuardError('oversized_stream');
            for(const line of lines) if(line.startsWith('data:')) {
              try { const c=usageCost(model,JSON.parse(line.slice(5).trim())); if(c!==null) observed=c; } catch { /* non-JSON terminator */ }
            }
            controller.enqueue(value);
          } catch(e){ await settle(null);finished=true;controller.error(e);await reader.cancel().catch(()=>{}); }
        },
        async cancel(reason){finished=true;await reader.cancel(reason).catch(()=>{});await settle(null);}
      }),{status:response.status,headers:response.headers});
    }
    try {
      const raw=await response.text();
      if(raw.length>4_000_000) throw new GuardError('oversized_response');
      try { await settle(usageCost(model,JSON.parse(raw))); } catch { await settle(null); }
      return new Response(raw,{status:response.status,headers:response.headers});
    } catch(e){await settle(null);throw e;}
  };
}
