// What unlocks Plus, from RevenueCat's subscriber record, under every sandbox
// policy. No network: the shipped entitlement.ts is imported and run on fixtures.
//
//   deno run --allow-read tools/android/entitlement-check.ts      (in gtm:check)
import { sandboxPolicy, storeAccess, verifiedEntitlement } from '../../supabase/functions/spotter-purchases/entitlement.ts';
const now = Date.parse('2026-09-13T00:00:00Z');
const fixture = (store='play_store', extra={}) => ({entitlements:{plus:{product_identifier:'plus_monthly',expires_date:'2026-10-13T00:00:00Z'}},subscriptions:{plus_monthly:{store,is_sandbox:false,...extra}}});
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
check(verifiedEntitlement(fixture(),now).active,'Google subscription');
check(verifiedEntitlement(fixture('app_store'),now).source==='apple','Apple cross-platform subscription');
check(!verifiedEntitlement(fixture('test_store'),now,true).active,'test store cannot unlock paid production features');
check(!verifiedEntitlement(fixture('play_store',{is_sandbox:true}),now).active,'sandbox disabled by default');
check(verifiedEntitlement(fixture('play_store',{is_sandbox:true}),now,true).active,'explicit sandbox testing');
check(!verifiedEntitlement(fixture('play_store',{refunded_at:'2026-09-12'}),now).active,'refund revokes');
check(!verifiedEntitlement(fixture(),Date.parse('2026-11-01')).active,'expiry revokes');
check(!verifiedEntitlement({},now).active,'missing entitlement');
const invalid=fixture(); invalid.entitlements.plus.expires_date='bad';
check(!verifiedEntitlement(invalid,now).active,'malformed expiry cannot grant');
const grace:any=fixture(); grace.entitlements.plus.expires_date='2026-09-12T00:00:00Z';
grace.entitlements.plus.grace_period_expires_date='2026-09-15T00:00:00Z';
check(verifiedEntitlement(grace,now).active,'store grace period preserves access');
check(!verifiedEntitlement(grace,Date.parse('2026-09-16')).active,'grace expiry revokes access');

// ---------- the policy switch ----------
const env = (vars: Record<string,string>) => (k: string) => vars[k];
const policies: [Record<string,string>, string, string][] = [
  [{}, 'off', 'unset is today\'s behaviour'],
  [{REVENUECAT_SANDBOX_POLICY:'off'}, 'off', 'off'],
  [{REVENUECAT_SANDBOX_POLICY:'qa'}, 'qa', 'qa'],
  [{REVENUECAT_SANDBOX_POLICY:' ALL '}, 'all', 'case and space forgiven'],
  [{REVENUECAT_SANDBOX_POLICY:'yes'}, 'off', 'a typo allows nothing'],
  [{REVENUECAT_ALLOW_SANDBOX:'true'}, 'all', 'the legacy switch reads as all'],
  [{REVENUECAT_ALLOW_SANDBOX:'1'}, 'off', 'the legacy switch only ever meant the string true'],
  [{REVENUECAT_SANDBOX_POLICY:'off',REVENUECAT_ALLOW_SANDBOX:'true'}, 'off', 'an explicit policy outranks the legacy switch'],
  [{REVENUECAT_SANDBOX_POLICY:'qa',REVENUECAT_ALLOW_SANDBOX:'true'}, 'qa', 'including a narrower one'],
];
for (const [vars, want, why] of policies) check(sandboxPolicy(env(vars))===want, 'policy: '+why+' ('+JSON.stringify(vars)+')');

// ---------- every policy × account × store × environment cell ----------
// `xcode` is an Xcode StoreKit-test purchase: RevenueCat records it as an App
// Store sandbox transaction, and GET /subscribers only returns it when the
// server sends X-Is-Sandbox, which storeAccess().xcode decides. So "visible" is
// part of the cell: a transaction the server never asks for cannot unlock.
type Cell = { store: string; sandbox?: boolean; xcode?: boolean };
const cells: Record<string, Cell> = {
  'App Store, production': { store: 'app_store' },
  'App Store, sandbox (TestFlight, App Review)': { store: 'app_store', sandbox: true },
  'Google Play, production': { store: 'play_store' },
  'Google Play, sandbox (licence testers)': { store: 'play_store', sandbox: true },
  'RevenueCat Test Store': { store: 'test_store', sandbox: true },
  'Xcode StoreKit test': { store: 'app_store', sandbox: true, xcode: true },
  'promotional grant': { store: 'promotional' },
};
// The table of record. Rows: cell; columns: off/qa/all × not QA/QA.
const want: Record<string, Record<string, [boolean, boolean]>> = {
  'App Store, production':                          { off: [true, true],   qa: [true, true],   all: [true, true] },
  'App Store, sandbox (TestFlight, App Review)':    { off: [false, false], qa: [false, true],  all: [true, true] },
  'Google Play, production':                        { off: [true, true],   qa: [true, true],   all: [true, true] },
  'Google Play, sandbox (licence testers)':         { off: [false, false], qa: [false, true],  all: [true, true] },
  'RevenueCat Test Store':                          { off: [false, false], qa: [false, true],  all: [false, true] },
  'Xcode StoreKit test':                            { off: [false, false], qa: [false, true],  all: [false, true] },
  'promotional grant':                              { off: [false, false], qa: [false, false], all: [false, false] },
};
const sourceOf: Record<string, string | null> = { app_store: 'apple', play_store: 'google', test_store: 'test', promotional: null };
const envOf = (c: Cell) => c.store === 'promotional' ? null : c.store === 'test_store' ? 'test_store' : c.sandbox ? 'sandbox' : 'production';
let cellsChecked = 0;
for (const [name, c] of Object.entries(cells)) for (const policy of ['off','qa','all'] as const) for (const qa of [false, true]) {
  const access = storeAccess(policy, qa);
  const visible = !c.xcode || access.xcode;
  const got = visible ? verifiedEntitlement(fixture(c.store, { is_sandbox: !!c.sandbox }), now, access) : null;
  const active = !!got?.active;
  check(active === want[name][policy][qa ? 1 : 0], name + ' under ' + policy + (qa ? ' for a QA account' : '') + ' should be ' + (active ? 'refused' : 'allowed'));
  if (got) {
    check(got.environment === envOf(c), name + ': environment recorded as ' + envOf(c) + ', got ' + got.environment);
    check(got.source === (active || c.store !== 'test_store' ? sourceOf[c.store] : null), name + ': source');
  }
  cellsChecked++;
}
check(!storeAccess('off', true).xcode && !storeAccess('all', false).xcode && storeAccess('all', true).xcode && storeAccess('qa', true).xcode,
  'X-Is-Sandbox is sent for QA accounts under qa and all, never otherwise');

// ---------- whether it renews (P-16) ----------
check(verifiedEntitlement(fixture(), now).willRenew === true, 'an ordinary subscription renews');
check(verifiedEntitlement(fixture('app_store', { unsubscribe_detected_at: '2026-09-12T00:00:00Z' }), now).willRenew === false, 'auto-renew turned off: ends');
const unsubscribed = verifiedEntitlement(fixture('app_store', { unsubscribe_detected_at: '2026-09-12T00:00:00Z' }), now);
check(unsubscribed.active, 'turning auto-renew off keeps access to the expiry');
check(verifiedEntitlement(fixture('play_store', { billing_issues_detected_at: '2026-09-12T00:00:00Z' }), now).willRenew === false, 'a renewal that could not be charged does not say renews');
check(verifiedEntitlement({}, now).willRenew === null && verifiedEntitlement({}, now).environment === null, 'no subscription, nothing claimed');
console.log('PASS verified store entitlements: Google, Apple, sandbox isolation, refunds, expiry, grace, absent and malformed claims; ' +
  policies.length + ' policy readings; ' + cellsChecked + ' policy × account × store cells; renewal state.');
