import { Purchases } from '@revenuecat/purchases-capacitor';
import config from './purchases-config.json';

// Store keys are public SDK identifiers. Secret RevenueCat keys stay server-side.
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
      if (!packages.month || !packages.year) throw new Error('Subscriptions are temporarily unavailable. Please try again later.');
      const price = item => ({ amount: Math.round(item.product.price * 100), localized: item.product.priceString });
      return { configured: true, nativeStore: true, currency: packages.month.product.currencyCode.toLowerCase(), plans: { plus: { month: price(packages.month), year: price(packages.year) } }, trial_days: 0 };
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
