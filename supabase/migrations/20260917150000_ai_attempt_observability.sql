-- ai_reservations is the authoritative charge ledger. ai_cost_log remains
-- diagnostic; NEVER add its estimates to reservation charges.
alter table public.ai_reservations add column if not exists attempt_meta jsonb not null default
  '{"environment":"unclassified","purpose":"unclassified","attempt_status":"unclassified"}'::jsonb;

create or replace function public.ai_record_attempt(
  p_id uuid,p_meta jsonb,p_final boolean default false,p_usd numeric default null,p_cooldown integer default 0
) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.ai_reservations;
begin
  -- Same lock order as ai_reserve/ai_settle. A metadata failure rolls settlement
  -- back too, leaving the conservative reservation charged until reconciliation.
  perform 1 from public.ai_guard_policy where singleton for update;
  select * into r from public.ai_reservations where id=p_id for update;
  if not found then raise exception 'Unknown AI reservation'; end if;
  if jsonb_typeof(p_meta) is distinct from 'object' or octet_length(p_meta::text)>8192 then
    raise exception 'Invalid AI attempt metadata';
  end if;
  if exists(select 1 from jsonb_object_keys(p_meta) k where k<>all(array[
    'purpose','action_id','job_id','environment','experiment_id','price_version','unit_prices',
    'provider_request_id','provider_response_id','resolved_model','http_status','attempt_status',
    'failure_kind','input_tokens','output_tokens','cached_input_tokens','reasoning_tokens',
    'input_modalities','usage_complete','started_at','finished_at','duration_ms','attempt_id'])) then
    raise exception 'Unexpected AI attempt metadata field';
  end if;
  if p_meta ? 'environment' and p_meta->>'environment' not in
    ('unclassified','production','experiment','staff_test','staging') then raise exception 'Invalid environment'; end if;
  if p_meta ? 'attempt_status' and p_meta->>'attempt_status' not in
    ('unclassified','started','succeeded','failed','unknown') then raise exception 'Invalid attempt status'; end if;
  -- Only the first terminal result may settle or replace attempt metadata.
  if r.state<>'reserved' then return false; end if;
  update public.ai_reservations set attempt_meta=attempt_meta||p_meta where id=p_id;
  if p_final then perform public.ai_settle(p_id,p_usd,p_cooldown); end if;
  return true;
end $$;
revoke all on function public.ai_record_attempt(uuid,jsonb,boolean,numeric,integer) from public,anon,authenticated;
grant execute on function public.ai_record_attempt(uuid,jsonb,boolean,numeric,integer) to service_role;
comment on column public.ai_reservations.attempt_meta is
  'Content-free per-attempt attribution. Legacy/default unclassified is not production. Charges use coalesce(charged_usd,reserved_usd); never sum ai_cost_log too.';
