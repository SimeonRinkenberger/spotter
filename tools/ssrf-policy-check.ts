// The outbound guard's policy, against the real net.ts and the real resolveShare.
// No network: Deno.resolveDns and fetch are stubbed per case.
//
//   deno run --allow-read tools/ssrf-policy-check.ts
//
// Three runtimes are simulated: a resolver whose answer changes between the
// guard's lookup and the next one, a site that answers only over plain http, and
// a runtime with no resolver at all (or one that errors). Platform hosts
// (TikTok / Instagram / YouTube CDNs, our own Supabase host) must behave exactly
// as before in all three.
import * as net from "../supabase/functions/spotter/net.ts";

// Our own project's host is read from SUPABASE_URL in production; this harness
// runs without env access, so it names it (older net.ts had no such hook).
const PROJECT = "https://mtzevoxxpsktmrbbuxva.supabase.co";
const useProject = (m: unknown) => (m as { useProjectHost?: (u: string) => void }).useProjectHost?.(PROJECT);
useProject(net);

const failures: string[] = [];
let passed = 0;
function check(ok: unknown, what: string) {
  if (ok) passed++;
  else { failures.push(what); console.error("FAIL " + what); }
}

type Resolver = (host: string, type: string) => Promise<string[]>;
const D = Deno as unknown as { resolveDns?: Resolver };
const realResolve = D.resolveDns;
const realFetch = globalThis.fetch;
const seen: string[] = [];

function useResolver(r: Resolver | undefined) {
  if (r) D.resolveDns = r; else delete D.resolveDns;
}
function useFetch(f: (url: string, init?: RequestInit) => Promise<Response>) {
  seen.length = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    return f(url, init);
  }) as typeof fetch;
}
const onlyHttps443 = () => seen.every((u) => { const x = new URL(u); return x.protocol === "https:" && (x.port === "" || x.port === "443"); });
const ok200 = () => Promise.resolve(new Response("<html><title>t</title></html>", { status: 200 }));
const PUBLIC = async (_h: string, t: string) => t === "A" ? ["93.184.216.34"] : ["2606:2800:220:1:248:1893:25c8:1946"];
const IPV4_ONLY: Resolver = async (_h, t) => { if (t === "A") return ["93.184.216.34"]; throw new Error("NotFound"); };

try {
  // ---- 1. rebind: public to the guard, private on the next lookup ----
  {
    let lookups = 0;
    useResolver(async (_h, t) => {
      lookups++;
      if (lookups <= 2) return t === "A" ? ["93.184.216.34"] : [];
      return t === "A" ? ["10.0.0.5"] : [];
    });
    useFetch(async () => new Response(null, { status: 302, headers: { location: "/next" } }));
    let err: unknown = null;
    try { await net.safeFetch("http://rebind.example/page"); } catch (e) { err = e; }
    check(seen.length >= 1, "rebind: the first hop is fetched");
    check(onlyHttps443(), "rebind: a name the guard resolved publicly is only ever fetched over https on 443 (fetched: " + seen.join(", ") + ")");
    check(err instanceof net.BlockedUrlError && /private/.test(String(err)), "rebind: the second hop's private answer is refused");
    check(seen.length === 1, "rebind: nothing is fetched after the private answer");
  }
  {
    // A redirect to plain http on the same rebinding name is upgraded, never followed as http.
    useResolver(PUBLIC);
    let n = 0;
    useFetch(async () => ++n === 1
      ? new Response(null, { status: 301, headers: { location: "http://rebind.example/elsewhere" } })
      : ok200());
    const r = await net.safeFetch("https://rebind.example/start");
    check(r.status === 200 && onlyHttps443(), "rebind: an https page redirecting to http:// is followed as https:// only (" + seen.join(", ") + ")");
  }
  {
    useResolver(PUBLIC);
    const c = await net.assertPublicUrl("https://example.org:80/x");
    check(!c.ok, "a non-platform host on port 80 over https is refused");
  }

  // ---- 2. http-only host: tried as https, refused when that fails ----
  {
    useResolver(PUBLIC);
    useFetch(async (u) => u.startsWith("https:") ? Promise.reject(new TypeError("tls: no https here")) : ok200());
    let err: unknown = null, status = 0;
    try { status = (await net.safeFetch("http://plain.example/workout")).status; } catch (e) { err = e; }
    check(status !== 200, "http-only: the page is not read over plain http");
    check(err instanceof net.BlockedUrlError && /no https/.test(String(err)), "http-only: refused with a legible reason");
    check(seen.length === 1 && seen[0] === "https://plain.example/workout", "http-only: exactly one attempt, the https form (" + seen.join(", ") + ")");
  }
  {
    // The same link on a site that does answer https is read, as https.
    useResolver(PUBLIC);
    useFetch(ok200);
    const r = await net.safeFetch("http://both.example/workout?x=1");
    check(r.status === 200 && seen[0] === "https://both.example/workout?x=1", "http link to a site with https: read over https");
    const c = await net.assertPublicUrl("http://both.example/workout");
    check(c.ok && c.url.protocol === "https:" && c.upgraded === true, "assertPublicUrl returns the https form and says it upgraded");
  }

  // ---- 3. no resolver / resolver errors: non-platform fails closed ----
  {
    // A fresh copy of net.ts, loaded after the resolver is gone, so the module
    // meets a resolver-less runtime from its first call exactly as a cold start would.
    useResolver(undefined);
    const fresh = await import("data:application/typescript," + encodeURIComponent(
      await Deno.readTextFile(new URL("../supabase/functions/spotter/net.ts", import.meta.url)))) as typeof net;
    useProject(fresh);
    check(!fresh.dnsAvailable(), "the simulated runtime has no resolver");
    const web = await fresh.assertPublicUrl("https://www.example.org/program");
    check(!web.ok && /could not be resolved/.test(web.reason), "no resolver: a non-platform host is refused");
    useFetch(ok200);
    let err: unknown = null;
    try { await fresh.safeFetch("https://www.example.org/program"); } catch (e) { err = e; }
    check((err as Error)?.name === "BlockedUrlError" && seen.length === 0, "no resolver: safeFetch makes no request to a non-platform host");
    const tt = await fresh.assertPublicUrl("https://www.tiktok.com/@coach/video/7400000000000000000");
    check(tt.ok, "no resolver: TikTok still passes (platform path unchanged)");
    const ig = await fresh.assertPublicUrl("https://scontent-lax3-1.cdninstagram.com/v/t51/abc.jpg");
    check(ig.ok, "no resolver: the Instagram CDN still passes");
    const yt = await fresh.assertPublicUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    check(yt.ok, "no resolver: the YouTube CDN still passes");
    const sb = await fresh.assertPublicUrl("https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/sign/uploads/x.jpg?token=t");
    check(sb.ok, "no resolver: our own signed storage URL still passes");
  }
  {
    useResolver(async () => { throw new Error("SERVFAIL"); });
    const web = await net.assertPublicUrl("https://www.example.org/program");
    check(!web.ok, "resolver errors on both lookups: a non-platform host is refused");
    const tt = await net.assertPublicUrl("https://vm.tiktok.com/ZMabc/");
    check(tt.ok, "resolver errors: a TikTok short link still passes");
  }
  {
    useResolver(IPV4_ONLY);
    const web = await net.assertPublicUrl("https://ipv4only.example/p");
    check(web.ok, "an IPv4-only site (AAAA lookup fails, A answers) is fetched");
  }

  // ---- platform paths keep their old rules ----
  {
    useResolver(PUBLIC);
    const c = await net.assertPublicUrl("http://www.tiktok.com/@a/video/1");
    check(c.ok && c.url.protocol === "http:", "platform http:// link is not rewritten");
    useResolver(async () => ["127.0.0.1"]);
    const p = await net.assertPublicUrl("https://www.youtube.com/watch?v=abc");
    check(!p.ok, "platform host resolving private is still refused");
    const isPlatformHost = (net as { isPlatformHost?: (h: string) => boolean }).isPlatformHost ?? (() => false);
    check(!isPlatformHost("tiktok.com.evil.example") && !isPlatformHost("eviltiktok.com") &&
      isPlatformHost("p16-sign.tiktokcdn-us.com") && isPlatformHost("youtu.be"),
      "the platform list matches whole labels only");
  }

  // ---- R-8: every IPv6 spelling of a private address, and our own project only ----
  {
    const priv = [
      "64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254", "64:ff9b::7f00:1", "64:ff9b:1::1",
      "2002:7f00:1::1", "2002:a00:1::", "2002:a9fe:a9fe::",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1",
      "fec0::1", "fed0:0:0:0:0:0:0:1",
      "::7f00:1", "::127.0.0.1", "::a9fe:a9fe", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001",
      "0:0:0:0:0:ffff:7f00:1", "::ffff:7f00:1", "::FFFF:A9FE:A9FE", "::ffff:0:7f00:1", "::ffff:10.0.0.1",
      "fe80::1%eth0", "[fe80::1]", "ff02::1", "fc00::1", "2001:db8::1", "::",
      "1:2:3:4:5:6:7:8:9", "::1::", "zz::1",
    ];
    const bad = priv.filter((ip) => !net.isPrivateAddress(ip));
    check(!bad.length, "R-8: private in every spelling (NAT64, 6to4, Teredo, site-local, IPv4-compatible/mapped in hex and uncompressed; unparsable refused) — missed: " + bad.join(", "));
    const pub = ["2606:2800:220:1:248:1893:25c8:1946", "64:ff9b::808:808", "2002:808:808::1", "::ffff:8.8.8.8",
      "2a03:2880:f12f:83:face:b00c::25de", "93.184.216.34"];
    const wrong = pub.filter((ip) => net.isPrivateAddress(ip));
    check(!wrong.length, "R-8: public addresses stay public, embedded ones judged by their IPv4 (" + wrong.join(", ") + ")");
    useResolver(async (_h, t) => t === "A" ? [] : ["64:ff9b::a9fe:a9fe"]);
    const nat = await net.assertPublicUrl("https://nat64.example/p");
    check(!nat.ok, "R-8: a name answering with a NAT64 address of the metadata host is refused");
    check(!net.isPlatformHost("evil.supabase.co") && !net.isPlatformHost("supabase.co") &&
      !net.isPlatformHost("x.mtzevoxxpsktmrbbuxva.supabase.co"),
      "R-8: somebody else's supabase.co project is not a platform host");
    check(net.isPlatformHost("mtzevoxxpsktmrbbuxva.supabase.co") && net.isPlatformHost("MTZEVOXXPSKTMRBBUXVA.supabase.co."),
      "R-8: our own project's host still is");
    useResolver(undefined);
    const other = await net.assertPublicUrl("http://evil.supabase.co/storage/v1/object/x");
    check(!other.ok, "R-8: another project's host is held to the non-platform rules (no resolver: refused)");
  }

  // ---- static checks are unchanged ----
  {
    useResolver(PUBLIC);
    for (const bad of ["http://169.254.169.254/latest/", "http://127.0.0.1/", "http://[::1]/", "http://localhost/",
      "https://10.0.0.1.nip.io/", "https://user:pw@example.org/", "file:///etc/passwd", "https://example.org:8443/"]) {
      const c = await net.assertPublicUrl(bad);
      check(!c.ok, "still refused: " + bad);
    }
  }

  // ---- resolveShare, the ingest entry point, on the same three runtimes ----
  {
    const src = await Deno.readTextFile(new URL("../supabase/functions/spotter/index.ts", import.meta.url));
    const start = src.indexOf('const BLOCKED = Symbol("blocked");');
    const end = src.indexOf("// ---------- AI chain ----------");
    const netSrc = await Deno.readTextFile(new URL("../supabase/functions/spotter/net.ts", import.meta.url));
    // Each load gets its own copy of net.ts, so the no-resolver load below meets a
    // runtime that never had one, as a cold start in such a runtime would.
    let loads = 0;
    const load = async (): Promise<Record<string, unknown> | null> => {
      const netUrl = "data:application/typescript," + encodeURIComponent(netSrc + "\n// copy " + (++loads));
      const mod = `
import { assertPublicUrl } from ${JSON.stringify(netUrl.replaceAll("'", "%27"))};
type Parsed = { platform: string; shortcode: string; kind: string; clean: string };
const DESKTOP_UA = 'test';
function matchInstagram(_u: string): Parsed | null { return null; }
function matchUrl(u: string): Parsed | null {
  const m = u.match(/tiktok\\.com\\/@[^/]+\\/video\\/(\\d+)/);
  return m ? { platform: 'tiktok', shortcode: 'tt-' + m[1], kind: 'video', clean: u.split('?')[0] } : null;
}
${src.slice(start, end)}
export { resolveShare, BLOCKED };
export const INSECURE_OR_NULL = typeof INSECURE === 'undefined' ? null : INSECURE;`;
      try { return await import("data:application/typescript," + encodeURIComponent(mod)); }
      catch (e) { check(false, "resolveShare slice loads: " + String(e).slice(0, 160)); return null; }
    };
    useResolver(PUBLIC);
    const m = await load();
    if (m) {
      const resolveShare = m.resolveShare as (raw: string) => Promise<unknown>;
      useResolver(PUBLIC);
      useFetch(async (u) => u.startsWith("https:") ? Promise.reject(new TypeError("no tls")) : ok200());
      const plain = await resolveShare("check this http://plain.example/legs");
      check(m.INSECURE_OR_NULL !== null && plain === m.INSECURE_OR_NULL,
        "ingest: an http-only page is refused with its own answer (got " + String(typeof plain === "symbol" ? plain.toString() : JSON.stringify(plain)) + ")");
      check(onlyHttps443(), "ingest: the http-only page was never requested over http (" + seen.join(", ") + ")");

      useFetch(ok200);
      const both = await resolveShare("http://both.example/legs?utm_source=x") as { platform?: string; clean?: string };
      check(both?.platform === "web" && both.clean === "https://both.example/legs", "ingest: an http link to an https site becomes an https card (" + JSON.stringify(both) + ")");
      check(onlyHttps443(), "ingest: and it was only ever requested as https");

    }
    useResolver(undefined);
    const bare = await load();
    if (bare) {
      const resolveShare = bare.resolveShare as (raw: string) => Promise<unknown>;
      useFetch(ok200);
      const nodns = await resolveShare("https://www.example.org/legs");
      check(nodns === bare.BLOCKED && seen.length === 0, "ingest: no resolver refuses a web link before any request, with the existing blocked answer (fetched: " + seen.join(", ") + ")");
      const tt = await resolveShare("https://www.tiktok.com/@coach/video/7400000000000000001") as { platform?: string };
      check(tt?.platform === "tiktok", "ingest: no resolver leaves a TikTok save untouched");
    }
  }
} finally {
  if (realResolve) D.resolveDns = realResolve;
  globalThis.fetch = realFetch;
}

if (failures.length) {
  console.error("\n" + failures.length + " of " + (failures.length + passed) + " outbound-guard policy checks FAILED");
  Deno.exit(1);
}
console.log("PASS " + passed + " outbound-guard policy checks: rebind, http-only, no resolver, platform paths unchanged, ingest entry point");
