-- Preflight finding 2026-09-18: the ops_alerts id sequence inherited the schema's default sequence
-- privileges, so anon/authenticated could read and advance it while the table itself was service-role only.
-- Sequences are not data, but nothing client-side should be able to touch an ops object at all.
revoke all on sequence public.ops_alerts_id_seq from public, anon, authenticated;
grant usage, select on sequence public.ops_alerts_id_seq to service_role;
