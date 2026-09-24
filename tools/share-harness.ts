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
  check(/framesPending && !frames && q\.job_created \? await holdForFrames\(q\.job_id, supplied\)/.test(SRC),
    "hold only for a new job with no frames yet");
  check(SRC.indexOf("releaseHeldJob(w, body.frames") < SRC.indexOf("const [countsR, cachedR, capsR] = await Promise.allSettled(["),
    "release is asked before /media counts or charges anything");
}

// ---- "Add the video": the route, and the worker's half ----
{
  const route = [
    "type Meta = any; type Cors = any; type Counts = any; type UserCaps = any; type UploadRef = any;",
    "export const S: any = {};",
    "function reset() { S.deleted = []; S.rpc = []; S.patches = []; S.kicks = 0; S.admitted = 0; S.plan = 'free'; S.previewOk = true; S.exists = true; S.reads = null; S.extracts = 0; S.paid = true; S.admit = null; S.job = { job_id: 'j9', job_created: true }; }",
    "export { reset };",
    "function json(body: any, status = 200) { return { status, body }; }",
    "async function deleteUpload(p: string) { S.deleted.push(p); }",
    "async function uploadExists() { return S.exists; }",
    "async function settledAll(a: any[]) { return Promise.all(a); }",
    "async function countsFor() { return { extracts: S.extracts }; }",
    "async function capsFor() { return { plan: S.plan, caps: { extract: 10 } }; }",
    "function overCap(u: number, c: number | null) { return c !== null && u >= c; }",
    "async function extractLimitResponse() { return json({ status: 'limit', kind: 'extract' }, 429); }",
    "async function monthReadsReached() { return S.reads; }",
    "async function allowanceLimit() { return json({ status: 'limit', scope: 'month' }, 429); }",
    "async function paidAllowed() { return S.paid; }",
    "function plusPlan(p: string) { return p === 'plus'; }",
    "async function admitNow() { S.admitted++; return S.admit; }",
    "const PREVIEW_CAP = 4;",
    "async function previewCount() { return 4; }",
    "async function dbSelect() { return []; }",
    "async function dbDelete() {}",
    "async function rpc(name: string, args: any) { S.rpc.push(name); if (name === 'reserve_video_preview') return S.previewOk; if (name === 'requeue_ingest') return [S.job]; }",
    "async function dbPatch(t: string, q: string, body: any) { S.patches.push({ t, q, body }); return body; }",
    "function kickWorker() { S.kicks++; }",
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

  a.reset(); a.S.previewOk = false;
  const out = await a.attachUpload(ig, ref, "", "u1", {});
  check(out.status === 429 && out.body.upgrade === true && a.S.deleted[0] === ref.path,
    "attach: no reads left → the Plus answer, and the file is deleted");
  a.reset(); a.S.plan = "plus"; a.S.reads = 20;
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
  a.reset();
  check(await a.attachRefusal("u1", "DcHDuEFzBSf", false, {}) !== null, "authorize: Basic with four previews used is refused up front");

  // The worker: a person's file, read into their card, and never into the cache.
  const worker = [
    "type Job = any; type Parsed = any; type Meta = any; type Card = any;",
    "export const S: any = {};",
    "export function reset(r: any) { S.read = r; S.finished = null; S.published = 0; S.built = null; }",
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
  r.reset({ meta: { caption: "only music", source: "transcript" } });
  let failed: any = null;
  try { await r.runAttachedUpload(job, p); } catch (e) { failed = e; }
  check(failed?.final && failed?.keepCard && /This card is unchanged\.$/.test(failed.userMessage),
    "worker: a file with no workout fails final and keeps the card, with a sentence");
  r.reset(new r.SoftFailure("Spotter watched this one and listened to it, and found no exercises either way. Paste the workout text instead.", "empty"));
  failed = null;
  try { await r.runAttachedUpload(job, p); } catch (e) { failed = e; }
  check(failed?.final && failed.keepCard && !/Paste the workout text/.test(failed.userMessage), "worker: the reader's own sentence, final, card kept");
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
