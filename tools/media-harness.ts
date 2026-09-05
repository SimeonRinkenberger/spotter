// Battery for the TikTok photo-post path (the swipe-right carousels).
//
// Run: deno run --allow-read tools/media-harness.ts   — exits non-zero on failure.
//
// Neither path can be exercised end to end from a laptop: one needs TikTok's CDN
// and the other needs Groq, Gemini and a private Supabase bucket. What CAN be
// checked locally is everything between those — the parsers, the URL matcher and
// the routing decision — so those are the parts written as pure functions, and
// this file is what proves them.
//
// The functions are lifted OUT OF index.ts rather than copied into this file. A
// copy would pass forever after the shipping code broke, which is the one failure
// mode a harness must not have; lifting the source means a rename here is a loud
// error rather than a quiet lie. index.ts calls Deno.serve at the bottom and
// exports nothing, so it cannot simply be imported — `lift` pulls the named
// top-level declarations out, and they are assembled into one module and imported
// as a data: URL, which Deno type-strips like any other TypeScript.
//
// The fixtures under tools/fixtures/ are real pages, fetched from this Mac's
// residential IP on 2026-09-05 and trimmed to three slides each with the signed
// CDN query strings removed (they expire in hours, and a fixture that rots is
// worse than no fixture). What they record, which is the whole reason photo posts
// used to fail:
//
//   tt-photo-shell.html   what a plain GET of /@user/photo/<id> returns to a
//                         server with a desktop UA: an empty __DEFAULT_SCOPE__.
//                         No blob, no og: tags, nothing to read.
//   tt-photo-watch.html   the SAME id at /@user/video/<id>: the full itemStruct,
//                         imagePost and all. This is why ttWatchUrl exists.
//   tt-photo-phone.html   the /photo/ URL fetched with an iPhone UA — the page a
//                         phone posts to /api/ingest. Same itemStruct, filed
//                         under webapp.reflow.video.detail instead.
//   tt-photo-embed.html   /embed/v2/<id>, which answers for a photo post and
//                         names the slides under imagePostInfo.displayImages.
//   tt-photo-oembed.json  what oEmbed says about a photo post: HTTP 400.
//   tt-video-watch.html   an ordinary video, so the photo work cannot quietly
//                         break the path 99% of saves take.

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));

// ---------- lifting declarations out of index.ts ----------

/**
 * Where the top-level declaration starting at `from` ends.
 *
 * A brace counter that did not know about strings would stop early on the regex
 * `/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>/` and on every template
 * literal in the source ladder, so this walks the characters properly: quotes,
 * template literals, both comment shapes, and regex literals (told from division
 * by the character before the slash, which is the standard heuristic and is
 * unambiguous here because nothing in the lifted set divides).
 *
 * A function ends at the brace that closes its body; everything else ends at the
 * semicolon at depth zero. The two rules are separate because a parameter list and
 * a type annotation both open and close before the declaration is finished, and
 * one rule for both would cut `function f(x: string)` off at its own signature.
 */
function declEnd(src: string, from: number, isFunction: boolean): number {
  let depth = 0;
  let inBody = false;
  let prev = "";
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
    if (c === "{" || c === "[" || c === "(") {
      if (isFunction && c === "{" && depth === 0) inBody = true;
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (isFunction && inBody && depth === 0) return i + 1;
    } else if (!isFunction && c === ";" && depth === 0) return i + 1;
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error("unterminated declaration at " + from);
}

const lifted = new Set<string>();

/** One named top-level declaration, verbatim, exported. */
function lift(name: string): string {
  if (lifted.has(name)) return "";
  lifted.add(name);
  const re = new RegExp("^(?:async )?(function|const|let|type|class) " + name + "\\b", "m");
  const m = SRC.match(re);
  if (!m || m.index === undefined) {
    throw new Error("index.ts no longer declares " + name + " — this harness is out of date");
  }
  return "export " + SRC.slice(m.index, declEnd(SRC, m.index, m[1] === "function"));
}

// The types the lifted code mentions but does not need to be honest about here.
const STUBS = "type Chapter = unknown; type Usage = unknown; type Card = Record<string, unknown>;\n" +
  "declare const runtimeCfg: Record<string, string>;\n";

const NAMES = [
  "Parsed", "Meta", "TtRaw", "TtSource",
  "DESKTOP_UA", "CRAWLER_UA", "TT_OG_NOT_A_HANDLE", "TT_SOURCES",
  "decodeEntities", "metaTag", "matchTikTok", "ttWatchUrl",
  "ttPickCover", "ttPickUrl", "ttSome", "ttPhotoRaw", "ttItemStruct",
  "ttFromOembed", "ttFromEmbedState", "ttFromUniversalData", "ttFromOg", "ttParseHtml",
];

const module = STUBS + NAMES.map(lift).join("\n\n") + "\n";
// eslint-disable-next-line -- a data: URL is a module specifier Deno type-strips
const M = await import("data:application/typescript," + encodeURIComponent(module));

// ---------- the scoreboard ----------

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want), "got " + JSON.stringify(got));
}

const fixture = (f: string) =>
  Deno.readTextFileSync(new URL("tools/fixtures/" + f, ROOT));

// ---------- 1. the URL matcher ----------
//
// This is most of the bug. Until /photo/ matched, resolveShare fell through to
// webParsed, which refuses tiktok.com hostnames, so ingest answered "No workout
// link found in what was shared" — the owner's error, verbatim.

const photoUrl = "https://www.tiktok.com/@isatnmlachi/photo/7618322223538998550";

eq("a /photo/ link parses as a tiktok photo", M.matchTikTok(photoUrl), {
  platform: "tiktok",
  shortcode: "tt-7618322223538998550",
  kind: "photo",
  clean: photoUrl,
});

eq("a /video/ link is still a video", M.matchTikTok("https://www.tiktok.com/@trainwjay/video/7663100570982501645"), {
  platform: "tiktok",
  shortcode: "tt-7663100570982501645",
  kind: "video",
  clean: "https://www.tiktok.com/@trainwjay/video/7663100570982501645",
});

eq("the /v/ short form is still a video",
  M.matchTikTok("https://m.tiktok.com/v/7663100570982501645.html")?.kind, "video");

// resolveShare follows a vm.tiktok.com share link and hands each Location header
// to this matcher, so what it lands on is what has to parse. Tracking params come
// with it and are cut here, as they always were.
eq("the redirect target of a vm.tiktok.com link parses, tracking and all",
  M.matchTikTok(photoUrl + "?is_from_webapp=1&sender_device=pc")?.clean, photoUrl);

check("a profile link still matches nothing",
  M.matchTikTok("https://www.tiktok.com/@isatnmlachi") === null);

// ---------- 2. which page a server may ask for ----------

eq("a photo post is scraped at its video address", M.ttWatchUrl(photoUrl),
  "https://www.tiktok.com/@isatnmlachi/video/7618322223538998550");
eq("a video address is left alone",
  M.ttWatchUrl("https://www.tiktok.com/@a/video/123"), "https://www.tiktok.com/@a/video/123");
check("oEmbed is the one rung a photo post skips",
  M.TT_SOURCES.filter((s: { videoOnly?: boolean }) => s.videoOnly).map((s: { name: string }) => s.name)
    .join(",") === "oembed");
check("the two page rungs ask for the video address",
  M.TT_SOURCES.filter((s: { name: string }) => s.name.startsWith("page-"))
    .every((s: { url: (i: string, c: string) => string }) => s.url("1", photoUrl).indexOf("/video/") > 0));

// ---------- 3. what the recorded pages actually parse to ----------

const shell = M.ttParseHtml(fixture("tt-photo-shell.html"));
eq("the shell a /photo/ GET returns parses to nothing at all",
  [shell.caption, shell.thumb, shell.author, shell.images ?? null], [null, null, null, null]);

check("oEmbed's answer for a photo post is not a card",
  M.ttFromOembed(fixture("tt-photo-oembed.json")) === null);

for (const [label, file] of [["watch page", "tt-photo-watch.html"], ["phone page", "tt-photo-phone.html"]]) {
  const got = M.ttParseHtml(fixture(file));
  check(label + ": the slides come back", (got.images ?? []).length === 3, JSON.stringify(got.images));
  check(label + ": every slide is an https CDN url",
    (got.images ?? []).every((u: string) => u.startsWith("https://")));
  check(label + ": the title over the first slide is in the caption",
    (got.caption ?? "").indexOf("El riesgo de quererte tanto") === 0, JSON.stringify(got.caption));
  check(label + ": the hashtag caption is in it too",
    (got.caption ?? "").indexOf("#tnmalachi") > 0);
  // The display name, not the handle — the same field a video card shows.
  eq(label + ": the creator", got.author, "\ud835\udcd8\ud835\udcfc\ud835\udcea(\ud835\udcef\ud835\udcea\ud835\udcf7\ud835\udcef\ud835\udcf2\ud835\udcec)");
  check(label + ": the thumbnail is the first slide", got.thumb === (got.images ?? [])[0]);
  check(label + ": a photo post claims no runtime", got.seconds === undefined);
}

const emb = M.ttParseHtml(fixture("tt-photo-embed.html"));
check("embed page: the slides come back", (emb.images ?? []).length === 3, JSON.stringify(emb.images));
check("embed page: the caption comes back", (emb.caption ?? "").indexOf("#tnmalachi") === 0);
check("embed page: the creator", (emb.author ?? "").length > 0, JSON.stringify(emb.author));

// The regression that matters most: 99% of saves are videos, and a video must not
// grow slides, because slides are what sends a save to the vision tier.
const vid = M.ttParseHtml(fixture("tt-video-watch.html"));
check("a video still parses", (vid.caption ?? "").indexOf("#gymtok") === 0, JSON.stringify(vid.caption));
eq("a video has a runtime", vid.seconds, 17);
check("a video has no slides", !vid.images || vid.images.length === 0);
check("a video keeps its cover as the thumbnail", !!vid.thumb);

// ---------- done ----------

console.log((failures ? "FAILED " : "ok ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);
