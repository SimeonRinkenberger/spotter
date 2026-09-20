import { AppleGrantError, createAppleGrants } from "../supabase/functions/spotter/apple-auth.ts";
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const uid = "11111111-1111-4111-8111-111111111111";
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const key = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))));
const env: Record<string, string> = { SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret-test", APPLE_TEAM_ID: "TEAM", APPLE_AUTH_KEY_ID: "KEY", APPLE_AUTH_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----` };
const decode = (part: string) => JSON.parse(atob(part.replace(/-/g,"+").replace(/_/g,"/")));
let cases = 0;
async function scenario(options: { sub?: string; apple?: boolean; saveFails?: boolean; revokeFails?: boolean; grants?: any[] } = {}) {
  const calls: string[] = [];
  let saved: any;
  const service = createAppleGrants(name => env[name], async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("appleid.apple.com")) {
      const form = new URLSearchParams(init?.body as URLSearchParams);
      const jwt = form.get("client_secret")!.split(".");
      const claims = decode(jwt[1]);
      assert(decode(jwt[0]).kid === "KEY", "key id");
      assert(claims.iss === "TEAM" && claims.sub === "app.spotter.dev" && claims.aud === "https://appleid.apple.com", "client secret claims");
      assert(claims.exp - claims.iat === 300, "short secret expiration");
      assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
        Uint8Array.from(atob(jwt[2].replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0)),
        new TextEncoder().encode(jwt.slice(0,2).join("."))), "signature verifies");
      if (url.endsWith("/token")) {
        assert(form.get("code") === "one-time-code" && form.get("grant_type") === "authorization_code", "code exchange");
        assert(!form.has("redirect_uri"), "native request has no redirect URI");
        return Response.json({ refresh_token: "private-refresh", id_token: `header.${btoa(JSON.stringify({ iss: "https://appleid.apple.com", aud: "app.spotter.dev", sub: options.sub ?? "apple-user", exp: Date.now()/1000+300 }))}.signature` });
      }
      assert(form.get("token_type_hint") === "refresh_token", "revokes refresh token");
      return new Response(null, { status: options.revokeFails ? 503 : 200 });
    }
    const headers = new Headers(init?.headers);
    assert(headers.get("apikey") === "secret-test" && !headers.has("authorization"), "new Supabase key uses apikey only");
    if (url.includes("/auth/v1/admin/users/")) return Response.json({ identities: options.apple === false ? [] : [{ provider: "apple", identity_data: { sub: "apple-user" } }] });
    if (init?.method === "POST") {
      saved = JSON.parse(String(init.body));
      return new Response(null, { status: options.saveFails ? 500 : 201 });
    }
    if (init?.method === "PATCH") return new Response(null, { status: 204 });
    return Response.json(options.grants ?? []);
  });
  return { service, calls, saved: () => saved };
}
async function rejects(work: Promise<unknown>, code: string) {
  try { await work; throw new Error("expected rejection"); }
  catch (error) { assert(error instanceof AppleGrantError && error.code === code, `expected ${code}`); }
}
{
  const t = await scenario(); await t.service.remember(uid, "one-time-code");
  assert(t.saved().user_id === uid && t.saved().refresh_token === "private-refresh", "grant belongs to authenticated user"); cases++;
}
{
  const t = await scenario({ sub: "other-apple-user" });
  await rejects(t.service.remember(uid, "one-time-code"), "apple_identity_mismatch");
  assert(!t.saved() && !t.calls.some(x => x.endsWith("/revoke")), "foreign grant neither stored nor revoked"); cases++;
}
{
  const t = await scenario({ apple: false });
  await rejects(t.service.remember(uid, "one-time-code"), "apple_not_linked");
  assert(!t.calls.some(x => x.includes("appleid")), "non-Apple account cannot exchange another grant"); cases++;
}
{
  const t = await scenario({ saveFails: true });
  await rejects(t.service.remember(uid, "one-time-code"), "apple_unavailable");
  assert(t.calls.some(x => x.endsWith("/revoke")), "orphan grant revoked after failed storage"); cases++;
}
{
  const t = await scenario();
  await rejects(t.service.remember(uid, "one-time-code", "attacker.app"), "bad_apple_grant");
  assert(!t.calls.length, "unknown client id rejected before network");
  await rejects(t.service.forget(uid), "apple_reauthentication_required"); cases++;
}
{
  const t = await scenario({ apple: false }); await t.service.forget(uid);
  assert(!t.calls.some(x => x.includes("appleid")), "email-only deletion needs no Apple key"); cases++;
}
const grants = [
  { id: "22222222-2222-4222-8222-222222222222", client_id: "app.spotter.dev", refresh_token: "one", revoked_at: null },
  { id: "33333333-3333-4333-8333-333333333333", client_id: "app.spotter.dev", refresh_token: "two", revoked_at: null },
  { id: "44444444-4444-4444-8444-444444444444", client_id: "app.spotter.dev", refresh_token: "old", revoked_at: "2026-09-19" },
];
{
  const t = await scenario({ grants }); await t.service.forget(uid);
  assert(t.calls.filter(x => x.endsWith("/revoke")).length === 2, "all active grants revoked; acknowledged grants skipped");
  assert(t.calls.filter(x => x.startsWith("PATCH")).length === 2, "revocations acknowledged for retry"); cases++;
}
{
  const t = await scenario({ grants, revokeFails: true });
  await rejects(t.service.forget(uid), "apple_unavailable");
  assert(!t.calls.some(x => x.startsWith("PATCH")), "failed revoke is never acknowledged"); cases++;
}
const migration = await Deno.readTextFile(new URL("../supabase/migrations/20260919120000_apple_auth_tokens.sql", import.meta.url));
assert(migration.includes("enable row level security") && migration.includes("from public, anon, authenticated") && migration.includes("on delete cascade"), "tokens inaccessible to clients and erased with account");
console.log(`PASS ${cases} Apple grant scenarios: real JWT signatures, account binding, private storage, failed storage cleanup, revocation, retries and ordinary account deletion.`);
