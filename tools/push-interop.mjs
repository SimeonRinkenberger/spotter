// The Node half of tools/push-harness.ts. Not run on its own — the Deno harness
// writes a fixture and spawns this with its path.
//
// Why it exists: RFC 8291 fails silently. A push service accepts any correctly
// FRAMED body and hands it to a browser that quietly cannot decrypt it, so an
// edge function with a wrong key schedule looks identical to a working one from
// the sending side — 201, every time, and a phone that never buzzes. The only
// honest test is a decryptor nobody on this side wrote, so the ciphertext
// push.ts produced is decrypted here by `http_ece`, which is the module the
// `web-push` npm package itself uses to encrypt every message it sends.
//
// It also checks the VAPID header both ways: the JWT push.ts signed is verified
// against the public key, and web-push is asked to build its own request for the
// same subscription with the same keys so the two can be compared.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ece = require("http_ece");
const webpush = require("web-push");

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}

const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b64u = (s) => Buffer.from(s, "base64url");

// The decryptor must be the one web-push itself depends on, or this proves
// nothing about interoperating with the real world.
const eceFrom = require.resolve("http_ece");
const eceViaWebPush = require.resolve("http_ece", { paths: [require.resolve("web-push")] });
check("the decryptor is web-push's own http_ece", eceFrom === eceViaWebPush,
  `${eceFrom} vs ${eceViaWebPush}`);

// ---------- the payload ----------

// The subscriber, rebuilt: http_ece wants a Node ECDH object because it calls
// getPublicKey() and computeSecret() on it.
const ua = crypto.createECDH("prime256v1");
ua.setPrivateKey(b64u(fx.uaPrivate));
check("the rebuilt subscriber key matches the one that was subscribed to",
  ua.getPublicKey().toString("base64url") === fx.p256dh);

let plain = null;
try {
  plain = ece.decrypt(b64u(fx.body), {
    version: "aes128gcm",
    privateKey: ua,
    authSecret: b64u(fx.auth),
  });
} catch (e) {
  check("http_ece decrypts what push.ts encrypted", false, String(e && e.message));
}
if (plain) {
  check("http_ece decrypts what push.ts encrypted", true);
  check("and gets back exactly the bytes that went in", plain.toString("utf8") === fx.payload,
    plain.toString("utf8"));
  const parsed = JSON.parse(plain.toString("utf8"));
  check("the notification carries a title, a tag and a url",
    typeof parsed.title === "string" && typeof parsed.tag === "string" &&
    typeof parsed.url === "string");
}

// The other direction: web-push builds a request for the same subscription with
// the same VAPID pair, and the same decrypt call reads it. If our body decrypts
// and theirs does not, the harness is testing itself rather than the standard.
const subscription = { endpoint: fx.endpoint, keys: { p256dh: fx.p256dh, auth: fx.auth } };
const theirs = webpush.generateRequestDetails(subscription, fx.payload, {
  vapidDetails: { subject: fx.subject, publicKey: fx.vapidPublic, privateKey: fx.vapidPrivate },
  contentEncoding: "aes128gcm",
});
const theirPlain = ece.decrypt(theirs.body, {
  version: "aes128gcm", privateKey: ua, authSecret: b64u(fx.auth),
});
check("the same call decrypts web-push's own body", theirPlain.toString("utf8") === fx.payload);
check("our body and web-push's differ only in the random parts (same length)",
  b64u(fx.body).length === theirs.body.length,
  `${b64u(fx.body).length} vs ${theirs.body.length}`);
check("both use the aes128gcm content encoding",
  theirs.headers["Content-Encoding"] === "aes128gcm");

// ---------- the VAPID header ----------

function parseVapid(header) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  if (!m) return null;
  const [head, body, sig] = m[1].split(".");
  return {
    key: m[2], head, body, sig,
    header: JSON.parse(b64u(head).toString("utf8")),
    claims: JSON.parse(b64u(body).toString("utf8")),
  };
}

const ours = parseVapid(fx.authorization);
check("the Authorization header is the vapid scheme with t= and k=", ours !== null, fx.authorization);
if (ours) {
  check("the JWT says ES256", ours.header.alg === "ES256" && ours.header.typ === "JWT");
  check("the audience is the push service's origin, not the endpoint",
    ours.claims.aud === new URL(fx.endpoint).origin, ours.claims.aud);
  check("the subject is the app, so a push service can find us",
    ours.claims.sub === fx.subject);
  const life = ours.claims.exp - Math.floor(Date.now() / 1000);
  check("the token expires within the 24 hour ceiling", life > 0 && life <= 86400, String(life));
  check("k= is the VAPID public key the browser subscribed with",
    ours.key === fx.vapidPublic);

  // The signature, verified with the public half — the check a push service makes.
  const pub = b64u(fx.vapidPublic);
  const key = crypto.createPublicKey({
    format: "jwk",
    key: {
      kty: "EC", crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
  });
  const verify = (sig, over) => crypto.verify(
    "sha256", Buffer.from(over), { key, dsaEncoding: "ieee-p1363" }, b64u(sig),
  );
  check("the ES256 signature verifies", verify(ours.sig, `${ours.head}.${ours.body}`));
  check("a tampered claim set does not",
    !verify(ours.sig, `${ours.head}.${Buffer.from('{"aud":"https://evil.example"}').toString("base64url")}`));

  const pkcs8 = parseVapid(fx.authorizationPkcs8);
  check("the PKCS#8 spelling of the key signs a valid token too",
    pkcs8 !== null && verify(pkcs8.sig, `${pkcs8.head}.${pkcs8.body}`));

  // web-push's own header for the same audience, as a shape check.
  const mine = parseVapid(`vapid ${theirs.headers.Authorization.replace(/^vapid /, "")}`);
  check("web-push builds the same header shape", mine !== null && mine.key === fx.vapidPublic);
  check("and the same audience", mine !== null && mine.claims.aud === ours.claims.aud);
}

console.log(`${checks} interop checks, ${checks - failures} passed`);
process.exit(failures ? 1 : 0);
