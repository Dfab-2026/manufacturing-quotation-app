-- Immutable audit trail and historical similarity helper.
create extension if not exists pg_trgm;

create or replace function public.audit_business_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  tid uuid;
  eid text;
begin
  tid := coalesce((to_jsonb(new)->>'tenant_id')::uuid,(to_jsonb(old)->>'tenant_id')::uuid);
  eid := coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id');
  insert into public.audit_logs(tenant_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
  values(tid,auth.uid(),tg_op,tg_table_name,eid,case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return coalesce(new,old);
end $$;

-- Key commercial/master records only; no auth or secret-bearing tables.
do $$
declare t text;
begin
 foreach t in array array['rfqs','parts','master_rates','process_routes','cost_lines','material_masters','machine_masters','process_masters','suppliers','assemblies','assembly_items','quantity_breaks','approval_requests','actual_job_costs','integration_connections'] loop
  execute format('drop trigger if exists audit_%I on public.%I',t,t);
  execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_business_change()',t,t);
 end loop;
end $$;

create or replace function public.find_similar_parts(target_part uuid, result_limit integer default 8)
returns table(part_id uuid, rfq_id uuid, drawing_number text, description text, material_code text, score numeric)
language sql stable security invoker set search_path=public as $$
  with target as (
    select * from public.parts where id=target_part and public.is_tenant_member(tenant_id)
  )
  select p.id,p.rfq_id,p.drawing_number,p.description,p.material_code,
    round((
      (case when p.material_code is not distinct from t.material_code then 0.35 else 0 end) +
      similarity(coalesce(p.description,''),coalesce(t.description,''))*0.35 +
      (case when t.length_mm>0 and p.length_mm>0 then greatest(0,1-abs(p.length_mm-t.length_mm)/greatest(p.length_mm,t.length_mm))*0.1 else 0 end) +
      (case when t.width_mm>0 and p.width_mm>0 then greatest(0,1-abs(p.width_mm-t.width_mm)/greatest(p.width_mm,t.width_mm))*0.1 else 0 end) +
      (case when t.thickness_mm>0 and p.thickness_mm>0 then greatest(0,1-abs(p.thickness_mm-t.thickness_mm)/greatest(p.thickness_mm,t.thickness_mm))*0.1 else 0 end)
    )::numeric,4) score
  from target t join public.parts p on p.tenant_id=t.tenant_id and p.id<>t.id
  order by score desc limit greatest(1,least(result_limit,50));
$$;
grant execute on function public.find_similar_parts(uuid,integer) to authenticated;
