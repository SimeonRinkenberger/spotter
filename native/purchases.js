import { Purchases } from '@revenuecat/purchases-capacitor';
import config from './purchases-config.json';

// Store keys are public SDK identifiers. Secret RevenueCat keys stay server-side.
export function createPurchases(platform) {
  let configured = false, currentUser = null, queue = Promise.resolve(), packages = {};
  const serial = work => { const next = queue.catch(() => {}).then(work); queue = next; return next; };
  async function identify(userId) {
    if (!config[platform]) throw new Error('Subscriptions are not available yet. Please try again later.');
    if (!userId) throw new Error('Sign in before opening subscriptions.');
    if (!configured) { await Purchases.configure({ apiKey: config[platform], appUserID: userId }); configured = true; }
    else if (currentUser !== userId) { packages = {}; await Purchases.logIn({ appUserID: userId }); }
    currentUser = userId;
  }
  return {
    configured: () => !!config[platform],
    prices: userId => serial(async () => {
      await identify(userId);
      const offerings = await Purchases.getOfferings();
      packages = {};
      const current = offerings.current;
      if (current?.monthly) packages.month = current.monthly;
      if (current?.annual) packages.year = current.annual;
      if (!packages.month || !packages.year) throw new Error('Subscriptions are temporarily unavailable. Please try again later.');
      const price = item => ({ amount: Math.round(item.product.price * 100), localized: item.product.priceString });
      return { configured: true, nativeStore: true, currency: packages.month.product.currencyCode.toLowerCase(), plans: { plus: { month: price(packages.month), year: price(packages.year) } }, trial_days: 0 };
    }),
    purchase: (userId, interval) => serial(async () => {
      await identify(userId);
      const item = packages[interval];
      if (!item) throw new Error('Please reopen subscriptions to refresh the price.');
      await Purchases.purchasePackage({ aPackage: item });
    }),
    restore: userId => serial(async () => { await identify(userId); await Purchases.restorePurchases(); }),
    clear: () => serial(async () => {
      packages = {};
      if (configured && currentUser) await Purchases.logOut();
      currentUser = null;
    }),
    managementUrl: () => platform === 'android' ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions'
  };
}
