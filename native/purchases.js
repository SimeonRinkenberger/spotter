import { Purchases } from '@revenuecat/purchases-capacitor';
import storeKeys from './purchases-config.json';

// Store keys are public SDK identifiers. Secret RevenueCat keys stay server-side.

// A free trial the store will actually give this person, in days, or 0. The sheet
// only ever states a trial from here: Apple's introPrice exists whether or not
// this Apple ID already used it, so it counts only when the store says the
// account is eligible; Google Play's default option is already the offer this
// account may take (Play leaves out the ones it may not), so its free phase is
// the answer. A month or a year is counted in calendar days from today.
const DAY = 86400000;
function periodDays(unit, count) {
  const n = Number(count) || 0, u = String(unit || '').toUpperCase();
  if (!(n > 0)) return 0;
  if (u === 'DAY') return n;
  if (u === 'WEEK') return 7 * n;
  if (u !== 'MONTH' && u !== 'YEAR') return 0;
  const from = new Date(), to = new Date(from);
  if (u === 'MONTH') to.setMonth(to.getMonth() + n); else to.setFullYear(to.getFullYear() + n);
  return Math.round((to - from) / DAY);
}
function freeTrialDays(product, eligible) {
  const phase = product?.defaultOption?.freePhase;
  if (phase) return periodDays(phase.billingPeriod?.unit, (phase.billingPeriod?.value || 0) * (phase.billingCycleCount || 1));
  const intro = product?.introPrice;
  if (!intro || intro.price !== 0 || !eligible) return 0;
  return periodDays(intro.periodUnit, (intro.periodNumberOfUnits || 0) * (intro.cycles || 1));
}

// RevenueCat's Test Store key, compiled in by tools/ios/build.mjs only for a Debug
// simulator bundle (SPOTTER_TEST_STORE=1); an empty string in every other build,
// which configures the SDK with the stores' own public keys as always.
const TEST_STORE = typeof __SPOTTER_TEST_STORE__ === 'string' && /^test_/.test(__SPOTTER_TEST_STORE__) ? __SPOTTER_TEST_STORE__ : '';
const config = TEST_STORE ? { ios: TEST_STORE, android: TEST_STORE } : storeKeys;

export function createPurchases(platform) {
  let configured = false, currentUser = null, queue = Promise.resolve(), packages = {}, generation = 0;
  const serial = work => { const next = queue.catch(() => {}).then(work); queue = next; return next; };
  const guard = version => { if (version !== generation) throw new Error('The account changed. Please reopen subscriptions.'); };
  const operation = work => {
    const version = generation;
    return serial(async () => { guard(version); const result = await work(version); guard(version); return result; });
  };
  async function identify(userId) {
    if (!config[platform]) throw new Error('Subscriptions are not available yet. Please try again later.');
    if (!userId) throw new Error('Sign in before opening subscriptions.');
    if (!configured) { await Purchases.configure({ apiKey: config[platform], appUserID: userId }); configured = true; }
    else if (currentUser !== userId) { packages = {}; await Purchases.logIn({ appUserID: userId }); }
    currentUser = userId;
  }
  return {
    configured: () => !!config[platform],
    prices: userId => operation(async version => {
      await identify(userId);
      guard(version);
      const offerings = await Purchases.getOfferings();
      guard(version);
      packages = {};
      const current = offerings.current;
      if (current?.monthly) packages.month = current.monthly;
      if (current?.annual) packages.year = current.annual;
      // One period on sale is still a page with a price on it; the sheet shows
      // the other one as unavailable. Neither is the unavailable state.
      const items = Object.keys(packages);
      if (!items.length) throw new Error('Subscriptions are temporarily unavailable. Please try again later.');
      // Apple only: whether this Apple ID may still take each introductory offer.
      // Unknown or unanswered is not eligible, so no trial is promised on a guess.
      let eligible = {};
      const asks = items.map(iv => packages[iv].product).filter(p => p.introPrice && p.introPrice.price === 0 && !p.defaultOption);
      if (asks.length && Purchases.checkTrialOrIntroductoryPriceEligibility) {
        try { eligible = await Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: asks.map(p => p.identifier) }); }
        catch (_) { eligible = {}; }
        guard(version);
      }
      const plus = {};
      for (const iv of items) {
        const product = packages[iv].product;
        plus[iv] = { amount: Math.round(product.price * 100), localized: product.priceString,
          trial_days: freeTrialDays(product, eligible?.[product.identifier]?.status === 2) };
      }
      const first = packages[items[0]].product;
      return { configured: true, nativeStore: true, currency: first.currencyCode.toLowerCase(), plans: { plus }, trial_days: plus.year?.trial_days || 0 };
    }),
    purchase: (userId, interval) => operation(async version => {
      await identify(userId);
      guard(version);
      const item = packages[interval];
      if (!item) throw new Error('Please reopen subscriptions to refresh the price.');
      await Purchases.purchasePackage({ aPackage: item });
    }),
    restore: userId => operation(async version => { await identify(userId); guard(version); await Purchases.restorePurchases(); }),
    // Apple's own offer-code sheet (iOS 14+). Resolves once the sheet is up, not when the
    // person is done with it; app.ts restores on the way back to the front. Play has no
    // sheet, so on Android the client opens Play's redeem page instead.
    redeemOfferCode: userId => operation(async version => {
      if (platform === 'android') throw new Error('Offer codes are redeemed in Google Play on Android.');
      await identify(userId);
      guard(version);
      await Purchases.presentCodeRedemptionSheet();
    }),
    clear: () => {
      // Invalidate queued operations immediately, before the SDK logout can run.
      generation++;
      packages = {};
      return serial(async () => {
        if (configured && currentUser) await Purchases.logOut();
        currentUser = null;
      });
    },
    managementUrl: () => platform === 'android' ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions'
  };
}
