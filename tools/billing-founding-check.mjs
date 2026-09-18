// The founding discount has to be OFF unless somebody switched it on. No network,
// no Stripe, no database.
//
// `"founding": {"enabled": false}` in tools/stripe-plans.json is read by the setup
// script and by nothing else, and the script deliberately deletes nothing. So the
// live coupon kept applying: the owner re-prices the annual plan to $50 and every
// new yearly subscriber quietly pays $40. The switch the repo can actually hold is
// the app_config row `billing.founding`, and these assertions are what keep it
// wired to BOTH surfaces — the paywall block and Checkout.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const src = fs.readFileSync('supabase/functions/spotter/billing.ts', 'utf8');
function fn(name) {
  const m = src.match(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
  assert(m, name);
  return src.slice(m.index, src.indexOf('\n}', m.index) + 2).replace(/^export /, '');
}

// ---------- one source of the coupon, read by both surfaces ----------
const fromCatalog = [...src.matchAll(/const \{[^}]*\bfounding\b[^}]*\} = await loadCatalog\(\);/g)];
assert.equal(fromCatalog.length, 2,
  'the paywall block and createCheckout both take the coupon from loadCatalog, so one switch governs both');
assert.equal((src.match(/(?<!function )\bloadFounding\(\)/g) ?? []).length, 1,
  'and nothing asks Stripe for the coupon outside loadCatalog');
assert.match(src, /founding: enabled \? founding : null/,
  'loadCatalog is where the switch is applied');

// ---------- the switch, run ----------
let configRows = [];
let configThrows = false;
let couponValid = true;
const coupon = { id: 'SPOTTER_FOUNDING_YEAR', valid: true, amount_off: 1000, max_redemptions: 200, times_redeemed: 7 };
const price = { lookup_key: 'spotter_plus_year', unit_amount: 5000, currency: 'usd', product: { id: 'prod_plus', name: 'Spotter Plus' } };

const logs = [];
const quiet = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) };
const c = vm.createContext({
  console: quiet, Date, Number, String, Math, Object, Promise, Array,
  PRICE_LOOKUP_KEYS: ['spotter_plus_month', 'spotter_plus_year', 'spotter_pro_month', 'spotter_pro_year'],
  FOUNDING_COUPON_ID: 'SPOTTER_FOUNDING_YEAR',
  PRICE_TTL_MS: 5 * 60_000,
  priceCache: null,
  billingCfg: async () => ({ trialDays: 7, tax: false, managed: true }),
  bSelect: async (table, query) => {
    assert.equal(table, 'app_config');
    assert.match(query, /key=eq\.billing\.founding/);
    if (configThrows) throw new Error('database unreachable');
    return configRows;
  },
  stripeClient: () => ({
    coupons: { retrieve: async () => (couponValid ? coupon : { ...coupon, valid: false }) },
    prices: { list: async () => ({ data: [price] }) },
  }),
});
vm.runInContext(transformSync(
  'let priceCache = null;\n' + ['loadFounding', 'foundingEnabled', 'loadCatalog', 'discounted', 'pricesBlock'].map(fn).join('\n') +
  '\nglobalThis.run = async (reset) => { if (reset) priceCache = null; return await pricesBlock(); };',
  { loader: 'ts', format: 'cjs' }).code, c);
const block = async () => await c.run(true);

configRows = [];
assert.equal((await block()).founding, null,
  'an absent billing.founding row sells at full price even though Stripe still has a valid coupon');
assert.equal((await block()).plans.plus.year.amount, 5000, 'and the standing annual price is unchanged');

configRows = [{ value: 'true' }];
const on = await block();
assert.equal(on.founding.first_year_amount, 4000,
  'the string true, and only the string true, switches the offer on');
assert.equal(on.founding.remaining, 193, 'and the counter is Stripe’s own');

for (const value of ['false', '1', 'yes', 'on', '', null, undefined, 'TRUE ']) {
  configRows = [{ value }];
  const got = await block();
  if (String(value ?? '').trim().toLowerCase() === 'true') {
    assert(got.founding, 'case and surrounding space are not a reason to sell at full price: ' + JSON.stringify(value));
  } else {
    assert.equal(got.founding, null, 'anything that is not true is off: ' + JSON.stringify(value));
  }
}

configRows = [{ value: 'true' }];
configThrows = true;
assert.equal((await block()).founding, null,
  'an unreadable dial is the conservative dial, and for a discount that is full price');
configThrows = false;

couponValid = false;
assert.equal((await block()).founding, null, 'a switched-on offer whose coupon Stripe has retired is still null');
couponValid = true;

// The cache is shared, so a stale switch cannot outlive a stale price.
configRows = [{ value: 'true' }];
assert(( await block()).founding, 'warm the cache');
configRows = [];
assert((await c.run(false)).founding, 'within the TTL the whole catalog is one snapshot');
assert.equal((await block()).founding, null, 'and it expires as one');

// ---------- the copy Stripe shows at Checkout ----------
const plans = JSON.parse(fs.readFileSync('tools/stripe-plans.json', 'utf8'));
const plus = plans.products.find((p) => p.key === 'plus');
assert.equal(plus.prices.find((p) => p.interval === 'year').unit_amount, 5000);
assert.equal(plans.founding.enabled, false);
// ensureProduct sends `description` on every run, so this string is on the page the
// customer buys from. It follows the paywall's rule: no unlimited AI, and no
// numeric allowance the cost controls cannot deliver.
assert.doesNotMatch(plus.description, /\ba day\b|\bdaily\b|unlimited (?!library)/i,
  'the Stripe product description must not advertise daily numeric allowances or unlimited AI');
assert.match(plus.description, /20 full video reads a month/);
assert.match(plus.description, /always free/);

// The owner has to be able to SEE that a live coupon is being ignored, or the
// switch is just a silent second place for the price to be wrong.
assert(logs.some((l) => l.includes('still exists in Stripe but billing.founding is not true')),
  'an ignored live coupon is logged, not swallowed');
assert(logs.some((l) => l.includes('founding switch unreadable')));

console.log('PASS the founding discount is off unless app_config billing.founding is true, on both surfaces, and the Checkout product copy carries no allowance claim.');
