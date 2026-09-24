// What the final verification on the iPhone found (V-1…V-6), exercised offline.
//
// Run: deno run --allow-read tools/verify-findings-harness.ts — exits non-zero on failure.
//
// The functions under test are LIFTED out of supabase/functions/spotter/index.ts
// the way tools/share-harness.ts lifts its own, so a rename there is a loud error
// here. Where a function is new in this change, a stand-in with the OLD behaviour
// is used when an older index.ts is checked (fnOr), so running this over the
// tree before the fix fails on the finding rather than on a missing name.
// No network, no database, no model, no production writes.
//
// V-1  a Basic account's own upload is delivered as read (finishJob)
// V-2  one daily media ceiling: the worker asks mediaBurst, as the routes do
// V-3  Instagram's generic og:image is never a cover; tools/thumbs-repair.ts
// V-5  the ingest key's lookup carries the profile; config read beside it
// V-6  a caption-wide set count reaches the slide exercises that have none
// (V-4 is the client's: tools/share-client-harness.mjs.)

const ROOT = new URL("../", import.meta.url);
const SRC = await Deno.readTextFile(new URL("supabase/functions/spotter/index.ts", ROOT));
const fixture = (name: string) => Deno.readTextFile(new URL("tools/fixtures/" + name, ROOT));

function fn(head: string): string {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error("index.ts no longer declares: " + head);
  const j = SRC.indexOf("\n}\n", i);
  return SRC.slice(i, j + 2);
}
function fnOr(head: string, fallback: string): string {
  return SRC.includes(head) ? fn(head) : fallback;
}
function span(from: string, to: string): string {
  const i = SRC.indexOf(from);
  const j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("index.ts section moved: " + from + " … " + to);
  return SRC.slice(i, j);
}
function spanOr(from: string, to: string, fallback: string): string {
  return SRC.includes(from) ? span(from, to) : fallback;
}
// The lifted code logs as it would in production; only this harness's verdict is printed.
const say = { log: console.log, error: console.error };
console.log = () => {}; console.error = () => {};
const load = (parts: string[]) => import("data:application/typescript," + encodeURIComponent(parts.join("\n")));

let checks = 0;
const failures: string[] = [];
function check(ok: unknown, what: string): void {
  checks++;
  if (!ok) failures.push(what);
}

// ---- V-1: a Basic account's own upload is delivered as read ----
{
  const m = await load([
    "type Job = any; type Parsed = any; type Meta = any; type Card = any;",
    "export const S: any = {};",
    "export function reset(o: any) { Object.assign(S, { plan: 'free', preview: false, built: 0, published: 0, finish: null, status: null }, o); }",
    "const WORKER_ID = 'w1'; const CARD_V = 11; const PACK_V = 1;",
    "function labelRecommendations() {}",
    "async function dbSelect(t: string) { return t === 'workouts' ? [{ id: 'row1', user_id: 'u1' }] : []; }",
    "function plusPlan(p: string) { return ['plus', 'pro', 'staff'].includes(p); }",
    "async function premiumAccess() { return plusPlan(S.plan) || S.preview; }",
    fn("function readQuality("),
    fn("function basicMeta("),
    "function cacheForAccess() { return null; }",
    "const aiActor = { run: (_c: any, f: () => any) => f(), getStore: () => ({}) };",
    // The caption-only card of a file with no caption: what V-1 delivered.
    "async function buildCard(meta: any) { S.built++; return { title: 'Uploaded workout', blocks: meta.caption ? [{ exercises: [{ name: 'From caption' }] }] : [], has_full_workout: false }; }",
    "function providerFor(p: string) { return { cacheable: p !== 'upload' }; }",
    "async function captionMayOverwriteCache() { return true; }",
    "async function publishCache() { S.published++; return true; }",
    "function visionWarning() { return null; }",
    "function plusReadHint() { return 'A Plus read of the video found more.'; }",
    // finish_ingest_job's own fence (20260917130000): premium needs Plus or a preview row.
    "async function rpc(name: string, a: any) { if (name !== 'finish_ingest_job') return null; S.finish = a.p_payload;",
    "  if (a.p_payload.read_quality === 'premium' && !(plusPlan(S.plan) || S.preview)) { S.status = 'access_changed'; return { status: 'access_changed', filled: 0 }; }",
    "  S.status = 'done'; return { status: 'done', filled: 1 }; }",
    "async function dbPatchMany() { return []; }",
    "function qualityColumns() { return {}; }",
    fn("async function finishJob("),
    "export { finishJob };",
  ]);
  const job = { id: "j1", user_id: "u1", claim_generation: 1, created_at: new Date().toISOString() };
  const upload = { platform: "upload", shortcode: "up-11111111-2222-4333-8444-555555555555", kind: "upload", clean: "spotter://upload/x" };
  const watched = () => ({ title: "Leg day", blocks: [{ type: "straight", rounds: null, exercises: [{ name: "Goblet Squat" }, { name: "Lunge" }] }], has_full_workout: true, extracted_by: "video:gemini-flash" });
  const names = () => (m.S.finish?.blocks ?? []).flatMap((b: any) => b.exercises.map((e: any) => e.name)).join(",");
  const run = async (p: any, meta: any, card: any) => {
    try { await m.finishJob(job, p, meta, card, null, false); } catch (e) { m.S.thrown = String(e); }
  };

  m.reset({});
  await run(upload, { caption: null, thumb: null, author: null, source: "video", media_source: "video:gemini" }, watched());
  check(m.S.status === "done" && names() === "Goblet Squat,Lunge",
    "V-1: Basic, own upload read by the video tier: the card lists the 2 exercises it read (got [" + names() + "], " + m.S.status + ")");
  check(m.S.finish?.read_quality === "basic" && m.S.finish?.read_plan === "free" && m.S.finish?.ingest_error === null,
    "V-1: …delivered as quality basic (the completion fence's own rule: no preview is charged for it), no Plus hint");
  check(m.S.built === 0 && m.S.published === 0, "V-1: no caption-only rebuild and nothing published for a person's own file");

  m.reset({});
  await run(upload, { caption: null, thumb: null, author: null, source: "video", media_source: "video:pack",
    pack: { reader: "gemini", exercises: [{ name: "Goblet Squat" }] } }, watched());
  check(m.S.status === "done" && names() === "Goblet Squat,Lunge", "V-1: Basic, own upload read by the pack: delivered as read");

  m.reset({});
  await run(upload, { caption: "squats 3x10", thumb: null, author: null, source: "transcript", media_source: "upload:gemini" }, watched());
  check(m.S.status === "done" && names() === "Goblet Squat,Lunge" && m.S.finish.read_quality === "basic",
    "V-1: a heard-only Basic upload is delivered as it always was");

  m.reset({ plan: "plus" });
  await run(upload, { caption: null, thumb: null, author: null, source: "video", media_source: "video:gemini" }, watched());
  check(m.S.status === "done" && names() === "Goblet Squat,Lunge" && m.S.finish.read_quality === "premium",
    "V-1: Plus upload unchanged: the read card, quality premium");

  // A shared video is not the person's own file: Basic without a preview still
  // gets the caption's card, never a Plus reading somebody else paid for.
  m.reset({});
  await run({ platform: "tiktok", shortcode: "tt-1", kind: "video", clean: "https://www.tiktok.com/@a/video/1" },
    { caption: "Core burner", thumb: null, author: "a", source: "oembed", media_source: "video:gemini" }, watched());
  check(m.S.status === "done" && names() === "From caption" && m.S.finish.read_quality === "basic" && m.S.built === 1,
    "V-1 scope: a Basic TikTok save still gets the caption card, not the shared premium read (got [" + names() + "])");

  // "Add the video": the post's platform, with the read reserved on the card.
  m.reset({ preview: true });
  await run({ platform: "instagram", shortcode: "DcHDuEFzBSf", kind: "reel", clean: "https://www.instagram.com/reel/DcHDuEFzBSf/" },
    { caption: "IG caption", thumb: null, author: "a", source: "personal-fallback,upload", media_source: "video:pack",
      pack: { reader: "gemini", exercises: [{ name: "Goblet Squat" }] }, supplied: true }, watched());
  check(m.S.status === "done" && names() === "Goblet Squat,Lunge" && m.S.finish.read_quality === "premium",
    "V-1: Add the video for Basic (its read reserved on the card) delivers the read, quality premium");
}

// ---- V-2: one daily media ceiling ----
{
  const m = await load([
    "type UserCaps = any;",
    "export const S: any = { used: 0, plan: 'free', fail: false };",
    "async function settledAll(a: any[]) { return Promise.all(a); }",
    "async function mediaCountToday() { if (S.fail) throw new Error('count 503'); return S.used; }",
    // The plan table's own numbers (LIMITS_DEFAULTS): Basic media 2, Plus 15.
    "async function capsFor() { return { plan: S.plan, caps: { media: S.plan === 'plus' ? 15 : 2 } }; }",
    "async function monthReadsReached() { return null; }",
    fn("function overCap("),
    fn("function plusPlan("),
    span("const BASIC_MEDIA_BURST", "\n/**"),
    fn("function uploadRoute("),
    "const UPLOAD_VIDEO_EXTS = new Set(['mp4', 'mov']);",
    fn("async function overMediaCapToday("),
    "export { overMediaCapToday, uploadRoute, mediaBurst };",
  ]);
  // One Basic video-door upload logs two media rows: the pack attempt and the video read.
  m.S.used = 2;
  const over = await m.overMediaCapToday("u1", "up-2");
  const route = m.uploadRoute({ ext: "mp4", videoTier: true, paid: true, overCap: over });
  check(!over && route.first === "video",
    "V-2: Basic, two media rows today (one upload): Add the video is still watched, not heard (over=" + over + ", first=" + route.first + ")");
  m.S.used = 14;
  check(!(await m.overMediaCapToday("u1", "up-3")), "V-2: Basic at 14 media steps is under the burst of 15, as /media admits it");
  m.S.used = 15;
  check(await m.overMediaCapToday("u1", "up-3"), "V-2: Basic at 15 is over — the same number /media and the read route refuse at");
  m.S.plan = "plus"; m.S.used = 15;
  check(await m.overMediaCapToday("u1", "up-3") && m.mediaBurst({ plan: "plus", caps: { media: 15 } }) === 15,
    "V-2: Plus keeps its plan number");
  m.S.fail = true;
  check(await m.overMediaCapToday("u1", "up-3"), "V-2: a count that cannot be read still answers over (heard, never uncapped)");
  const upgrade = fn("async function upgradeCachedCard(");
  check(/mediaCapReached\(userId, mediaBurst\(uc as UserCaps\)\)/.test(upgrade) && !/caps\.media/.test(upgrade),
    "V-2: the cache upgrade asks mediaBurst too — no route or worker path reads the plan table's media for Basic");
  check(!/\.caps\.media\b/.test(SRC.replace(fn("function mediaBurst("), "")),
    "V-2: mediaBurst is the only reader of caps.media");
}

// ---- V-3: Instagram's generic og:image is never a cover ----
const IG_LOGO = "https://static.cdninstagram.com/rsrc.php/v4/yD/r/R0fBIMurK8v.png";
{
  const ig = await load([
    "type Meta = any; type Parsed = any;",
    "export const S: any = {};",
    "async function safeFetch(u: string) { return new Response(/embed\\/captioned/.test(u) ? S.embed : S.page, { status: 200 }); }",
    "const CRAWLER_UA = 'c'; const IPHONE_UA = 'i';",
    fn("function decodeEntities("), fn("function metaTag("),
    fnOr("function igGenericImage(", "function igGenericImage(_u: any) { return false; }"),
    fn("function igFromOg("), fn("function igFromEmbed("), fn("function igEmbedContext("), fn("function igBetterCaption("),
    fn("function igParseHtml("), fn("async function igMeta("),
    "export { igGenericImage, igFromOg, igFromEmbed, igParseHtml, igMeta };",
  ]);
  check(ig.igGenericImage(IG_LOGO), "V-3: the stored logo's og:image URL is generic");
  check(!ig.igGenericImage("https://scontent-ord5-2.cdninstagram.com/v/t51.71878-15/624173128_n.jpg?stp=x") &&
    !ig.igGenericImage("https://instagram.fxyz1-1.fna.fbcdn.net/v/t51.2885-15/1.jpg") && !ig.igGenericImage(null),
    "V-3: a post's own media (scontent, fbcdn) is not");
  // The page Instagram served this datacenter for CLymnxZjlAw and DFmWcwhoaCQ:
  // generic, the logo as og:image, nothing about the post.
  const generic = '<html><head><meta property="og:title" content="Instagram" /><meta property="og:image" content="' + IG_LOGO + '" /></head></html>';
  check(ig.igFromOg(generic).thumb === null, "V-3: og: rung — the logo is not a thumb (got " + ig.igFromOg(generic).thumb + ")");
  check(ig.igParseHtml(generic).thumb === null && !ig.igParseHtml(generic).images.includes(IG_LOGO),
    "V-3: the phone's path neither — and the logo is never a slide for vision to read");
  const reel = await fixture("ig-reel-embed.html");
  const media = ig.igFromEmbed(reel);
  check(media.mediaThumb === true && /^https:\/\/scontent/.test(media.thumb ?? ""), "V-3: the embed names its media image");
  const q = { shortcode: "DFmWcwhoaCQ", clean: "https://www.instagram.com/reel/DFmWcwhoaCQ/" };
  ig.S.page = generic; ig.S.embed = reel;
  const cold = await ig.igMeta(q);
  check(cold.thumb === media.thumb && !cold.images.includes(IG_LOGO),
    "V-3: igMeta, generic page + real embed: the cover is the embed's scontent image (got " + String(cold.thumb).slice(0, 60) + ")");
  // Even when og:image is a real picture, the embed's media image is preferred:
  // og: is a 640 square crop of the post; the embed's is the post at its own shape.
  const square = "https://scontent-ord5-2.cdninstagram.com/v/t51.71878-15/476388993_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6";
  ig.S.page = '<html><head><meta property="og:image" content="' + square + '" /><meta property="og:title" content="coach on Instagram: &quot;Legs&quot;" /></head></html>';
  check((await ig.igMeta(q)).thumb === media.thumb, "V-3: igMeta prefers the embed's media image over og:image");
  // A loose scontent match (it can be the author's avatar) never displaces og:image.
  ig.S.embed = '<html><img src="https://scontent-x.cdninstagram.com/v/t51.2885-19/avatar.jpg" /><div class="Caption">Legs</div><div class="CaptionComments"></div></html>';
  check((await ig.igMeta(q)).thumb === square, "V-3: a loose scontent src in the embed only fills a gap");
  const side = ig.igFromEmbed(await fixture("ig-sidecar-embed.html"));
  check(side.thumb === side.images[0] || side.mediaThumb, "V-3: a carousel's cover is its first slide when the embed names no media image");

  // storeThumb, the one place a cover is written: refuses the logo by URL and by bytes.
  const st = await load([
    "export const S: any = { puts: [] as string[], bytes: new Uint8Array(0) };",
    "async function safeFetch(_u: string) { return new Response(S.bytes, { status: 200, headers: { 'content-type': 'image/png' } }); }",
    "const DESKTOP_UA = 'd'; const SUPABASE_URL = 'https://p.example'; const COVER_CACHE = 'max-age=604800';",
    "const COVER_PLATFORMS = new Set(['tiktok', 'instagram', 'youtube']);",
    "function plainJpegSize() { return null; } function coverFit() { return null; } function kickCover() {}",
    "async function putThumb(name: string) { S.puts.push(name); return new Response('{}', { status: 200 }); }",
    fnOr("function igGenericImage(", "function igGenericImage(_u: any) { return false; }"),
    fn("function ttGenericImage("),
    spanOr("export const PLATFORM_LOGO_SHA256", "export async function storeThumb(",
      "export const PLATFORM_LOGO_SHA256: Record<string, string> = {}; export async function platformLogo(_b: any) { return null; }"),
    fn("async function storeThumb("),
    "export { storeThumb };",
  ]);
  const png = new Uint8Array(4096); png.set([0x89, 0x50, 0x4e, 0x47], 0); png[2000] = 7;
  st.S.bytes = png;
  check(await st.storeThumb("CLymnxZjlAw", IG_LOGO, "instagram") === null && !st.S.puts.length,
    "V-3: storeThumb refuses Instagram's og:image by its URL and uploads nothing");
  check(st.PLATFORM_LOGO_SHA256["b421b00fd1791a1d1ab70dd1e9667f40ca79a8c8673989864f1be092295cd7da"] &&
    st.PLATFORM_LOGO_SHA256["3e37b1d51ead41bc3e9a3c2951994e0ecbcf090f09116a2055d27c547a12afa4"],
    "V-3: the two measured logo fingerprints (thumbs/CLymnxZjlAw.jpg = Instagram's og:image; thumbs/tt-7679960172495785999.jpg)");
  // Bytes: the same picture reached by a URL no rule knows. The table is keyed by
  // SHA-256; this fixture's own digest stands in for a logo's.
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", png)), (b) => b.toString(16).padStart(2, "0")).join("");
  st.PLATFORM_LOGO_SHA256[hex] = "Fixture logo";
  check(await st.platformLogo(png) === "Fixture logo" && await st.storeThumb("DX", "https://scontent.example/x.jpg", "instagram") === null &&
    !st.S.puts.length, "V-3: storeThumb refuses a logo by its bytes too");
  png[2000] = 8;
  check(await st.storeThumb("DX", "https://scontent.example/x.jpg", "instagram") !== null && st.S.puts.join() === "DX.jpg",
    "V-3: a real picture is stored as before");
}

// ---- V-3: tools/thumbs-repair.ts, against a fake project ----
{
  const tool = await import(new URL("tools/thumbs-repair.ts", ROOT).href).catch(() => null);
  check(tool, "V-3: tools/thumbs-repair.ts exists and loads without the network");
  if (tool) {
    const base = "https://p.example";
    const url = (n: string) => base + "/storage/v1/object/public/thumbs/" + n;
    const png = (w: number, h: number, tag: number) => {
      const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); b[40] = tag; return b;
    };
    const jpg = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255]); return b; };
    type World = Record<string, Uint8Array<ArrayBuffer>>;
    const world = (): { objects: World; refs: Record<string, { cache: number; workouts: number }>; calls: string[] } => ({
      objects: {
        "CLymnxZjlAw.jpg": png(4168, 4168, 1), "DFmWcwhoaCQ.jpg": png(4168, 4168, 1), "DStill.jpg": png(4168, 4168, 1),
        "tt-7679960172495785999.jpg": png(928, 928, 2), "tt-1.jpg": jpg(600, 1066), "DGood.jpg": jpg(640, 1136), "loose.jpg": jpg(10, 10),
      },
      refs: { [url("CLymnxZjlAw.jpg")]: { cache: 1, workouts: 2 }, [url("DFmWcwhoaCQ.jpg")]: { cache: 1, workouts: 0 }, [url("DStill.jpg")]: { cache: 1, workouts: 1 } },
      calls: [],
    });
    const rows = [
      { shortcode: "CLymnxZjlAw", platform: "instagram", kind: "p", url: "https://www.instagram.com/p/CLymnxZjlAw/", thumb_url: url("CLymnxZjlAw.jpg") },
      { shortcode: "DFmWcwhoaCQ", platform: "instagram", kind: "reel", url: "https://www.instagram.com/reel/DFmWcwhoaCQ/", thumb_url: url("DFmWcwhoaCQ.jpg") },
      { shortcode: "DStill", platform: "instagram", kind: "p", url: "https://www.instagram.com/p/DStill/", thumb_url: url("DStill.jpg") },
      { shortcode: "tt-1", platform: "tiktok", kind: "video", url: "https://www.tiktok.com/@a/video/1", thumb_url: url("tt-1.jpg") },
      { shortcode: "DGood", platform: "instagram", kind: "p", url: "https://www.instagram.com/p/DGood/", thumb_url: url("DGood.jpg") },
      { shortcode: "DElse", platform: "instagram", kind: "p", url: "https://www.instagram.com/p/DElse/", thumb_url: "https://elsewhere.example/storage/v1/object/public/thumbs/CLymnxZjlAw.jpg" },
    ];
    const deps = (w: ReturnType<typeof world>) => ({
      base,
      rows: async () => rows,
      objects: async () => Object.keys(w.objects),
      read: async (n: string) => w.objects[n] ? { bytes: w.objects[n], type: "image/png" } : null,
      logo: async (b: Uint8Array) => b[0] === 0x89 && b[40] === 1 ? "Instagram logo (4168x4168 PNG)" : b[0] === 0x89 && b[40] === 2 ? "TikTok logo (928x928 PNG)" : null,
      refs: async (u: string) => w.refs[u] ?? { cache: 0, workouts: 0 },
      refetch: async (r: any) => r.shortcode === "CLymnxZjlAw" ? "https://scontent.example/real.jpg?sig=1" : r.shortcode === "DStill" ? IG_LOGO : null,
      probe: async (s: string) => s === IG_LOGO ? { ok: true, logo: "Instagram logo (4168x4168 PNG)", size: "4168x4168 png" } : { ok: true, logo: null, size: "640x1136 jpeg 90000 B" },
      store: async (r: any, s: string) => { w.calls.push("store " + r.shortcode + " " + s); w.objects[r.shortcode + ".jpg"] = jpg(640, 1136); return true; },
      clearThumb: async (u: string) => { w.calls.push("clear " + u); const n = w.refs[u] ?? { cache: 0, workouts: 0 }; w.refs[u] = { cache: 0, workouts: 0 }; return n; },
      remove: async (n: string) => { w.calls.push("remove " + n); delete w.objects[n]; return true; },
    });
    const w = world();
    const d = deps(w);
    const { actions, hashed } = await tool.plan(d);
    const what = actions.map((a: any) => a.kind + " " + a.name).sort().join(", ");
    check(what === "clear DFmWcwhoaCQ.jpg, clear DStill.jpg, delete tt-7679960172495785999.jpg, replace CLymnxZjlAw.jpg",
      "V-3 repair: plan = replace CLymnxZjlAw, clear DFmWcwhoaCQ (no picture) and DStill (still the logo), delete the TikTok orphan (got " + what + ")");
    check(hashed === 7 && !w.calls.length, "V-3 repair: a dry run hashes every object once and writes nothing");
    const lines = tool.report(actions).join("\n");
    check(/CLymnxZjlAw\.jpg\tCLymnxZjlAw\tinstagram\tInstagram logo.*4168x4168 png.*cache 1 \/ workouts 2\tREPLACE with https:\/\/scontent\.example\/real\.jpg \(640x1136/.test(lines) &&
      !/sig=1/.test(lines) && /tt-7679960172495785999\.jpg\t-\t-\tTikTok logo.*DELETE the object — no row references it/.test(lines),
      "V-3 repair: the dry run prints each object, its proof, the rows sharing it and exactly what would change");
    const out = await tool.apply(d, actions);
    check(w.calls.sort().join("|") === [
      "clear " + url("DFmWcwhoaCQ.jpg"), "clear " + url("DStill.jpg"), "remove DFmWcwhoaCQ.jpg", "remove DStill.jpg",
      "remove tt-7679960172495785999.jpg", "store CLymnxZjlAw https://scontent.example/real.jpg?sig=1",
    ].sort().join("|"), "V-3 repair: --apply stores, clears and deletes those and nothing else (" + w.calls.join(" | ") + ")");
    check(out.some((l: string) => /^CLymnxZjlAw\.jpg\treplaced: 1136x640|^CLymnxZjlAw\.jpg\treplaced: 640x1136/.test(l)) && ["tt-1.jpg", "DGood.jpg", "loose.jpg"].every((n) => w.objects[n]),
      "V-3 repair: the replaced object is a real picture; covers that are not logos are untouched");
    // Changed between the dry run and --apply: skipped, not acted on blind.
    const w2 = world(); const d2 = deps(w2);
    const p2 = await tool.plan(d2);
    w2.objects["tt-7679960172495785999.jpg"] = jpg(600, 600);
    w2.refs[url("CLymnxZjlAw.jpg")] = { cache: 1, workouts: 2 };
    const o2 = await tool.apply(d2, p2.actions.filter((a: any) => a.kind === "delete"));
    check(o2[0]?.includes("SKIPPED") && w2.objects["tt-7679960172495785999.jpg"], "V-3 repair: an object that changed since the plan is skipped");
    const w3 = world(); const d3 = deps(w3);
    const p3 = await tool.plan(d3);
    w3.refs[url("tt-7679960172495785999.jpg")] = { cache: 0, workouts: 1 };
    const o3 = await tool.apply(d3, p3.actions.filter((a: any) => a.kind === "delete"));
    check(o3[0]?.includes("SKIPPED") && !w3.calls.length, "V-3 repair: an orphan that gained a reference is not deleted");
    check(tool.ownObject(base, url("a-b_1.jpg")) === "a-b_1.jpg" && tool.ownObject(base, url("../x.jpg")) === null &&
      tool.ownObject(base, "https://elsewhere.example/storage/v1/object/public/thumbs/x.jpg") === null && tool.ownObject(base, url("x.png")) === null,
      "V-3 repair: only an object in our own thumbs bucket, by the one name shape storeThumb writes");
    check(tool.describe(png(4168, 4168, 1)) === "4168x4168 png 64 B" && tool.describe(jpg(640, 1136)) === "640x1136 jpeg 64 B",
      "V-3 repair: object sizes read from the header");
  }
}

// ---- V-5: the ingest key's lookup carries the profile; the config read runs beside it ----
{
  const actorImport = new URL("supabase/functions/spotter/ai-guard.ts", ROOT).href;
  const m = await load([
    "import { aiActor } from " + JSON.stringify(actorImport) + ";",
    "import { AsyncLocalStorage } from 'node:async_hooks';",
    "type Cors = any; type LimitKind = string;",
    "export const S: any = { events: [] as string[], reads: 0, consent: true, lastQuery: '' };",
    "const tick = () => new Promise((r) => setTimeout(r, 15));",
    "async function dbSelect(t: string, q: string) { S.lastQuery = q; if (t !== 'profiles') return []; S.reads++; S.events.push('profile:start'); await tick(); S.events.push('profile:end');",
    "  return [{ id: 'u1', plan: 'free', limits: null, settings: S.consent ? { ai_consent_version: '2026-09-19', ai_consent_at: '2026-09-19T12:00:00Z' } : {} }]; }",
    "async function ensureConfig() { S.events.push('config:start'); await tick(); S.events.push('config:end'); }",
    "function json(b: any, s = 200) { return Response.json(b, { status: s }); }",
    "async function rpc() { return 'ok'; }",
    "async function pumpyMeter() { return null; } function pumpyConfig() { return { turnMaxCredits: 40 }; } const LIMIT_CHAT = 200;",
    "async function isSaveAuthorize() { return false; }",
    span("const profileMemo = ", "async function guardedUserRequest("),
    "async function capsFor(u: string) { await profileRow(u); return { plan: 'free', caps: { saves: 30, extract: 10, uploads: 1, helper: 25 } }; }",
    fn("function scopeFor("),
    "const AI_CONSENT_VERSION = '2026-09-19';",
    fn("function aiConsented("),
    fn("function admitsLate("),
    "const admission = new AsyncLocalStorage<{ admit: () => Promise<Response | null> }>();",
    fn("function admissionRefusal("),
    fn("async function guardedUserRequest("),
    fn("async function userFromIngestKey("),
    "export { guardedUserRequest, userFromIngestKey };",
  ]);
  const req = () => new Request("https://fixture.invalid/api/ingest", { method: "POST", body: "{}" });
  const reset = () => { m.S.events = []; m.S.reads = 0; m.S.consent = true; };

  reset();
  let reached = false;
  await m.guardedUserRequest(req(), "/api/ingest", "u1", {}, async () => { reached = true; m.S.events.push("handler"); return Response.json({}); });
  const e = m.S.events;
  check(reached && e.indexOf("config:start") >= 0 && e.indexOf("config:start") < e.indexOf("profile:end"),
    "V-5: the config wait starts beside the consent read, not after it (" + e.join(" → ") + ")");
  check(m.S.reads === 1, "V-5: one profile read per request (consent and caps share it), got " + m.S.reads);

  // The Share Extension's path: the key's lookup already read the row.
  const seen: { profile?: any } = {};
  reset();
  const keyReq = new Request("https://fixture.invalid/api/ingest", { headers: { "x-ingest-key": "a".repeat(32) } });
  const uid = await m.userFromIngestKey(keyReq, new URL("https://fixture.invalid/api/ingest"), seen);
  check(uid === "u1" && /select=id,plan,limits,settings$/.test(m.S.lastQuery) && seen.profile?.plan === "free" && seen.profile?.settings,
    "V-5: the ingest key's lookup brings back plan, limits and settings with the id (" + m.S.lastQuery + ")");
  reset();
  reached = false;
  await m.guardedUserRequest(req(), "/api/ingest", "u1", {}, async () => { reached = true; return Response.json({}); }, seen.profile);
  check(reached && m.S.reads === 0, "V-5: …so a key save reads the profile once, not twice (reads in the guard: " + m.S.reads + ")");
  reset();
  const refused = await m.guardedUserRequest(req(), "/api/ingest", "u1", {}, async () => Response.json({}),
    { id: "u1", plan: "free", limits: null, settings: {} });
  check(refused.status === 403 && (await refused.json()).code === "ai_consent_required",
    "V-5: consent is still asked of the carried row (403 ai_consent_required, unchanged)");
  check(await m.userFromIngestKey(new Request("https://x/", { headers: { "x-ingest-key": "nope" } }), new URL("https://x/"), {}) === null,
    "V-5: a key that is not 32 hex characters still never reaches PostgREST");

  const router = SRC.slice(SRC.indexOf("if (!path.startsWith(\"/api/\"))"));
  const kick = router.indexOf("if (req.method === \"POST\" && FREE_THROTTLED.has(path)) models();");
  check(kick > 0 && kick < router.indexOf("let userId = await userFromBearer(req);"),
    "V-5: the three save routes start the config refresh before auth, so it runs beside it");
  check(router.includes("userId = await userFromIngestKey(req, url, keyed);") && router.includes("}, keyed.profile);"),
    "V-5: the router hands the key's profile row to the guard");
}

// ---- V-6: a caption-wide set count reaches the slide exercises that have none ----
{
  const m = await load([
    "type Card = any;",
    span("const DOSE_WORDS = new Set([", "/**\n * Whether a stored card is fit to be served."),
    fnOr("function captionWideSets(", "function captionWideSets(_c: any) { return null; }"),
    fnOr("function applyCaptionSets(", "function applyCaptionSets(_c: any, _n: number) { return 0; }"),
    "export { captionWideSets, applyCaptionSets };",
  ]);
  const saved = JSON.parse(await fixture("ig-DGLrGidP-Mz-card.json"));
  const card = structuredClone(saved.card);
  const n = m.captionWideSets(saved.caption);
  const applied = n ? m.applyCaptionSets(card, n) : 0;
  const exs = card.blocks.flatMap((b: any) => b.exercises);
  check(n === 3, "V-6: DGLrGidP-Mz's caption ('✅3 sets') gives the whole post 3 sets (got " + n + ")");
  check(applied === 8 && exs.every((x: any) => x.sets === 3),
    "V-6: all 8 slide exercises take 3 sets (applied " + applied + "; " + exs.map((x: any) => x.name + " " + x.sets + "×" + x.reps).join(", ") + ")");
  check(exs.map((x: any) => x.reps).join() === saved.card.blocks.flatMap((b: any) => b.exercises).map((x: any) => x.reps).join(),
    "V-6: their reps are untouched");
  check(m.captionWideSets("ABS Weak LOWER Back Workout\n3 Sets x 15 Reps each Exercise") === 3, "V-6: '3 Sets x 15 Reps each Exercise' is 3 sets");
  check(m.captionWideSets("Sets: 4\nLegs") === 4, "V-6: 'Sets: 4' on its own line is 4");
  check(m.captionWideSets("3-4 sets") === null && m.captionWideSets("3 sets\n4 sets") === null,
    "V-6: a range, or two lines that disagree, give nothing");
  check(m.captionWideSets("Do 3 sets of squats and lunges") === null && m.captionWideSets("Leg day\nSquats 3 sets") === null && m.captionWideSets(null) === null,
    "V-6: a line with a movement on it is the caption's own plan, not a post-wide count");
  const mixed = {
    blocks: [
      { type: "straight", rounds: null, exercises: [
        { name: "Row", sets: 4, reps: "8", evidence: { source: "carousel" } },
        { name: "Curl", sets: null, reps: "12", evidence: { source: "carousel" } },
        { name: "Squat", sets: null, reps: "10", evidence: { source: "caption" } },
      ] },
      { type: "circuit", rounds: 3, exercises: [{ name: "Burpee", sets: null, reps: "10", evidence: { source: "carousel" } }] },
      { type: "straight", rounds: 2, exercises: [{ name: "Plank", sets: null, reps: null, evidence: { source: "carousel" } }] },
    ],
  };
  check(m.applyCaptionSets(mixed, 3) === 1 && mixed.blocks[0].exercises.map((x: any) => x.sets).join() === "4,3," &&
    mixed.blocks[1].exercises[0].sets === null && mixed.blocks[2].exercises[0].sets === null,
    "V-6: only slide exercises with no sets of their own, in straight blocks without rounds");
  const build = fn("async function buildCard(");
  check(/stampVision\(\);\s*\n\s*console\.log\("vision: coverage"[^\n]*\n\s*const wide = captionWideSets\(meta\.caption\);\s*\n\s*const widened = wide \? applyCaptionSets\(card, wide\) : 0;/.test(build),
    "V-6: buildCard applies it once the slides are merged, inside the carousel pass");
}

console.log = say.log; console.error = say.error;
if (failures.length) {
  console.error("FAIL " + failures.length + " of " + checks + " verification-finding checks:\n  " + failures.join("\n  "));
  Deno.exit(1);
}
console.log("PASS " + checks + " verification-finding checks (V-1, V-2, V-3, V-5, V-6); offline, no production writes.");
