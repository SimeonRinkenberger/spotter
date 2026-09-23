import { AsyncLocalStorage } from 'node:async_hooks';

export type Actor = { userId: string | null; workKey: string; actionId?: string; blocked?: string; deadline?: number;
  /** What this unit of work is for. Only the image exception below reads it. */
  purpose?: string; jobId?: string; environment?: string; experimentId?: string };
export const aiActor = new AsyncLocalStorage<Actor>();
type Rpc = (name: string, args: Record<string, unknown>) => Promise<any>;
export class GuardError extends Error {
  constructor(public reason: string) { super('AI work paused: ' + reason); }
}
// Explicit models only. Unknown aliases must not silently inherit cheaper rates.
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://ai.google.dev/gemini-api/docs/pricing (2026 promotional period)
export function tokenPrice(model: string, now = new Date()): [number, number, number] | null {
  // The text default from 2026-09-23. Read from
  // https://developers.openai.com/api/docs/models/gpt-6-luna on 2026-09-23:
  // $0.10/M in, $0.50/M out, $0.01/M cached — half 5.6's input and well under
  // half its output, on the same Chat Completions surface and reasoning dial.
  if (model === 'gpt-6-luna') return [.10, .50, .01];
  // Kept after the move: ai_reservations and ai_cost_log rows name it, and a
  // rollback is an app_config update that must not land on `unknown_price`.
  if (model === 'gpt-5.6-luna') return [.20, 1.20, .02];
  if (model === 'gemini-3.6-flash') return now < new Date('2027-01-01T00:00:00Z') ? [.75,3.75,.075] : [1.50,7.50,.15];
  // Flash-Lite does video, at a third of Flash's input price and no promotional
  // cliff to fall off. Read from https://ai.google.dev/gemini-api/docs/pricing on
  // 2026-09-15: $0.25/M in, $1.50/M out, $0.025/M cached. It is here so the owner
  // can move `pack.model` to it by config; nothing routes to it by default.
  if (model === 'gemini-3.1-flash-lite') return [.25,1.50,.025];
  // The frontier reader, priced so the pack eval can A/B it against Luna on the
  // same contact sheets. Read from https://developers.openai.com/api/docs/models
  // on 2026-09-15: $2/M in, $12/M out, $0.20/M cached. Nothing routes to it by
  // default; it is reachable only through pack.sheets_model and the eval route.
  if (model === 'gpt-5.6-terra') return [2,12,.2];
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

type Usage = { input_tokens: number; output_tokens: number; cached_input_tokens: number;
  reasoning_tokens: number; input_modalities: Record<string, number> };
function normalizedUsage(body: any): Usage | null {
  const u = body?.usageMetadata ?? body?.usage;
  if (!u) return null;
  const input = u.prompt_tokens ?? u.promptTokenCount;
  const output = u.completion_tokens ?? ((u.candidatesTokenCount ?? 0)+(u.thoughtsTokenCount ?? 0));
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 0;
  const thoughts = u.completion_tokens_details?.reasoning_tokens ?? u.thoughtsTokenCount ?? 0;
  if (![input,output,cached,thoughts].every(n=>Number.isSafeInteger(n)&&n>=0) || cached>input) return null;
  const modalities: Record<string,number> = {};
  for (const part of Array.isArray(u.promptTokensDetails) ? u.promptTokensDetails : []) {
    const modality=String(part?.modality ?? '').toLowerCase();
    if (['text','image','audio','video'].includes(modality) && Number.isSafeInteger(part.tokenCount) && part.tokenCount>=0)
      modalities[modality]=(modalities[modality]??0)+part.tokenCount;
  }
  return {input_tokens:input,output_tokens:output,cached_input_tokens:cached,reasoning_tokens:thoughts,input_modalities:modalities};
}
function usageCost(u: Usage | null, prices: [number,number,number]): number | null {
  return u ? ((u.input_tokens-u.cached_input_tokens)*prices[0]+u.output_tokens*prices[1]+u.cached_input_tokens*prices[2])/1e6 : null;
}
function label(value: unknown, fallback='unclassified'): string {
  return typeof value==='string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value) ? value : fallback;
}
function uuidOrNull(value: unknown): string | null {
  return typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value : null;
}

export function createGuardedFetch(rpc: Rpc, nativeFetch: typeof fetch = (...args) => fetch(...args), options: { environment?: string } = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const actor = aiActor.getStore();
    if (!actor) throw new GuardError('missing_actor');
    const attribution={purpose:actor.purpose,actionId:actor.actionId,jobId:actor.jobId,
      environment:actor.environment ?? options.environment,experimentId:actor.experimentId};
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
      // Google is reserved for input modalities Luna cannot read directly. A
      // transient Luna failure must not send text, chat or images to Google.
      const parts = Array.isArray(body?.contents) ? body.contents.flatMap((c: any) => Array.isArray(c?.parts) ? c.parts : []) : [];
      const inline = parts.map((p: any) => p.inline_data ?? p.inlineData).filter(Boolean);
      if (inline.length) {
        // The one exception, and it is deliberate rather than a loosening.
        //
        // The rule above exists because Google is reserved for input modalities
        // Luna cannot read directly: a transient Luna failure must never end with
        // text, chat or a user's images being sent there instead. That is
        // fallback LEAKAGE, and it is what `inline_data` almost always means.
        //
        // The Video Context Pack's sheets reader is the opposite case. It is a
        // DESIGNED image read: the phone cuts contact sheets on the device, and
        // which model reads them is a measurement the owner is running — Luna
        // reported "hands on the mat" on frames where a person can see the hands
        // wrapped around a kettlebell, so the two readers have to be comparable on
        // identical input. So the exception is scoped to exactly that work and
        // bounded on every axis it can be bounded on: only the pack's own two
        // purposes, only images, at most three of them, each within the same
        // ceiling the upload route enforces on a sheet.
        const purpose = attribution.purpose ?? '';
        if (purpose !== 'pack' && purpose !== 'pack_eval') throw new GuardError('gemini_media_only');
        if (inline.length !== parts.length - 1 || inline.length > 3) throw new GuardError('gemini_media_only');
        for (const d of inline) {
          if (!/^image\//.test(d?.mime_type ?? d?.mimeType ?? '')) throw new GuardError('gemini_media_only');
          const b64 = String(d?.data ?? '');
          // Decoded length, not the base64 length: the ceiling is about the JPEG.
          if (Math.floor(b64.length * 3 / 4) > 600 * 1024) throw new GuardError('gemini_image_too_large');
        }
      } else if (!parts.some((p: any) => p.fileData?.fileUri && /^(audio|video)\//.test(p.fileData?.mimeType ?? ''))) {
        throw new GuardError('gemini_media_only');
      }

      if (!tokenPrice(model)) throw new GuardError('unknown_price');
      // Lite's audio tariff differs from its image/text tariff. Until modality
      // accounting is implemented, only the priced contact-sheet route is allowed.
      if (model === 'gemini-3.1-flash-lite' && !inline.length) throw new GuardError('unsupported_audio_pricing');
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
    // A per-work ceiling belongs to one account. Shared video identifiers must
    // not let another user's retries consume this account's work allowance.
    const workKey = actor.userId ? actor.userId + ':' + actor.workKey : actor.workKey;
    try { admitted=await rpc('ai_reserve',{p_id:id,p_user:actor.userId,p_work:workKey,p_provider:provider,p_model:model,p_usd:reserve}); }
    catch { actor.blocked="accounting_unavailable"; throw new GuardError(actor.blocked); }
    if (admitted!=='ok') { actor.blocked=String(admitted); throw new GuardError(String(admitted)); }
    // Snapshot attribution into this reservation's closure; concurrent calls must
    // never share a mutable "last request" identifier or settlement target.
    const prices=tokenPrice(model)!;
    const started=Date.now();
    const environment=['production','experiment','staff_test','staging'].includes(attribution.environment ?? '')
      ? attribution.environment : attribution.purpose==='pack_eval' ? 'experiment' : 'unclassified';
    const metadata: Record<string,unknown> = {
      attempt_id:id, purpose:label(attribution.purpose), action_id:uuidOrNull(attribution.actionId), job_id:uuidOrNull(attribution.jobId),
      environment, experiment_id:attribution.experimentId ? label(attribution.experimentId,'unclassified') : null,
      price_version:'2026-09-17:'+model+':'+prices.join('/'),
      unit_prices:{currency:'USD',unit:'million_tokens',input:prices[0],output:prices[1],cached_input:prices[2]},
      attempt_status:'started',started_at:new Date(started).toISOString(),
    };
    try {
      const recorded=await rpc('ai_record_attempt',{p_id:id,p_meta:metadata});
      if (recorded!==true) throw new Error('attempt not recorded');
    } catch {
      // Do not start an untraceable inference or silently refund a reservation
      // when accounting is unhealthy. It stays held for later reconciliation.
      actor.blocked='accounting_unavailable'; throw new GuardError(actor.blocked);
    }
    let responseMetadata: Record<string,unknown> = {};
    const settle=async(cost: number|null,cooldown=0,usage:Usage|null=null,failure?:string)=>{
      const final={...responseMetadata,...(usage??{}),usage_complete:cost!==null && !!usage,
        attempt_status:failure ? (cost===null?'unknown':'failed') : cost===null?'unknown':'succeeded',
        failure_kind:failure ?? (cost===null?'usage_missing':null),
        finished_at:new Date().toISOString(),duration_ms:Math.max(0,Date.now()-started)};
      // Metadata and the existing charge settlement commit in one transaction.
      // On failure the reservation remains held; missing telemetry is never free.
      try { await rpc('ai_record_attempt',{p_id:id,p_meta:final,p_final:true,p_usd:cost,p_cooldown:cooldown}); }
      catch { console.error('AI settlement unavailable',id); }
    };
    let response: Response;
    try { response=await nativeFetch(input,{...init,signal}); }
    catch(e) { await settle(null,30,null,'transport_error'); throw e; }
    responseMetadata={http_status:response.status,
      provider_request_id:(response.headers.get('x-request-id') ?? response.headers.get('x-goog-request-id') ?? response.headers.get('request-id'))?.slice(0,200) ?? null};
    if (!response.ok) {
      const retry=Number(response.headers.get('retry-after'));
      const cooldown=response.status===429||response.status>=500 ? Math.min(300,Math.max(30,Number.isFinite(retry)?retry:30)) : 0;
      await settle([400,401,403,404,413,422,429].includes(response.status)?0:null,cooldown,null,'http_error');
      return response;
    }
    if (body?.stream || response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader=response.body?.getReader();
      if (!reader) { await settle(null); return response; }
      let pending='', observed: Usage|null=null, finished=false;
      const decoder=new TextDecoder();
      const finish=async()=>{if(!finished){finished=true;await settle(usageCost(observed,prices),0,observed);}};
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const {done,value}=await reader.read();
            if(done){await finish();controller.close();return;}
            pending+=decoder.decode(value,{stream:true});
            const lines=pending.split('\n'); pending=lines.pop() ?? '';
            if(pending.length>1_000_000) throw new GuardError('oversized_stream');
            for(const line of lines) if(line.startsWith('data:')) {
              try { const parsed=JSON.parse(line.slice(5).trim()); const u=normalizedUsage(parsed); if(u!==null) observed=u;
                if (parsed.model) responseMetadata.resolved_model=label(parsed.model);
                if (parsed.id || parsed.responseId) responseMetadata.provider_response_id=String(parsed.id ?? parsed.responseId).slice(0,200); } catch { /* non-JSON terminator */ }
            }
            controller.enqueue(value);
          } catch(e){ await settle(null,0,observed,'stream_error');finished=true;controller.error(e);await reader.cancel().catch(()=>{}); }
        },
        async cancel(reason){finished=true;await reader.cancel(reason).catch(()=>{});await settle(null,0,observed,'stream_cancelled');}
      }),{status:response.status,headers:response.headers});
    }
    try {
      const raw=await response.text();
      if(raw.length>4_000_000) throw new GuardError('oversized_response');
      try {
        const parsed=JSON.parse(raw), usage=normalizedUsage(parsed);
        responseMetadata.resolved_model=label(parsed.model ?? parsed.modelVersion,model);
        responseMetadata.provider_response_id=parsed.id || parsed.responseId ? String(parsed.id ?? parsed.responseId).slice(0,200) : null;
        await settle(usageCost(usage,prices),0,usage);
      } catch { await settle(null,0,null,'response_parse'); }
      return new Response(raw,{status:response.status,headers:response.headers});
    } catch(e){await settle(null,0,null,'response_read');throw e;}
  };
}
