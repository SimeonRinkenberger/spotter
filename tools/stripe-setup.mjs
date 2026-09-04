#!/usr/bin/env node
// Spotter — one-time (and re-runnable) Stripe setup.
//
// Creates the products, the prices, the Customer Portal configuration and the
// webhook endpoint that `supabase/functions/spotter/billing.ts` expects, from the
// numbers in `tools/stripe-plans.json`. Run it once against a test key, verify,
// then once against the live key: portal configurations and webhook endpoints are
// per mode, so the live account genuinely needs its own run.
//
//   STRIPE_SECRET_KEY=sk_test_… node tools/stripe-setup.mjs
//   STRIPE_SECRET_KEY=sk_live_… node tools/stripe-setup.mjs --live
//   STRIPE_SECRET_KEY=sk_test_… node tools/stripe-setup.mjs --dry-run
//
// Usually you want `tools/stripe-setup.sh`, which prompts for the key without
// echoing it and stores the secrets for you. This file is the part that talks to
// Stripe, and it deliberately has no dependencies: plain fetch, form-encoded
// bodies, Basic auth. A setup script that needs `npm install` is a setup script
// that stops working in a year.
//
// Everything here is idempotent, and the idempotency keys are chosen so that
// renaming things in the Dashboard cannot confuse it:
//   products  by metadata.spotter_key  (NOT by name — names are for humans)
//   prices    by lookup_key            (the same key the function looks them up by)
//   coupon    by its fixed id          (SPOTTER_FOUNDING_YEAR, chosen not generated)
//   portal    by metadata.spotter      (one configuration, versioned)
//   webhook   by url                   (there can only be one endpoint per URL)
//
// It never writes a secret to disk and never prints the API key. The webhook
// signing secret is printed exactly once, on the run that creates the endpoint,
// because that is the only time Stripe returns it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://api.stripe.com/v1";
// Pinned so a re-run next year behaves the way this script was written and
// tested, rather than following whatever the account default has moved to.
const API_VERSION = "2026-08-26.dahlia";

const here = dirname(fileURLToPath(import.meta.url));
const PLANS_PATH = join(here, "stripe-plans.json");

const args = new Set(process.argv.slice(2));
const LIVE = args.has("--live");
const DRY = args.has("--dry-run");

const KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();

// Collected as we go and printed at the end, so the owner reads one list rather
// than hunting for instructions scattered through the log.
const followUps = [];

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ---------- the smallest Stripe client that does the job ----------

/**
 * Stripe's form encoding: nested objects become `a[b]`, arrays `a[0]`. Null and
 * undefined are dropped rather than sent as the string "null", which Stripe would
 * happily store.
 */
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") form(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") {
      form(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

async function call(method, path, body) {
  const isGet = method === "GET";
  const qs = isGet && body ? `?${form(body).toString()}` : "";
  const res = await fetch(`${API}/${path}${qs}`, {
    method,
    headers: {
      // Basic auth with the key as the username and an empty password. The key
      // never reaches a URL or an argv, so it cannot end up in a shell history.
      Authorization: `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`,
      "Stripe-Version": API_VERSION,
      ...(isGet ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    ...(isGet ? {} : { body: form(body ?? {}).toString() }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = json?.error ?? {};
    const e = new Error(`${res.status} ${err.type ?? ""} ${err.message ?? text}`.trim());
    e.status = res.status;
    e.param = err.param;
    e.code = err.code;
    throw e;
  }
  return json;
}

const get = (path, params) => call("GET", path, params);
const post = (path, body) => call("POST", path, body);

/** Every page of a list endpoint. A hundred at a time is more than this ever needs. */
async function listAll(path, params = {}) {
  const out = [];
  let startingAfter;
  for (let page = 0; page < 10; page++) {
    const res = await get(path, { limit: 100, ...params, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    out.push(...(res.data ?? []));
    if (!res.has_more || !out.length) break;
    startingAfter = out[out.length - 1].id;
  }
  return out;
}

function would(what) {
  console.log(`  · would ${what}`);
}

// ---------- steps ----------

async function ensureProduct(product) {
  const all = await listAll("products", { active: "true" });
  const found = all.find((p) => p.metadata?.spotter_key === product.key);
  const fields = {
    name: product.name,
    description: product.description,
    metadata: { spotter_key: product.key },
  };
  if (found) {
    if (DRY) { would(`update product ${found.id} (${product.name})`); return found; }
    const updated = await post(`products/${found.id}`, fields);
    console.log(`  ✓ product ${updated.id} — ${updated.name} (updated)`);
    return updated;
  }
  if (DRY) { would(`create product "${product.name}"`); return { id: `prod_dryrun_${product.key}` }; }
  const created = await post("products", fields);
  console.log(`  ✓ product ${created.id} — ${created.name} (created)`);
  return created;
}

async function ensurePrice(productId, currency, spec) {
  const res = await get("prices", { lookup_keys: [spec.lookup_key], active: "true", limit: 10 });
  const existing = (res.data ?? [])[0];

  if (existing
    && existing.unit_amount === spec.unit_amount
    && existing.currency === currency
    && existing.recurring?.interval === spec.interval
    && existing.product === productId) {
    console.log(`  = price ${existing.id} — ${spec.lookup_key} ${money(spec.unit_amount, currency)}/${spec.interval} (unchanged)`);
    return existing;
  }

  if (existing) {
    console.log(`  ! ${spec.lookup_key} changes: ${money(existing.unit_amount, existing.currency)} -> ${money(spec.unit_amount, currency)}`);
    console.log("    Prices are immutable in Stripe, so this makes a NEW price, moves the");
    console.log("    lookup key onto it, and deactivates the old one. Anyone already");
    console.log("    subscribed keeps the price they bought — Stripe never re-prices them.");
  }
  if (DRY) {
    would(existing
      ? `create a replacement price for ${spec.lookup_key} and deactivate ${existing.id}`
      : `create price ${spec.lookup_key} ${money(spec.unit_amount, currency)}/${spec.interval}`);
    return { id: `price_dryrun_${spec.lookup_key}` };
  }

  const created = await post("prices", {
    product: productId,
    currency,
    unit_amount: spec.unit_amount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookup_key,
    // Steals the key off the old price in the same call, so there is never a
    // moment where the function's lookup finds nothing.
    transfer_lookup_key: true,
  });
  console.log(`  ✓ price ${created.id} — ${spec.lookup_key} ${money(spec.unit_amount, currency)}/${spec.interval} (created)`);

  if (existing) {
    await post(`prices/${existing.id}`, { active: false });
    console.log(`  ✓ price ${existing.id} deactivated (old ${spec.lookup_key})`);
  }
  return created;
}

/**
 * The founding offer, as a coupon with an id we chose rather than one Stripe
 * generated — that is what lets the edge function ask for it by name.
 *
 * Coupons are almost entirely immutable: only the name and metadata can be
 * changed after creation, so an existing coupon whose numbers no longer match
 * the JSON is reported rather than "fixed", because the only way to fix it is to
 * delete it, and deleting it while it is live would strip the discount off
 * anyone mid-checkout. Ending the offer is the owner's deliberate act in the
 * Dashboard, never a side effect of re-running a setup script.
 */
async function ensureFounding(spec, productId) {
  if (!spec || spec.enabled === false) {
    console.log("  – no founding offer configured (\"enabled\": false in stripe-plans.json)");
    followUps.push(
      "If a founding coupon still exists from an earlier run, the function will keep applying " +
      `it to yearly checkouts. Delete ${spec?.id ?? "the coupon"} in Products > Coupons to end the offer.`,
    );
    return;
  }

  let found = null;
  try {
    found = await get(`coupons/${encodeURIComponent(spec.id)}`);
  } catch (e) {
    // "No such coupon" is the ordinary first-run answer, not a failure.
    if (e.status !== 404) throw e;
  }

  if (found) {
    const same = found.amount_off === spec.amount_off
      && found.duration === spec.duration
      && found.max_redemptions === spec.max_redemptions;
    const left = typeof found.max_redemptions === "number"
      ? `${found.max_redemptions - (found.times_redeemed ?? 0)} of ${found.max_redemptions} left`
      : "unlimited";
    console.log(`  = coupon ${found.id} — ${money(found.amount_off, found.currency)} off, ${left}` +
      `${found.valid ? "" : ", NO LONGER VALID (all redeemed)"}`);
    if (!same) {
      console.log("    ! It does not match stripe-plans.json. Coupons are immutable in Stripe.");
      followUps.push(
        `Coupon ${found.id} does not match stripe-plans.json. To change the offer, delete it in ` +
        "Products > Coupons and run this script again — but only when nobody is mid-checkout.",
      );
    }
    return;
  }

  if (DRY) { would(`create coupon ${spec.id} (${money(spec.amount_off, "usd")} off the first year, ${spec.max_redemptions} redemptions)`); return; }

  const created = await post("coupons", {
    id: spec.id,
    name: spec.name,
    amount_off: spec.amount_off,
    currency: spec.currency ?? "usd",
    duration: spec.duration,
    max_redemptions: spec.max_redemptions,
    // Scoped to the product, so it can never be applied to something else later.
    ...(productId ? { applies_to: { products: [productId] } } : {}),
  });
  console.log(`  ✓ coupon ${created.id} — ${money(created.amount_off, created.currency)} off, ` +
    `${created.max_redemptions} redemptions (created)`);
  console.log("    The function applies it to every YEARLY checkout while it is valid. Delete it");
  console.log("    in Products > Coupons to end the offer — nothing needs redeploying.");
}

async function ensurePortal(plans, catalog) {
  const all = await listAll("billing_portal/configurations");
  const found = all.find((c) => c.metadata?.spotter === "v1");

  const body = {
    business_profile: {
      headline: "Spotter",
      privacy_policy_url: `${plans.site}/privacy.html`,
      terms_of_service_url: `${plans.site}/terms.html`,
    },
    default_return_url: `${plans.site}/`,
    metadata: { spotter: "v1" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      // Plan switching needs a product catalog on the configuration, or Stripe
      // refuses the update feature outright. Listing every product with all of
      // its prices is what puts month<->year (and Plus<->Pro, when Pro is sold)
      // on one screen.
      subscription_update: {
        enabled: catalog.length > 0,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: catalog,
      },
    },
  };

  if (DRY) { would(found ? `update portal configuration ${found.id}` : "create the portal configuration"); return; }

  let cfg;
  if (found) {
    cfg = await post(`billing_portal/configurations/${found.id}`, body);
    console.log(`  ✓ portal configuration ${cfg.id} (updated)`);
  } else {
    cfg = await post("billing_portal/configurations", body);
    console.log(`  ✓ portal configuration ${cfg.id} (created)`);
  }

  if (!cfg.is_default) {
    followUps.push(
      `Settings > Billing > Customer portal: make configuration ${cfg.id} the default ` +
      "(Spotter mints portal sessions without naming a configuration, so the default is the one people get).",
    );
  }
}

async function ensureWebhook(url, events) {
  const all = await listAll("webhook_endpoints");
  const found = all.find((e) => e.url === url);

  if (found) {
    if (DRY) { would(`update webhook endpoint ${found.id} with ${events.length} events`); return; }
    await post(`webhook_endpoints/${found.id}`, { enabled_events: events, disabled: false });
    console.log(`  ✓ webhook endpoint ${found.id} (updated, ${events.length} events)`);
    console.log("    The signing secret is only ever returned when the endpoint is created.");
    console.log("    If you need it again: Stripe Dashboard > Workbench > Webhooks > this");
    console.log("    endpoint > Roll secret, then set STRIPE_WEBHOOK_SECRET to the new one.");
    return;
  }

  if (DRY) { would(`create the webhook endpoint at ${url}`); return; }
  const created = await post("webhook_endpoints", {
    url,
    enabled_events: events,
    description: "Spotter — subscriptions",
    api_version: API_VERSION,
  });
  console.log(`  ✓ webhook endpoint ${created.id} (created, ${events.length} events)`);
  // Printed on its own line, in exactly this shape, because stripe-setup.sh
  // greps for it and stores it. This is the only moment Stripe will ever show it.
  console.log(`STRIPE_WEBHOOK_SECRET=${created.secret}`);
}

function money(cents, currency) {
  const n = (cents / 100).toFixed(2);
  return currency === "usd" ? `$${n}` : `${n} ${String(currency).toUpperCase()}`;
}

// ---------- main ----------

async function main() {
  if (!KEY) {
    die("STRIPE_SECRET_KEY is not set.\n\n" +
      "  Run tools/stripe-setup.sh instead — it prompts for the key without echoing it.\n" +
      "  Or, for one shot:  STRIPE_SECRET_KEY=sk_test_… node tools/stripe-setup.mjs\n\n" +
      "  Get a key from https://dashboard.stripe.com/apikeys (use a sandbox first).\n" +
      "  Nothing was contacted and nothing was changed.");
  }
  if (!/^(sk|rk)_(test|live)_/.test(KEY)) {
    die("That does not look like a Stripe secret key (it should start with sk_test_ or sk_live_).");
  }
  const live = KEY.startsWith("sk_live_") || KEY.startsWith("rk_live_");
  if (live && !LIVE) {
    die("That is a LIVE key. Re-run with --live if you really mean to change the live account.");
  }

  let plans;
  try {
    plans = JSON.parse(await readFile(PLANS_PATH, "utf8"));
  } catch (e) {
    die(`Could not read ${PLANS_PATH}: ${e.message}`);
  }

  const mode = live ? "LIVE" : "test";
  console.log(`\nSpotter — Stripe setup  [${mode} mode]${DRY ? "  (dry run: nothing will be changed)" : ""}`);
  console.log(`  plans file   ${PLANS_PATH}`);
  console.log(`  webhook      ${plans.webhook_url}`);
  console.log(`  trial        ${plans.trial_days} days (annual only; the function reads app_config.billing.trial_days, not this)`);
  if (plans.founding?.enabled !== false && plans.founding) {
    console.log(`  founding     ${money(plans.founding.amount_off, plans.currency ?? "usd")} off the first year, ` +
      `first ${plans.founding.max_redemptions} accounts (coupon ${plans.founding.id})`);
  }

  const currency = plans.currency ?? "usd";
  const enabled = (plans.products ?? []).filter((p) => p.enabled !== false);
  const skipped = (plans.products ?? []).filter((p) => p.enabled === false);
  if (!enabled.length) die("No enabled products in stripe-plans.json — nothing to do.");

  console.log("\nProducts and prices");
  const catalog = [];
  const productIds = {};
  for (const product of enabled) {
    const created = await ensureProduct(product);
    productIds[product.key] = created.id;
    const priceIds = [];
    for (const spec of product.prices ?? []) {
      const price = await ensurePrice(created.id, currency, spec);
      priceIds.push(price.id);
    }
    if (priceIds.length) catalog.push({ product: created.id, prices: priceIds });
  }
  for (const product of skipped) {
    console.log(`  – ${product.name} skipped ("enabled": false in stripe-plans.json)`);
  }

  console.log("\nFounding offer");
  await ensureFounding(
    plans.founding ? { currency, ...plans.founding } : null,
    productIds[plans.founding?.product ?? "plus"] ?? null,
  );

  console.log("\nCustomer Portal");
  await ensurePortal(plans, catalog);

  console.log("\nWebhook endpoint");
  await ensureWebhook(plans.webhook_url, plans.events ?? []);

  console.log("\nDone.");
  if (DRY) {
    console.log("\nThat was a dry run. Re-run without --dry-run to apply it.\n");
    return;
  }

  console.log("\nSecrets the function needs (stripe-setup.sh sets these for you):");
  console.log("  STRIPE_SECRET_KEY      the key you just used");
  console.log("  STRIPE_WEBHOOK_SECRET  printed above, only on the run that created the endpoint");

  console.log(`\nStill to do by hand in the ${mode} Dashboard — the API cannot set these:`);
  const checklist = [
    "Revenue recovery > Retries: Smart Retries on, 8 tries over 2 weeks, and then " +
    "\"Cancel the subscription\". Do NOT pick \"leave past-due\": Spotter treats past_due " +
    "as entitled during the grace window, so that setting would give a non-payer the paid plan for ever.",
    "Revenue recovery > Emails: failed-payment ON, expiring-card ON.",
    "Settings > Billing > Subscriptions and emails: trial-ending reminder ON, upcoming-renewal " +
    "emails ON, and under Manage free trial messaging pick \"Link to a Stripe-hosted page\".",
    "Settings > Checkout and Payment Links > Subscriptions: \"Limit customers to one " +
    "subscription\" ON (it needs the no-code portal login link enabled).",
    "Settings > Branding, plus a public business name and support email — they appear on " +
    "Checkout, in the portal and on every email Stripe sends.",
    "Stripe Tax: enable threshold monitoring only. No registrations, no calculation — " +
    "billing.tax stays false until a registration actually exists.",
    ...followUps,
  ];
  checklist.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  if (!live) console.log("\nWhen the test run checks out, do it again with the live key and --live.");
  console.log("");
}

main().catch((e) => {
  console.error(`\n✗ Stripe setup failed: ${e.message}`);
  if (e.param) console.error(`  parameter: ${e.param}`);
  console.error("  Nothing further was changed. Fix the cause and run it again — every step is idempotent.\n");
  process.exit(1);
});
