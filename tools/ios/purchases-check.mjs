// Exercise the shipped adapter against a controllable store SDK. No store calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('native/purchases.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
const product = (price, extra = {}) => ({ product: { identifier: 'p' + price, price, priceString: '$' + price, currencyCode: 'USD', introPrice: null, defaultOption: null, ...extra } });
let calls = [], waitOffering = null, cancelPurchase = false, offering = null, eligibility = {};
const sdk = {
  configure: async ({appUserID}) => { calls.push(['configure', appUserID]); },
  logIn: async ({appUserID}) => { calls.push(['login', appUserID]); },
  logOut: async () => { calls.push(['logout']); },
  getOfferings: async () => {
    if (waitOffering) await waitOffering;
    return { current: offering || { monthly: product(6.99), annual: product(49.99) } };
  },
  checkTrialOrIntroductoryPriceEligibility: async ({ productIdentifiers }) => {
    calls.push(['eligibility', productIdentifiers.join(',')]);
    if (eligibility instanceof Error) throw eligibility;
    return eligibility;
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

// ---------- the trial line comes from the store's own eligible offer (P-07) ----------
const week = { price: 0, priceString: '$0.00', cycles: 1, period: 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: 1 };
const trialApp = create('ios');
await trialApp.prices('t');
offering = { monthly: product(6.99), annual: product(49.99, { identifier: 'spotter_plus_year', introPrice: week }) };
eligibility = { spotter_plus_year: { status: 2, description: 'eligible' } };
let p = await trialApp.prices('t');
assert.equal(p.plans.plus.year.trial_days, 7, 'an Apple free week this Apple ID may still take');
assert.equal(p.trial_days, 7);
assert.equal(p.plans.plus.month.trial_days, 0, 'no offer on the monthly plan, no trial on it');
assert.deepEqual(calls.at(-1), ['eligibility', 'spotter_plus_year'], 'only products with a free intro offer are asked about');
eligibility = { spotter_plus_year: { status: 1, description: 'ineligible' } };
assert.equal((await trialApp.prices('t')).plans.plus.year.trial_days, 0, 'an Apple ID that used its trial is not promised another');
eligibility = new Error('StoreKit did not answer');
assert.equal((await trialApp.prices('t')).plans.plus.year.trial_days, 0, 'an unanswered eligibility check promises nothing');
offering = { monthly: product(6.99), annual: product(49.99, { identifier: 'spotter_plus_year', introPrice: { ...week, price: 0.99, priceString: '$0.99' } }) };
eligibility = { spotter_plus_year: { status: 2, description: 'eligible' } };
assert.equal((await trialApp.prices('t')).plans.plus.year.trial_days, 0, 'a paid introductory price is not a free trial');
const play = create('android');
offering = { monthly: product(6.99), annual: product(49.99, { identifier: 'spotter_plus_year:yearly',
  defaultOption: { freePhase: { billingPeriod: { unit: 'DAY', value: 7, iso8601: 'P7D' }, billingCycleCount: 1 } } }) };
const before = calls.filter(c => c[0] === 'eligibility').length;
p = await play.prices('g');
assert.equal(p.plans.plus.year.trial_days, 7, "Play's trial-7-days offer on the yearly plan, as Play offers it to this account");
assert.equal(calls.filter(c => c[0] === 'eligibility').length, before, 'Play is never asked the Apple eligibility question');
offering = { monthly: product(6.99), annual: product(49.99, { defaultOption: { freePhase: null } }) };
assert.equal((await play.prices('g')).plans.plus.year.trial_days, 0, 'no free phase, no trial');

// ---------- one period on sale is still a page with a price ----------
offering = { monthly: null, annual: product(49.99) };
p = await trialApp.prices('t');
assert.deepEqual(Object.keys(p.plans.plus), ['year'], 'the yearly card alone');
await trialApp.purchase('t', 'year');
await assert.rejects(trialApp.purchase('t', 'month'), /reopen subscriptions/, 'the missing period cannot be bought');
offering = { monthly: null, annual: null };
await assert.rejects(trialApp.prices('t'), /temporarily unavailable/, 'nothing on sale is the unavailable state');
offering = null;
console.log('PASS native subscriptions: store prices, eligible trial days (Apple intro + eligibility, Play free phase), one period on sale, sign-in, package refresh on identity change, cancellation recovery, restore, sign-out invalidates in-flight prices and queued purchases/restores, next account recovery.');
