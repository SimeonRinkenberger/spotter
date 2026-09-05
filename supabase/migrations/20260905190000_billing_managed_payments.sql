-- Spotter — Managed Payments is a dial.
--
-- Stripe accounts opened in 2026 have Managed Payments on by default: Stripe is
-- the merchant of record, calculates, withholds and remits sales tax, VAT and
-- GST in 80+ countries, handles disputes and transaction-level support, and the
-- customer sees "Sold through Link" on receipts and LINK.COM* on statements. It
-- costs 3.5 % on top of the ordinary card fee. The first live Checkout Session
-- was refused because the product had no tax code — the setup script now sets
-- txcd_10103000 (SaaS, personal use) — and the function now states the choice
-- explicitly on every session instead of inheriting the account default.
--
-- 'true' = Stripe is merchant of record (the default, and the safe one for a
-- solo owner selling a consumer app worldwide). 'false' = Spotter sells as
-- itself at the lower fee and the owner carries the tax obligations; pair it
-- with billing.tax the day a registration exists. Read on the same five-minute
-- cache as billing.trial_days, so a change lands without a deploy.
insert into public.app_config (key, value) values
  ('billing.managed_payments', 'true')
on conflict (key) do nothing;
