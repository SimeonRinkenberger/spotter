// Card-size covers (storeThumb): the fit, the header walk that decides what may be
// re-encoded, the re-encode itself, and the order and headers of the two uploads.
// Run: deno run --allow-read --allow-env tools/cover-check.ts — exits non-zero on failure.
//
// Everything is synthetic and in memory: the JPEGs are made here with the same
// codec, the platform CDN and Storage are a mocked fetch, and DNS answers a public
// address so the outbound guard lets the mock through. Nothing touches a network.
Deno.env.set("SUPABASE_URL", "https://check.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "check-not-a-jwt");
const SECRET = "check-worker-secret-0123456789abcdef";
Deno.env.set("WORKER_SECRET", SECRET);
// index.ts ends in Deno.serve(handler): keep the handler, so the route is driven
// through the same path matching a real request goes through.
let serve: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: unknown }).serve = (...a: unknown[]) => {
  serve = a.find((x) => typeof x === "function") as typeof serve;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {},
    addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 } };
};
(Deno as unknown as { resolveDns: unknown }).resolveDns = (_h: string, t: string) =>
  Promise.resolve(t === "A" ? ["93.184.216.34"] : []);
const quiet = console.log; console.log = () => {};
const S = await import("../supabase/functions/spotter/index.ts");
const jpeg = (await import("npm:jpeg-js@0.4.4")).default;
console.log = quiet;

let failures = 0, checks = 0;
function check(name: string, cond: boolean, detail = "") {
  checks++;
  if (!cond) { failures++; console.log("FAIL  " + name + (detail ? "  — " + detail : "")); }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, JSON.stringify(got) === JSON.stringify(want), "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}

// A frame with real detail in it (a sweep plus a checker), so a re-encode has
// something to lose and the byte saving is not a flat-colour accident.
function frame(w: number, h: number): Uint8Array<ArrayBuffer> {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, c = ((x >> 3) + (y >> 3)) & 1;
    d[o] = (x * 255 / w) | 0; d[o + 1] = (y * 255 / h) | 0; d[o + 2] = c ? 200 : 40; d[o + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data: d, width: w, height: h }, 95).data);
}
// The same JPEG with one more segment right after SOI.
function withSegment(b: Uint8Array, marker: number, payload: number[]): Uint8Array {
  const len = payload.length + 2;
  return new Uint8Array([0xFF, 0xD8, 0xFF, marker, len >> 8, len & 255, ...payload, ...b.subarray(2)]);
}
// Exif APP1 with IFD0 holding one Orientation entry, big- or little-endian.
function exif(orientation: number | null, le = false): number[] {
  const u16 = (v: number) => le ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const u32 = (v: number) => le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const entries = orientation === null ? [] : [...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0];
  return [0x45, 0x78, 0x69, 0x66, 0, 0, ...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(42), ...u32(8),
    ...u16(entries.length ? 1 : 0), ...entries, ...u32(0)];
}

// ---------- the fit ----------
eq("2160x3840 fills a 640-wide 4:5 tile at 640x1138", S.coverFit(2160, 3840), { w: 640, h: 1138 });
eq("1440x2560 -> 640x1138", S.coverFit(1440, 2560), { w: 640, h: 1138 });
eq("a 4:5 photo post 1890x2362 -> 640x800", S.coverFit(1890, 2362), { w: 640, h: 800 });
eq("a landscape 1920x1080 is sized by the tile's height, 800", S.coverFit(1920, 1080), { w: 1422, h: 800 });
eq("YouTube's 480x360 is never enlarged", S.coverFit(480, 360), null);
eq("Instagram's 512x640 is left alone", S.coverFit(512, 640), null);
eq("within a fifth of the target (760 wide) is not worth a re-encode", S.coverFit(760, 1351), null);
eq("over 12 MP is refused, not decoded", S.coverFit(4000, 4000), null);

// ---------- the header walk ----------
const big = frame(1440, 2560);
eq("a plain JPEG's size is read off its frame header", S.plainJpegSize(big), { w: 1440, h: 2560 });
eq("Exif orientation 1 is plain (TikTok's 1233x1764 covers carry it)", S.plainJpegSize(withSegment(big, 0xE1, exif(1))), { w: 1440, h: 2560 });
eq("Exif with no orientation tag is plain", S.plainJpegSize(withSegment(big, 0xE1, exif(null, true))), { w: 1440, h: 2560 });
eq("little-endian Exif orientation 1 is plain", S.plainJpegSize(withSegment(big, 0xE1, exif(1, true))), { w: 1440, h: 2560 });
eq("Exif orientation 6 (turned) keeps the original", S.plainJpegSize(withSegment(big, 0xE1, exif(6))), null);
eq("XMP in APP1 keeps the original", S.plainJpegSize(withSegment(big, 0xE1, [...new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x/>")])), null);
eq("an ICC profile keeps the original", S.plainJpegSize(withSegment(big, 0xE2, [...new TextEncoder().encode("ICC_PROFILE\0\x01\x01xxxx")])), null);
eq("a PNG is not a JPEG", S.plainJpegSize(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10, 0, 0, 0, 0])), null);
eq("a truncated header is not read past its end", S.plainJpegSize(big.subarray(0, 30)), null);

// ---------- the re-encode ----------
const small = S.shrinkCover(big);
check("a 1440x2560 cover is re-encoded", small !== null);
if (small) {
  const d = jpeg.decode(small, { useTArray: true });
  eq("at the fitted size", [d.width, d.height], [640, 1138]);
  check("and at most four fifths of the bytes", small.byteLength <= big.byteLength * 0.8, small.byteLength + " of " + big.byteLength);
  // Colour lands where it was: the mean of each channel over a block matches the
  // mean over the same area of the decoded original (an area average, not a
  // shifted point sample, and no colour cast from the round trip).
  const src = jpeg.decode(big, { useTArray: true });
  const mean = (img: { data: Uint8Array; width: number }, x0: number, y0: number, w: number, h: number, c: number) => {
    let t = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) t += img.data[(y * img.width + x) * 4 + c];
    return t / (w * h);
  };
  const k = 1440 / 640;
  for (const [bx, by] of [[64, 64], [320, 569], [560, 1000]]) {
    for (let c = 0; c < 3; c++) {
      const a = mean(d, bx, by, 32, 32, c), b = mean(src, Math.round(bx * k), Math.round(by * k), Math.round(32 * k), Math.round(32 * k), c);
      check(`block ${bx},${by} channel ${c} keeps its colour`, Math.abs(a - b) <= 2.5, a.toFixed(1) + " vs " + b.toFixed(1));
    }
  }
}
eq("a cover already small enough comes back null", S.shrinkCover(frame(600, 1066)), null);
eq("a turned cover comes back null", S.shrinkCover(withSegment(big, 0xE1, exif(8))), null);

// ---------- storeThumb and /api/worker/cover: what goes up, where, in what order ----------
// Storage is a Map behind a mocked fetch; the kick to /api/worker/cover is handed
// to the function's own handler, as the platform would hand it to a new isolate.
type Put = { name: string; type: string; cache: string; bytes: number };
const puts: Put[] = [], kicks: { secret: string; body: string }[] = [];
const bucket = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string; cache: string }>();
const cdn = new Map<string, Uint8Array<ArrayBuffer>>([["https://cdn.example.com/big.jpg", big], ["https://cdn.example.com/small.jpg", frame(512, 640)]]);
const pending: Promise<unknown>[] = [];
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const u = new URL(req.url);
  if (cdn.has(u.href)) return new Response(cdn.get(u.href)!, { headers: { "content-type": "image/jpeg" } });
  if (u.hostname === "check.invalid" && u.pathname.startsWith("/storage/v1/object/thumbs/")) {
    const name = decodeURIComponent(u.pathname.slice("/storage/v1/object/thumbs/".length));
    if (req.method === "GET") {
      const o = bucket.get(name);
      return o ? new Response(o.bytes, { headers: { "content-type": o.type, "cache-control": o.cache, "content-length": String(o.bytes.byteLength) } })
        : new Response("{}", { status: 400 });
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    const put = { name, type: req.headers.get("content-type") ?? "", cache: req.headers.get("cache-control") ?? "", bytes: bytes.byteLength };
    puts.push(put); bucket.set(name, { bytes, type: put.type, cache: put.cache });
    return new Response("{}", { status: 200 });
  }
  if (u.hostname === "check.invalid" && u.pathname === "/functions/v1/spotter/api/worker/cover") {
    const body = await req.text();
    kicks.push({ secret: req.headers.get("x-worker-secret") ?? "", body });
    const run = serve!(new Request(req.url, { method: "POST", headers: req.headers, body }));
    pending.push(run);
    return await run;
  }
  return new Response("no", { status: 404 });
}) as typeof fetch;
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 5)); await Promise.all(pending); };
const route = (body: unknown, secret: string | null) => serve!(new Request("https://check.invalid/functions/v1/spotter/api/worker/cover", {
  method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-worker-secret": secret }) },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));

let url = await S.storeThumb("tt-1", "https://cdn.example.com/big.jpg", "tiktok");
eq("the thumb_url is the same name it always was", url, "https://check.invalid/storage/v1/object/public/thumbs/tt-1.jpg");
eq("storeThumb itself uploads the original only, uncached", puts.map((p) => [p.name, p.cache, p.bytes]), [["tt-1.jpg", "no-cache", big.byteLength]]);
await settle();
eq("and kicks /api/worker/cover with the secret and the name, nothing else",
  kicks.map((k) => [k.secret === SECRET, JSON.parse(k.body)]), [[true, { name: "tt-1.jpg" }]]);
eq("TikTok: the original first, uncached; then, from the cover isolate, the small copy with a week's max-age",
  puts.map((p) => [p.name, p.cache, p.type]), [["tt-1.jpg", "no-cache", "image/jpeg"], ["tt-1.jpg", "max-age=604800", "image/jpeg"]]);
check("the second upload is the small one", puts.length === 2 && puts[1].bytes < puts[0].bytes * 0.8, JSON.stringify(puts));

puts.length = 0; kicks.length = 0;
url = await S.storeThumb("web-abc", "https://cdn.example.com/big.jpg", "web");
await settle();
eq("a web page's picture goes up whole, once, cacheable, and nothing is kicked",
  [puts.map((p) => [p.name, p.cache, p.bytes]), kicks.length], [[["web-abc.jpg", "max-age=604800", big.byteLength]], 0]);

puts.length = 0; kicks.length = 0;
url = await S.storeThumb("DAbc", "https://cdn.example.com/small.jpg", "instagram");
await settle();
eq("a cover already at tile size goes up once, cacheable, and nothing is kicked", [puts.map((p) => [p.name, p.cache]), kicks.length], [[["DAbc.jpg", "max-age=604800"]], 0]);

puts.length = 0; kicks.length = 0;
url = await S.storeThumb("tt-2", "https://cdn.example.com/missing.jpg", "tiktok");
eq("a cover that will not download stores nothing, kicks nothing and answers null", [url, puts.length, kicks.length], [null, 0, 0]);

// ---------- the route's gate ----------
bucket.set("tt-9.jpg", { bytes: big, type: "image/jpeg", cache: "no-cache" });
puts.length = 0;
for (const [label, secret] of [["no secret", null], ["a wrong secret", "x".repeat(SECRET.length)], ["an empty secret", ""], ["a prefix of it", SECRET.slice(0, -1)]] as const) {
  const r = await route({ name: "tt-9.jpg" }, secret);
  eq(`${label} is a 404, as if the route did not exist`, [r.status, (await r.json()).message], [404, "Not found"]);
}
for (const bad of ["../tt-9.jpg", "a/b.jpg", "..", "../../uploads/x.jpg", "tt-9.jpg/..", "%2e%2e/tt-9.jpg", "tt-9.png", "tt-9", ".jpg", "tt 9.jpg", "x".repeat(65) + ".jpg"]) {
  const r = await route({ name: bad }, SECRET);
  eq(`the name ${JSON.stringify(bad)} is a 400`, r.status, 400);
}
for (const body of ["not json", { name: 7 }, { url: "https://cdn.example.com/big.jpg" }, {}]) {
  const r = await route(body, SECRET);
  eq(`a body of ${JSON.stringify(body)} is a 400`, r.status, 400);
}
eq("nothing was read or written for any refused request", puts.length, 0);

// ---------- the route's work ----------
let r = await route({ name: "tt-9.jpg" }, SECRET);
let o = await r.json();
eq("a stored big cover is shrunk in place", [r.status, o.action, o.size, o.before], [200, "shrunk", "1440x2560", big.byteLength]);
check("its CPU time is reported", typeof o.cpu_ms === "number" && o.cpu_ms >= 0, JSON.stringify(o));
eq("and written back under the same name with the week's header", puts.map((p) => [p.name, p.cache]), [["tt-9.jpg", "max-age=604800"]]);
puts.length = 0;
r = await route({ name: "tt-9.jpg" }, SECRET); o = await r.json();
eq("a second run finds it small and cacheable and writes nothing", [o.action, o.recached, puts.length], ["kept", false, 0]);
r = await route({ name: "tt-404.jpg" }, SECRET); o = await r.json();
eq("a name with no object is 'missing', and nothing is written", [r.status, o.action, puts.length], [200, "missing", 0]);
bucket.set("web-9.jpg", { bytes: big, type: "image/jpeg", cache: "no-cache" });
r = await route({ name: "web-9.jpg" }, SECRET); o = await r.json();
eq("a web page's picture is never re-encoded, only made cacheable", [o.action, o.cpu_ms, puts.map((p) => [p.name, p.cache, p.bytes])],
  ["kept", 0, [["web-9.jpg", "max-age=604800", big.byteLength]]]);
puts.length = 0;
bucket.set("tt-8.jpg", { bytes: withSegment(big, 0xE1, exif(6)) as Uint8Array<ArrayBuffer>, type: "image/jpeg", cache: "no-cache" });
r = await route({ name: "tt-8.jpg" }, SECRET); o = await r.json();
eq("a turned cover is kept whole and made cacheable", [o.action, puts.map((p) => [p.name, p.cache])], ["kept", [["tt-8.jpg", "max-age=604800"]]]);
puts.length = 0;
bucket.set("tt-7.jpg", { bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, 10, 0, 5, 160, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xFF, 0xD9]), type: "image/jpeg", cache: "max-age=604800" });
r = await route({ name: "tt-7.jpg" }, SECRET); o = await r.json();
eq("a cover that will not decode is kept, and nothing throws", [r.status, o.action, puts.length], [200, "kept", 0]);

console.log(failures ? `\n${failures} of ${checks} cover checks FAILED` : `PASS ${checks} cover checks: fit, header walk, re-encode, upload order and headers, the cover route's gate and work`);
Deno.exit(failures ? 1 : 0);
