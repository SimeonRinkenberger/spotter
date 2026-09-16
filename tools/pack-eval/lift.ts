// Spotter — pulling applyPack out of index.ts without running it.
//
// `index.ts` calls `Deno.serve` at the bottom and exports nothing, so the one
// function this eval actually needs to exercise — `applyPack`, which is where the
// pack meets the card — cannot be imported. The harnesses solve that by LIFTING
// the declaration out of the source text and compiling it on its own, and this is
// that same walker.
//
// It is a copy of the one in tools/pack-harness.ts (itself a copy of
// tools/media-harness.ts) rather than a shared import, for two reasons. The
// harness runs its whole battery at module scope, so importing it would run it;
// and wave D is only allowed to write under tools/pack-eval and tools/fixtures, so
// the shared version cannot be created here. If a third copy ever appears,
// somebody should factor all three into tools/lift.ts and delete this note.
//
// The point of lifting rather than re-implementing: a rename in index.ts becomes a
// loud error here instead of a quiet lie. An eval that scored a reimplementation
// of the pipeline would pass forever while the pipeline drifted.

const ROOT = new URL("../../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));

/**
 * Where a declaration ends, counted character by character.
 *
 * Brace counting is not enough: index.ts is full of regexes and template literals,
 * and a counter that did not know about them would cut a declaration off in the
 * middle of one. Generics are tracked separately because a `{` inside an unclosed
 * `<...>` is part of a type — `): Promise<{ obs: Observation }>` — and reading it
 * as the body would end the declaration at its own signature.
 */
function declEnd(src: string, from: number, isFunction: boolean): number {
  let depth = 0;
  let inBody = false;
  let prev = "";
  let angle = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      prev = q;
      continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%^~<>]/.test(prev)) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      prev = "/";
      continue;
    }
    if (!inBody && isFunction && c === "<") angle++;
    else if (!inBody && isFunction && c === ">" && prev !== "=") angle = Math.max(0, angle - 1);
    if (c === "{" || c === "[" || c === "(") {
      if (isFunction && c === "{" && depth === 0 && prev !== ":" && angle === 0) inBody = true;
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (isFunction && inBody && depth === 0) return i + 1;
    } else if (!isFunction && c === ";" && depth === 0) return i + 1;
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error("unterminated declaration at " + from);
}

function lift(name: string): string {
  const re = new RegExp("^(?:async )?(function|const|let|type|class) " + name + "\\b", "m");
  const m = SRC.match(re);
  if (!m || m.index === undefined) {
    throw new Error("index.ts no longer declares " + name + " — tools/pack-eval is out of date");
  }
  return "export " + SRC.slice(m.index, declEnd(SRC, m.index, m[1] === "function"));
}

// The collaborators applyPack reaches for. Everything with judgement in it — how a
// card exercise is matched to a pack exercise, which fact becomes evidence, what
// counts as an alignment — is the shipping code; only the types are loosened, so
// that pulling in `Exercise` does not pull in half the file.
const STUBS = "import { normText } from '" +
  new URL("supabase/functions/spotter/evidence.ts", ROOT).href + "';\n" +
  "import { bestSeenFact, packInTimeOrder, sharesHeadNoun } from '" +
  new URL("supabase/functions/spotter/pack.ts", ROOT).href + "';\n" +
  "type Pack = Record<string, any>;\n" +
  "type Card = { blocks: { exercises: any[] }[] };\n" +
  "type Evidence = Record<string, unknown>;\n" +
  "type PackExercise = { i: number; variant: Record<string, unknown>; [k: string]: any };\n" +
  "type Exercise = Record<string, any>;\n";

const NAMES = ["matchPackExercise", "packEvidence", "applyPack"];

const module = STUBS + NAMES.map(lift).join("\n\n") + "\n";
const M = await import("data:application/typescript," + encodeURIComponent(module));

/** The shipping applyPack, with nothing between it and the card. */
export const applyPack = M.applyPack as (card: unknown, pack: unknown) => void;
