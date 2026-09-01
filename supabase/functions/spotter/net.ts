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

export type UrlCheck =
  | { ok: true; url: URL }
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

/** True for loopback, link-local, RFC1918 and the neighbouring reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (a.includes(":")) {
    if (a === "::" || a === "::1") return true;
    // IPv4-mapped (::ffff:127.0.0.1) — judge the embedded v4 address
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(a)) return true;              // fc00::/7 unique local
    if (/^fe[89ab]/.test(a)) return true;           // fe80::/10 link local
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

// Deno.resolveDns is not part of every Deno-compatible runtime. Probe once so a
// runtime without it degrades to the static checks rather than throwing per hop.
let dnsProbe: boolean | null = null;
export function dnsAvailable(): boolean {
  if (dnsProbe === null) {
    const d = (globalThis as { Deno?: { resolveDns?: unknown } }).Deno;
    dnsProbe = typeof d?.resolveDns === "function";
  }
  return dnsProbe;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t = 0;
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
 * Resolve the host and reject if any answer is a private address.
 * Fails OPEN when the runtime has no resolver or the lookup errors — the static
 * checks still stand, and a DNS hiccup must not break a legitimate save.
 * Fails CLOSED the moment a private answer comes back.
 */
export async function hostResolvesPrivate(hostname: string): Promise<boolean> {
  if (!dnsAvailable()) return false;
  const resolveDns = (globalThis as unknown as {
    Deno: { resolveDns: (h: string, t: string) => Promise<string[]> };
  }).Deno.resolveDns;

  for (const type of ["A", "AAAA"]) {
    const answers = await withTimeout(
      resolveDns(hostname, type).catch(() => null as unknown as string[]),
      2500,
    );
    if (!answers) continue;
    for (const ip of answers) if (isPrivateAddress(ip)) return true;
  }
  return false;
}

/** Static checks plus a DNS check. This is what callers should use. */
export async function assertPublicUrl(raw: string | URL): Promise<UrlCheck> {
  const c = checkUrl(raw);
  if (!c.ok) return c;
  if (await hostResolvesPrivate(c.url.hostname)) {
    return { ok: false, reason: "host resolves to a private address" };
  }
  return c;
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

    const r = await fetch(check.url.toString(), { ...init, redirect: "manual" });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) return r;

    await r.body?.cancel();
    try { current = new URL(loc, check.url).toString(); } catch { throw new BlockedUrlError(loc, "bad redirect target"); }
  }
  throw new BlockedUrlError(current, "too many redirects");
}
