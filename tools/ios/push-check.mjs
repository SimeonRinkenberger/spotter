// The native reminders, checked without a phone.
//
// Three things can silently break this feature and none of them shows up in a
// build:
//
//   1. **The gate.** `pushable()` deciding wrong turns two switches into
//      furniture — or, worse, into switches that flip and do nothing. The three
//      states (no plugin, no APNs key on the deployment, ready) each have their
//      own sentence, and the sentences are the only thing the user ever sees of
//      any of this.
//   2. **The row.** The page writes `push_devices` straight through PostgREST
//      under RLS, so the column names in app.ts and the column names in the
//      migration are two copies of one fact. A typo is not an error: PostgREST
//      answers 400, the toast says "did not save", and nobody can tell you why.
//   3. **The rotation.** A device token changes and the preferences have to move
//      with it, new row before old row, or a reminder goes quiet for good.
//
// So the real functions come out of app.ts and run against stubs, the way
// live-state-check.mjs does, rather than being matched with a regex. The Swift,
// SQL and project-file assertions below are text, because there is no way to run
// those here — CI has no Xcode and no Deno on this step.
//
// Node-only, like every other tools/ios/*-check.mjs.

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const app = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const swift = fs.readFileSync('ios/App/App/SpotterPushPlugin.swift', 'utf8');
const bridge = fs.readFileSync('native/push.js', 'utf8');
const sql = fs.readFileSync(
  'supabase/migrations/20260918190000_push_devices.sql', 'utf8');
const pbx = fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const xcconfig = fs.readFileSync('ios/debug.xcconfig', 'utf8');
const example = fs.readFileSync('ios/App/Local.xcconfig.example', 'utf8');
const entitlements = fs.readFileSync('ios/App/App/Push.entitlements', 'utf8');

// Same extractor as live-state-check.mjs: brace counting, so a one-line function
// comes out whole. None of the functions pulled below has a brace inside a
// string or a regex.
function fn(name) {
  const start = app.indexOf('\n  function ' + name + '(');
  assert(start >= 0, 'app.ts has no ' + name + '()');
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1) + '\n';
  }
  throw new Error('unbalanced braces in ' + name);
}

const pull = names => names.map(fn).join('');

// The two shared copy constants sit beside the functions rather than inside
// them, so they come across as source too. Reading them rather than repeating
// them means this file pins where the sentences are USED, not what they say
// twice over.
function consts() {
  const at = app.indexOf('  var REMIND_OFF =');
  assert(at >= 0, 'app.ts has no REMIND_OFF');
  return app.slice(at, app.indexOf('\n\n', at)) + '\n';
}

// ---------- a page running inside the native shell ----------

// One chainable stub for supabase-js. Every call is recorded in order, which is
// what makes "new row before old row" an assertion rather than a hope.
function fakeSb(log) {
  return {
    from(table) {
      const q = {
        upsert(row, opts) { log.push({ op: 'upsert', table, row, opts }); return { then: f => f({ error: null }) }; },
        delete() { return { eq(col, value) { log.push({ op: 'delete', table, col, value }); return { then: f => f({ error: null }) }; } }; },
        select() {
          return {
            eq(col, value) {
              log.push({ op: 'select', table, col, value });
              return { maybeSingle: () => Promise.resolve({ data: q._row }) };
            }
          };
        },
        _row: null
      };
      q._row = fakeSb.row;
      return q;
    }
  };
}

function context(over) {
  const log = [];
  const store = {};
  const plugin = {
    status: () => Promise.resolve(over.status ?? { permission: 'granted', environment: 'sandbox', bundle: 'app.spotter.dev' }),
    register: over.register ?? (() => Promise.resolve({
      granted: true, token: 'abc123', permission: 'granted',
      environment: 'sandbox', bundle: 'app.spotter.dev'
    })),
    unregister: () => { log.push({ op: 'unregister' }); return Promise.resolve({}); }
  };
  const painted = [];
  const toasts = [];
  const ctx = vm.createContext({
    native: { push: plugin },
    state: { user: { id: 'u1' } },
    VERSION: '0.14',
    sb: fakeSb(log),
    api: () => Promise.resolve({ status: 'ok', configured: true, key: 'vapid', apns: over.apns !== false }),
    toast: m => toasts.push(m),
    paintRemind: () => painted.push(1),
    standalone: () => true,
    tzName: () => 'Europe/Zurich',
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    window: { Notification: { permission: 'default' } },
    navigator: {},
    Promise, Date, Object, String, Number, Boolean, JSON, Math, isFinite, RegExp
  });
  vm.runInContext(
    'var remind = { plan: false, risk: false, at: 1050, sub: null, key: null, busy: false,' +
    ' cfg: null, apns: false, perm: "unsupported", env: "sandbox", bundle: "", tok: null };' +
    'var TOKKEY = "spotter_push_token";',
    ctx);
  vm.runInContext(consts(), ctx);
  vm.runInContext(pull(['enrolled', 'fromPlugin', 'pushable', 'denied', 'remindNote',
    'pushKey', 'readRemind', 'loadNative', 'saveRemind', 'remindSaved', 'offRemind']), ctx);
  return { ctx, log, store, toasts, painted };
}

const NOT_CONFIGURED = 'Native reminders are not configured in this development build.';
const SETTINGS = 'Reminders arrive as notifications. You can change this in Settings › Notifications.';
const OFF = "Reminders are off in your phone's Settings.";

// ---------- the gate and the three sentences ----------

{
  const { ctx } = context({});
  // Before anything has been asked: no plugin answer yet, no config yet. The
  // switches must be dead and the note must be the honest one — this is the
  // state a cold Settings open renders for a frame or two.
  assert.equal(vm.runInContext('pushable()', ctx), false, 'a page that has asked nothing must not offer the switches');
  assert.equal(vm.runInContext('remindNote()', ctx), NOT_CONFIGURED);

  // A shell that has the plugin, on a deployment with no APNs key.
  vm.runInContext('remind.perm = "undetermined"; remind.apns = false;', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), false, 'no APNs key on the deployment must not offer the switches');
  assert.equal(vm.runInContext('remindNote()', ctx), NOT_CONFIGURED);

  // Keyed up, never asked: the switches are live and the note explains what
  // arrives, because permission has not been spent yet.
  vm.runInContext('remind.apns = true;', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), true);
  assert.match(vm.runInContext('remindNote()', ctx), /Two at most and never more than one a day/);

  // Refused. Never a second prompt — a refusal is undone in the OS only.
  vm.runInContext('remind.perm = "denied";', ctx);
  assert.equal(vm.runInContext('denied()', ctx), true);
  assert.equal(vm.runInContext('pushable()', ctx), true, 'denied is a state of a usable switch, not an unusable one');
  assert.equal(vm.runInContext('remindNote()', ctx), OFF);

  // Granted: the only thing left to say is where it is undone.
  vm.runInContext('remind.perm = "granted";', ctx);
  assert.equal(vm.runInContext('remindNote()', ctx), SETTINGS);
  vm.runInContext('remind.perm = "provisional";', ctx);
  assert.equal(vm.runInContext('remindNote()', ctx), SETTINGS,
    'a provisional authorization still delivers, so it gets the same sentence');

  // An older shell, whose plugin rejects: push.js reports "unsupported".
  vm.runInContext('remind.perm = "unsupported";', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), false);
}

// ---------- the browser path is untouched ----------

// The whole native branch hangs off one `native` flag, so the one thing that
// must be proved about the web app is that nothing moved: with no shell, the
// gate is still the three WebKit objects and the copy is still the install hint.
{
  const { ctx } = context({});
  vm.runInContext('native = null;', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), false,
    'a browser with no PushManager must not offer the switches');
  assert.match(vm.runInContext('remindNote()', ctx), /^This browser cannot show reminders/);
  vm.runInContext('navigator.serviceWorker = {}; window.PushManager = {}; window.Notification = { permission: "default" };', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), true,
    'an installed web app must still be offered the switches');
  assert.equal(vm.runInContext('denied()', ctx), false);
  assert.match(vm.runInContext('remindNote()', ctx), /Two at most and never more than one a day/);
  vm.runInContext('window.Notification.permission = "denied";', ctx);
  assert.equal(vm.runInContext('denied()', ctx), true);
  assert.equal(vm.runInContext('remindNote()', ctx), OFF);
  // The APNs flag is a native concept and must not be able to reach a browser.
  vm.runInContext('remind.apns = false;', ctx);
  assert.equal(vm.runInContext('pushable()', ctx), true,
    'an unkeyed APNs deployment must not switch off Web Push');
}

// ---------- the row the page writes ----------

const DEVICE_COLUMNS = ['app_version', 'bundle', 'env', 'remind_at', 'remind_plan',
  'remind_risk', 'token', 'tz', 'updated_at', 'user_id'];

{
  const { ctx, log, store } = context({});
  vm.runInContext('remind.apns = true; remind.perm = "granted"; remind.tok = "abc123";' +
    'remind.env = "sandbox"; remind.bundle = "app.spotter.dev"; remind.plan = true;', ctx);
  vm.runInContext('saveRemind()', ctx);

  const write = log.find(e => e.op === 'upsert');
  assert(write, 'saveRemind wrote nothing on native');
  assert.equal(write.table, 'push_devices', 'the native row does not belong in push_subscriptions');
  assert.equal(write.opts.onConflict, 'token', 'the token is the row identity, so it is the conflict target');
  assert.deepEqual(Object.keys(write.row).sort(), DEVICE_COLUMNS,
    'the upsert payload drifted from the grant in the migration');
  assert.equal(write.row.remind_plan, true);
  assert.equal(write.row.tz, 'Europe/Zurich', "the row carries the phone's own zone");
  assert.equal(store.spotter_push_token, 'abc123', 'the enrolment is remembered so a boot can re-check it');

  // Every column the page sends must be one the migration grants, or the write
  // is a 403 nobody can read.
  const granted = /grant update \(([^)]*)\)\s*\n?\s*on public\.push_devices/m.exec(sql);
  assert(granted, 'the migration does not grant update on push_devices');
  const allowed = granted[1].split(',').map(s => s.trim()).filter(Boolean);
  for (const col of Object.keys(write.row)) {
    assert(allowed.includes(col), 'app.ts writes ' + col + ' but the migration does not grant it');
  }
  // And nothing the sender owns may be grantable to a browser.
  for (const ledger of ['last_sent_at', 'sent_week', 'week_key', 'risk_week']) {
    assert(!allowed.includes(ledger), 'the cap column ' + ledger + ' must not be user-writable');
  }
}

// ---------- Off leaves nothing behind ----------

{
  const { ctx, log, store } = context({});
  vm.runInContext('remind.tok = "abc123";', ctx);
  vm.runInContext('localStorage.setItem(TOKKEY, "abc123");', ctx);
  vm.runInContext('offRemind()', ctx);
  assert(log.some(e => e.op === 'unregister'), 'Off must tell iOS to stop minting tokens');
  const gone = log.find(e => e.op === 'delete');
  assert(gone && gone.table === 'push_devices' && gone.value === 'abc123', 'Off must delete the row');
  assert.equal(store.spotter_push_token, undefined, 'Off must forget the enrolment');
}

// ---------- a boot that has never enrolled asks the phone for nothing ----------

{
  let asked = 0;
  const { ctx } = context({ register: () => { asked++; return Promise.resolve({}); } });
  vm.runInContext('loadNative()', ctx);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(asked, 0,
    'loadNative registered without an enrolment — that puts the permission sheet on screen at launch');
}

// ---------- a rotated token moves the preferences before dropping the old row ----------

{
  fakeSb.row = { remind_plan: true, remind_risk: false, remind_at: 1140 };
  const { ctx, log, store } = context({
    register: () => Promise.resolve({
      granted: true, token: 'NEW', permission: 'granted',
      environment: 'sandbox', bundle: 'app.spotter.dev'
    })
  });
  vm.runInContext('localStorage.setItem(TOKKEY, "OLD");', ctx);
  vm.runInContext('loadNative()', ctx);
  await new Promise(r => setTimeout(r, 20));

  assert.equal(vm.runInContext('remind.plan', ctx), true, 'the stored preference did not come back');
  assert.equal(vm.runInContext('remind.at', ctx), 1140, 'the stored time did not come back');

  const read = log.findIndex(e => e.op === 'select');
  const wrote = log.findIndex(e => e.op === 'upsert');
  const deleted = log.findIndex(e => e.op === 'delete');
  assert(read >= 0 && log[read].value === 'OLD', "the preferences are read from the OLD token's row");
  assert(wrote >= 0, 'a rotated token did not write the preferences to the new row');
  assert.equal(log[wrote].row.token, 'NEW');
  assert(deleted > wrote,
    'the old row was dropped before the new one was written — a failure between the two silences the reminder');
  assert.equal(log[deleted].value, 'OLD');
  assert.equal(store.spotter_push_token, 'NEW', 'the enrolment must follow the token');
  fakeSb.row = null;
}

// ---------- an unchanged token touches nothing ----------

{
  fakeSb.row = { remind_plan: true, remind_risk: false, remind_at: 1050 };
  const { ctx, log } = context({});
  vm.runInContext('localStorage.setItem(TOKKEY, "abc123");', ctx);
  vm.runInContext('loadNative()', ctx);
  await new Promise(r => setTimeout(r, 20));
  assert(!log.some(e => e.op === 'delete'), 'a boot with an unchanged token deleted a row');
  assert(!log.some(e => e.op === 'upsert'), 'a boot with an unchanged token rewrote its row for nothing');
  fakeSb.row = null;
}

// ---------- the Swift half ----------

assert.match(swift, /jsName = "SpotterPush"/);
for (const method of ['status', 'register', 'unregister']) {
  assert(swift.includes('CAPPluginMethod(name: "' + method + '"'), 'the plugin does not expose ' + method);
}
// The one ordering rule that matters: the token is only asked for once
// permission is actually held, and permission is only asked for from `register`.
// The call site, not the sentence about it in the header comment.
assert(swift.indexOf('UIApplication.shared.registerForRemoteNotifications()') >
  swift.indexOf('permission == .granted'),
  'registerForRemoteNotifications must come after the permission gate');
assert(!/func load\(\)/.test(swift), 'nothing in this plugin may run at launch');
assert(swift.includes('String(format: "%02x"'),
  'the device token must be lowercase hex, which is what APNs wants back in the path');
assert(!swift.includes('"configured"'),
  "configured is the deployment's answer, not the phone's - it comes from /api/push/config");
assert(bridge.includes("permission: 'unsupported'"),
  'push.js must turn a missing plugin into the same shape app.ts reads');

// ---------- the migration ----------

assert.match(sql, /create table if not exists public\.push_devices/);
assert.match(sql, /token\s+text not null unique/, 'the token is the row identity');
assert.match(sql, /check \(env in \('sandbox', 'production'\)\)/,
  'a token belongs to exactly one APNs host');
for (const policy of ['select', 'insert', 'update', 'delete']) {
  assert(new RegExp('for ' + policy + ' ').test(sql), 'push_devices has no ' + policy + ' policy');
}
// Comments out first: the migration's own prose explains the rule by quoting
// the bare form it forbids.
const sqlCode = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
assert(!/auth\.uid\(\)/.test(sqlCode.replace(/\(select auth\.uid\(\)\)/g, '')),
  'RLS must use the initplan-safe (select auth.uid()) form');
assert.match(sql, /revoke update on public\.push_devices from authenticated/);
assert.match(sql, /create index if not exists push_devices_live/);
// The hourly job used to wake only for browser subscriptions. A project whose
// only subscribers are native installs must still get a tick.
assert.match(sql, /cron\.schedule\('spotter-push-tick'/, 'the job must keep its name');
assert.match(sql, /exists \(select 1 from public\.push_devices where remind_plan or remind_risk\)/,
  'the cron guard does not look at push_devices');
assert.match(sql, /exists \(select 1 from public\.push_subscriptions where remind_plan or remind_risk\)/,
  'the cron guard stopped looking at push_subscriptions');
assert.match(sql, /value like '%\/api\/worker\/tick'/,
  'the worker_url derivation guard must survive the reschedule');

// ---------- the entitlement switch ----------

assert.match(entitlements, /<key>aps-environment<\/key>\s*<string>development<\/string>/);
assert.match(entitlements, /keychain-access-groups/,
  'Push.entitlements must keep the keychain group, or the share extension loses the account');
assert.match(xcconfig, /^SPOTTER_ENTITLEMENTS = App\/Share\.entitlements$/m,
  'the committed default must be the file a Personal Team can sign');
assert(xcconfig.indexOf('SPOTTER_ENTITLEMENTS') < xcconfig.indexOf('#include? "App/Local.xcconfig"'),
  'the default must come before the include, or Local.xcconfig cannot override it');
assert.match(example, /SPOTTER_ENTITLEMENTS = App\/Push\.entitlements/,
  'Local.xcconfig.example must document the switch');
assert.equal((pbx.match(/CODE_SIGN_ENTITLEMENTS = "\$\(SPOTTER_ENTITLEMENTS\)"/g) || []).length, 2,
  'both App configurations must read the variable');
assert.equal((pbx.match(/SPOTTER_ENTITLEMENTS = App\/Share\.entitlements;/g) || []).length, 1,
  'Debug retains the Personal Team default; Release uses its organization configuration');
assert(!/CODE_SIGN_ENTITLEMENTS = App\/Push\.entitlements/.test(pbx),
  'the committed project must not require an entitlement this account cannot sign');

// ---------- the simulator fixtures ----------

for (const name of ['reminder-plan', 'reminder-risk']) {
  const path = 'tools/ios/fixtures/' + name + '.apns';
  assert(fs.existsSync(path), path + ' is missing — run npm run push:harness');
  const f = JSON.parse(fs.readFileSync(path, 'utf8'));
  assert(f['Simulator Target Bundle'], 'simctl needs a target bundle when none is given on the command line');
  assert(f.aps && f.aps.alert && f.aps.alert.title, 'the fixture has no alert to show');
  assert.match(f.url, /^spotter:\/\/tab\/(plan|progress)$/, 'the fixture must deep-link somewhere real');
  assert.equal(f.aps.url, undefined, 'a custom key inside aps is dropped by APNs');
}

console.log("PASS native reminders: the three-state gate and its copy, the untouched browser path, the " +
  "push_devices payload against the migration's grant, Off, a cold boot that asks the phone for nothing, " +
  "token rotation ordering, the Swift permission gate, the cron guard over both tables, the entitlement " +
  "switch and the simctl fixtures.");
