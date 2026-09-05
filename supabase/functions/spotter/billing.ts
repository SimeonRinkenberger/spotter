// Spotter — Stripe. Checkout, the Customer Portal, webhooks, and the one writer
// of a `subscriptions` row.
//
// Two rules shape this whole file.
//
// **It must not be able to take the rest of the function down.** `index.ts` also
// serves ingest, the worker and Pumpy, and a project with no Stripe key at all
// must keep behaving exactly as it does today. So the Stripe client is built
// lazily, on the first call that actually needs it, and never at module load —
// `new Stripe(undefined!)` throws at import, which on a keyless project would
// mean every save 500s because of a billing module nobody switched on. For the
// same reason this module depends on nothing from `index.ts`: it reads its own
// environment and talks to PostgREST itself, so there is no import cycle to
// reason about and no way for an edit here to change a code path over there.
// The five helpers below are deliberately the same shape (and send the same
// `Prefer` headers) as their twins in index.ts.
//
// **Stripe is a signal, never the state.** Stripe does not guarantee event
// order and says so; two events about the same subscription can carry the same
// timestamp. So no handler here reads a payload as truth. Every event, and the
// success return, and a Settings refresh, all call the same
// `syncStripeCustomer(customerId)`, which asks Stripe what the customer's
// subscriptions are NOW and overwrites one row. Replaying an event rewrites an
// identical row; a re-ordered pair converges. Debugging becomes "did the row
// match Stripe at sync time" instead of "which of nine handlers wrote this".

import Stripe from "npm:stripe@^22";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as index.ts: legacy service keys are JWTs and want a Bearer header,
// new sb_secret_ keys are not JWTs and must go as `apikey` only.
const KEY_IS_JWT = (SERVICE_KEY ?? "").split(".").length === 3;
const dbHeaders: Record<string, string> = KEY_IS_JWT
  ? { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }
  : { apikey: SERVICE_KEY, "content-type": "application/json" };

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://simeonrinkenberger.github.io,http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** The four lookup keys the whole integration is addressed by. No price ids anywhere. */
export const PRICE_LOOKUP_KEYS = [
  "spotter_plus_month", "spotter_plus_year", "spotter_pro_month", "spotter_pro_year",
];

/**
 * The founding offer: $10 off the first year, first 200 accounts.
 *
 * A fixed coupon id rather than a promotion code, because it is not a code
 * anybody types — it is applied to every yearly checkout automatically for as
 * long as the coupon exists and Stripe still calls it valid. Stripe's own
 * `max_redemptions` counter is what closes the offer, so there is no "how many
 * are left" number kept on our side to drift out of step. The owner switches the
 * offer off by deleting the coupon in the Dashboard; nothing here needs a deploy.
 */
export const FOUNDING_COUPON_ID = "SPOTTER_FOUNDING_YEAR";

/**
 * The product tax code Managed Payments insists on: Software as a service,
 * personal use. The setup script writes it when it creates a product; this is
 * the copy the function uses to repair a product that lost it (an edit in the
 * Dashboard, a product made by hand) rather than refuse every checkout until
 * somebody re-runs the script. Stripe Tax reads the same field if it is ever
 * switched on instead.
 */
export const PRODUCT_TAX_CODE = "txcd_10103000";

/** Statuses that entitle. Kept in step with the migration's trigger, by hand and on purpose. */
const ENTITLING = new Set(["trialing", "active", "past_due"]);

/**
 * A billing failure that already knows what the user should be told. Every route
 * in index.ts catches it and answers with its status and code; anything else that
 * escapes is a 500 and a log line, which is the correct treatment for a surprise.
 */
export class BillingError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

// ---------- the client ----------

let client: Stripe | null = null;

/** True when the owner has set a secret key. Every billing route asks this first. */
export function billingConfigured(): boolean {
  return !!(Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
}

/**
 * The Stripe client, built on first use.
 *
 * stripe-node pins the API version it was built against, so `apiVersion` is left
 * unset — passing a mismatched one breaks the types and buys nothing. The env
 * override exists for the one case it is worth having: an account pinned to an
 * older version during a migration.
 */
function stripeClient(): Stripe {
  if (client) return client;
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!key) throw new BillingError(503, "not_configured", "Plans are not switched on yet.");
  const version = (Deno.env.get("STRIPE_API_VERSION") ?? "").trim();
  client = new Stripe(key, version ? { apiVersion: version as Stripe.LatestApiVersion } : undefined);
  return client;
}

// Deno verifies webhook signatures through Web Crypto, which is async — the
// synchronous constructEvent() throws here. Built once; it holds no key.
let cryptoProvider: Stripe.CryptoProvider | null = null;
function subtle(): Stripe.CryptoProvider {
  if (!cryptoProvider) cryptoProvider = Stripe.createSubtleCryptoProvider();
  return cryptoProvider;
}

// ---------- PostgREST, the small corner of it this module needs ----------

function rest(table: string): string {
  return `${SUPABASE_URL}/rest/v1/${table}`;
}

async function bSelect(table: string, query: string): Promise<any[]> {
  const r = await fetch(`${rest(table)}?${query}`, { headers: dbHeaders });
  if (!r.ok) throw new Error(`billing db select ${table} ${r.status}: ${await r.text()}`);
  return await r.json();
}

/** Insert one row and get it back. `prefer` lets the event claim ask for ignore-duplicates. */
async function bInsert(
  table: string, row: Record<string, unknown>, query = "", prefer = "return=representation",
): Promise<any[]> {
  const r = await fetch(`${rest(table)}${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { ...dbHeaders, prefer },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`billing db insert ${table} ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

/** Upsert on the primary key. Throws, unlike index.ts's — a lost sync must retry. */
async function bUpsert(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await fetch(rest(table), {
    method: "POST",
    headers: { ...dbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`billing db upsert ${table} ${r.status}: ${await r.text()}`);
  await r.body?.cancel();
}

async function bPatch(table: string, query: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${rest(table)}?${query}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`billing db patch ${table} ${r.status}: ${await r.text()}`);
  await r.body?.cancel();
}

async function bDelete(table: string, query: string): Promise<void> {
  const r = await fetch(`${rest(table)}?${query}`, { method: "DELETE", headers: dbHeaders });
  if (!r.ok) throw new Error(`billing db delete ${table} ${r.status}: ${await r.text()}`);
  await r.body?.cancel();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ---------- the two dials ----------

// `billing.trial_days` and `billing.tax` live in app_config beside every other
// dial. index.ts's model cache does not carry them — it refreshes on a timer for
// hot paths, and these are read only by checkout, which happens a handful of
// times a day. So this is its own read on its own TTL rather than a second timer
// on somebody else's cache.
type BillingCfg = { trialDays: number; tax: boolean; managed: boolean };
const CFG_TTL_MS = 5 * 60_000;
let cfgCache: { at: number; cfg: BillingCfg } | null = null;

async function billingCfg(): Promise<BillingCfg> {
  if (cfgCache && Date.now() - cfgCache.at < CFG_TTL_MS) return cfgCache.cfg;
  // Managed Payments defaults to ON here as well as in Stripe: a new account has
  // it switched on, and a missing row must not silently move the tax liability
  // back onto the owner. `billing.managed_payments = false` is the deliberate act.
  const cfg: BillingCfg = { trialDays: 0, tax: false, managed: true };
  try {
    const rows = await bSelect("app_config",
      "key=in.(billing.trial_days,billing.tax,billing.managed_payments)&select=key,value");
    for (const r of rows) {
      if (r.key === "billing.trial_days") {
        const n = Number(String(r.value ?? "").trim());
        // A typo must not hand out a two-year trial: anything unreadable is no trial.
        if (Number.isFinite(n) && n >= 0 && n <= 730) cfg.trialDays = Math.floor(n);
      } else if (r.key === "billing.tax") {
        cfg.tax = String(r.value ?? "").trim().toLowerCase() === "true";
      } else if (r.key === "billing.managed_payments") {
        cfg.managed = String(r.value ?? "").trim().toLowerCase() !== "false";
      }
    }
    cfgCache = { at: Date.now(), cfg };
  } catch (e) {
    // A dial that cannot be read is the conservative dial: no trial, no tax of
    // our own, and Stripe as merchant of record.
    console.error("billing config unreadable, using no trial, no tax, managed —", e);
  }
  return cfg;
}

// ---------- customers ----------

async function customerIdFor(userId: string): Promise<string | null> {
  const rows = await bSelect("billing_customers", `user_id=eq.${userId}&select=stripe_customer_id`);
  return rows[0]?.stripe_customer_id ?? null;
}

/**
 * The user's Stripe Customer, made once and reused for ever.
 *
 * Checkout is never allowed to create the customer: in subscription mode, passing
 * neither `customer` nor `customer_email` mints a brand-new Customer on every
 * checkout, and then the webhook cannot answer "which user is this". Creating it
 * here, before Checkout, is what makes the customer id the join key for the whole
 * integration.
 */
export async function ensureCustomer(userId: string, email: string): Promise<string> {
  const existing = await customerIdFor(userId);
  if (existing) return existing;

  const customer = await stripeClient().customers.create(
    { email: email || undefined, metadata: { user_id: userId } },
    // Survives a retried request: two clicks on Upgrade cannot make two customers.
    { idempotencyKey: `spotter-customer-${userId}` },
  );
  try {
    await bInsert("billing_customers", { user_id: userId, stripe_customer_id: customer.id });
  } catch (e) {
    // Lost a race with another tab. The row that won is the one that counts —
    // ours is an orphan Customer in Stripe with no subscription, which is free
    // and harmless, and the idempotency key means there is at most one of them.
    const again = await customerIdFor(userId);
    if (!again) throw e;
    console.log("billing: customer race for", userId, "— keeping", again);
    return again;
  }
  return customer.id;
}

// ---------- prices ----------

// Prices change about once a year and Checkout is not a hot path, but a price
// lookup on every paywall open would still be a Stripe round trip per user per
// visit. Five minutes in-isolate is plenty, and a re-price takes effect on its
// own within that.
const PRICE_TTL_MS = 5 * 60_000;
type Catalog = { byKey: Record<string, Stripe.Price>; founding: Stripe.Coupon | null };
let priceCache: { at: number; catalog: Catalog } | null = null;

/**
 * The founding coupon as Stripe currently sees it, or null.
 *
 * Null covers all three ways the offer can be over — never created, deleted by
 * the owner, or all 200 redeemed, which Stripe reports by flipping `valid` to
 * false — so no caller has to know the difference. A Stripe error that is NOT
 * "no such coupon" is also null: an offer that cannot be confirmed must not be
 * promised on the paywall or passed to Checkout.
 */
async function loadFounding(): Promise<Stripe.Coupon | null> {
  try {
    const c = await stripeClient().coupons.retrieve(FOUNDING_COUPON_ID);
    return c && c.valid ? c : null;
  } catch (e) {
    const err = e as Stripe.errors.StripeError;
    if (err?.code !== "resource_missing" && err?.statusCode !== 404) {
      console.error("billing: founding coupon lookup failed —", e);
    }
    return null;
  }
}

/**
 * The prices and the founding coupon, fetched together and cached together.
 *
 * They are one thing as far as the paywall is concerned — a yearly card either
 * shows $39.99 or $29.99-then-$39.99 — so caching them separately would let the
 * sheet show an offer that checkout no longer applies, for up to five minutes.
 * One round trip pair, one expiry.
 */
async function loadCatalog(): Promise<Catalog> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.catalog;
  const [res, founding] = await Promise.all([
    stripeClient().prices.list({
      lookup_keys: PRICE_LOOKUP_KEYS, active: true, expand: ["data.product"],
    }),
    loadFounding(),
  ]);
  const byKey: Record<string, Stripe.Price> = {};
  for (const p of res.data) if (p.lookup_key) byKey[p.lookup_key] = p;
  const catalog = { byKey, founding };
  priceCache = { at: Date.now(), catalog };
  return catalog;
}

export async function priceByLookupKey(key: string): Promise<Stripe.Price | null> {
  const { byKey } = await loadCatalog();
  return byKey[key] ?? null;
}

/**
 * The plans somebody could actually buy this minute: a plan is here only when
 * Stripe has an active price for it.
 *
 * This is what makes `upgrade` on a cap 429 honest. `pro` is seeded in the cap
 * table as the price-raise valve but has no Stripe product, so a Plus subscriber
 * who trips a daily ceiling must be told "that is the ceiling", not sold a tier
 * that does not exist. And with no key at all the answer is nobody-can-buy-
 * anything, which is exactly right: a project running without billing should
 * never show a paywall.
 */
export async function sellablePlans(): Promise<string[]> {
  if (!billingConfigured()) return [];
  try {
    const { byKey } = await loadCatalog();
    const plans = new Set<string>();
    for (const [key, price] of Object.entries(byKey)) {
      if (price && typeof price.unit_amount === "number") plans.add(key.split("_")[1]);
    }
    return [...plans];
  } catch (e) {
    // Same direction as everything else here: when Stripe cannot be asked, sell
    // nothing rather than advertise something that might not be there.
    console.error("billing: could not list sellable plans —", e);
    return [];
  }
}

/** What one plan's first-year price is with the founding coupon applied. */
function discounted(amount: number, coupon: Stripe.Coupon): number {
  if (typeof coupon.amount_off === "number") return Math.max(0, amount - coupon.amount_off);
  if (typeof coupon.percent_off === "number") {
    return Math.max(0, Math.round(amount * (1 - coupon.percent_off / 100)));
  }
  return amount;
}

/**
 * What `GET /api/billing/prices` answers with. Only plans that actually have a
 * price in Stripe appear — the setup script creates Plus today and Pro the day
 * the owner decides to sell it, and this needs no edit for that to work.
 *
 * `founding` is null unless the coupon exists, is valid, and the yearly price it
 * discounts is on sale, so the sheet can render the offer from `first_year_amount`
 * without doing arithmetic on a coupon shape it should not have to know about.
 * `remaining` is Stripe's own counter, not ours.
 */
export async function pricesBlock(): Promise<Record<string, unknown>> {
  const { byKey, founding } = await loadCatalog();
  const cfg = await billingCfg();
  const plans: Record<string, Record<string, unknown>> = {};
  let currency = "usd";
  for (const key of PRICE_LOOKUP_KEYS) {
    const price = byKey[key];
    if (!price || typeof price.unit_amount !== "number") continue;
    const [, plan, interval] = key.split("_");
    currency = price.currency || currency;
    const product = price.product;
    const block = (plans[plan] ??= {});
    // The product name belongs to the plan, not to one of its two prices —
    // "Spotter Plus" is the same product whether it is billed monthly or yearly.
    if (!block.name && product && typeof product === "object" && "name" in product) {
      block.name = product.name;
    }
    block[interval] = { amount: price.unit_amount, lookup_key: key };
  }

  const yearly = (plans.plus?.year ?? null) as { amount?: number } | null;
  const foundingBlock = founding && typeof yearly?.amount === "number"
    ? {
      first_year_amount: discounted(yearly.amount, founding),
      remaining: typeof founding.max_redemptions === "number"
        ? Math.max(0, founding.max_redemptions - (founding.times_redeemed ?? 0))
        : null,
    }
    : null;

  return {
    configured: true, currency, trial_days: cfg.trialDays, plans, founding: foundingBlock,
  };
}

// ---------- the one writer ----------

// Which subscription is "the" subscription when Stripe has several. An entitling
// one always wins; among equals the newest does. Nothing here is a tie-break on
// `created` alone, because a canceled subscription created yesterday must not
// beat the active one created last month.
const STATUS_RANK: Record<string, number> = {
  trialing: 5, active: 5, past_due: 4, unpaid: 3,
  paused: 2, incomplete: 1, incomplete_expired: 0, canceled: 0,
};

/**
 * Overwrite one user's `subscriptions` row from what Stripe says right now.
 *
 * The only writer. Called by every webhook event, by the success return, and by
 * a Settings refresh — all three converge on the same row, which is the entire
 * point: there is no ordering to get wrong and no payload to half-trust.
 */
export async function syncStripeCustomer(customerId: string): Promise<void> {
  const link = await bSelect("billing_customers", `stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id`);
  const userId = link[0]?.user_id;
  if (!userId) return;   // not one of ours — a `stripe trigger` fixture, or another integration

  const subs = await stripeClient().subscriptions.list({
    customer: customerId, status: "all", limit: 10, expand: ["data.items.data.price"],
  });
  const sub = subs.data.slice().sort(
    (a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || b.created - a.created,
  )[0];

  if (!sub) {
    // No subscription at all: drop the row and let the trigger put them on free.
    await bDelete("subscriptions", `user_id=eq.${userId}`);
    console.log("billing: no subscription for", userId, "— row removed");
    return;
  }

  const item = sub.items.data[0];
  const price = item?.price;
  const lk = price?.lookup_key ?? null;
  // Basil (API 2025-03-31) moved the period off the subscription and onto the
  // item. Reading the old field gets `undefined` and no error, which is how this
  // becomes a renewal date that silently stops moving.
  const periodEnd = item?.current_period_end ?? null;
  // Flexible billing mode signals "cancels at the end of the period" through
  // `cancel_at` rather than `cancel_at_period_end`, so both are checked.
  const willCancel = sub.cancel_at_period_end === true || sub.cancel_at != null;
  const failing = sub.status === "past_due" || sub.status === "unpaid";

  // Keep the FIRST payment_failed_at for as long as it is still failing, so
  // Settings can say how long it has been broken rather than resetting the clock
  // on every retry.
  const prev = await bSelect("subscriptions", `user_id=eq.${userId}&select=payment_failed_at`);

  await bUpsert("subscriptions", {
    user_id: userId,
    source: "stripe",
    external_id: sub.id,
    // spotter_plus_month -> plus. A price with no lookup key should not exist —
    // the setup script always sets one — so 'plus' is the floor, not a guess.
    plan: lk?.split("_")[1] === "pro" ? "pro" : "plus",
    status: sub.status,
    price_lookup_key: lk,
    interval: price?.recurring?.interval === "year" ? "year"
      : price?.recurring?.interval === "month" ? "month" : null,
    cancel_at_period_end: willCancel,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    payment_failed_at: failing
      ? (prev[0]?.payment_failed_at ?? new Date().toISOString())
      : null,
    // Trimmed on purpose: enough to answer a support question, not a copy of
    // Stripe's database in ours.
    raw: {
      id: sub.id, status: sub.status, cancel_at: sub.cancel_at,
      cancel_at_period_end: sub.cancel_at_period_end,
      price: price?.id ?? null, lookup_key: lk,
      latest_invoice: typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id ?? null,
      synced_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  });
  console.log("billing: synced", userId, sub.id, sub.status, lk ?? "no-lookup-key");
}

/** True when this user's row entitles them today. Used to refuse a second checkout. */
async function entitledNow(userId: string): Promise<boolean> {
  const rows = await bSelect("subscriptions", `user_id=eq.${userId}&select=status`);
  return ENTITLING.has(String(rows[0]?.status ?? ""));
}

// ---------- where the browser comes back to ----------

/**
 * The origin+path Checkout and the Portal are allowed to send the user back to.
 *
 * An open redirect here would be a phishing primitive with Stripe's name on it,
 * so the rule is narrow and positive rather than a blocklist: the origin must be
 * one this function already serves CORS for, the path may contain only the
 * characters a static site needs, and there is no query and no fragment (those
 * are ours to append). Anything else falls back to the app's own address.
 */
export function returnBaseFrom(raw: unknown, _req?: Request): string {
  const fallback = `${ALLOWED_ORIGINS[0]}/spotter/`;
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return fallback;
  }
  if (!ALLOWED_ORIGINS.includes(u.origin)) return fallback;
  if (u.search || u.hash) return fallback;
  if (!/^\/[A-Za-z0-9_\-./]*$/.test(u.pathname)) return fallback;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  return `${u.origin}${path}`;
}

// ---------- checkout ----------

/**
 * A hosted Checkout Session for one plan and one interval.
 *
 * Three things here are load-bearing and easy to get wrong. `customer` (never
 * `customer_email`) reuses the one Customer this user already has. The trial —
 * when there is one — is attached to the ANNUAL price only, with a card taken up
 * front: the free tier already does the "try it" job, so the trial exists to
 * de-risk a year's commitment, not to hand out a free week of the monthly plan,
 * and a card at signup is what makes it convert rather than lapse. (No
 * `payment_method_collection`, no `trial_settings`: both only matter for a
 * card-free trial, and this is not one.) And `discounts` and
 * `allow_promotion_codes` are mutually exclusive in one session — passing both is
 * a 400 from Stripe — so a yearly checkout with the founding offer takes the
 * coupon and gives up the promo box, which is the right trade when the coupon is
 * the better of the two anyway.
 */
export async function createCheckout(
  userId: string, email: string, plan: string, interval: string, returnBase: string,
): Promise<string> {
  if (await entitledNow(userId)) {
    throw new BillingError(409, "already_subscribed",
      "You are already subscribed — open Manage subscription to change or cancel it.");
  }
  const key = `spotter_${plan}_${interval}`;
  const { byKey, founding } = await loadCatalog();
  const price = byKey[key];
  if (!price) {
    throw new BillingError(503, "price_missing", "That plan is not on sale yet.");
  }

  const cfg = await billingCfg();
  const customer = await ensureCustomer(userId, email);
  const trialDays = cfg.trialDays > 0 && interval === "year" ? cfg.trialDays : 0;
  // Yearly only, and only if the coupon is actually scoped to this product —
  // otherwise Stripe would reject the session, the retry below would fire, and
  // the person would wait for two round trips to reach the same page.
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  await ensureTaxCode(price);
  const appliesTo = founding?.applies_to?.products ?? null;
  const coupon = interval === "year" && founding
      && (!appliesTo || appliesTo.includes(productId))
    ? founding.id
    : null;

  const params = (withCoupon: boolean): Stripe.Checkout.SessionCreateParams => ({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price: price.id, quantity: 1 }],
    ...(withCoupon && coupon
      ? { discounts: [{ coupon }] }
      : { allow_promotion_codes: true }),
    success_url: `${returnBase}billing-return.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}?billing=cancel`,
    subscription_data: {
      metadata: { user_id: userId },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    // Managed Payments: Stripe is the merchant of record, so it calculates,
    // withholds and remits sales tax, VAT and GST itself, handles disputes and
    // transaction support, and the customer sees "Sold through Link". Always
    // stated explicitly, both ways — a new Stripe account has it on by default,
    // and whether this account sells as itself or through Stripe is a decision
    // the config makes, never one the account's default makes for it. It needs
    // a tax code on the Product (the setup script sets one) and forbids
    // `automatic_tax` and `customer_update` on the session, hence the guard on
    // the tax block below.
    managed_payments: { enabled: cfg.managed },
    // Only when a registration exists AND the owner is the merchant of record.
    // `customer_update.address` defaults to `never`, which silently reuses
    // whatever address is already on the Customer — the failure that looks like
    // success — so it is set explicitly here.
    ...(cfg.tax && !cfg.managed
      ? {
        automatic_tax: { enabled: true },
        billing_address_collection: "required" as const,
        customer_update: { address: "auto" as const },
      }
      : {}),
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.create(params(true));
  } catch (e) {
    // The coupon can be gone between the cache being filled and this call — the
    // 200th person redeems it, or the owner deletes it mid-session. Losing $10
    // off is annoying; losing the sale because the discount expired thirty
    // seconds ago is worse, so the second attempt is at full price.
    if (!coupon) throw e;
    // Drop the cached coupon so the next paywall stops advertising it.
    if (priceCache) priceCache.catalog.founding = null;
    console.error("billing: founding coupon refused, retrying at full price —", e);
    session = await stripeClient().checkout.sessions.create(params(false));
  }
  if (!session.url) throw new BillingError(502, "no_checkout_url", "Stripe did not return a checkout page.");
  console.log("billing: checkout", userId, key, trialDays ? `trial ${trialDays}d` : "no trial",
    coupon ? `coupon ${coupon}` : "no coupon");
  return session.url;
}

/**
 * Make sure the product behind a price carries a tax code before Checkout is
 * asked to sell it. Managed Payments refuses the session otherwise, and the
 * first real checkout on this account failed exactly that way. Once per
 * product per isolate: the catalog is expanded with its products, so this is
 * a field read on the happy path and a single update on the unhappy one.
 */
const taxCodeSeen = new Set<string>();
async function ensureTaxCode(price: Stripe.Price): Promise<void> {
  const product = price.product;
  if (typeof product !== "object" || !product || ("deleted" in product && product.deleted)) return;
  const p = product as Stripe.Product;
  if (taxCodeSeen.has(p.id)) return;
  if (p.tax_code) { taxCodeSeen.add(p.id); return; }
  try {
    await stripeClient().products.update(p.id, { tax_code: PRODUCT_TAX_CODE });
    p.tax_code = PRODUCT_TAX_CODE;
    taxCodeSeen.add(p.id);
    console.log("billing: set tax code", PRODUCT_TAX_CODE, "on", p.id, p.name);
  } catch (e) {
    // Not fatal here: the session call below will say so in Stripe's own words
    // if the product really cannot be sold, and that error is the one to log.
    console.error("billing: could not set the product tax code on", p.id, e);
  }
}

// ---------- portal ----------

/** A fresh single-use Customer Portal URL. Never cached: they expire and burn on use. */
export async function createPortal(userId: string, returnUrl: string): Promise<string> {
  const customer = await customerIdFor(userId);
  if (!customer) {
    throw new BillingError(404, "no_customer", "There is nothing to manage yet — you have never subscribed.");
  }
  const session = await stripeClient().billingPortal.sessions.create({
    customer, return_url: returnUrl,
  });
  return session.url;
}

// ---------- the success return ----------

/**
 * Sync from the Checkout Session the browser came back with.
 *
 * Stripe's own fulfilment guidance is to do this AND handle the webhook: the
 * webhook is what makes fulfilment certain, and this is what makes it immediate
 * while the person is still looking at the screen. Both call the same sync, so
 * doing both twice is doing it once.
 */
export async function syncFromSession(userId: string, sessionId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]{8,120}$/.test(sessionId)) {
    throw new BillingError(400, "bad_session", "That checkout could not be read.");
  }
  const s = await stripeClient().checkout.sessions.retrieve(sessionId);
  // Belt and braces on top of the customer link: a session id is not a secret,
  // and one user must never be able to sync another user's checkout.
  if (s.client_reference_id !== userId) {
    throw new BillingError(403, "mismatch", "That checkout belongs to a different account.");
  }
  const cid = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
  if (cid) await syncStripeCustomer(cid);
}

/** Sync whatever Stripe currently says about this user, with no session in hand. */
export async function syncUser(userId: string): Promise<void> {
  const cid = await customerIdFor(userId);
  if (cid) await syncStripeCustomer(cid);
}

// ---------- account deletion ----------

/**
 * Cancel everything and delete the Stripe Customer, before a single row of the
 * account is touched.
 *
 * Throws on any Stripe failure, and the caller turns that into a 503 that deletes
 * nothing. An account that is gone but still billing is the one outcome that must
 * never happen, and "try again in a minute" is a far better answer than a monthly
 * charge to an address that no longer receives mail.
 */
export async function cancelAndDeleteCustomer(userId: string): Promise<void> {
  const customer = await customerIdFor(userId);
  if (!customer) return;
  if (!billingConfigured()) {
    // A customer row with no key to cancel it: refuse loudly rather than delete
    // the account and leave a live subscription behind with nobody attached.
    throw new Error("billing_customers row exists but STRIPE_SECRET_KEY is unset");
  }
  const stripe = stripeClient();
  const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
  for (const sub of subs.data) {
    if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
    await stripe.subscriptions.cancel(sub.id);
    console.log("billing: cancelled", sub.id, "for", userId);
  }
  try {
    await stripe.customers.del(customer);
  } catch (e) {
    // Already gone is the state we wanted. Anything else is a real failure.
    if ((e as Stripe.errors.StripeError)?.code !== "resource_missing") throw e;
  }
  console.log("billing: customer deleted", customer, "for", userId);
}

// ---------- webhook ----------

/** The customer this event is about, whatever kind of object it carries. */
function customerIdFromEvent(event: Stripe.Event): string | null {
  const o = event.data.object as unknown as Record<string, unknown>;
  const c = o.customer ?? (o.object === "customer" ? o.id : null);
  if (typeof c === "string") return c;
  const id = (c as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : null;
}

type Claim = "ours" | "duplicate";

/**
 * Claim an event id, or find out it is a duplicate.
 *
 * Insert-then-process is only safe if the insert can tell "already done" from
 * "somebody started this and failed". `on_conflict` + ignore-duplicates gives an
 * empty array when the row already existed; `processed_at` then decides. Without
 * this, a handler that fails and answers 500 would swallow its own retry, because
 * the row it wrote on the first attempt reads as a duplicate on the second.
 */
async function claimEvent(id: string, type: string): Promise<Claim> {
  const inserted = await bInsert(
    "billing_events", { id, type }, "on_conflict=id",
    "resolution=ignore-duplicates,return=representation",
  );
  if (inserted.length) return "ours";
  const rows = await bSelect("billing_events", `id=eq.${encodeURIComponent(id)}&select=processed_at`);
  return rows[0]?.processed_at ? "duplicate" : "ours";
}

/**
 * POST /api/billing/webhook — matched before the user-auth gate, like the worker
 * routes, because Stripe has no Supabase token and never will.
 */
export async function handleWebhook(req: Request): Promise<Response> {
  const secret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
  if (!billingConfigured() || !secret) {
    // Not 400: without the secret the signature cannot be checked at all, and a
    // 5xx tells Stripe to retry once the owner has set it rather than to give up.
    return jsonResponse({ status: "error", code: "not_configured" }, 503);
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return jsonResponse({ status: "error", code: "no_signature" }, 400);

  // Raw text first, before anything else touches the body: parsing it as JSON and
  // re-serialising changes the bytes and the HMAC no longer matches.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      raw, sig, secret,
      undefined,           // default 300s tolerance; never pass 0, it disables the recency check
      subtle(),
    );
  } catch (e) {
    console.error("billing webhook: bad signature —", e);
    return jsonResponse({ status: "error", code: "bad_signature" }, 400);
  }

  let claim: Claim;
  try {
    claim = await claimEvent(event.id, event.type);
  } catch (e) {
    console.error("billing webhook: could not claim", event.id, e);
    return jsonResponse({ status: "error", code: "claim_failed" }, 500);
  }
  if (claim === "duplicate") return jsonResponse({ status: "ok", duplicate: true });

  try {
    const customerId = customerIdFromEvent(event);
    if (customerId) await syncStripeCustomer(customerId);
    await bPatch("billing_events", `id=eq.${encodeURIComponent(event.id)}`,
      { processed_at: new Date().toISOString(), error: null });
  } catch (e) {
    console.error("billing webhook:", event.type, event.id, "failed —", e);
    try {
      await bPatch("billing_events", `id=eq.${encodeURIComponent(event.id)}`, { error: String(e).slice(0, 2000) });
    } catch (e2) {
      console.error("billing webhook: could not record the error either", e2);
    }
    // 500 so Stripe retries — three days of exponential backoff in live mode.
    return jsonResponse({ status: "error" }, 500);
  }
  return jsonResponse({ status: "ok" });
}
