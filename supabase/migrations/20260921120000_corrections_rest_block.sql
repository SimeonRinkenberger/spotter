-- Two more things a person can put right on a card, and the ledger has to be
-- able to hold both or the edit lands and the telemetry row is refused:
--
--   rest_seconds  the rest after an exercise, which Workout Mode always had and
--                 the card never showed, let alone let anyone change;
--   block         a section's own furniture (name, kind, rounds, rest between
--                 rounds, time cap) as one JSON string either side, written by
--                 the new edit_block op. Kind stays 'edit'.
--
-- Same shape as the 20260902010000 change that added 'title'.

alter table public.corrections drop constraint if exists corrections_field_check;
alter table public.corrections add constraint corrections_field_check
  check (field in ('name', 'sets', 'reps', 'duration_seconds', 'rest_seconds', 'exercise', 'title', 'block'));
