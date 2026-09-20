// Exercise the shipped adapter against a controllable store SDK. No store calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('native/purchases.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
const product = price => ({ product: { price, priceString: '$' + price, currencyCode: 'USD' } });
let calls = [], waitOffering = null, cancelPurchase = false;
const sdk = {
  configure: async ({appUserID}) => { calls.push(['configure', appUserID]); },
  logIn: async ({appUserID}) => { calls.push(['login', appUserID]); },
  logOut: async () => { calls.push(['logout']); },
  getOfferings: async () => {
    if (waitOffering) await waitOffering;
    return { current: { monthly: product(6.99), annual: product(49.99) } };
  },
  purchasePackage: async () => { calls.push(['purchase']); if (cancelPurchase) throw { userCancelled: true }; },
  restorePurchases: async () => { calls.push(['restore']); }
};
const create = new Function('Purchases', 'config', source + '\nreturn createPurchases;')(sdk, { ios: 'public-test', android: 'public-test' });
const app = create('ios');
await assert.rejects(app.prices(null), /Sign in/);
const prices = await app.prices('a');
assert.equal(prices.plans.plus.year.amount, 4999);
await app.purchase('a', 'year');
await assert.rejects(app.purchase('b', 'year'), /reopen subscriptions/);
await app.prices('b');
cancelPurchase = true;
await assert.rejects(app.purchase('b', 'year'), error => error.userCancelled === true);
cancelPurchase = false;
await app.restore('b'); // A cancellation must not poison the serial queue.
assert.deepEqual(calls.filter(c => c[0] === 'login'), [['login', 'b']]);

let release;
waitOffering = new Promise(resolve => { release = resolve; });
const stalePrices = app.prices('b');
await new Promise(resolve => setTimeout(resolve, 0));
const queuedPurchase = app.purchase('b', 'year');
const queuedRestore = app.restore('b');
const results = Promise.allSettled([stalePrices, queuedPurchase, queuedRestore]);
const purchaseCount = calls.filter(c => c[0] === 'purchase').length;
const restoreCount = calls.filter(c => c[0] === 'restore').length;
const clear = app.clear();
release(); waitOffering = null;
assert((await results).every(result => result.status === 'rejected'));
await clear;
assert.equal(calls.filter(c => c[0] === 'purchase').length, purchaseCount);
assert.equal(calls.filter(c => c[0] === 'restore').length, restoreCount);
await app.prices('c');
await app.purchase('c', 'year');
assert.equal(calls.filter(c => c[0] === 'logout').length, 1);
assert.equal(create('android').managementUrl(), 'https://play.google.com/store/account/subscriptions');
console.log('PASS native subscriptions: store prices, sign-in, package refresh on identity change, cancellation recovery, restore, sign-out invalidates in-flight prices and queued purchases/restores, next account recovery.');
