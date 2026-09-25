-- A person can now put a card in their own order: sections up and down the card,
-- exercises up and down a section, an exercise from one section into another.
-- handleCorrection writes that as ONE ledger row per reorder, kind 'edit', so
-- it counts once against the daily edit limit however many things moved:
--
--   order  the card's layout either side — section titles and exercise names,
--          in order, as one JSON string (layoutText in index.ts).
--
-- Without this the edit still lands (the workout is written first, the ledger
-- after) but the row is refused, the log says NOT RECORDED, and the reorder is
-- not counted. So this migration goes in BEFORE the function that sends 'order'.
-- Same shape as 20260921120000, which added 'rest_seconds' and 'block'.

alter table public.corrections drop constraint if exists corrections_field_check;
alter table public.corrections add constraint corrections_field_check
  check (field in ('name', 'sets', 'reps', 'duration_seconds', 'rest_seconds', 'exercise', 'title', 'block', 'order'));
