// Spotter — outbound request guard (SSRF).
//
// Every URL this function fetches originates from something a user posted or from
// a page that user's link pointed at. Without a filter, "save this link" is a
// request to fetch an arbitrary address from inside Supabase's network — the
// metadata endpoint at 169.254.169.254, a loopback admin port, an RFC1918 host.
//
// The load-bearing part is that the check runs on EVERY redirect hop, not just on
// what the user typed. A public hostname that answers 302 -> http://169.254.169.254/
// defeats a first-hop-only check completely, and that is the actual attack path.

// `url` is the address to actually fetch, which is not always the one passed in:
// an http:// link to an arbitrary site comes back as its https:// form, with
// `upgraded` set so a caller can tell "the site has no https" from "the site is
// down" when that fetch fails.
export type UrlCheck =
  | { ok: true; url: URL; upgraded?: boolean }
  | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (h.includes(":")) return true;                 // IPv6 literal
  if (/^\d+$/.test(h)) return true;                 // decimal    (2130706433)
  if (/^0[xX][0-9a-fA-F]+$/.test(h)) return true;   // hex        (0x7f000001)
  if (/^[0-9a-fA-FxX.]+$/.test(h) && /^[0-9]/.test(h) && h.includes(".")) {
    // dotted numeric in any base: 127.0.0.1, 0177.0.0.1, 0x7f.0.0.1
    return h.split(".").every((p) => p !== "" && /^(0[xX][0-9a-fA-F]+|\d+)$/.test(p));
  }
  return false;
}

/**
 * An IPv6 address as its eight 16-bit groups, or null when it is not one. Handles
 * `::` compression, a dotted IPv4 tail (`::ffff:1.2.3.4`, `64:ff9b::10.0.0.1`),
 * leading zeros and a zone id (`fe80::1%eth0`). Every spelling of one address
 * comes out the same, so the ranges below are judged on bits, not on text.
 */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!s.includes(":")) return null;
  const tail = s.slice(s.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = tail.split(".");
    if (v4.length !== 4 || !v4.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
    const n = v4.map(Number);
    s = s.slice(0, s.length - tail.length) + ((n[0] << 8) | n[1]).toString(16) + ":" + ((n[2] << 8) | n[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** The IPv4 address carried in two 16-bit groups, dotted. */
function v4From(hi: number, lo: number): string {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** True for loopback, link-local, RFC1918 and the neighbouring reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (a.includes(":")) {
    const g = parseIPv6(a);
    // Something that looks like IPv6 and does not parse is refused, not waved on.
    if (!g) return true;
    const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
    // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (mapped):
    // the embedded IPv4 address decides — ::1 is 0.0.0.1, which is "this host".
    if (zero(0, 6) || (zero(0, 5) && g[5] === 0xffff)) return isPrivateAddress(v4From(g[6], g[7]));
    // ::ffff:0:a.b.c.d (IPv4-translated) and 64:ff9b::/96 (NAT64): same rule.
    if ((zero(0, 4) && g[4] === 0xffff && g[5] === 0) || (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6))) {
      return isPrivateAddress(v4From(g[6], g[7]));
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;   // 64:ff9b:1::/48 local NAT64
    if (g[0] === 0x2002) return isPrivateAddress(v4From(g[1], g[2])); // 6to4 carries its IPv4 address
    if (g[0] === 0x2001 && g[1] === 0) return true;                   // Teredo 2001::/32
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;              // documentation
    if (g[0] === 0x0100 && zero(1, 4)) return true;                   // 100::/64 discard
    if ((g[0] & 0xfe00) === 0xfc00) return true;                      // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true;                      // fe80::/10 link local
    if ((g[0] & 0xffc0) === 0xfec0) return true;                      // fec0::/10 site local
    if ((g[0] & 0xff00) === 0xff00) return true;                      // ff00::/8 multicast
    return false;
  }

  const p = a.split(".");
  if (p.length !== 4) return false;
  const n = p.map((x) => parseInt(x, 10));
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return false;
  const [b0, b1] = n;

  if (b0 === 0) return true;                                  // 0.0.0.0/8 "this host"
  if (b0 === 10) return true;                                 // RFC1918
  if (b0 === 127) return true;                                // loopback
  if (b0 === 169 && b1 === 254) return true;                  // link-local / cloud metadata
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;        // RFC1918
  if (b0 === 192 && b1 === 168) return true;                  // RFC1918
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;       // CGNAT
  if (b0 === 192 && b1 === 0) return true;                    // 192.0.0.0/24 protocol assignments
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;    // benchmarking
  if (b0 >= 224) return true;                                 // multicast + reserved 240/4
  return false;
}

/**
 * Static validation — protocol, credentials, port, and hostname shape. Runs on
 * every URL before it is fetched and again on every redirect target.
 */
export function checkUrl(raw: string | URL): UrlCheck {
  let u: URL;
  try { u = raw instanceof URL ? raw : new URL(raw); } catch { return { ok: false, reason: "not a url" }; }

  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "protocol " + u.protocol };
  if (u.username || u.password) return { ok: false, reason: "credentials in url" };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "port " + u.port };

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "no host" };
  if (host === "localhost") return { ok: false, reason: "localhost" };
  for (const s of BLOCKED_SUFFIXES) if (host.endsWith(s)) return { ok: false, reason: "internal suffix " + s };

  // Literal IPs are rejected wholesale: a real workout link is never one, and
  // allowing them means enumerating every notation an address can be written in.
  if (isIpLiteral(host)) return { ok: false, reason: "ip literal host" };

  // nip.io / sslip.io style wildcard DNS smuggles an address into a name
  const embedded = host.match(/(?:^|[.-])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:[.-]|$)/);
  if (embedded && isPrivateAddress(embedded.slice(1, 5).join("."))) {
    return { ok: false, reason: "private address embedded in hostname" };
  }

  return { ok: true, url: u };
}

// Hosts whose DNS belongs to the platforms themselves (and our own Supabase
// project, which serves our own signed storage URLs). A user can put any URL in front of us, but
// nobody outside these companies can point one of these names at 10.0.0.1, so a
// resolve-then-fetch race buys an attacker nothing here and these paths keep the
// rules they have always had: http or https on 80/443, DNS checked when the
// runtime has a resolver.
//
// Everything else is somebody's own domain, and somebody's own domain can answer
// the guard's lookup with a public address and the fetch's lookup a second later
// with a private one. The guard and fetch() resolve separately and nothing here
// can make them share an answer, so for those hosts the defence is TLS instead:
// https on 443 only, where the certificate check fails on any internal host the
// name is re-pointed at. And no resolver, or no answer, is a refusal rather than a
// pass, because the DNS half is then the only thing between a name and the network.
const PLATFORM_SUFFIXES = [
  "tiktok.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu", "tiktokcdn.com", "tiktokcdn-us.com",
  "tiktokcdn-eu.com", "ttwstatic.com", "ibyteimg.com", "byteimg.com", "ibytedtos.com", "muscdn.com",
  "instagram.com", "cdninstagram.com", "fbcdn.net",
  "youtube.com", "youtu.be", "ytimg.com", "googlevideo.com", "ggpht.com", "youtube-nocookie.com",
];

// Our own project, by its exact host — not every name under supabase.co, which
// is every Supabase customer's. Read from SUPABASE_URL at load (the edge runtime
// always has it); a harness without env access names it with useProjectHost.
let projectHost = hostOf((() => {
  try { return (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.("SUPABASE_URL") ?? ""; }
  catch { return ""; }
})());

function hostOf(url: string): string {
  try { return url ? new URL(url).hostname.toLowerCase().replace(/\.$/, "") : ""; } catch { return ""; }
}

/** The project whose storage host counts as a platform host (see projectHost). */
export function useProjectHost(url: string): void {
  projectHost = hostOf(url);
}

/** True for a host on the fixed platform list (exact name or a subdomain of one), or our own project. */
export function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (projectHost && h === projectHost) return true;
  return PLATFORM_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}

// Deno.resolveDns is not part of every Deno-compatible runtime. Checked per call
// (a typeof is free) so the answer can never go stale; production logs "on" at
// every cold start (index.ts), and a runtime without it now refuses non-platform
// hosts instead of waving them through.
export function dnsAvailable(): boolean {
  const d = (globalThis as { Deno?: { resolveDns?: unknown } }).Deno;
  return typeof d?.resolveDns === "function";
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((res) => { t = setTimeout(() => res(null), ms); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Every A and AAAA answer for the host, or null when the runtime has no resolver
 * or neither lookup produced one. An IPv4-only host fails its AAAA lookup, so one
 * answered lookup is enough; none is "could not resolve".
 */
async function resolveAll(hostname: string): Promise<string[] | null> {
  if (!dnsAvailable()) return null;
  const resolveDns = (globalThis as unknown as {
    Deno: { resolveDns: (h: string, t: string) => Promise<string[]> };
  }).Deno.resolveDns;

  // Both record types at once. Sequentially this is two DNS round trips on the
  // critical path of every save, and the answers are independent — the guard needs
  // to see both, not one after the other.
  const lookups = await Promise.all(["A", "AAAA"].map((type) =>
    // withTimeout already swallows failures, so neither of these can reject and
    // leave the other's rejection unobserved.
    withTimeout(resolveDns(hostname, type).catch(() => null as unknown as string[]), 2500)
  ));
  const all: string[] = [];
  for (const answers of lookups) if (Array.isArray(answers)) all.push(...answers);
  return all.length ? all : null;
}

/**
 * Resolve the host and report whether any answer is a private address.
 * Fails OPEN when the runtime has no resolver or the lookup errors; used only for
 * the platform hosts above, whose names nobody else can re-point. Fails CLOSED the
 * moment a private answer comes back.
 */
export async function hostResolvesPrivate(hostname: string): Promise<boolean> {
  const answers = await resolveAll(hostname);
  return !!answers && answers.some((ip) => isPrivateAddress(ip));
}

/**
 * Static checks plus a DNS check. This is what callers should use, and the URL it
 * returns is the one to fetch.
 */
export async function assertPublicUrl(raw: string | URL): Promise<UrlCheck> {
  const c = checkUrl(raw);
  if (!c.ok) return c;

  if (isPlatformHost(c.url.hostname)) {
    if (await hostResolvesPrivate(c.url.hostname)) {
      return { ok: false, reason: "host resolves to a private address" };
    }
    return c;
  }

  // Anyone's own domain. An http:// link is tried as https:// — most sites answer
  // both — and only ever fetched that way.
  const url = new URL(c.url.toString());
  const upgraded = url.protocol === "http:";
  if (upgraded) url.protocol = "https:";
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    return { ok: false, reason: "only https on port 443 is fetched for this host" };
  }
  const answers = await resolveAll(url.hostname);
  if (!answers) return { ok: false, reason: "host could not be resolved" };
  if (answers.some((ip) => isPrivateAddress(ip))) {
    return { ok: false, reason: "host resolves to a private address" };
  }
  return { ok: true, url, upgraded };
}

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super("blocked url " + url + ": " + reason);
    this.name = "BlockedUrlError";
  }
}

/**
 * fetch() with redirects followed by hand so every hop is validated. Using the
 * built-in redirect:"follow" is the bug: the browser-style redirect chase happens
 * below our checks, so only the first URL is ever seen.
 */
export async function safeFetch(
  target: string | URL,
  init: RequestInit = {},
  maxHops = 5,
): Promise<Response> {
  let current = String(target);
  for (let hop = 0; hop <= maxHops; hop++) {
    const check = await assertPublicUrl(current);
    if (!check.ok) throw new BlockedUrlError(current, check.reason);

    let r: Response;
    try {
      r = await fetch(check.url.toString(), { ...init, redirect: "manual" });
    } catch (e) {
      // The https form of an http:// link did not answer. That is the site having
      // no https, and the link is refused rather than read over plain http.
      if (check.upgraded) throw new BlockedUrlError(current, "no https answer for an http link");
      throw e;
    }
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) return r;

    await r.body?.cancel();
    try { current = new URL(loc, check.url).toString(); } catch { throw new BlockedUrlError(loc, "bad redirect target"); }
  }
  throw new BlockedUrlError(current, "too many redirects");
}
