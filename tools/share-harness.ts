// The save flow's server half, exercised offline.
//
// Run: deno run --allow-read tools/share-harness.ts   — exits non-zero on failure.
//
// Every function under test is LIFTED out of supabase/functions/spotter/index.ts
// (which calls Deno.serve and exports nothing), the way tools/pack-harness.ts and
// tools/ingest-coverage-harness.ts lift theirs, so a rename in index.ts is a loud
// error here rather than a quiet lie. No network, no database, no model.
//
// The Instagram fixtures are the captioned embed as Instagram served it to the
// link-preview crawler on 24 Sept 2026, trimmed to the parts the parser reads with
// the escaping kept byte for byte (tools/fixtures/ig-*-embed.html).

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
const fixture = (name: string) => Deno.readTextFile(new URL("tools/fixtures/" + name, ROOT));

/** A top-level declaration, from its first line to the closing brace at column 0. */
function fn(head: string): string {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error("index.ts no longer declares: " + head);
  const j = SRC.indexOf("\n}\n", i);
  return SRC.slice(i, j + 2);
}
/** A declaration this cycle added, or a stand-in when running over an older index.ts (fail-before runs). */
function fnOr(head: string, fallback: string): string {
  return SRC.includes(head) ? fn(head) : fallback;
}
/** Everything between two markers, the first included. */
function span(from: string, to: string): string {
  const i = SRC.indexOf(from);
  const j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("index.ts section moved: " + from + " … " + to);
  return SRC.slice(i, j);
}

const lifted = [
  "type Meta = any; type Card = any; type Exercise = any;",
  fn("function decodeEntities("),
  fn("function metaTag("),
  fnOr("function igGenericImage(", ""),
  fn("function igFromOg("),
  fn("function igFromEmbed("),
  fn("function igEmbedContext("),
  fn("function igBetterCaption("),
  fn("function igParseHtml("),
  span("const DOSE_WORDS = new Set([", "function cleanLine("),
  "export { igFromOg, igFromEmbed, igParseHtml, isDoseWordName, cardSound };",
].join("\n");
const m = await import("data:application/typescript," + encodeURIComponent(lifted));

let checks = 0;
const failures: string[] = [];
function check(ok: unknown, what: string): void {
  checks++;
  if (!ok) failures.push(what);
}

// ---- S3: Instagram carousels are read slide by slide ----
{
  const html = await fixture("ig-sidecar-embed.html");
  const em = m.igFromEmbed(html);
  // Instagram's own count: six children, each a video whose cover is the slide.
  // The page names seven display_url values because the carousel's own repeats
  // its first child's; the parser must not read that picture twice.
  check(em.images.length === 6, "S3 carousel: 6 slides, got " + em.images.length);
  check(em.slides.every((s: any) => s.video), "S3 carousel: every child is a video cover");
  check(em.images.every((u: string) => u.startsWith("https://scontent") && !u.includes("\\")),
    "S3 carousel: slide URLs are unescaped https URLs");
  check(em.images.every((u: string) => !/\\u0025|u00253D/.test(u) && /%3D/.test(u)),
    "S3 carousel: \\u escapes decoded (ig_cache_key keeps its %3D)");
  check(new Set(em.images).size === em.images.length, "S3 carousel: no slide twice");
  check(em.author === "frank_medrano", "S3 carousel: author from the embed context");
  check(typeof em.caption === "string" && em.caption.startsWith("ABS Weak LOWER Back Workout") &&
    em.caption.includes("\n3 Sets x 15 Reps each Exercise"),
    "S3 carousel: caption with its line structure, no handle on line one");
  check(!em.absent, "S3 carousel: a real post is not absent");
  // The phone's path runs the same parser over the page it fetched.
  const phone = m.igParseHtml(html);
  check(phone.images.length === 6, "S3 phone path: 6 slides");

  // The fallback: the same page with the context script's shape broken still
  // yields the slides through the flattened regex.
  const mangled = html.replace('"contextJSON":"', '"contextJSONx":"');
  const fb = m.igFromEmbed(mangled);
  check(fb.images.length === 6, "S3 fallback: flattened regex finds the 6 slides, got " + fb.images.length);

  const reel = m.igFromEmbed(await fixture("ig-reel-embed.html"));
  check(reel.images.length === 1 && reel.slides[0].video, "S3 reel: one cover, marked video");
  check(!reel.absent && !!reel.caption, "S3 reel: caption read, not absent");

  const broken = m.igFromEmbed(await fixture("ig-broken-embed.html"));
  check(broken.absent && !broken.images.length && !broken.caption, "S8 IG: broken-media embed reads as absent");
  // A login shell is NOT absent: it says nothing about the post.
  check(!m.igFromEmbed("<html><body>Log in</body></html>").absent, "S8 IG: a shell is not absent");
}

// ---- S3: dose words are not movements ----
{
  for (const junk of ["each Exercise", "Each exercise", "per side", "All Sets", "Reps", "each side", "3 rounds"]) {
    check(m.isDoseWordName(junk), "dose word refused: " + junk);
  }
  for (const real of ["Leg Raises", "Arm Circles", "Side Plank", "Squat", "Rest", "Legs", "Russian Twists",
    "Single Arm Row", "Each Side Lunge Twist", "Dead Bug", "Plank", "Burpees x 10"]) {
    check(!m.isDoseWordName(real), "real movement kept: " + real);
  }
  const junkCard = { blocks: [{ exercises: [{ name: "each Exercise", sets: 3, reps: "15" }] }] };
  check(!m.cardSound(junkCard), "S3 cache: the DTasqBeFMdq row fails the validator");
  check(m.cardSound({ blocks: [{ exercises: [{ name: "Goblet Squat" }] }] }), "S3 cache: a real card passes");
  check(m.cardSound({ blocks: [] }) && m.cardSound(null), "S3 cache: an empty card is not junk");

  // Every movement name in every committed fixture survives the rule, so the
  // pack-eval cards and the golden card come out byte-identical.
  const names: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.exercises)) {
      for (const e of o.exercises) if (typeof (e as any)?.name === "string") names.push((e as any).name);
    }
    Object.values(o).forEach(walk);
  };
  const dirs = [new URL("tools/fixtures/", ROOT), new URL("tools/fixtures/eval/", ROOT)];
  for (const dir of dirs) {
    for await (const f of Deno.readDir(dir)) {
      if (!f.isFile || !f.name.endsWith(".json")) continue;
      walk(JSON.parse(await Deno.readTextFile(new URL(f.name, dir))));
    }
  }
  const hit = names.filter((n) => m.isDoseWordName(n));
  check(names.length > 20 && !hit.length,
    "fixtures: no movement named in dose words (" + names.length + " names; hit: " + hit.join(", ") + ")");
}

// ---- S11–S13: every link shape the audit collected, through the real normalizer ----
//
// resolveShare and the three matchers, lifted with the URL parsing section. The
// outbound guard is net.ts's own static half (the DNS half needs the network) and
// the redirect hops are answered by a table here: expired TikTok short links 302
// to the home page (measured 24 Sept), and an Instagram share page names its post
// in og:url. Everything else is the shipping code.
{
  const netUrl = new URL("supabase/functions/spotter/net.ts", ROOT).href;
  const urlMod = [
    "import { checkUrl } from '" + netUrl + "';",
    "async function assertPublicUrl(u: string | URL) { return checkUrl(u); }",
    "export const NET: any = { hops: [] as string[] };",
    "async function fetch(u: string, _init: any) {",
    "  NET.hops.push(String(u));",
    "  if (/^https:\\/\\/(vm|vt)\\.tiktok\\.com\\/|tiktok\\.com\\/t\\//.test(u)) return new Response(null, { status: 302, headers: { location: 'https://www.tiktok.com/?_r=1' } });",
    "  if (/instagram\\.com\\/share\\//.test(u)) return new Response('<meta property=\"og:url\" content=\"https://www.instagram.com/reel/DBGi0r0pHZ4/\" />', { status: 200 });",
    "  return new Response('', { status: 200 });",
    "}",
    "const DESKTOP_UA = 'desktop'; const CRAWLER_UA = 'crawler';",
    "function matchUrl(u: string) { return matchInstagram(u) ?? matchTikTok(u) ?? matchYouTube(u); }",
    fn("function decodeEntities("),
    fn("function metaTag("),
    span("// ---------- URL parsing ----------", "// ---------- AI chain ----------"),
    "export { resolveShare, noPostAnswer, BLOCKED, matchTikTok, matchInstagram };",
  ].join("\n");
  const u = await import("data:application/typescript," + encodeURIComponent(urlMod));
  const cases = JSON.parse(await fixture("share-url-cases.json"));
  let pass = 0;
  for (const c of cases) {
    const got = await u.resolveShare(c.input);
    const r = got === u.BLOCKED ? { platform: "BLOCKED" } : (got ?? { platform: null });
    if (c.expect) {
      const ok = Object.entries(c.expect).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
      check(ok, "link " + c.id + ": want " + JSON.stringify(c.expect) + ", got " + JSON.stringify(r));
      if (ok) pass++;
    }
    if (c.answer) {
      const a = u.noPostAnswer(c.input);
      check(!got && a.code === c.answer, "link " + c.id + ": answer code " + c.answer + ", got " + a.code);
    }
  }
  check(pass === cases.filter((c: any) => c.expect).length, "all expected link cases pass (" + pass + ")");
  // The clean link of a bare-id shape must be one the media isolate re-matches to
  // the same shortcode, or the video would be refused at /api/worker/media.
  for (const shape of ["https://www.tiktok.com/embed/v2/7679960172495785246", "https://www.tiktok.com/player/v1/7679960172495785246",
    "https://www.tiktokv.com/share/video/7679960172495785246/"]) {
    const p = u.matchTikTok(shape);
    check(p && u.matchTikTok(p.clean)?.shortcode === p.shortcode, "bare TikTok shape re-matches its clean link: " + shape);
  }
  check(u.noPostAnswer("Leg day https://example.com").message === "No workout link found in what was shared.",
    "an ordinary non-post keeps the old sentence");
  const unresolved = u.noPostAnswer("https://www.instagram.com/share/reel/BAGabc123xy/");
  check(unresolved.code === "link_unresolved" && /Copy link/.test(unresolved.message),
    "an Instagram share link that names no post says what works instead, not that it was deleted");
  const expired = u.noPostAnswer("https://vt.tiktok.com/ZSe4FqkKd");
  check(expired.message === "That link no longer opens a post — it may have been deleted. Open the post and share it again.",
    "S13 sentence for an expired short link");
}

// ---- S8: the platform answered, and there is no post ----
{
  const tt = [
    "type TtRaw = any; type Meta = any; type Parsed = any;",
    fn("function decodeEntities("), fn("function metaTag("),
    // The handle rule, the generic-poster rule and ttFromOg sit together in the source.
    span("const TT_OG_NOT_A_HANDLE =", "\n/**\n * Every HTML-reading TikTok rung"),
    fn("function ttSome("),
    "export { ttFromOg, ttGenericImage };",
  ].join("\n");
  const t = await import("data:application/typescript," + encodeURIComponent(tt));
  const missing = await fixture("tt-missing-crawler.html");
  check(t.ttFromOg(missing) === null, "S8 TikTok: the generic poster is not a thumbnail, and nothing else is read");
  check(t.ttGenericImage("https://lf16-tiktok-common.ibytedtos.com/obj/tiktok-web-common-sg/mtact/static/images/tiktok-logo/poster-square.png"),
    "S8 TikTok: the logo URL is recognised");
  check(!t.ttGenericImage("https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/o07ltGqB1As7rv5iii2lmAI3CiIUvSrAsIIy2e~tplv-photomode-video-share-card:1200:630:20.jpeg"),
    "S8 TikTok: a real cover is kept");

  // ttMeta's decision, over the statuses TikTok gave a nonexistent id.
  const meta = [
    "type TtRaw = any; type Meta = any; type Parsed = any; type TtSource = any;",
    "export const S: any = { answers: {} };",
    "const TT_SOURCES = [{ name: 'oembed', videoOnly: true }, { name: 'embed-v2' }, { name: 'page-crawler' }, { name: 'page-desktop' }];",
    "async function ttFetchSource(s: any) { return S.answers[s.name] ?? { status: 0, bytes: 0, raw: null }; }",
    "function keepFetchableUrl(u: string) { return u; }",
    fn("async function ttMeta("),
    "export { ttMeta };",
  ].join("\n");
  const tm = await import("data:application/typescript," + encodeURIComponent(meta));
  const nil = (status: number) => ({ status, bytes: 10, raw: null });
  const p = { shortcode: "tt-7679960172495785999", kind: "video", clean: "https://www.tiktok.com/@x/video/7679960172495785999" };
  tm.S.answers = { oembed: nil(400), "embed-v2": nil(400), "page-crawler": nil(200), "page-desktop": nil(200) };
  check((await tm.ttMeta(p)).absent === true, "S8 TikTok: oEmbed 400 + embed 400 + a bare crawler page is absent");
  tm.S.answers = { oembed: nil(403), "embed-v2": nil(429), "page-crawler": nil(200), "page-desktop": nil(0) };
  check(!(await tm.ttMeta(p)).absent, "S8 TikTok: a wall (403/429) is not absent — it is worth a retry");
  tm.S.answers = { oembed: nil(400), "embed-v2": nil(400), "page-crawler": nil(0), "page-desktop": nil(0) };
  check(!(await tm.ttMeta(p)).absent, "S8 TikTok: no answer from the page is not absent");
  tm.S.answers = { oembed: nil(400), "embed-v2": { status: 200, bytes: 9, raw: { caption: null, thumb: "https://x/cover.jpg", author: "aj" } } };
  check(!(await tm.ttMeta(p)).absent, "S8 TikTok: anything read at all is not absent");

  // igMeta, over a page with no og: tags and the broken-media embed.
  const ig = [
    "type Meta = any; type Parsed = any;",
    "export const S: any = {};",
    "async function safeFetch(u: string) { return new Response(/embed\\/captioned/.test(u) ? S.embed : S.page, { status: 200 }); }",
    "const CRAWLER_UA = 'c'; const IPHONE_UA = 'i';",
    fn("function decodeEntities("), fn("function metaTag("),
    fnOr("function igGenericImage(", ""),
    fn("function igFromOg("), fn("function igFromEmbed("), fn("function igEmbedContext("), fn("function igBetterCaption("),
    fn("async function igMeta("),
    "export { igMeta };",
  ].join("\n");
  const im = await import("data:application/typescript," + encodeURIComponent(ig));
  const q = { shortcode: "DZZZZZZZZZq", clean: "https://www.instagram.com/p/DZZZZZZZZZq/" };
  im.S.page = "<html><title>Instagram</title></html>";
  im.S.embed = await fixture("ig-broken-embed.html");
  check((await im.igMeta(q)).absent === true, "S8 IG: no og: tags + the broken-media embed is absent");
  im.S.embed = "<html>Log in</html>";
  check(!(await im.igMeta(q)).absent, "S8 IG: a login shell is not absent");
  im.S.embed = await fixture("ig-sidecar-embed.html");
  const carousel = await im.igMeta({ shortcode: "DTasqBeFMdq", clean: "https://www.instagram.com/p/DTasqBeFMdq/" });
  check(carousel.images.length === 6 && /embed-captioned/.test(carousel.source),
    "S3 igMeta: the carousel's six slides reach the job, source names embed-captioned");

  // The worker turns `absent` into a final failure with the contract sentence.
  const unavailable = SRC.match(/const UNAVAILABLE_SENTENCE = "([^"]+)"/)?.[1];
  check(unavailable === "This post is private, deleted or unavailable to Spotter.", "S8: the contract sentence, verbatim");
  check(/if \(meta\.absent\) \{[\s\S]{0,200}new SoftFailure\(UNAVAILABLE_SENTENCE, [^)]*\{ final: true \}\)/.test(SRC),
    "S8: runJob fails an absent post at attempt one, final");
}

// ---- contract 1 + 2: saved first, frames after ----
{
  const mod = [
    "type Meta = any; type Cors = any; type Frames = any;",
    "export const S: any = { patches: [], kicks: 0, deleted: 0, bg: [] as Promise<unknown>[], job: null, claimed: false };",
    "function json(body: any, status = 200) { return { status, body }; }",
    "async function dbPatchMany(_t: string, q: string, body: any) { if (S.claimed) return []; S.patches.push({ q, body }); return [{ id: 'j1' }]; }",
    "async function dbPatch() { return {}; }",
    "async function dbSelect(t: string) { return t === 'ingest_jobs' && S.job ? [S.job] : []; }",
    "function parseFrames(raw: any, uid: string, sc: string) { return raw?.bad ? { error: 'frames refused' } : { frames: { sheets: [{ path: uid + '/pack/' + sc + '/sheet-1.jpg' }] } }; }",
    "async function deleteSheets(f: any) { S.deleted += f?.sheets?.length ?? 0; }",
    "function kickWorker() { S.kicks++; }",
    "function background(p: Promise<unknown>) { S.bg.push(p); }",
    span("const FRAMES_HOLD_MS = ", "/**\n * \"Read the video\" — the manual trigger"),
    "export { holdForFrames, releaseHeldJob, FRAMES_HOLD_MS };",
  ].join("\n");
  // setTimeout inside the hold's delayed kick would keep this process alive for
  // twenty seconds; the fixture's clock skips it.
  const realTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (f: () => void) => { f(); return 0; };
  const h = await import("data:application/typescript," + encodeURIComponent(mod));
  const t0 = Date.now();
  check(await h.holdForFrames("j1", null), "hold: a new job is held");
  const hold = h.S.patches[0];
  const due = Date.parse(hold.body.run_after) - t0;
  check(hold.q.includes("status=eq.queued") && hold.body.meta.hold_frames === true && hold.body.step === "meta",
    "hold: fenced on queued, marked, and left to scrape");
  check(due >= h.FRAMES_HOLD_MS - 50 && due <= h.FRAMES_HOLD_MS + 1000, "hold: due in twenty seconds, got " + due);
  await Promise.all(h.S.bg);
  check(h.S.kicks === 1, "hold: the worker is woken when the hold runs out, not a cron minute later");
  h.S.patches = [];
  await h.holdForFrames("j2", { caption: "typed", supplied: true });
  check(h.S.patches[0].body.step === "card" && h.S.patches[0].body.meta.caption === "typed",
    "hold: a save that brought its own text keeps it, at the card step");

  const w = { id: "w1", shortcode: "tt-1", ingest_job_id: "j1" };
  h.S.job = null;
  check(await h.releaseHeldJob(w, {}, "u1", {}) === null, "release: a job that is not held answers null (the old path)");
  h.S.job = { id: "j1", meta: { caption: null, thumb: null, author: null, hold_frames: true } };
  h.S.patches = []; h.S.kicks = 0;
  const rel = await h.releaseHeldJob(w, {}, "u1", {});
  check(rel.status === 202 && rel.body.job_id === "j1", "release: frames for a held job answer 202 for the same job");
  const moved = h.S.patches[0].body;
  check(moved.meta.frames?.sheets?.length === 1 && !("hold_frames" in moved.meta) && Date.parse(moved.run_after) <= Date.now(),
    "release: the frames ride on the job, the hold is cleared, and it is due now");
  check(h.S.kicks === 1, "release: the worker is woken at once");
  const bad = await h.releaseHeldJob(w, { bad: true }, "u1", {});
  check(bad.status === 400, "release: frames the door refuses are refused by name");
  h.S.claimed = true; h.S.deleted = 0;
  const late = await h.releaseHeldJob(w, {}, "u1", {});
  check(late.status === 200 && late.body.status === "processing" && h.S.deleted === 1,
    "release: a job claimed in the meantime keeps going without them, and the sheets are deleted");
  (globalThis as any).setTimeout = realTimeout;

  // The route wiring, read off the source: the hold is only for a job this save
  // created, and /media asks for the release before anything is charged.
  // The third argument is the ready mark (notify_ready), which rides on the held job's meta.
  check(/framesPending && !frames && q\.job_created && framesCouldHelp\(p, uc\.plan, cached\[0\]\)\s*\n\s*\? await holdForFrames\(q\.job_id, supplied, mark\)/.test(SRC),
    "hold only for a new job with no frames yet, where frames could help");
  check(SRC.indexOf("releaseHeldJob(w, body.frames") < SRC.indexOf("const [countsR, cachedR, capsR] = await Promise.allSettled(["),
    "release is asked before /media counts or charges anything");
}

// ---- "Add the video": the route, and the worker's half ----
{
  const route = [
    "type Meta = any; type Cors = any; type Counts = any; type UserCaps = any; type UploadRef = any;",
    "export const S: any = {};",
    // The preview table with reserve_video_preview's real semantics (idempotent per
    // key, four a month), and the month's read set keyed as the worker logs it.
    "function reset() { S.deleted = []; S.rpc = []; S.reserved = []; S.patches = []; S.kicks = 0; S.admitted = 0; S.plan = 'free'; S.previews = new Set(); S.readSet = new Set(); S.readKeys = []; S.mediaOver = null; S.dbDeleted = []; S.exists = true; S.extracts = 0; S.paid = true; S.admit = null; S.job = { job_id: 'j9', job_created: true }; }",
    "export { reset };",
    "function json(body: any, status = 200) { return { status, body }; }",
    "async function deleteUpload(p: string) { S.deleted.push(p); }",
    "async function uploadExists() { return S.exists; }",
    "async function settledAll(a: any[]) { return Promise.all(a); }",
    "async function countsFor() { return { extracts: S.extracts }; }",
    "async function capsFor() { return { plan: S.plan, caps: { extract: 10 } }; }",
    "function overCap(u: number, c: number | null) { return c !== null && u >= c; }",
    "async function extractLimitResponse() { return json({ status: 'limit', kind: 'extract' }, 429); }",
    "async function monthReadsReached(_u: string, plan: string, key: string) { S.readKeys.push(key); if (plan !== 'plus') return null; if (key && S.readSet.has(key)) return null; return S.readSet.size >= 20 ? S.readSet.size : null; }",
    "function mediaBurst() { return 15; }",
    "async function mediaCapReached() { return S.mediaOver; }",
    "async function capLimit(kind: string, _uc: any, used: number) { return json({ status: 'limit', kind, scope: 'day', used }, 429); }",
    "async function allowanceLimit() { return json({ status: 'limit', scope: 'month' }, 429); }",
    "async function paidAllowed() { return S.paid; }",
    "function plusPlan(p: string) { return p === 'plus'; }",
    "async function admitNow() { S.admitted++; return S.admit; }",
    "const PREVIEW_CAP = 4;",
    "function allowanceFor(plan: string) { return { reads: plan === 'plus' ? 20 : 4 }; } function utcNextMonth() { return '2026-10-01T00:00:00.000Z'; }",
    fn("function previewLimit("),
    "async function previewCount() { return S.previews.size; }",
    "async function dbSelect(t: string, q: string) { if (t !== 'video_previews') return []; const sc = decodeURIComponent((q.match(/shortcode=eq\\.([^&]+)/) ?? [])[1] ?? ''); return S.previews.has(sc) ? [{ shortcode: sc }] : []; }",
    "async function dbDelete(t: string, q: string) { S.dbDeleted.push(t + '?' + q); }",
    "async function rpc(name: string, args: any) { S.rpc.push(name); if (name === 'reserve_video_preview') { S.reserved.push(args.p_shortcode); if (S.previews.has(args.p_shortcode)) return true; if (S.previews.size >= 4) return false; S.previews.add(args.p_shortcode); return true; } if (name === 'requeue_ingest') return [S.job]; }",
    "async function dbPatch(t: string, q: string, body: any) { S.patches.push({ t, q, body }); return body; }",
    "function kickWorker() { S.kicks++; }",
    fnOr("function attachReadKey(", "function attachReadKey(ref: any) { return 'up-' + ref.id; }"),
    fnOr("async function refundAttachRead(", "async function refundAttachRead() {}"),
    fn("function attachable("), fn("async function attachRefusal("), fn("async function attachUpload("),
    "export { attachUpload, attachRefusal };",
  ].join("\n");
  const a = await import("data:application/typescript," + encodeURIComponent(route));
  const ref = { path: "u1/11111111-2222-4333-8444-555555555555.mp4", id: "11111111-2222-4333-8444-555555555555", ext: "mp4" };
  const ig = { id: "w1", platform: "instagram", shortcode: "DcHDuEFzBSf", ingest_status: "ready", caption: "cap", author: "a", thumb_url: "t", title: "Mine" };
  a.reset();
  const ok = await a.attachUpload(ig, ref, "reel.mp4", "u1", {});
  const seed = a.S.patches.find((x: any) => x.t === "ingest_jobs")?.body;
  check(ok.status === 202 && ok.body.status === "processing" && ok.body.id === "w1", "attach: 202 processing for THAT card");
  check(a.S.rpc.join(",") === "reserve_video_preview,requeue_ingest", "attach: Basic spends a video read (a preview), then requeues");
  check(seed?.max_attempts === 1 && seed.meta.attach === true && seed.meta.upload_path === ref.path &&
    seed.meta.supplied === true && seed.meta.caption === "cap", "attach: one attempt, the address, the card's own caption, marked supplied");
  check(a.S.patches.some((x: any) => x.t === "workouts" && x.body.media_stage === "watching") && a.S.kicks === 1,
    "attach: the card says watching and the worker is woken");
  check(a.S.deleted.length === 0 && a.S.admitted === 1, "attach: the file is kept for the reader, and the save was admitted once");

  a.reset(); a.S.previews = new Set(["a", "b", "c", "d"]);
  const out = await a.attachUpload(ig, ref, "", "u1", {});
  check(out.status === 429 && out.body.upgrade === true && out.body.scope === "month" && out.body.cap === 4 &&
    out.body.next_plan === "plus" && a.S.deleted[0] === ref.path,
    "attach: no reads left → the Plus answer (previewLimit's shape), and the file is deleted");
  a.reset(); a.S.plan = "plus"; a.S.readSet = new Set(Array.from({ length: 20 }, (_, i) => "tt-" + i));
  const month = await a.attachUpload(ig, ref, "", "u1", {});
  check(month.status === 429 && month.body.scope === "month" && !a.S.rpc.length, "attach: Plus at twenty reads is refused before any reservation");
  a.reset(); a.S.admit = { status: 429, body: { code: "busy" } };
  const busy = await a.attachUpload(ig, ref, "", "u1", {});
  check(busy.status === 429 && !a.S.rpc.includes("reserve_video_preview") && a.S.deleted.length === 1,
    "attach: refused admission reserves nothing and deletes the file");
  a.reset();
  const up = await a.attachUpload({ ...ig, platform: "upload" }, ref, "", "u1", {});
  check(up.status === 400 && a.S.deleted.length === 1, "attach: an upload card cannot be attached to");
  a.reset();
  const pend = await a.attachUpload({ ...ig, ingest_status: "processing" }, ref, "", "u1", {});
  check(pend.body.status === "processing" && a.S.deleted.length === 1 && !a.S.rpc.length, "attach: a card already reading is left alone");
  a.reset(); a.S.exists = false;
  const gone = await a.attachUpload(ig, ref, "", "u1", {});
  check(gone.status === 404, "attach: a file that never landed is a 404 with a next step");
  a.reset(); a.S.previews = new Set(["a", "b", "c", "d"]);
  check(await a.attachRefusal("u1", "DcHDuEFzBSf", "up-" + ref.id, false, {}) !== null, "authorize: Basic with four previews used is refused up front");

  // ---- R-1: a read is one FILE, not one card ----
  const ref2 = { path: "u1/22222222-2222-4333-8444-555555555555.mp4", id: "22222222-2222-4333-8444-555555555555", ext: "mp4" };
  a.reset(); a.S.previews = new Set(["DcHDuEFzBSf", "a", "b", "c"]);
  const again = await a.attachUpload(ig, ref2, "", "u1", {});
  check(again.status === 429 && again.body.upgrade === true && again.body.scope === "month" && again.body.cap === 4 &&
    !a.S.rpc.includes("requeue_ingest") && a.S.deleted[0] === ref2.path,
    "R-1: Basic, four previews used and one on this card: a second file into the same card is refused (previewLimit shape), no job queued, file deleted");
  a.reset(); a.S.previews = new Set(["DcHDuEFzBSf", "a", "b", "c"]);
  check(await a.attachRefusal("u1", "DcHDuEFzBSf", "up-" + ref2.id, false, {}) !== null,
    "R-1: authorize refuses that second file up front too");
  a.reset(); a.S.previews = new Set(["DcHDuEFzBSf"]);
  const second = await a.attachUpload(ig, ref2, "", "u1", {});
  check(second.status === 202 && a.S.reserved.join() === "up-" + ref2.id && a.S.previews.size === 2,
    "R-1: Basic, the card already read once: the next file spends a preview of its own (up-<id>)");
  a.reset();
  const first = await a.attachUpload(ig, ref, "", "u1", {});
  check(first.status === 202 && a.S.reserved.join() === "DcHDuEFzBSf" && a.S.previews.size === 1,
    "R-1: Basic, the card's first read is reserved on the card (the row the completion fence reads)");
  a.reset(); a.S.previews = new Set(["DcHDuEFzBSf"]); a.S.job = { job_id: "j8", job_created: false };
  await a.attachUpload(ig, ref2, "", "u1", {});
  check(a.S.dbDeleted.some((q: string) => q.includes("shortcode=eq.up-" + ref2.id)) &&
    !a.S.dbDeleted.some((q: string) => q.includes("shortcode=eq.DcHDuEFzBSf")),
    "R-1: a file that joined another job's read gives its own preview back, never the card's");
  a.reset(); a.S.plan = "plus"; a.S.readSet = new Set(["DcHDuEFzBSf", ...Array.from({ length: 19 }, (_, i) => "tt-" + i)]);
  const plus20 = await a.attachUpload(ig, ref2, "", "u1", {});
  check(plus20.status === 429 && plus20.body.scope === "month" && !a.S.rpc.includes("requeue_ingest") &&
    a.S.readKeys.every((k: string) => k === "up-" + ref2.id),
    "R-1: Plus at twenty reads with this card among them: a new file is refused (the month is asked with the file's key)");
  a.reset(); a.S.plan = "plus"; a.S.readSet = new Set(["DcHDuEFzBSf", ...Array.from({ length: 18 }, (_, i) => "tt-" + i)]);
  const plus19 = await a.attachUpload(ig, ref2, "", "u1", {});
  check(plus19.status === 202 && !a.S.rpc.includes("reserve_video_preview"), "R-1: Plus under twenty: the file is read, no preview row");
  a.reset(); a.S.mediaOver = 15;
  const burst = await a.attachUpload(ig, ref2, "", "u1", {});
  check(burst.status === 429 && burst.body.kind === "media" && !a.S.rpc.length && a.S.deleted[0] === ref2.path,
    "R-1: the daily media ceiling is asked, as Read the video asks it — refused before any reservation, file deleted");

  // The worker: a person's file, read into their card, and never into the cache.
  const worker = [
    "type Job = any; type Parsed = any; type Meta = any; type Card = any;",
    "export const S: any = {};",
    "export function reset(r: any) { S.read = r; S.finished = null; S.published = 0; S.built = null; S.dbDeleted = []; }",
    "async function dbDelete(t: string, q: string) { S.dbDeleted.push(t + '?' + q); }",
    fn("function readQuality("),
    fn("class SoftFailure extends Error {").replace(/^class/, "class"),
    "class GuardError extends Error {}",
    "const aiActor = { getStore: () => null };",
    "const UUID_RE = /^[0-9a-fA-F-]{36}$/;",
    "const UPLOAD_EXTS = ['mp4', 'mov'];",
    fn("function parseUploadPath("),
    "function uploadParsed(sc: string) { return { platform: 'upload', shortcode: sc, kind: 'upload', clean: 'spotter://upload/x' }; }",
    "async function dbSelect() { return [{ id: 'w1', title: 'My leg day', caption: 'IG caption', author: 'a', thumb_url: 'thumbs/x.jpg', blocks: [] }]; }",
    "async function uploadMeta(_p: any, job: any) { if (S.read instanceof Error) throw S.read; if (S.read.card) job.card = S.read.card; return S.read.meta; }",
    "async function capsFor() { return { plan: 'free' }; }",
    "async function buildCard(meta: any) { S.built = meta; return { title: 'Built', blocks: /squat/i.test(meta.transcript ?? '') ? [{ exercises: [{ name: 'Squat' }] }] : [] }; }",
    "function countExercises(c: any) { return (c?.blocks ?? []).reduce((n: number, b: any) => n + (b.exercises?.length ?? 0), 0); }",
    "function mergeNoDowngrade(_old: any, next: any) { return { ...next }; }",
    "function labelRecommendations() {}",
    "async function publishCache() { S.published++; }",
    "async function finishJob(_j: any, _p: any, meta: any, card: any, thumb: any) { S.finished = { meta, card, thumb }; }",
    fnOr("function attachReadKey(", "function attachReadKey(ref: any) { return 'up-' + ref.id; }"),
    fnOr("async function refundAttachRead(", "async function refundAttachRead() {}"),
    fn("async function runAttachedUpload("),
    "export { runAttachedUpload, SoftFailure };",
  ].join("\n");
  const r = await import("data:application/typescript," + encodeURIComponent(worker));
  const UID = "aaaaaaaa-0000-4000-8000-000000000001";
  const job = { id: "j9", user_id: UID, claim_generation: 1, meta: { attach: true, upload_path: UID + "/11111111-2222-4333-8444-555555555555.mp4", filename: "reel.mp4", caption: "IG caption" } };
  const p = { platform: "instagram", shortcode: "DcHDuEFzBSf", kind: "reel", clean: "https://www.instagram.com/reel/DcHDuEFzBSf/" };
  r.reset({ meta: { caption: null, transcript: "00:01 squats", media_source: "video:pack", source: "video" } });
  await r.runAttachedUpload(job, p);
  check(r.S.finished && r.S.finished.card.title === "My leg day", "worker: the card keeps the person's title");
  check(r.S.built.caption === "IG caption" && r.S.built.transcript === "00:01 squats" && r.S.built.supplied === true,
    "worker: rebuilt from the post's caption plus what the file said, marked supplied");
  check(r.S.finished.thumb === "thumbs/x.jpg" && r.S.published === 0, "worker: keeps the card's picture and never publishes to the cache");
  check(!r.S.dbDeleted.length, "R-1 worker: a read that watched the file keeps its preview");
  const refunded = () => r.S.dbDeleted.some((q: string) => q.startsWith("video_previews?") &&
    q.includes("shortcode=eq.up-11111111-2222-4333-8444-555555555555") && q.includes("completed=eq.false"));
  r.reset({ meta: { caption: null, transcript: "00:01 squats", media_source: "transcript", source: "transcript" } });
  await r.runAttachedUpload(job, p);
  check(r.S.finished && refunded(), "R-1 worker: a file that was only heard gives its own preview back");
  r.reset({ meta: { caption: "only music", source: "transcript" } });
  let failed: any = null;
  try { await r.runAttachedUpload(job, p); } catch (e) { failed = e; }
  check(failed?.final && failed?.keepCard && /This card is unchanged\.$/.test(failed.userMessage),
    "worker: a file with no workout fails final and keeps the card, with a sentence");
  check(refunded(), "R-1 worker: a failed read gives the file's preview back");
  r.reset(new r.SoftFailure("Spotter watched this one and listened to it, and found no exercises either way. Paste the workout text instead.", "empty"));
  failed = null;
  try { await r.runAttachedUpload(job, p); } catch (e) { failed = e; }
  check(failed?.final && failed.keepCard && !/Paste the workout text/.test(failed.userMessage), "worker: the reader's own sentence, final, card kept");
}

// ---- CR-5 / CR-6: which saves are held, and the 202 says so ----
{
  const mod = [
    "type Meta = any; type Cors = any; type Frames = any; type Counts = any; type UserCaps = any; type Card = any; type Parsed = any;",
    "export const S: any = {};",
    "export function reset(o: any = {}) { Object.assign(S, { plan: 'plus', p: { platform: 'tiktok', shortcode: 'tt-1', kind: 'video', clean: 'https://www.tiktok.com/@/video/1' }, cache: [], q: { workout_id: 'w1', job_id: 'j1', job_created: true, already: false }, held: 0, kicks: 0 }, o); }",
    "function json(body: any, status = 200) { return { status, body }; }",
    "const BLOCKED = Symbol('blocked'); const INSECURE = Symbol('insecure');",
    "const SUPPLIED_HTML_MAX = 2_000_000; const SUPPLIED_CAPTION_MAX = 6_000; const FRAMES_HOLD_MS = 20_000;",
    "async function resolveShare() { return S.p; }",
    "function noPostAnswer() { return { status: 'error' }; }",
    "async function dbSelect(t: string) { return t === 'video_cache' ? S.cache : []; }",
    "async function countsFor() { return { saves: 0, extracts: 0 }; }",
    "async function capsFor() { return { plan: S.plan, caps: { library: null, saves: null, extract: null } }; }",
    "async function libraryCount() { return 0; }",
    "function overCap(u: number, c: number | null) { return c !== null && u >= c; }",
    "function cacheForAccess(row: any) { return row ?? null; }",
    "function visuallyRead(r: any) { return !!r?.read; }",
    SRC.match(/^function plusPlan\(.*$/m)![0],
    "const MIN_USABLE_CARD_V = 10;",
    "async function admitNow() { return null; }",
    "function cleanTitle(t: string) { return t; } function fallbackTitle() { return 'Saved workout'; }",
    "async function rpc() { return [S.q]; }",
    "async function holdForFrames() { S.held++; return true; }",
    "async function seedJobMeta() { return true; }",
    "function kickWorker() { S.kicks++; }",
    "function readingLine() { return 'Reading the video…'; }",
    "async function deleteSheets() {}",
    "async function upgradeCachedCard() { return null; }",
    "async function dbInsert(_t: string, row: any) { return { id: 'w1', ...row }; }",
    "function background() {} async function logSave() {} function visionWarning() { return null; } function plusReadHint() { return null; }",
    fn("async function handleIngest("),
    fn("function framesCouldHelp("),
    "export { handleIngest, framesCouldHelp };",
  ].join("\n");
  const g = await import("data:application/typescript," + encodeURIComponent(mod));
  const save = (body: unknown) => g.handleIngest(new Request("https://fixture.invalid/api/ingest", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "u1", {});
  const link = "https://www.tiktok.com/@a/video/1";

  g.reset();
  let r = await save({ url: link, frames_pending: true });
  check(r.status === 202 && r.body.frames_wanted === true && g.S.held === 1 && g.S.kicks === 0,
    "CR-5: a Plus TikTok video save is held and the 202 says frames_wanted: true");
  g.reset({ plan: "free" });
  r = await save({ url: link, frames_pending: true });
  check(r.status === 202 && r.body.frames_wanted === false && g.S.held === 0 && g.S.kicks === 1,
    "CR-6: a stale Plus hint on a Basic account is ignored — not held, read now, frames_wanted: false");
  g.reset({ p: { platform: "tiktok", shortcode: "tt-2", kind: "photo", clean: "https://www.tiktok.com/@/photo/2" } });
  r = await save({ url: link, frames_pending: true });
  check(r.body.frames_wanted === false && g.S.held === 0, "CR-6: a TikTok photo post is not held");
  g.reset({ p: { platform: "instagram", shortcode: "DcHDuEFzBSf", kind: "reel", clean: "https://www.instagram.com/reel/DcHDuEFzBSf/" } });
  r = await save({ url: link, frames_pending: true });
  check(r.body.frames_wanted === false && g.S.held === 0, "CR-6: nor anything the phone does not cut stills from");
  g.reset({ q: { workout_id: "w1", job_id: "j0", job_created: false, already: false } });
  r = await save({ url: link, frames_pending: true });
  check(r.body.frames_wanted === false && g.S.held === 0, "CR-6: a joined job is not held (its own save owns it)");
  g.reset({ cache: [{ read: true, card: { blocks: [] }, vision: null }] });
  g.S.cache[0].card.vision = { missing: ["x"] };
  r = await save({ url: link, frames_pending: true });
  check(r.status === 202 && r.body.frames_wanted === false && g.S.held === 0, "CR-5: a video already read visually is not held");
  g.reset();
  r = await save({ url: link });
  check(r.status === 202 && !("frames_wanted" in r.body) && g.S.held === 0, "a save that did not ask gets no frames_wanted (old clients, the app)");

  check(g.framesCouldHelp({ platform: "tiktok", kind: "video" }, "staff", null) &&
    !g.framesCouldHelp({ platform: "tiktok", kind: "video" }, "free", null) &&
    !g.framesCouldHelp({ platform: "tiktok", kind: "video" }, "plus", { read: true }),
    "framesCouldHelp: Plus-family, unread TikTok video only");
  // The cache upgrade's 202 never waits either.
  check(/message: "Listening to the video…",\s*\n\s*\/\/ A cache upgrade never waits[^\n]*\n\s*frames_wanted: false,/.test(SRC),
    "CR-5: a cache hit that goes on to read says frames_wanted: false");
}

// ---- CR-1: the video door mints its own path ----
{
  const UID = "aaaaaaaa-0000-4000-8000-000000000001";
  const mod = [
    "type Cors = any; type UploadRef = any;",
    "export const S: any = {};",
    "export function reset(o: any = {}) { Object.assign(S, { admitted: 0, admit: null, permits: [], permitArgs: [], permit: 'ok', signed: [], signFail: false, full: false, paid: true, sheets: 0, patched: [], noFourArg: false }, o); }",
    "function json(body: any, status = 200) { return { status, body }; }",
    "class GuardError extends Error {}",
    "const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;",
    span("const UPLOAD_EXTS = ", "// Signed media links expire"),
    "const UPLOAD_SIGN_SECONDS = 900;",
    fn("function parseUploadPath("),
    "async function authorizeSheets() { S.sheets++; return json({ status: 'ok', sheets: [] }); }",
    "async function capsFor() { return { caps: { library: 20 } }; }",
    "async function libraryCount() { return S.full ? 20 : 3; }",
    "function overCap(u: number, c: number | null) { return c !== null && u >= c; }",
    "async function capLimit() { return json({ status: 'limit', kind: 'library' }, 429); }",
    "async function paidAllowed() { return S.paid; }",
    "async function attachRefusal() { return null; }",
    "async function dbSelect() { return [{ id: 'w1', shortcode: 'DcHDuEFzBSf', platform: 'instagram' }]; }",
    "function attachable() { return true; }",
    "async function admitNow() { S.admitted++; return S.admit; }",
    "async function rpc(name: string, args: any) { if (S.noFourArg && 'p_address_seconds' in args) throw new Error('rpc issue_upload_permit 404: {\"code\":\"PGRST202\"}'); S.permits.push(args.p_path); S.permitArgs.push(args); return S.permit; }",
    "async function dbPatchMany(t: string, q: string, b: any) { S.patched.push({ t, q, b }); return []; }",
    // The storage token's own lifetime is two hours (measured: exp-iat = 7200).
    "async function signUploadTarget(path: string, upsert = false) { if (S.signFail) throw new Error('503'); S.signed.push({ path, upsert }); return { upload_url: 'https://x.supabase.co/storage/v1/object/upload/sign/uploads/' + path + '?token=t0k', token: 't0k', expires_in: 7200 }; }",
    "const SIGNED_UPLOAD_SECONDS = 7200;",
    fnOr("async function issueAddressPermit(", "async function issueAddressPermit() { throw new Error('no address-aware permit in this tree'); }"),
    SRC.includes("const ADDRESS_HOLD_MARGIN_S") ? span("const ADDRESS_HOLD_MARGIN_S", ";") + ";" : "",
    fn("async function authorizeUpload("),
    span("const SHARED_VIDEO_TYPES", "\n};\n") + "\n};",
    "export { authorizeUpload, SHARED_VIDEO_TYPES };",
  ].join("\n");
  const u = await import("data:application/typescript," + encodeURIComponent(mod));
  const ask = (body: unknown) => u.authorizeUpload(new Request("https://fixture.invalid/api/uploads/authorize",
    { method: "POST", body: JSON.stringify(body) }), UID, {});
  const pathRe = new RegExp("^" + UID + "/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(mp4|mov|m4v)$");

  u.reset();
  let r = await ask({ kind: "video", bytes: 8_000_000, ext: "mp4" });
  check(r.status === 200 && r.body.status === "ok" && pathRe.test(r.body.path) && r.body.path.endsWith(".mp4"),
    "CR-1: {kind:video, bytes, ext} with no path → 200 and a path minted as <uid>/<uuid>.mp4");
  check(r.body.upload_url.includes(r.body.path) && r.body.token === "t0k" && r.body.expires_in === 7200,
    "CR-1/R-2: the answer carries the signed upload address, its token, and the token's real lifetime (" + r.body.expires_in + ")");
  check(u.S.permitArgs[0]?.p_address_seconds >= 7200,
    "R-2: the video door's permit is held for the address's lifetime (p_address_seconds " + u.S.permitArgs[0]?.p_address_seconds + ")");
  check(u.S.permits[0] === r.body.path && u.S.signed[0].path === r.body.path && u.S.signed[0].upsert === false && u.S.admitted === 1,
    "CR-1: the permit is for that path, the address writes once (no upsert), admitted once");
  const again = await ask({ kind: "video", bytes: 8_000_000, ext: "mp4" });
  check(again.body.path !== r.body.path, "CR-1: every authorize mints a new path (a retry never writes over the last)");
  u.reset();
  r = await ask({ kind: "video", bytes: 1000, ext: "MOV" });
  const r2 = await ask({ kind: "video", bytes: 1000, ext: ".m4v" });
  check(r.status === 200 && r.body.path.endsWith(".mov") && r2.status === 200 && r2.body.path.endsWith(".m4v"),
    "CR-1: MOV and M4V too, case and a leading dot forgiven");
  check(Object.keys(u.SHARED_VIDEO_TYPES).join() === "mp4,mov,m4v" &&
    Object.values(u.SHARED_VIDEO_TYPES).join() === "video/mp4,video/quicktime,video/x-m4v",
    "CR-1: exactly the three content types the brief names");
  for (const [body, why] of [
    [{ kind: "video", bytes: 1000, ext: "webm" }, "WebM (not one of the three)"],
    [{ kind: "video", bytes: 1000, ext: "constructor" }, "a prototype key as the ext"],
    [{ kind: "video", bytes: 1000 }, "no ext"],
    [{ kind: "video", bytes: 25 * 1024 * 1024 + 1, ext: "mp4" }, "one byte over the upload cap"],
    [{ kind: "video", bytes: 0, ext: "mp4" }, "zero bytes"],
    [{ kind: "video", bytes: 1.5, ext: "mp4" }, "fractional bytes"],
  ] as [unknown, string][]) {
    u.reset();
    const x = await ask(body);
    check(x.status === 400 && u.S.admitted === 0 && !u.S.permits.length && !u.S.signed.length,
      "CR-1/1b: " + why + " → 400, no admission, no permit");
  }
  u.reset();
  r = await ask({ kind: "video", bytes: 25 * 1024 * 1024, ext: "mp4" });
  check(r.status === 200, "CR-1: exactly the upload cap is taken");

  // The app's shape, byte for byte as before.
  u.reset();
  const own = UID + "/11111111-2222-4333-8444-555555555555.mov";
  r = await ask({ path: own, bytes: 1000 });
  check(r.status === 200 && JSON.stringify(r.body) === JSON.stringify({ status: "ok", path: own }) &&
    u.S.permits[0] === own && !u.S.signed.length && u.S.admitted === 1,
    "CR-1: a caller-named path answers {status, path} as today, no address signed");
  check(Object.keys(u.S.permitArgs[0] ?? {}).sort().join() === "p_bytes,p_path,p_user",
    "R-2: the app's own permit is asked with the same three arguments as before");
  u.reset();
  r = await ask({ kind: "video", path: own, bytes: 1000 });
  check(r.status === 200 && !("upload_url" in r.body), "CR-1: a named path wins over kind (old shape unchanged)");
  u.reset();
  r = await ask({ path: "bbbbbbbb-0000-4000-8000-000000000002/11111111-2222-4333-8444-555555555555.mp4", bytes: 1000 });
  check(r.status === 400 && u.S.admitted === 0, "CR-1b: somebody else's path → 400 with no admission");
  u.reset({ full: true });
  r = await ask({ kind: "video", bytes: 1000, ext: "mp4" });
  check(r.status === 429 && r.body.kind === "library" && u.S.admitted === 0 && !u.S.permits.length,
    "CR-1b: a full library is answered before admission (free answers spend nothing)");
  u.reset({ admit: { status: 429, body: { code: "daily" } } });
  r = await ask({ kind: "video", bytes: 1000, ext: "mp4" });
  check(r.status === 429 && r.body.code === "daily" && !u.S.permits.length, "CR-1b: a refused admission issues no permit");
  u.reset({ permit: "busy" });
  r = await ask({ kind: "video", bytes: 1000, ext: "mp4" });
  check(r.status === 429 && !u.S.signed.length, "CR-1: permits busy → 429, no address signed");
  u.reset({ signFail: true });
  r = await ask({ kind: "video", bytes: 1000, ext: "mp4" });
  check(r.status === 502 && r.body.status === "error", "CR-1: storage would not sign → 502 with a sentence");
  check(u.S.patched.some((x: any) => x.t === "upload_permits" && x.b.released === true && x.b.address_until === null),
    "R-2: no address was made, so the permit is given back at once");
  u.reset({ noFourArg: true });
  r = await ask({ kind: "video", bytes: 1000, ext: "mp4" });
  check(r.status === 200 && u.S.permitArgs.length === 1 && !("p_address_seconds" in u.S.permitArgs[0]),
    "R-2: before its migration is applied, the door falls back to the old permit (deploy order safe)");
  u.reset();
  r = await ask({ kind: "pack", shortcode: "tt-1", sheets: [{ bytes: 1 }] });
  check(u.S.sheets === 1 && u.S.admitted === 0, "the pack authorize is still its own branch");
  check(/if \(!paid\) throw new GuardError\("budget"\);\s*\n[^\n]*\n[^\n]*\n\s*const refused = await admitNow\(\);\s*\n\s*if \(refused\) return refused;\s*\n\s*\n\s*const paths = sizes\.map/.test(SRC),
    "CR-1b: the pack authorize admits after its free refusals, before its permits");
  check(/path === "\/api\/ingest" \|\| path === "\/api\/uploads\/authorize" \|\|/.test(SRC),
    "CR-1b: /api/uploads/authorize is a late-admitting route");
}

// ---- R-2: what storage is actually asked for, and what the token says ----
{
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = (claims: unknown) => b64({ alg: "HS256", typ: "JWT" }) + "." + b64(claims) + ".sig";
  const mod = [
    "export const S: any = { calls: [], token: '' };",
    "const SUPABASE_URL = 'https://proj.supabase.co';",
    "const dbHeaders = { apikey: 'k', 'content-type': 'application/json' };",
    "const UPLOAD_SIGN_SECONDS = 900;",
    "const SIGNED_UPLOAD_SECONDS = 7200;",
    "async function fetch(url: string, init: any) { S.calls.push({ url, headers: init.headers, body: init.body }); return new Response(JSON.stringify({ url: '/object/upload/sign/uploads/p?token=' + S.token }), { status: 200 }); }",
    fn("async function signUploadTarget("),
    fnOr("function tokenLifetime(", ""),
    "export { signUploadTarget };",
  ].join("\n");
  const g = await import("data:application/typescript," + encodeURIComponent(mod));
  g.S.token = jwt({ url: "uploads/p", upsert: false, scope: "upload", iat: 1790266216, exp: 1790273416 });
  const video = await g.signUploadTarget("u/v.mp4", false);
  check(video.expires_in === 7200, "R-2: the address's lifetime is read from its token (exp-iat = 7200), not assumed (" + video.expires_in + ")");
  const vh = g.S.calls[0].headers ?? {};
  check(!("x-upsert" in vh) && !/upsert/.test(String(g.S.calls[0].body ?? "")),
    "R-2: a video's address is asked without upsert, in the only form storage reads (no x-upsert header, no ignored body flag)");
  g.S.calls = [];
  g.S.token = jwt({ url: "uploads/p", upsert: true, scope: "upload", iat: 100, exp: 3700 });
  const sheet = await g.signUploadTarget("u/pack/tt-1/sheet-1.jpg", true);
  check(g.S.calls[0].headers?.["x-upsert"] === "true", "R-2: a sheet's address asks for upsert with the x-upsert header storage honours");
  check(sheet.expires_in === 3600, "R-2: a different storage lifetime is reported as it is (" + sheet.expires_in + ")");
  g.S.calls = []; g.S.token = "not-a-jwt";
  const odd = await g.signUploadTarget("u/v.mp4", false);
  check(odd.expires_in === 7200, "R-2: an unreadable token is reported at storage's documented two hours");
  check(/signUploadTarget\(path, true\)/.test(SRC) && /signUploadTarget\(ref\.path, false\)/.test(SRC),
    "R-2: sheets sign with upsert, the video door without");
}

// ---- CR-2: the save key on /media, narrowly ----
{
  const UID = "aaaaaaaa-0000-4000-8000-000000000001";
  const mod = [
    "type Cors = any; type Frames = any; type Counts = any; type UserCaps = any; type Meta = any; type Card = any;",
    "export const S: any = {};",
    "export function reset(o: any = {}) { Object.assign(S, { rows: [], reads: 0, released: null, attached: 0, deleted: 0, reached: false }, o); }",
    "function json(body: any, status = 200) { return { status, body }; }",
    "async function dbSelect(_t: string, q: string) { S.reads++; S.q = q; return S.rows; }",
    "const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;",
    "const UPLOAD_EXTS = ['mp4', 'mov', 'm4v'];",
    fn("function parseUploadPath("),
    "async function attachUpload(w: any) { S.attached++; return json({ status: 'processing', id: w.id, message: 'Watching your video…' }, 202); }",
    "async function releaseHeldJob() { return S.released; }",
    "function parseFrames(raw: any, uid: string, sc: string) { return raw?.bad ? { error: 'frames refused' } : { frames: { sheets: [{ path: uid + '/pack/' + sc + '/sheet-1.jpg' }] } }; }",
    "async function deleteSheets(f: any) { S.deleted += f?.sheets?.length ?? 0; }",
    "function providerFor() { S.reached = true; return { media: false }; }",
    fnOr("async function deleteUnheldSheets(", ""),
    span("/** POST /api/workouts/:id/media, the one route", "/**\n * \"Read the video\" — the manual trigger"),
    fn("async function handleReadVideo("),
    "export { handleReadVideo, keyMediaBody, MEDIA_PATH_RE };",
  ].join("\n");
  const k = await import("data:application/typescript," + encodeURIComponent(mod));
  const ID = "cccccccc-0000-4000-8000-000000000003";
  const media = (body: unknown, viaKey = true) => k.handleReadVideo(ID, UID,
    new Request("https://fixture.invalid/api/workouts/" + ID + "/media", { method: "POST", body: JSON.stringify(body) }), {}, viaKey);
  const card = (o: any = {}) => ({ id: ID, user_id: UID, shortcode: "tt-1", platform: "tiktok", ingest_status: "processing", ingest_job_id: "j1", ...o });
  const frames = { sheets: [{ path: UID + "/pack/tt-1/sheet-1.jpg" }] };

  // Refused before a row is read.
  for (const [body, why] of [
    [{}, "an empty body (a server-side re-read)"],
    [{ preview: true }, "a preview"],
    [{ frames, preview: true }, "frames with a preview"],
    [{ frames, reread: true }, "frames plus anything else"],
    [{ frames: null }, "null frames"],
    [{ upload_path: UID + "/11111111-2222-4333-8444-555555555555.mp4", frames }, "an upload with frames"],
    [{ upload_path: 7 }, "an upload_path that is not a string"],
    [null, "no JSON at all"],
  ] as [unknown, string][]) {
    k.reset({ rows: [card()] });
    const r = await media(body);
    check(r.status === 403 && k.S.reads === 0 && !k.S.attached, "CR-2: the key with " + why + " → 403, no row read");
  }
  // Somebody else's card (or none): the owner filter answers 404.
  k.reset({ rows: [] });
  let r = await media({ frames });
  check(r.status === 404 && k.S.q.includes("user_id=eq." + UID), "CR-2: frames for a card the key's account does not own → 404");
  k.reset({ rows: [] });
  r = await media({ upload_path: UID + "/11111111-2222-4333-8444-555555555555.mp4" });
  check(r.status === 404 && !k.S.attached, "CR-2: Add the video into a foreign card → 404");
  // The two bodies it may send.
  k.reset({ rows: [card()], released: { status: 202, body: { status: "processing", job_id: "j1" } } });
  r = await media({ frames });
  check(r.status === 202 && r.body.job_id === "j1", "CR-2: frames that release the key's own held save → 202 for that job");
  k.reset({ rows: [card()], released: null });
  r = await media({ frames });
  check(r.status === 200 && r.body.message === "Already reading that one." && k.S.deleted === 1 && !k.S.reached,
    "CR-2: frames after the hold ran out → 'Already reading', sheets deleted, nothing charged");
  k.reset({ rows: [card({ ingest_status: "ready" })] });
  r = await media({ frames });
  check(r.status === 403 && k.S.deleted === 1 && !k.S.reached, "CR-2: frames for a card not being read (a re-read) → 403, sheets deleted");
  k.reset({ rows: [card({ ingest_status: "ready", platform: "instagram" })] });
  r = await media({ upload_path: UID + "/11111111-2222-4333-8444-555555555555.mp4", filename: "reel.mp4" });
  check(r.status === 202 && k.S.attached === 1, "CR-2: Add the video into the key's own card → attach (202)");
  // The bearer is unchanged: the same empty body goes on past the gate.
  k.reset({ rows: [card({ ingest_status: "ready" })] });
  r = await media({}, false);
  check(k.S.reached && r.status === 400, "CR-2: with the bearer, every other body still reaches the old path");
  check(k.MEDIA_PATH_RE.test("/api/workouts/" + ID + "/media") && !k.MEDIA_PATH_RE.test("/api/workouts/" + ID + "/reprocess"),
    "CR-2: the key's /media match is that route only");
  check(/path === "\/api\/ai-consent" \|\| \(req\.method === "POST" && MEDIA_PATH_RE\.test\(path\)\)\)\) \{\s*\n\s*userId = await userFromIngestKey\(req, url, keyed\);\s*\n\s*viaKey = !!userId;/.test(SRC) &&
    /handleReadVideo\(readvid\[1\], userId, req, cors, viaKey\)/.test(SRC),
    "CR-2: the router lets the key reach /media only as viaKey (a bearer never sets it)");
}

// ---- R-6: frames sent twice never delete the sheets a live job holds ----
{
  const UID = "aaaaaaaa-0000-4000-8000-000000000001";
  const mod = [
    "type Meta = any; type Cors = any; type Frames = any; type Counts = any; type UserCaps = any; type Card = any;",
    "export const S: any = {};",
    "export function reset(card: any, job: any) { Object.assign(S, { card, job, deleted: [] as string[], kicks: 0 }); }",
    "function json(body: any, status = 200) { return { status, body }; }",
    // A small stateful ingest_jobs/workouts pair, answering the queries these routes make.
    "async function dbSelect(t: string, q: string) {",
    "  if (t === 'workouts') return S.card ? [S.card] : [];",
    "  const j = S.job; if (!j) return [];",
    "  if (q.includes('select=frames:meta->frames')) return ['queued', 'running'].includes(j.status) ? [{ frames: j.meta?.frames ?? null }] : [];",
    "  if (q.includes('status=eq.queued')) return j.status === 'queued' ? [{ id: j.id, meta: j.meta }] : [];",
    "  return [j];",
    "}",
    "async function dbPatchMany(t: string, q: string, body: any) { if (t === 'ingest_jobs' && S.job && S.job.status === 'queued') { Object.assign(S.job, body); return [S.job]; } return []; }",
    "async function dbPatch() { return {}; }",
    "function parseFrames(raw: any, uid: string, sc: string) { return { frames: { source: 'device', duration_s: 30, sheets: [{ path: uid + '/pack/' + sc + '/sheet-1.jpg' }, { path: uid + '/pack/' + sc + '/sheet-2.jpg' }] } }; }",
    "async function deleteSheets(f: any) { for (const x of f?.sheets ?? []) S.deleted.push(x.path); }",
    "function kickWorker() { S.kicks++; }",
    "function background() {}",
    "function providerFor() { return { media: true }; }",
    "const UUID_RE = /^[0-9a-fA-F-]{36}$/; const UPLOAD_EXTS = ['mp4'];",
    fn("function parseUploadPath("),
    "async function attachUpload() { throw new Error('not here'); }",
    span("const FRAMES_HOLD_MS = ", "/**\n * \"Read the video\" — the manual trigger"),
    fn("async function handleReadVideo("),
    "export { handleReadVideo };",
  ].join("\n");
  const h = await import("data:application/typescript," + encodeURIComponent(mod));
  const ID = "cccccccc-0000-4000-8000-000000000006";
  const post = (viaKey: boolean) => h.handleReadVideo(ID, UID,
    new Request("https://fixture.invalid/api/workouts/" + ID + "/media", { method: "POST", body: JSON.stringify({ frames: { sheets: [] } }) }), {}, viaKey);
  const card = { id: ID, user_id: UID, shortcode: "tt-9", platform: "tiktok", ingest_status: "processing", ingest_job_id: "j6" };
  for (const viaKey of [true, false]) {
    const who = viaKey ? "the save key" : "the app";
    h.reset({ ...card }, { id: "j6", user_id: UID, status: "queued", meta: { caption: null, hold_frames: true } });
    const first = await post(viaKey);
    check(first.status === 202 && h.S.job.meta.frames?.sheets?.length === 2 && !h.S.deleted.length,
      "R-6 (" + who + "): the first frames POST releases the held job with its sheets");
    const again = await post(viaKey);
    check(again.status === 200 && again.body.message === "Already reading that one." && !h.S.deleted.length,
      "R-6 (" + who + "): the same POST again deletes nothing the queued job holds (deleted: " + h.S.deleted.join(", ") + ")");
    check(h.S.job.meta.frames?.sheets?.length === 2, "R-6 (" + who + "): and the job still has its frames");
    h.S.job.status = "running";
    await post(viaKey);
    check(!h.S.deleted.length, "R-6 (" + who + "): nor once a worker is running it");
    h.S.job.status = "done";
    await post(viaKey);
    check(h.S.deleted.length === 2, "R-6 (" + who + "): sheets nobody holds any more are still deleted");
  }
}

// ---- the free path's per-minute throttle (request_tick) ----
{
  const mod = [
    "type Cors = any;",
    "export const S: any = { ticks: 0, calls: [] as string[], fail: false };",
    "function json(body: any, status = 200) { return { status, body }; }",
    // The SQL's own rule (proved in tools/request-tick-db-check.mjs), per route.
    "const seen: Record<string, number> = {};",
    "async function rpc(name: string, a: any) { S.calls.push(name); if (S.fail) throw new Error('rpc request_tick 503'); if (name !== 'request_tick') return 'ok'; const k = a.p_user + a.p_route; if ((seen[k] ?? 0) >= a.p_limit) return false; seen[k] = (seen[k] ?? 0) + 1; return true; }",
    fn("function admissionRefusal("),
    span("const FREE_PER_MINUTE = ", "/**\n * One profile read per request"),
    "export { freePathThrottle, FREE_PER_MINUTE, FREE_THROTTLED };",
  ].join("\n");
  const t = await import("data:application/typescript," + encodeURIComponent(mod));
  const answers = [];
  for (let i = 0; i < 31; i++) answers.push(await t.freePathThrottle("u1", "/api/ingest", {}));
  check(t.FREE_PER_MINUTE === 30 && answers.slice(0, 30).every((r: any) => r === null), "throttle: 30 free requests in a minute go through");
  const r31 = answers[30];
  check(r31?.status === 429 && r31.body.code === "minute" && r31.body.kind === "request" &&
    r31.body.message === "That is a lot of saves in one minute — wait a few seconds and share it again.",
    "throttle: the 31st is 429 with the existing minute sentence and code");
  check(t.S.calls.every((c: string) => c === "request_tick"), "throttle: paid admission is not asked (no ai_admit call)");
  check(await t.freePathThrottle("u1", "/api/ingest/prepare", {}) === null && await t.freePathThrottle("u2", "/api/ingest", {}) === null,
    "throttle: per route and per person");
  const other = await t.freePathThrottle("u3", "/api/uploads/authorize", {}).then(async () => {
    for (let i = 0; i < 30; i++) await t.freePathThrottle("u3", "/api/uploads/authorize", {});
    return t.freePathThrottle("u3", "/api/uploads/authorize", {});
  });
  check(other?.status === 429 && !/share/.test(other.body.message), "throttle: authorize is refused in route-neutral words");
  t.S.fail = true;
  check(await t.freePathThrottle("u9", "/api/ingest", {}) === null, "throttle: a failed tick fails open");
  check([...t.FREE_THROTTLED].sort().join() === "/api/ingest,/api/ingest/prepare,/api/uploads/authorize",
    "throttle: exactly the three free-path routes");
  // Wiring: started after auth, before the body is read, and awaited before each
  // of the three handlers — so before resolveShare, and not inside ai_admit.
  const router = SRC.slice(SRC.indexOf("let userId = await userFromBearer(req);"));
  check(router.indexOf("const freeTick = req.method === \"POST\" && FREE_THROTTLED.has(path) ? freePathThrottle(userId, path, cors) : null;") <
      router.indexOf("if (req.method === \"POST\") req = await boundedRequest(req);") &&
    router.indexOf("if (!userId) return json(") < router.indexOf("const freeTick"),
    "throttle: started once the caller is known, before the body is read");
  // handleIngest also learns whether the ingest key opened the door (viaKey): a
  // save from the Share Extension is announced when it is ready (push.ts).
  for (const h of ["authorizeUpload(req, userId!, cors)", "handleIngestPrepare(req, userId, cors)", "handleIngest(req, userId, cors, viaKey)"]) {
    check(router.includes("return (await freeTick) ?? await " + h + ";"), "throttle: awaited before " + h.split("(")[0]);
  }
  check(!/request_tick/.test(fn("async function guardedUserRequest(")), "throttle: not part of admission");
}

// ---- S10: the end of a job wakes the worker for that person's next one ----
{
  const mod = [
    "export const S: any = { rows: [], kicks: 0, q: '' };",
    "async function dbSelect(_t: string, q: string) { S.q = q; return S.rows; }",
    "function kickWorker() { S.kicks++; }",
    fn("async function kickIfQueued("),
    "export { kickIfQueued };",
  ].join("\n");
  const k = await import("data:application/typescript," + encodeURIComponent(mod));
  await k.kickIfQueued("u1");
  check(k.S.kicks === 0, "S10: nothing queued, nothing woken");
  k.S.rows = [{ id: "j2" }];
  await k.kickIfQueued("u1");
  check(k.S.kicks === 1 && /status=eq\.queued/.test(k.S.q) && /run_after=lte\./.test(k.S.q),
    "S10: a due queued job for the same person wakes the worker (a held one is not due)");
  check(/runJob\(j\)\.catch\(\(e\) => failJob\(j, e\)\)\.then\(\(\) => kickIfQueued\(j\.user_id\)\)/.test(SRC),
    "S10: asked at the end of every job, success or failure");
}

if (failures.length) {
  console.error("FAIL " + failures.length + " of " + checks + " share checks:\n  " + failures.join("\n  "));
  Deno.exit(1);
}
console.log("PASS " + checks + " share checks; offline, no production writes.");
