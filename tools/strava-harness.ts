// Battery for the three pieces of strava.ts whose bugs would be invisible until
// somebody's connection quietly broke or somebody else's Strava got written to.
// Run: deno run --allow-env tools/strava-harness.ts   — exits non-zero on failure.
//
//   1. The signed state. It is the ONLY thing tying the browser that started the
//      OAuth hop to the browser that comes back, because Strava arrives at the
//      callback with no Supabase token. A state that could be forged, replayed
//      from last week, or edited to name a different user id would be an
//      account-takeover primitive, so every one of those is a case here.
//   2. The activity body. Nothing local can POST to Strava — no secrets here, and
//      localhost cannot reach the function — so the composition is checked
//      directly instead: uniform sets collapse, mixed sets do not, holds read as
//      seconds, weights convert to the user's unit, and the permalink is there
//      because it is the only way the share card is reachable from an activity.
//   3. The compare-and-set on refresh. Strava rotates the refresh token on every
//      refresh and invalidates the old one at once, so the isolate that loses a
//      race must take the token that WAS stored, never the one it just minted.
//
// The env is set before the module is imported, which is why the import is
// dynamic: strava.ts reads its Supabase pair at module load, the way billing.ts
// does, and the three Strava secrets on the call that needs them.

Deno.env.set("SUPABASE_URL", "https://harness.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "harness-not-a-jwt");
Deno.env.set("STRAVA_CLIENT_ID", "123456");
Deno.env.set("STRAVA_CLIENT_SECRET", "harness-client-secret");
Deno.env.set("STRAVA_STATE_SECRET", "harness-state-secret-aaaaaaaaaaaaaaaa");

const S = await import("../supabase/functions/spotter/strava.ts");

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.log("FAIL  " + name + (detail === undefined ? "" : "  — " + detail));
}

const USER = "3f2a1c88-4d5e-4a1b-9c77-0b1e2d3f4a5b";
const OTHER = "11111111-2222-4333-8444-555555555555";

// ---------- 1. the signed state ----------

const now = Date.now();
const good = await S.signState(USER, now);

check("state round-trips to the user who made it", (await S.verifyState(good, now)) === USER);

check("the state is not the bare user id on the wire",
  good.indexOf(USER) < 0, good);

check("two states for the same user in the same millisecond differ (nonce)",
  (await S.signState(USER, now)) !== (await S.signState(USER, now)));

// The whole point: swap the payload for one naming a different account and keep
// the signature. This is the attack the HMAC exists to stop.
const forgedPayload = (await S.signState(OTHER, now)).split(".")[0] + "." + good.split(".")[1];
check("a payload swapped under a valid signature is refused",
  (await S.verifyState(forgedPayload, now)) === null);

// Flip one character of the payload. base64url decoding still succeeds, so this
// has to fail on the signature and not on a parse error.
const chars = good.split(".");
const flipped = chars[0].slice(0, -1) + (chars[0].slice(-1) === "A" ? "B" : "A") + "." + chars[1];
check("a tampered payload is refused", (await S.verifyState(flipped, now)) === null);

const badSig = chars[0] + "." + (chars[1].slice(0, -1) + (chars[1].slice(-1) === "A" ? "B" : "A"));
check("a tampered signature is refused", (await S.verifyState(badSig, now)) === null);

check("a state one millisecond past its expiry is refused",
  (await S.verifyState(good, now + 10 * 60_000 + 1)) === null);
check("a state inside its ten minutes is still good",
  (await S.verifyState(good, now + 9 * 60_000)) === USER);

check("garbage is refused, not thrown on", (await S.verifyState("not-a-state", now)) === null);
check("an empty state is refused", (await S.verifyState("", now)) === null);
check("a payload with no signature is refused", (await S.verifyState(chars[0], now)) === null);

// A state signed with a different secret must not verify under ours — this is
// what would happen if the owner rotated STRAVA_STATE_SECRET mid-flight, and the
// right answer is "start again", not "trust it".
Deno.env.set("STRAVA_STATE_SECRET", "a-completely-different-state-secret");
const otherSecretState = await S.signState(USER, now);
Deno.env.set("STRAVA_STATE_SECRET", "harness-state-secret-aaaaaaaaaaaaaaaa");
check("a state signed with another secret is refused",
  (await S.verifyState(otherSecretState, now)) === null);

// ---------- 2. the activity body ----------

const LOG = {
  workout_title: "Push Day",
  duration_seconds: 2730,
  entries: [
    // Uniform: three identical sets must collapse to "3 x 12 @ 24 lb".
    { name: "Goblet Squat", sets: [
      { reps: 12, weight: 24, unit: "lb", done: true },
      { reps: 12, weight: 24, unit: "lb", done: true },
      { reps: 12, weight: 24, unit: "lb", done: true },
    ] },
    // Mixed: a drop set must be spelled out, because "3 x 12" would be a lie.
    { name: "Bench Press", sets: [
      { reps: 10, weight: 60, unit: "lb", done: true },
      { reps: 8, weight: 60, unit: "lb", done: true },
      { reps: 6, weight: 50, unit: "lb", done: true },
    ] },
    // Bodyweight: no weight at all, so no "@" and no unit.
    { name: "Push-up", sets: [{ reps: 20, done: true }, { reps: 20, done: true }] },
    // A hold logs seconds and no reps, and must not count toward volume.
    { name: "Plank", sets: [{ seconds: 45, done: true }, { seconds: 45, done: true }] },
    // Written in kg by a user who has since switched to lb.
    { name: "Row", sets: [{ reps: 10, weight: 20, unit: "kg", done: true }] },
  ],
};

const body = S.activityBody(LOG, {
  startLocal: "2026-09-04T18:32:00Z",
  unit: "lb",
  prs: [{ name: "Goblet Squat", weight: 24, unit: "lb", reps: 12 }],
});

check("name is the workout title", body.name === "Push Day", body.name);
check("sport_type is WeightTraining", body.sport_type === "WeightTraining", body.sport_type);
check("no deprecated `type` field is sent", !("type" in body));
check("no distance is sent for a lifting session", !("distance" in body));
check("start_date_local is the client's local ISO verbatim",
  body.start_date_local === "2026-09-04T18:32:00Z", body.start_date_local);
check("elapsed_time is the duration in whole seconds",
  body.elapsed_time === "2730", body.elapsed_time);

const d = body.description;
check("uniform sets collapse", d.indexOf("Goblet Squat  3 x 12 @ 24 lb") >= 0, d);
check("mixed sets are spelled out", d.indexOf("Bench Press  10 @ 60, 8 @ 60, 6 @ 50 lb") >= 0, d);
check("bodyweight sets carry no weight and no unit",
  d.indexOf("Push-up  2 x 20\n") >= 0, d);
check("holds read as seconds", d.indexOf("Plank  2 x 45s") >= 0, d);
check("a kg set is converted into the user's unit", d.indexOf("Row  1 x 10 @ 44.1 lb") >= 0, d);
// 3x12x24 + 10x60 + 8x60 + 6x50 + 1x10x44.1 = 864 + 600 + 480 + 300 + 441 = 2685
check("volume is the sum of reps x weight, holds excluded",
  d.indexOf("Volume 2,685 lb") >= 0, d);
check("a PR the client sent is named", d.indexOf("New best: Goblet Squat 24 lb x 12") >= 0, d);
check("the permalink is in the description — no photo endpoint is open to us",
  d.indexOf("Logged with Spotter — https://simeonrinkenberger.github.io/spotter/") >= 0, d);
check("the description stays inside a sane cap", d.length <= 4000, String(d.length));

const kg = S.activityBody(LOG, { startLocal: "2026-09-04T18:32:00Z", unit: "kg" });
check("in kg the lb sets convert the other way",
  kg.description.indexOf("Goblet Squat  3 x 12 @ 10.9 kg") >= 0, kg.description);
check("in kg a kg set is left exactly alone",
  kg.description.indexOf("Row  1 x 10 @ 20 kg") >= 0, kg.description);
check("with no PRs sent, nothing claims one",
  kg.description.indexOf("New best") < 0);

const bare = S.activityBody({ workout_title: null, duration_seconds: 0, entries: [] },
  { startLocal: "2026-09-04T18:32:00Z" });
check("an untitled session still has a name", bare.name === "Workout", bare.name);
check("a zero duration floors at a minute rather than being refused by Strava",
  bare.elapsed_time === "60", bare.elapsed_time);
check("an empty session still links back",
  bare.description.indexOf("Logged with Spotter") >= 0, bare.description);

// ---------- 3. the compare-and-set on refresh ----------

const minted = { access_token: "minted-access", refresh_token: "minted-refresh", expires_at: 1 };
const stored = {
  user_id: USER, athlete_id: 1, access_token: "stored-access",
  refresh_token: "stored-refresh", expires_at: new Date().toISOString(), scope: "activity:write",
};

let rereads = 0;
const reread = () => { rereads++; return Promise.resolve(stored); };

check("winning the race uses the token we just minted",
  (await S.resolveRotation(minted, 1, reread)) === "minted-access");
check("winning the race costs no extra read", rereads === 0, String(rereads));

// The case the whole design exists for. Zero rows changed means another isolate
// spent the same refresh token first and stored ITS rotation; ours is the one
// Strava has already thrown away.
check("losing the race uses the token that is actually stored",
  (await S.resolveRotation(minted, 0, reread)) === "stored-access");
check("losing the race re-reads exactly once", rereads === 1, String(rereads));

let threw: any = null;
try {
  await S.resolveRotation(minted, 0, () => Promise.resolve(null));
} catch (e) { threw = e; }
check("losing the race to a disconnect says disconnected, not success",
  !!threw && threw.code === "disconnected" && threw.status === 409,
  threw ? threw.code + " " + threw.status : "nothing thrown");

console.log((failures ? "FAILED " : "ok  ") + (checks - failures) + "/" + checks + " checks");
if (failures) Deno.exit(1);
