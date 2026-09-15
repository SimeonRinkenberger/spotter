export function verifiedEntitlement(subscriber: any, now = Date.now(), allowSandbox = false) {
  const entitlement = subscriber?.entitlements?.plus;
  const product = entitlement?.product_identifier;
  const sub = subscriber?.subscriptions?.[product];
  const source = sub?.store === 'play_store' ? 'google' : sub?.store === 'app_store' ? 'apple' : null;
  const expiry = entitlement?.expires_date;
  const paidUntil = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const graceUntil = typeof entitlement?.grace_period_expires_date === 'string'
    ? Date.parse(entitlement.grace_period_expires_date) : NaN;
  const time = Number.isFinite(paidUntil) && Number.isFinite(graceUntil)
    ? Math.max(paidUntil, graceUntil) : paidUntil;
  // Spotter sells recurring subscriptions, never lifetime/test-store grants.
  const active = !!source && !!sub && (!sub.is_sandbox || allowSandbox) &&
    Number.isFinite(time) && time > now && !sub.refunded_at;
  return { active, expiry: Number.isFinite(time) ? new Date(time).toISOString() : null,
    source, product: typeof product === 'string' ? product : null };
}
