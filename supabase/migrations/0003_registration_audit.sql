create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_name text;
  tenant_id uuid;
  base_slug text;
  final_slug text;
begin
  company_name := nullif(trim(new.raw_user_meta_data ->> 'company_name'), '');
  if company_name is null then
    return new;
  end if;

  base_slug := lower(regexp_replace(company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if char_length(base_slug) < 2 then base_slug := 'company'; end if;
  final_slug := left(base_slug, 48) || '-' || left(replace(new.id::text, '-', ''), 8);

  insert into public.tenants(name, slug)
  values (left(company_name, 160), final_slug)
  returning id into tenant_id;

  insert into public.memberships(tenant_id, user_id, role, status)
  values (tenant_id, new.id, 'owner', 'active');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.audit_business_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant uuid;
  entity text;
begin
  if tg_op = 'DELETE' then
    tenant := old.tenant_id;
    entity := old.id::text;
  else
    tenant := new.tenant_id;
    entity := new.id::text;
  end if;
  insert into public.audit_logs(
    tenant_id,
    actor_user_id,
    action,
    entity_table,
    entity_id,
    before_data,
    after_data
  ) values (
    tenant,
    auth.uid(),
    tg_op,
    tg_table_name,
    entity,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_business_change() from public, anon, authenticated;

create trigger customers_audit after insert or update or delete on public.customers
for each row execute function public.audit_business_change();
create trigger rfqs_audit after insert or update or delete on public.rfqs
for each row execute function public.audit_business_change();
create trigger rates_audit after insert or update or delete on public.master_rates
for each row execute function public.audit_business_change();
create trigger parts_audit after insert or update or delete on public.parts
for each row execute function public.audit_business_change();
create trigger costs_audit after insert or update or delete on public.cost_lines
for each row execute function public.audit_business_change();
