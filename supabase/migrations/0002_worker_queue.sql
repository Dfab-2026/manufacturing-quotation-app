create or replace function public.claim_analysis_job(p_worker_id text)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare claimed_id uuid;
begin
  select id into claimed_id
  from public.analysis_jobs
  where status = 'queued' and attempt_count < 5
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then return; end if;

  update public.analysis_jobs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = left(p_worker_id, 120),
      started_at = coalesce(started_at, now())
  where id = claimed_id;

  return query select * from public.analysis_jobs where id = claimed_id;
end;
$$;

revoke all on function public.claim_analysis_job(text) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(text) to service_role;
