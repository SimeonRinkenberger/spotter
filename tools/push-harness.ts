// Battery for the two things in push.ts that nobody can see go wrong.
//
// Run: deno run --allow-env --allow-read --allow-write --allow-run tools/push-harness.ts
//      (exits non-zero on failure; needs `npm install` first for the Node half)
//
//   1. **The decision.** Whether a phone buzzes is a pure function of one row,
//      one user's week and one instant, and every rule in the design lives in
//      it: the hour in the user's own zone, one push a day, three a week, silence
//      for 24h after a session, nothing when the plan is empty, the at-risk push
//      once per week and never after 20:00. A bug here is a stranger's lock
//      screen at 3am, which is not a thing you find out about from a log.
//
//   2. **The encryption.** RFC 8291 has no forgiving failure: a push service
//      answers 201 to a correctly-framed message it cannot read, so a wrong key
//      schedule looks EXACTLY like a working one from this side. The only real
//      proof is somebody else's decryptor, so the ciphertext this code produces
//      is handed to Node and decrypted by `http_ece` — the library the `web-push`
//      package itself uses — in tools/push-interop.mjs. The VAPID JWT is verified
//      over there too, against web-push's own header for the same subscription.
//
// The env is set before the module is imported, which is why the import is
// dynamic: push.ts reads its Supabase pair at module load the way strava.ts does.

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
Deno.env.set("VAPID_SUBJECT", "https://simeonrinkenberger.github.io/spotter/");

// A throwaway VAPID pair, in the shape `web-push generate-vapid-keys` prints:
// the 65-byte public point and the bare 32-byte private scalar, both base64url.
// Generating it here rather than pasting one keeps a private key out of a public
// repository and exercises the import path the real secret will take.
const vapidPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
) as CryptoKeyPair;
const vapidPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey));
const vapidJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
const vapidPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", vapidPair.privateKey));

function toB64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const VAPID_PUBLIC = toB64u(vapidPublicRaw);
Deno.env.set("VAPID_PUBLIC_KEY", VAPID_PUBLIC);
Deno.env.set("VAPID_PRIVATE_KEY", vapidJwk.d!);

const P = await import("../supabase/functions/spotter/push.ts");

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}

// ---------- 1. the calendar ----------
//
// Every later answer is built on these three, and all three are bare-date
// arithmetic on purpose: a Date carrying a time of day through a DST weekend is
// how "the week starts on Monday" turns into "the week starts on Sunday at 23:00".

check("Monday is day 0", P.dowOf("2026-09-07") === 0);
check("Sunday is day 6", P.dowOf("2026-09-13") === 6);
check("a Wednesday belongs to its Monday", P.mondayKey("2026-09-09") === "2026-09-07");
check("a Sunday belongs to the Monday before it", P.mondayKey("2026-09-13") === "2026-09-07");
check("the week key crosses a month", P.mondayKey("2026-10-01") === "2026-09-28");
check("the week key crosses a year", P.mondayKey("2027-01-01") === "2026-12-28");
// 2026-03-08 is the US spring-forward Sunday and 2026-03-29 the European one.
check("spring forward does not move a week key (US)", P.mondayKey("2026-03-08") === "2026-03-02");
check("spring forward does not move a week key (EU)", P.mondayKey("2026-03-29") === "2026-03-23");

// ---------- 2. the hour a row belongs to ----------

check("17:30 lands on the 17:00 tick", P.hourFor(1050) === 17);
check("17:29 lands on the 17:00 tick", P.hourFor(1049) === 17);
check("17:31 lands on the 18:00 tick", P.hourFor(1051) === 18);
check("07:00 lands on the 07:00 tick", P.hourFor(420) === 7);
check("midnight lands on the 00:00 tick", P.hourFor(0) === 0);
// Rounding must never push a reminder into the next day: 23:45 is still tonight.
check("23:45 stays on the 23:00 tick", P.hourFor(1425) === 23);
check("a nonsense value is clamped, not thrown", P.hourFor(99999) === 23 && P.hourFor(-5) === 0);

// ---------- 3. the clock, in the user's own zone ----------

// 2026-09-07 22:00 UTC. Chicago is UTC-5 in September, Tokyo UTC+9, Kolkata
// UTC+5:30, Midway UTC-11 — one negative, one positive, one half-hour and one
// that is on a different DATE from UTC at that instant.
const inst = Date.UTC(2026, 8, 7, 22, 0, 0);
check("a negative offset reads local", P.localAt(inst, "America/Chicago").hour === 17);
check("a positive offset reads local and rolls the date",
  P.localAt(inst, "Asia/Tokyo").hour === 7 && P.localAt(inst, "Asia/Tokyo").ymd === "2026-09-08");
check("a half-hour zone keeps its minutes",
  P.localAt(inst, "Asia/Kolkata").hour === 3 && P.localAt(inst, "Asia/Kolkata").minute === 30);
check("a zone a day behind UTC reads its own date",
  P.localAt(inst, "Pacific/Midway").ymd === "2026-09-07" &&
  P.localAt(inst, "Pacific/Midway").hour === 11);
check("an unknown zone falls back to UTC rather than throwing",
  P.localAt(inst, "Mars/Olympus").hour === 22);

// The DST proof: 17:00 in Chicago is a DIFFERENT UTC instant either side of the
// spring-forward Sunday, and both must read as 17:00 local. If this ever fails,
// every user in a DST country gets their reminder an hour out twice a year.
check("17:00 local on the Saturday before spring forward",
  P.localAt(Date.UTC(2026, 2, 7, 23, 0), "America/Chicago").hour === 17);
check("17:00 local on the spring-forward Sunday itself",
  P.localAt(Date.UTC(2026, 2, 8, 22, 0), "America/Chicago").hour === 17);
check("17:00 local after the autumn fall back",
  P.localAt(Date.UTC(2026, 10, 1, 23, 0), "America/Chicago").hour === 17);
check("the hour that happens twice on fall-back day is still local 01:00",
  P.localAt(Date.UTC(2026, 10, 1, 6, 30), "America/Chicago").hour === 1 &&
  P.localAt(Date.UTC(2026, 10, 1, 7, 30), "America/Chicago").hour === 1);

// ---------- 4. the week, re-derived ----------

// Wednesday 2026-09-09: four days left counting today.
check("days left counts today", P.weekState([], [], 3, "2026-09-09").daysLeft === 5);
check("Monday has seven days left", P.weekState([], [], 3, "2026-09-07").daysLeft === 7);
check("Sunday has one day left", P.weekState([], [], 3, "2026-09-13").daysLeft === 1);

const twoDone = ["2026-09-07", "2026-09-08"];
check("sessions this week count toward the goal",
  P.weekState(twoDone, [], 3, "2026-09-09").done === 2);
check("last week's sessions do not",
  P.weekState(["2026-09-01"], [], 3, "2026-09-09").done === 0);
check("two sessions in one day count twice",
  P.weekState(["2026-09-08", "2026-09-08"], [], 3, "2026-09-09").done === 2);
check("the goal falls back to the plan's distinct days",
  P.weekState([], ["2026-09-07", "2026-09-09", "2026-09-11"], null, "2026-09-09").goal === 3);
check("a duplicated plan day is one day",
  P.weekState([], ["2026-09-07", "2026-09-07"], null, "2026-09-09").goal === 1);
check("with neither setting nor plan the goal is three",
  P.weekState([], [], null, "2026-09-09").goal === 3);
check("the setting beats the plan",
  P.weekState([], ["2026-09-07", "2026-09-09"], 5, "2026-09-09").goal === 5);

// At risk is exactly "needed === daysLeft": every remaining day must now carry a
// session. One short on Sunday is at risk; one short on Wednesday is not.
check("one short on Sunday is at risk",
  P.weekState(twoDone, [], 3, "2026-09-13").atRisk === true);
check("one short on Wednesday is not at risk",
  P.weekState(twoDone, [], 3, "2026-09-09").atRisk === false);
check("two short with two days left is at risk",
  P.weekState(["2026-09-07"], [], 3, "2026-09-12").atRisk === true);
check("a met goal is never at risk",
  P.weekState([...twoDone, "2026-09-09"], [], 3, "2026-09-13").atRisk === false);
check("an unreachable week is not at risk either",
  P.weekState([], [], 3, "2026-09-13").atRisk === false);

// The streak walks back from the week before this one, and a week exactly one
// short spends a freeze — once per rolling four weeks, twice on Plus.
const perfect: string[] = [];
for (let w = 1; w <= 6; w++) {
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.UTC(2026, 8, 7) - w * 7 * 86_400_000 + d * 86_400_000);
    perfect.push(day.toISOString().slice(0, 10));
  }
}
check("six clean weeks read as a streak of six",
  P.weekState(perfect, [], 3, "2026-09-09").streakWeeks === 6);
check("this week's own sessions extend the streak once the goal is met",
  P.weekState([...perfect, ...twoDone, "2026-09-09"], [], 3, "2026-09-09").streakWeeks === 7);
const oneShort = perfect.filter((d) => d !== perfect[2]);   // last week ends 2 of 3
check("a week one short spends a freeze and the streak survives",
  P.weekState(oneShort, [], 3, "2026-09-09").streakWeeks === 6);
const twoShort = perfect.filter((d, i) => i !== 1 && i !== 2);
check("a week two short breaks the streak",
  P.weekState(twoShort, [], 3, "2026-09-09").streakWeeks === 0);

// ---------- 5. the decision ----------

const BASE: P.Sub = {
  id: "11111111-2222-4333-8444-555555555555",
  user_id: "3f2a1c88-4d5e-4a1b-9c77-0b1e2d3f4a5b",
  endpoint: "https://push.example/abc",
  p256dh: "x", auth: "y",
  tz: "America/Chicago",
  remind_plan: true, remind_risk: true, remind_at: 1050,
  last_sent_at: null, sent_week: 0, week_key: null, risk_week: null,
};

const CTX: P.Ctx = {
  sessionDays: [], plannedDays: ["2026-09-09"],
  todayPlan: { title: "Push day", minutes: 42 },
  goal: 3, freeAllowance: 1, lastFinishMs: null,
};

// Wednesday 2026-09-09, 17:00 in Chicago.
const WED17 = Date.UTC(2026, 8, 9, 22, 0);
const sub = (o: Partial<P.Sub>): P.Sub => ({ ...BASE, ...o });
const ctx = (o: Partial<P.Ctx>): P.Ctx => ({ ...CTX, ...o });

const planDay = P.decide(BASE, CTX, WED17);
check("the plan-day reminder fires at the chosen hour", planDay.send === true);
check("the plan-day copy is the final string",
  planDay.send === true && planDay.kind === "plan" &&
  planDay.title === "Push day is on today's plan." && planDay.body === "42 minutes.",
  planDay.send ? `${planDay.title} / ${planDay.body}` : planDay.why);
check("a workout with no duration gets no invented second line",
  (() => {
    const d = P.decide(BASE, ctx({ todayPlan: { title: "Push day", minutes: null } }), WED17);
    return d.send === true && d.body === undefined;
  })());
check("the tag is fixed per kind so a repeat replaces rather than stacks",
  planDay.send === true && planDay.tag === "spotter-plan");

check("nothing fires an hour early", P.decide(BASE, CTX, Date.UTC(2026, 8, 9, 21, 0)).send === false);
check("nothing fires an hour late", P.decide(BASE, CTX, Date.UTC(2026, 8, 9, 23, 0)).send === false);
check("an empty plan day sends nothing",
  (() => {
    const d = P.decide(BASE, ctx({ todayPlan: null }), WED17);
    return d.send === false && d.why === "nothing planned today";
  })());
check("both switches off means never",
  P.decide(sub({ remind_plan: false, remind_risk: false }), CTX, WED17).send === false);
check("the plan switch off silences the plan reminder",
  P.decide(sub({ remind_plan: false }), CTX, WED17).send === false);

// The caps.
check("a session in the last 24h silences the day",
  (() => {
    const d = P.decide(BASE, ctx({ lastFinishMs: WED17 - 3 * 3600_000 }), WED17);
    return d.send === false && d.why === "trained in the last 24h";
  })());
check("a session 25 hours ago does not",
  P.decide(BASE, ctx({ lastFinishMs: WED17 - 25 * 3600_000 }), WED17).send === true);
check("one a day: a push already sent today blocks the next",
  (() => {
    const d = P.decide(sub({ last_sent_at: new Date(WED17 - 4 * 3600_000).toISOString() }), CTX, WED17);
    return d.send === false && d.why === "already sent today";
  })());
check("yesterday's push does not block today's",
  P.decide(sub({ last_sent_at: new Date(WED17 - 24 * 3600_000).toISOString() }), CTX, WED17).send === true);
check("three a week is a ceiling",
  (() => {
    const d = P.decide(sub({ sent_week: 3, week_key: "2026-09-07" }), CTX, WED17);
    return d.send === false && d.why === "three already this week";
  })());
check("a counter from another week is not this week's budget",
  P.decide(sub({ sent_week: 3, week_key: "2026-08-31" }), CTX, WED17).send === true);

// "One a day" is a promise about the user's day, not about 24 elapsed hours.
// Midway is 11 hours behind UTC, so its local day and UTC's disagree for half
// of every day — which is exactly where a UTC-day comparison would be wrong.
check("the daily cap is counted in local days, not UTC ones",
  (() => {
    const nowMs = Date.UTC(2026, 8, 8, 4, 0);            // 2026-09-07 17:00 in Midway
    const earlier = new Date(Date.UTC(2026, 8, 8, 0, 30)).toISOString();  // 13:30 the same local day
    const d = P.decide(sub({ tz: "Pacific/Midway", last_sent_at: earlier }), CTX, nowMs);
    return d.send === false && d.why === "already sent today";
  })());

// The at-risk reminder.
const SUN17 = Date.UTC(2026, 8, 13, 22, 0);              // Sunday 2026-09-13, 17:00 Chicago
const riskCtx = ctx({ sessionDays: [...perfect, ...twoDone], plannedDays: [], todayPlan: null });
const risk = P.decide(BASE, riskCtx, SUN17);
check("the at-risk reminder fires on the day the week runs out", risk.send === true);
check("the at-risk copy is the final string",
  risk.send === true && risk.kind === "risk" &&
  risk.title === "One session left this week." && risk.body === "Your streak is at 6.",
  risk.send ? `${risk.title} / ${risk.body}` : risk.why);
check("more than one left pluralises rather than lying",
  (() => {
    const d = P.decide(BASE, ctx({ sessionDays: ["2026-09-07"], plannedDays: [], todayPlan: null }),
      Date.UTC(2026, 8, 12, 22, 0));
    return d.send === true && d.title === "2 sessions left this week.";
  })());
check("a streak of zero is left unsaid rather than read as a scold",
  (() => {
    const d = P.decide(BASE, ctx({ sessionDays: twoDone, plannedDays: [], todayPlan: null }), SUN17);
    return d.send === true && d.body === undefined;
  })());
check("the at-risk reminder goes once per week, not once a day",
  P.decide(sub({ risk_week: "2026-09-07" }), riskCtx, SUN17).send === false);
check("the risk switch off silences it",
  P.decide(sub({ remind_risk: false }), riskCtx, SUN17).send === false);
check("a week that is not at risk sends nothing",
  P.decide(BASE, ctx({ sessionDays: [...perfect, ...twoDone, "2026-09-13"], plannedDays: [], todayPlan: null }),
    SUN17).send === false);

// Never after 20:00 local, and never silently never: a user who picked 21:30
// still gets the at-risk push, at 20:00, which is the last hour the design allows.
check("a 21:30 reminder time still gets the at-risk push, at 20:00",
  (() => {
    const late = sub({ remind_at: 1290 });                // 21:30 -> plan hour 22, risk hour 20
    const at20 = P.decide(late, riskCtx, Date.UTC(2026, 8, 14, 1, 0));  // 20:00 Chicago Sunday
    return at20.send === true && at20.kind === "risk";
  })());
check("nothing at all is sent after 20:00 except the plan reminder that asked for it",
  (() => {
    const late = sub({ remind_at: 1290 });
    const at22 = P.decide(late, riskCtx, Date.UTC(2026, 8, 14, 3, 0));  // 22:00 Chicago Sunday
    return at22.send === false;
  })());
check("at-risk wins a tie with the plan reminder — the week does not come round again",
  (() => {
    const both = P.decide(BASE, ctx({
      sessionDays: [...perfect, ...twoDone], plannedDays: ["2026-09-13"],
      todayPlan: { title: "Push day", minutes: 42 },
    }), SUN17);
    return both.send === true && both.kind === "risk";
  })());

// The copy rules from the design, enforced rather than remembered.
const BANNED = ["don't", "dont", "failed", "lost", "last chance", "missed", "!", "streak is at 0"];
const strings = [planDay, risk].flatMap((d) => d.send ? [d.title, d.body ?? ""] : []);
for (const s of strings) {
  for (const bad of BANNED) {
    check(`no "${bad}" in "${s}"`, s.toLowerCase().indexOf(bad) < 0);
  }
}

// ---------- 6. the encryption, proved by somebody else's decryptor ----------

// A subscriber, generated the way a browser generates one: a P-256 key pair and
// sixteen random bytes of auth secret.
const uaPair = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
) as CryptoKeyPair;
const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey));
const uaJwk = await crypto.subtle.exportKey("jwk", uaPair.privateKey);
const uaAuth = crypto.getRandomValues(new Uint8Array(16));

const p256dh = toB64u(uaPublic);
const authB64 = toB64u(uaAuth);
const payload = JSON.stringify({
  title: "Push day is on today's plan.", body: "42 minutes.",
  tag: "spotter-plan", url: "https://simeonrinkenberger.github.io/spotter/",
});

const body1 = await P.encryptPayload(p256dh, authB64, new TextEncoder().encode(payload));
const body2 = await P.encryptPayload(p256dh, authB64, new TextEncoder().encode(payload));
check("the aes128gcm header carries a 65-byte key id",
  body1[20] === 65 && body1.length > 21 + 65);
check("the record size field is the four bytes after the salt",
  new DataView(body1.buffer).getUint32(16) === 4096);
check("the ephemeral key is uncompressed point form", body1[21] === 0x04);
// Same message, same subscriber, different bytes: a repeated salt and ephemeral
// key would repeat the AES-GCM nonce, which leaks both plaintexts.
check("two sends of the same message do not repeat the salt",
  toB64u(body1.slice(0, 16)) !== toB64u(body2.slice(0, 16)));
check("two sends do not repeat the ephemeral key",
  toB64u(body1.slice(21, 86)) !== toB64u(body2.slice(21, 86)));

const endpoint = "https://fcm.googleapis.com/fcm/send/fake-endpoint-for-the-harness";
const auth32 = await P.vapidAuth(endpoint);
// The same header again from the PKCS#8 spelling of the same private key: the
// two shapes a VAPID pair is saved in must both work, because which one the
// owner pasted is not discoverable from here.
Deno.env.set("VAPID_PRIVATE_KEY", toB64u(vapidPkcs8));
const authPkcs8 = await P.vapidAuth(endpoint);
Deno.env.set("VAPID_PRIVATE_KEY", vapidJwk.d!);
check("a PKCS#8 private key signs too, and for the same key",
  authPkcs8.split(", k=")[1] === VAPID_PUBLIC && authPkcs8.indexOf("vapid t=") === 0);

const fixture = {
  p256dh, auth: authB64, uaPrivate: uaJwk.d,
  vapidPublic: VAPID_PUBLIC, vapidPrivate: vapidJwk.d,
  subject: "https://simeonrinkenberger.github.io/spotter/",
  endpoint, payload,
  body: toB64u(body1),
  authorization: auth32,
  authorizationPkcs8: authPkcs8,
};

const file = await Deno.makeTempFile({ prefix: "spotter-push-", suffix: ".json" });
await Deno.writeTextFile(file, JSON.stringify(fixture));
const node = new Deno.Command("node", {
  args: ["tools/push-interop.mjs", file],
  stdout: "piped", stderr: "piped",
});
const out = await node.output();
await Deno.remove(file).catch(() => {});
const stdout = new TextDecoder().decode(out.stdout).trim();
const stderr = new TextDecoder().decode(out.stderr).trim();
if (stdout) console.log(stdout);
check("the Node interop half passed", out.code === 0, stderr || `exit ${out.code}`);
// Its own checks are counted here so the totals mean what they say.
const counted = /(\d+) interop checks/.exec(stdout);
if (counted) checks += Number(counted[1]);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) Deno.exit(1);
