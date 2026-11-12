-- Manufacturing Quotation Platform
-- Multi-tenant schema with defense-in-depth authorization.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner','admin','estimator','viewer');
create type public.member_status as enum ('active','invited','disabled');
create type public.rfq_status as enum ('draft','review','ready','sent','won','lost','cancelled');
create type public.job_status as enum ('queued','processing','completed','failed');
create type public.rate_category as enum ('material','process','labor','consumable','subcontract','inspection','packing','other');
create type public.rate_basis as enum ('kg','minute','hour','mm','meter','bend','piece','sqm','lot');
create type public.source_kind as enum ('drawing','cad','calculated','inferred','manual');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  legal_name text,
  tax_id text,
  country_code char(2) not null default 'IN',
  default_currency char(3) not null default 'INR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id, status);
create index memberships_tenant_idx on public.memberships(tenant_id, role, status);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  code text,
  email text,
  phone text,
  gstin text,
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  payment_terms text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index customers_tenant_name_idx on public.customers(tenant_id, name);

create sequence public.quote_number_seq start 1000;

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  quote_number text,
  customer_reference text,
  title text not null check (char_length(title) between 2 and 160),
  status public.rfq_status not null default 'draft',
  currency char(3) not null default 'INR',
  required_date date,
  notes text,
  overhead_percent numeric(7,3) not null default 0 check (overhead_percent between 0 and 100),
  margin_percent numeric(7,3) not null default 0 check (margin_percent >= 0 and margin_percent < 100),
  direct_cost numeric(18,4) not null default 0 check (direct_cost >= 0),
  total_value numeric(18,4) not null default 0 check (total_value >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, quote_number)
);
create index rfqs_tenant_created_idx on public.rfqs(tenant_id, created_at desc);
create index rfqs_tenant_status_idx on public.rfqs(tenant_id, status);

create table public.drawings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text,
  revision text,
  extraction_status public.job_status not null default 'queued',
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drawings_rfq_idx on public.drawings(tenant_id, rfq_id, created_at desc);

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  status public.job_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  locked_at timestamptz,
  locked_by text,
  error_message text,
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index analysis_jobs_queue_idx on public.analysis_jobs(status, created_at) where status in ('queued','processing');
create index analysis_jobs_tenant_idx on public.analysis_jobs(tenant_id, rfq_id, created_at desc);

create table public.drawing_extractions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  schema_version integer not null default 1,
  extractor_version text not null,
  raw_text text,
  structured_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (drawing_id, schema_version)
);
create index drawing_extractions_tenant_idx on public.drawing_extractions(tenant_id, rfq_id);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  drawing_id uuid references public.drawings(id) on delete set null,
  item_no text,
  drawing_number text,
  revision text,
  description text not null,
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  material_code text,
  material_grade text,
  shape text,
  length_mm numeric(18,4),
  width_mm numeric(18,4),
  thickness_mm numeric(18,4),
  diameter_mm numeric(18,4),
  drawing_weight_kg numeric(18,6),
  net_weight_kg numeric(18,6),
  raw_weight_kg numeric(18,6),
  weight_source public.source_kind,
  geometry jsonb not null default '{}'::jsonb,
  tolerances jsonb not null default '[]'::jsonb,
  finishes jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  confidence numeric(5,4) check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parts_rfq_idx on public.parts(tenant_id, rfq_id, item_no);

create table public.master_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  category public.rate_category not null,
  basis public.rate_basis not null,
  rate numeric(18,6) not null check (rate >= 0),
  currency char(3) not null default 'INR',
  material_code text,
  metadata jsonb not null default '{}'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index master_rates_lookup_idx on public.master_rates(tenant_id, category, material_code, active);

create table public.process_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  operation text not null,
  work_center text,
  setup_minutes numeric(14,4) not null default 0 check (setup_minutes >= 0),
  cycle_minutes numeric(14,4) not null default 0 check (cycle_minutes >= 0),
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  rate_id uuid references public.master_rates(id) on delete set null,
  source public.source_kind not null default 'manual',
  confidence numeric(5,4) check (confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (part_id, sequence_no)
);
create index process_routes_part_idx on public.process_routes(tenant_id, part_id, sequence_no);

create table public.cost_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  part_id uuid references public.parts(id) on delete cascade,
  route_id uuid references public.process_routes(id) on delete cascade,
  category public.rate_category not null,
  description text not null,
  quantity numeric(18,6) not null check (quantity >= 0),
  basis public.rate_basis not null,
  rate numeric(18,6) not null check (rate >= 0),
  waste_percent numeric(7,3) not null default 0 check (waste_percent between 0 and 100),
  amount numeric(18,4) generated always as (round((quantity * rate * (1 + waste_percent / 100.0))::numeric, 4)) stored,
  source public.source_kind not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cost_lines_rfq_idx on public.cost_lines(tenant_id, rfq_id, part_id);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  snapshot jsonb not null,
  total_value numeric(18,4) not null check (total_value >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (rfq_id, version_no)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  actor_user_id uuid,
  action text not null,
  entity_table text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs(tenant_id, created_at desc);

create table public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 1,
  primary key (user_id, route, bucket_start)
);

-- Authorization helpers deliberately avoid reading request-controlled tenant IDs.
create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = target_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_tenant_role(target_tenant uuid, allowed public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = target_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed)
  );
$$;

revoke all on function public.is_tenant_member(uuid) from public;
revoke all on function public.has_tenant_role(uuid, public.member_role[]) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, public.member_role[]) to authenticated;

create or replace function public.consume_rate_limit(p_route text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  bucket timestamptz;
  new_count integer;
begin
  if uid is null or p_limit < 1 or p_window_seconds < 1 then return false; end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits(user_id, route, bucket_start, request_count)
  values (uid, left(p_route, 160), bucket, 1)
  on conflict (user_id, route, bucket_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into new_count;
  return new_count <= p_limit;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;

create or replace function public.assign_quote_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quote_number is null then
    new.quote_number := 'Q-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
create trigger rfq_quote_number before insert on public.rfqs for each row execute function public.assign_quote_number();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger tenants_touch before update on public.tenants for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function public.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger rfqs_touch before update on public.rfqs for each row execute function public.touch_updated_at();
create trigger drawings_touch before update on public.drawings for each row execute function public.touch_updated_at();
create trigger parts_touch before update on public.parts for each row execute function public.touch_updated_at();
create trigger rates_touch before update on public.master_rates for each row execute function public.touch_updated_at();
create trigger routes_touch before update on public.process_routes for each row execute function public.touch_updated_at();
create trigger costs_touch before update on public.cost_lines for each row execute function public.touch_updated_at();

-- RLS + grants. No anonymous access to business data.
do $$
declare t text;
begin
  foreach t in array array['tenants','memberships','customers','rfqs','drawings','analysis_jobs','drawing_extractions','parts','master_rates','process_routes','cost_lines','quote_versions','audit_logs','api_rate_limits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
  end loop;
end $$;

grant select on public.tenants, public.memberships, public.customers, public.rfqs, public.drawings,
  public.analysis_jobs, public.drawing_extractions, public.parts, public.master_rates,
  public.process_routes, public.cost_lines, public.quote_versions, public.audit_logs to authenticated;
grant insert, update on public.customers, public.rfqs, public.drawings, public.analysis_jobs,
  public.parts, public.process_routes, public.cost_lines, public.quote_versions to authenticated;
grant insert, update on public.master_rates to authenticated;

create policy tenant_read on public.tenants for select to authenticated using (public.is_tenant_member(id));
create policy membership_read on public.memberships for select to authenticated using (public.is_tenant_member(tenant_id));

create policy customers_read on public.customers for select to authenticated using (public.is_tenant_member(tenant_id));
create policy customers_insert on public.customers for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));
create policy customers_update on public.customers for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy rfqs_read on public.rfqs for select to authenticated using (public.is_tenant_member(tenant_id));
create policy rfqs_insert on public.rfqs for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]) and created_by = auth.uid());
create policy rfqs_update on public.rfqs for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy drawings_read on public.drawings for select to authenticated using (public.is_tenant_member(tenant_id));
create policy drawings_insert on public.drawings for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]) and uploaded_by = auth.uid());
create policy drawings_update on public.drawings for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy jobs_read on public.analysis_jobs for select to authenticated using (public.is_tenant_member(tenant_id));
create policy jobs_insert on public.analysis_jobs for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]) and requested_by = auth.uid());
create policy jobs_update on public.analysis_jobs for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));

create policy extraction_read on public.drawing_extractions for select to authenticated using (public.is_tenant_member(tenant_id));
create policy parts_read on public.parts for select to authenticated using (public.is_tenant_member(tenant_id));
create policy parts_insert on public.parts for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));
create policy parts_update on public.parts for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy rates_read on public.master_rates for select to authenticated using (public.is_tenant_member(tenant_id));
create policy rates_insert on public.master_rates for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]) and created_by = auth.uid());
create policy rates_update on public.master_rates for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));

create policy routes_read on public.process_routes for select to authenticated using (public.is_tenant_member(tenant_id));
create policy routes_insert on public.process_routes for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));
create policy routes_update on public.process_routes for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy costs_read on public.cost_lines for select to authenticated using (public.is_tenant_member(tenant_id));
create policy costs_insert on public.cost_lines for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));
create policy costs_update on public.cost_lines for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy quote_versions_read on public.quote_versions for select to authenticated using (public.is_tenant_member(tenant_id));
create policy quote_versions_insert on public.quote_versions for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]) and created_by = auth.uid());
create policy audit_read on public.audit_logs for select to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin']::public.member_role[]));

-- Private drawing storage. First path segment must equal tenant UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drawings','drawings',false,26214400,array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy drawing_object_read on storage.objects for select to authenticated
using (bucket_id = 'drawings' and public.is_tenant_member((storage.foldername(name))[1]::uuid));
create policy drawing_object_insert on storage.objects for insert to authenticated
with check (bucket_id = 'drawings' and public.has_tenant_role((storage.foldername(name))[1]::uuid, array['owner','admin','estimator']::public.member_role[]));
create policy drawing_object_delete on storage.objects for delete to authenticated
using (bucket_id = 'drawings' and public.has_tenant_role((storage.foldername(name))[1]::uuid, array['owner','admin']::public.member_role[]));
