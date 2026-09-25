-- ops_week was the one public function without a pinned search_path (advisor
-- function_search_path_mutable). It calls date_trunc only; pinning it costs the
-- ops views nothing measurable (they aggregate a few hundred rows) and closes
-- the last advisor WARN of that kind.
alter function public.ops_week(timestamptz) set search_path = pg_catalog, public;
