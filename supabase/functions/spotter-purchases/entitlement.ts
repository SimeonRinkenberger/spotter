// Which test purchases may unlock Plus. One secret, REVENUECAT_SANDBOX_POLICY:
//   off  (the default, and what an unset or unreadable value means) production
//        store purchases only, exactly as before this switch existed.
//   qa   accounts flagged QA (profiles.limits.store_qa, which only the service
//        role can write) may also use store sandbox, RevenueCat's Test Store and
//        Xcode StoreKit-test purchases. Everybody else: production only.
//   all  every account may use store sandbox (TestFlight, App Review); Test Store
//        and Xcode StoreKit-test purchases stay QA-only.
// The legacy REVENUECAT_ALLOW_SANDBOX=true reads as `all`, which is what it did.
export type SandboxPolicy = 'off' | 'qa' | 'all';
export type StoreAccess = { sandbox: boolean; testStore: boolean; xcode: boolean };

export function sandboxPolicy(get: (key: string) => string | undefined): SandboxPolicy {
  const raw = (get('REVENUECAT_SANDBOX_POLICY') ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'qa' || raw === 'all') return raw;
  // A value somebody typed and got wrong is not permission for anything.
  if (raw) return 'off';
  return get('REVENUECAT_ALLOW_SANDBOX') === 'true' ? 'all' : 'off';
}

// What one account may use under a policy. `xcode` is also whether the server
// asks RevenueCat for Xcode StoreKit-test transactions at all (X-Is-Sandbox):
// GET /subscribers leaves them out unless asked, so for everybody else they are
// never seen, whatever else is allowed.
export function storeAccess(policy: SandboxPolicy, qa: boolean): StoreAccess {
  if (policy === 'all') return { sandbox: true, testStore: qa, xcode: qa };
  if (policy === 'qa' && qa) return { sandbox: true, testStore: true, xcode: true };
  return { sandbox: false, testStore: false, xcode: false };
}

const SOURCE: Record<string, string> = { app_store: 'apple', play_store: 'google', test_store: 'test' };

export function verifiedEntitlement(subscriber: any, now = Date.now(), allow: boolean | StoreAccess = false) {
  // A bare boolean is the old signature: store sandbox yes or no, never Test Store.
  const access: StoreAccess = typeof allow === 'boolean' ? { sandbox: allow, testStore: false, xcode: false } : allow;
  const entitlement = subscriber?.entitlements?.plus;
  const product = entitlement?.product_identifier;
  const sub = subscriber?.subscriptions?.[product];
  const store = SOURCE[sub?.store] ?? null;
  const testStore = store === 'test';
  // Spotter sells recurring subscriptions: a promotional or lifetime grant has no
  // store and never unlocks, and a Test Store one only for the accounts allowed it.
  const source = testStore && !access.testStore ? null : store;
  const expiry = entitlement?.expires_date;
  const paidUntil = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const graceUntil = typeof entitlement?.grace_period_expires_date === 'string'
    ? Date.parse(entitlement.grace_period_expires_date) : NaN;
  const time = Number.isFinite(paidUntil) && Number.isFinite(graceUntil)
    ? Math.max(paidUntil, graceUntil) : paidUntil;
  const environment = !sub || !store ? null : testStore ? 'test_store' : sub.is_sandbox ? 'sandbox' : 'production';
  const active = !!source && !!sub && (testStore || !sub.is_sandbox || access.sandbox) &&
    Number.isFinite(time) && time > now && !sub.refunded_at;
  // Auto-renew is off once the store reports the person unsubscribed, or that the
  // renewal could not be charged; access still runs to the expiry either way.
  const willRenew = !sub ? null : !sub.unsubscribe_detected_at && !sub.billing_issues_detected_at;
  return { active, expiry: Number.isFinite(time) ? new Date(time).toISOString() : null,
    source, product: typeof product === 'string' ? product : null, environment, willRenew };
}
