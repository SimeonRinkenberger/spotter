// A slide gets one economical image read and, only on failure, one fallback.
// Keep this independent of the worker so transport and failure cases are testable
// without credentials, paid requests, or production database writes.
export type VisionUsage = { inTok: number; outTok: number; cachedTok?: number };
type Provider = "openai" | "gemini";
export type VisionReaderOptions = {
  openaiKey: string; geminiKey: string;
  openaiModel: string; geminiModel: string;
  timeoutMs: number;
  allowed(provider: Provider): Promise<boolean>;
  record(provider: Provider, model: string, usage: VisionUsage, ok: boolean): Promise<void>;
  fetcher?: typeof fetch;
};

// An explicit empty slide is successful. Missing fields, refusal, truncated JSON,
// unreadable text and provider failures must never masquerade as an empty slide.
export function parseVisionOutput(text: string): Record<string, any> {
  const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.unreadable === true) {
    throw new Error("unreadable or invalid vision result");
  }
  if (raw.none === true) {
    if (raw.blocks?.length) throw new Error("contradictory empty vision result");
    return raw;
  }
  if (!Array.isArray(raw.blocks) || raw.blocks.length > 12 || !raw.blocks.length ||
      raw.blocks.some((b: any) => !Array.isArray(b?.exercises) || !b.exercises.length ||
        b.exercises.length > 15 || b.exercises.some((e: any) =>
          typeof e?.name !== "string" || e.name.trim().length < 2))) {
    throw new Error("invalid vision workout shape");
  }
  return raw;
}

export async function readVisionImage(
  data: string, mime: string, prompt: string, options: VisionReaderOptions,
): Promise<{ raw: Record<string, any>; by: string }> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error("unsupported image type");
  const fetcher = options.fetcher ?? fetch;
  const providers: Provider[] = [];
  if (options.openaiKey && await options.allowed("openai")) providers.push("openai");
  if (options.geminiKey && await options.allowed("gemini")) providers.push("gemini");
  // Includes response-body reading. Reserve time for the fallback instead of
  // allowing the first provider to consume the parent isolate's whole deadline.
  const budget = Math.max(100, Math.min(28_000, options.timeoutMs));
  const deadline = Date.now() + budget;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const model = provider === "openai" ? options.openaiModel : options.geminiModel;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const timeout = i < providers.length - 1 ? Math.ceil(left * 0.65) : left;
    const signal = AbortSignal.timeout(timeout);
    let usage: VisionUsage = { inTok: 0, outTok: 0 };
    let result: { raw: Record<string, any>; by: string } | undefined;
    try {
      const openai = provider === "openai";
      const response = await fetcher(openai ? "https://api.openai.com/v1/chat/completions" :
        "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST", signal,
        headers: openai
          ? { "content-type": "application/json", authorization: "Bearer " + options.openaiKey }
          : { "content-type": "application/json", "x-goog-api-key": options.geminiKey },
        body: JSON.stringify(openai ? {
          model, reasoning_effort: "none", max_completion_tokens: 4000,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: prompt }, { role: "user", content: [
            { type: "image_url", image_url: { url: "data:" + mime + ";base64," + data, detail: "high" } },
          ] }],
        } : {
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("HTTP " + response.status);
      }
      const body = await response.json();
      const u = openai ? body.usage : body.usageMetadata;
      usage = openai ? {
        inTok: Number(u?.prompt_tokens) || 0, outTok: Number(u?.completion_tokens) || 0,
        cachedTok: Number(u?.prompt_tokens_details?.cached_tokens) || 0,
      } : {
        inTok: Number(u?.promptTokenCount) || 0,
        outTok: (Number(u?.candidatesTokenCount) || 0) + (Number(u?.thoughtsTokenCount) || 0),
      };
      const candidate = openai ? body.choices?.[0] : body.candidates?.[0];
      if ((openai ? candidate?.finish_reason : candidate?.finishReason) !== (openai ? "stop" : "STOP")) {
        throw new Error("incomplete or refused output");
      }
      const text = openai ? candidate.message?.content :
        candidate.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
      result = { raw: parseVisionOutput(text || ""), by: "vision:" + provider + ":" + model };
    } catch (error) {
      // Never log the image, prompt, credentials, or provider response body.
      console.warn("vision provider", provider, model,
        error instanceof SyntaxError ? "invalid JSON" : String(error).slice(0, 160));
    }
    try { await options.record(provider, model, usage, !!result); }
    catch { console.warn("vision usage recording failed", provider, model); }
    if (result) return result;
  }
  throw new Error("vision providers unavailable or image unreadable");
}
