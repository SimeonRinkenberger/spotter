-- Three of the five Gemini models in the rotation pool do not exist.
--
-- Measured, not guessed. Vision calls on 2026-09-01 produced:
--
--   gemini-3.6-flash        429  (real, free-tier daily cap reached)
--   gemini-3.6-flash-lite   404  (does not exist)
--   gemini-3-flash-lite     404  (does not exist)
--   gemini-3-flash          404  (does not exist)
--   gemini-flash-latest     429  (real, cap reached)
--   gemini-flash-lite-latest 200 (real — added here)
--
-- The pool exists because Gemini's free tier caps requests PER MODEL, so rotating
-- multiplies the daily budget. Three dead entries meant the budget was two models'
-- worth rather than five, and every exhausted call paid for three pointless round
-- trips before finding that out. The evergreen `-latest` aliases are preferred
-- over pinned versions for exactly the reason this table exists: they survive a
-- retirement without anybody noticing.
--
-- This is what putting model ids in configuration bought. The correction was made
-- against the live project with an UPDATE while the function kept serving, and
-- this migration is only here so a fresh deployment starts from the same place.
-- Nothing is pinned to Gemini 2.5.

update public.app_config
   set value = 'gemini-3.6-flash,gemini-flash-latest,gemini-flash-lite-latest',
       updated_at = now()
 where key = 'model.gemini_pool'
   and value like '%gemini-3-flash%';   -- only the known-bad seed, never a hand-tuned one

insert into public.app_config (key, value) values
  ('model.gemini_pool', 'gemini-3.6-flash,gemini-flash-latest,gemini-flash-lite-latest')
on conflict (key) do nothing;
