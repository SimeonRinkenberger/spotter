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

if (failures.length) {
  console.error("FAIL " + failures.length + " of " + checks + " share checks:\n  " + failures.join("\n  "));
  Deno.exit(1);
}
console.log("PASS " + checks + " share checks; offline, no production writes.");
