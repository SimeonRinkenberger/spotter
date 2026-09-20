// Apple grants are server-only. Supabase verifies the login ID token; a separate
// code exchange retains the refresh token needed to revoke Apple on erasure.
// Never log request bodies, Apple responses, or database error bodies here.
export class AppleGrantError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Environment = (name: string) => string | undefined;
type Identity = { provider?: string; id?: string; identity_data?: { sub?: string } };
type Grant = { id: string; client_id: string; refresh_token: string; revoked_at: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const encode = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

export function createAppleGrants(env: Environment, request: typeof fetch = fetch) {
  function failure() {
    return new AppleGrantError(503, "apple_unavailable", "Could not finish the Apple connection. Please try again in a moment.");
  }
  async function service(path: string, init: RequestInit = {}) {
    const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
    if (key.split(".").length === 3) headers.authorization = `Bearer ${key}`;
    const response = await request(`${env("SUPABASE_URL")}${path}`, {
      ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw failure(); }
    return response;
  }
  async function identities(userId: string): Promise<Identity[]> {
    if (!UUID.test(userId)) throw new AppleGrantError(400, "bad_account", "Bad account.");
    const response = await service(`/auth/v1/admin/users/${userId}`);
    const user = await response.json();
    return (user.identities ?? []).filter((identity: Identity) => identity.provider === "apple");
  }
  function allowedClient(clientId: string) {
    return (env("APPLE_CLIENT_IDS") ?? "app.spotter.dev").split(",").map(x => x.trim()).includes(clientId);
  }
  async function secret(clientId: string) {
    const kid = env("APPLE_AUTH_KEY_ID"), team = env("APPLE_TEAM_ID");
    const pem = (env("APPLE_AUTH_KEY_P8") ?? "").replace(/\\n/g, "\n");
    if (!kid || !team || !pem || !allowedClient(clientId)) throw failure();
    try {
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${encode({ iss: team, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId })}`;
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));
      return `${unsigned}.${base64url(new Uint8Array(signature))}`;
    } catch { throw failure(); }
  }
  async function apple(endpoint: "token" | "revoke", clientId: string, values: Record<string, string>) {
    const response = await request(`https://appleid.apple.com/auth/${endpoint}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: await secret(clientId), ...values }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw failure(); }
    return response;
  }
  async function revoke(clientId: string, token: string) {
    const response = await apple("revoke", clientId, { token, token_type_hint: "refresh_token" });
    await response.body?.cancel();
  }
  async function remember(userId: string, code: unknown, clientId = "app.spotter.dev") {
    if (typeof code !== "string" || !code || code.length > 4096 || !allowedClient(clientId)) {
      throw new AppleGrantError(400, "bad_apple_grant", "Sign in with Apple again to finish connecting your account.");
    }
    const linked = await identities(userId);
    if (!linked.length) throw new AppleGrantError(403, "apple_not_linked", "Apple is not linked to this account.");
    const response = await apple("token", clientId, { code, grant_type: "authorization_code" });
    const tokens = await response.json();
    // These claims come directly from Apple's HTTPS token endpoint, never from
    // a client-supplied JWT. Match them to Supabase's verified Apple identity.
    let claims;
    try {
      const part = tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      claims = JSON.parse(atob(part + "=".repeat((4 - part.length % 4) % 4)));
    } catch { throw failure(); }
    if (claims.iss !== "https://appleid.apple.com" || claims.aud !== clientId ||
        !(claims.exp > Date.now() / 1000) ||
        !linked.some(identity => (identity.identity_data?.sub ?? identity.id) === claims.sub)) {
      throw new AppleGrantError(403, "apple_identity_mismatch", "Apple did not match the signed-in account. Please sign in again.");
    }
    if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw failure();
    // Keep each grant until erasure. Replacing a token could lose an older
    // authorization; all retained grants are revoked before the auth row goes.
    try {
      const saved = await service("/rest/v1/apple_auth_tokens", {
        method: "POST", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, client_id: clientId, refresh_token: tokens.refresh_token }),
      });
      await saved.body?.cancel();
    } catch {
      // If storage fails, avoid leaving a newly issued grant behind unrecorded.
      await revoke(clientId, tokens.refresh_token).catch(() => {});
      throw failure();
    }
  }
  async function forget(userId: string) {
    const linked = await identities(userId);
    const response = await service(`/rest/v1/apple_auth_tokens?user_id=eq.${userId}&select=id,client_id,refresh_token,revoked_at`);
    const grants: Grant[] = await response.json();
    if (linked.length && !grants.length) {
      throw new AppleGrantError(409, "apple_reauthentication_required", "Sign out, then sign in with Apple in the Spotter iPhone app before deleting this account. This lets Spotter disconnect your Apple authorization.");
    }
    for (const grant of grants) {
      if (grant.revoked_at) continue;
      await revoke(grant.client_id, grant.refresh_token);
      // Preserve an acknowledgement if a later deletion step fails. Apple also
      // treats a repeat revocation of an already invalidated token as success.
      const saved = await service(`/rest/v1/apple_auth_tokens?id=eq.${grant.id}&user_id=eq.${userId}`, {
        method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      await saved.body?.cancel();
    }
  }
  return { remember, forget };
}

const grants = createAppleGrants(name => Deno.env.get(name));
export const rememberAppleGrant = grants.remember;
export const forgetAppleGrant = grants.forget;
