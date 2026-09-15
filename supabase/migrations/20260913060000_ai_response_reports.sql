-- Reports are reviewable by the operator through the service role. The client
-- supplies only an ID; the database copies an assistant response it owns.
create table public.ai_response_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null,
  content text,
  proposal jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, message_id)
);
alter table public.ai_response_reports enable row level security;
revoke all on public.ai_response_reports from anon, authenticated;
grant all on public.ai_response_reports to service_role;

create function public.report_pumpy_response(message_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.pumpy_messages m
    where m.id = report_pumpy_response.message_id and m.user_id = caller and m.role = 'assistant')
  then raise exception 'Response not found'; end if;
  insert into public.ai_response_reports (user_id, message_id, content, proposal)
    select caller, m.id, left(m.content, 32000), m.meta -> 'proposal'
    from public.pumpy_messages m where m.id = report_pumpy_response.message_id and m.user_id = caller
    on conflict on constraint ai_response_reports_user_id_message_id_key do nothing;
end;
$$;
revoke all on function public.report_pumpy_response(bigint) from public, anon;
grant execute on function public.report_pumpy_response(bigint) to authenticated;
