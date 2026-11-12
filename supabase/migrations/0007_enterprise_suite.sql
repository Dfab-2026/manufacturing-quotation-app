-- Enterprise quotation suite: masters, suppliers, assemblies, approvals, quantity pricing,
-- subscriptions, actual-vs-quoted learning and integrations. Additive only.


alter table public.tenants add column if not exists logo_path text;
alter table public.tenants add column if not exists address jsonb not null default '{}'::jsonb;
alter table public.tenants add column if not exists quote_terms text;
alter table public.tenants add column if not exists default_tax_percent numeric(7,3) not null default 18 check (default_tax_percent between 0 and 100);
alter table public.tenants add column if not exists default_scrap_percent numeric(7,3) not null default 5 check (default_scrap_percent between 0 and 100);

alter table public.customers add column if not exists contact_person text;
alter table public.customers add column if not exists currency char(3);
alter table public.customers add column if not exists default_margin_percent numeric(7,3) check (default_margin_percent is null or (default_margin_percent >= 0 and default_margin_percent < 100));
alter table public.customers add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.rfqs add column if not exists approval_state text not null default 'not_required' check (approval_state in ('not_required','pending','approved','rejected'));
alter table public.rfqs add column if not exists approved_by uuid references auth.users(id);
alter table public.rfqs add column if not exists approved_at timestamptz;
alter table public.rfqs add column if not exists tax_percent numeric(7,3) not null default 0 check (tax_percent between 0 and 100);
alter table public.rfqs add column if not exists freight_amount numeric(18,4) not null default 0 check (freight_amount >= 0);
alter table public.rfqs add column if not exists validity_days integer not null default 30 check (validity_days between 1 and 3650);

create table public.material_masters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  grade text,
  density_kg_m3 numeric(14,4) not null check (density_kg_m3 > 0),
  purchase_basis public.rate_basis not null default 'kg',
  purchase_rate numeric(18,6) not null default 0 check (purchase_rate >= 0),
  scrap_percent numeric(7,3) not null default 5 check (scrap_percent between 0 and 100),
  standard_sizes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.machine_masters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  machine_type text not null,
  hourly_rate numeric(18,6) not null default 0 check (hourly_rate >= 0),
  setup_rate numeric(18,6) not null default 0 check (setup_rate >= 0),
  capacity jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.process_masters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  category public.rate_category not null default 'process',
  default_basis public.rate_basis not null default 'hour',
  default_rate numeric(18,6) not null default 0 check (default_rate >= 0),
  minimum_charge numeric(18,4) not null default 0 check (minimum_charge >= 0),
  default_setup_minutes numeric(14,4) not null default 0 check (default_setup_minutes >= 0),
  compatible_materials jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text,
  name text not null,
  email text,
  phone text,
  gstin text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  payment_terms text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.supplier_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  description text not null,
  category public.rate_category not null,
  basis public.rate_basis not null,
  rate numeric(18,6) not null check (rate >= 0),
  currency char(3) not null default 'INR',
  valid_from date not null default current_date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id) on delete cascade,
  check (valid_to is null or valid_to >= valid_from)
);

create table public.assemblies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null,
  code text not null,
  description text not null,
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (rfq_id, tenant_id) references public.rfqs(id, tenant_id) on delete cascade
);

create table public.assembly_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assembly_id uuid not null,
  part_id uuid,
  child_assembly_id uuid,
  description text,
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, assembly_id) references public.assemblies(tenant_id, id) on delete cascade,
  foreign key (part_id, tenant_id) references public.parts(id, tenant_id) on delete cascade,
  foreign key (tenant_id, child_assembly_id) references public.assemblies(tenant_id, id) on delete cascade,
  check ((part_id is not null)::integer + (child_assembly_id is not null)::integer = 1)
);

create table public.quantity_breaks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null,
  part_id uuid,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  total_price numeric(18,4) not null check (total_price >= 0),
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (rfq_id, part_id, quantity),
  foreign key (rfq_id, tenant_id) references public.rfqs(id, tenant_id) on delete cascade,
  foreign key (part_id, tenant_id) references public.parts(id, tenant_id) on delete cascade
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  unique nulls not distinct (rfq_id, status),
  foreign key (rfq_id, tenant_id) references public.rfqs(id, tenant_id) on delete cascade
);

create table public.actual_job_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rfq_id uuid not null,
  part_id uuid,
  material_cost numeric(18,4) not null default 0,
  labor_cost numeric(18,4) not null default 0,
  machine_cost numeric(18,4) not null default 0,
  subcontract_cost numeric(18,4) not null default 0,
  scrap_cost numeric(18,4) not null default 0,
  other_cost numeric(18,4) not null default 0,
  actual_hours numeric(18,4) not null default 0,
  notes text,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (rfq_id, tenant_id) references public.rfqs(id, tenant_id) on delete cascade,
  foreign key (part_id, tenant_id) references public.parts(id, tenant_id) on delete cascade
);

create table public.subscription_plans (
  code text primary key,
  name text not null,
  max_users integer not null check (max_users > 0),
  drawings_per_month integer not null check (drawings_per_month > 0),
  storage_gb integer not null check (storage_gb > 0),
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true
);
insert into public.subscription_plans(code,name,max_users,drawings_per_month,storage_gb,features) values
('starter','Starter',5,100,10,'{"approvals":false,"actual_costs":true,"integrations":false}'::jsonb),
('professional','Professional',20,1000,100,'{"approvals":true,"actual_costs":true,"integrations":true}'::jsonb),
('enterprise','Enterprise',500,100000,2000,'{"approvals":true,"actual_costs":true,"integrations":true,"sso":true}'::jsonb)
on conflict (code) do nothing;

create table public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('odoo','sap','tally','zoho','dynamics','webhook')),
  display_name text not null,
  base_url text,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, display_name)
);

-- Bootstrap subscriptions for existing/new tenants.
insert into public.tenant_subscriptions(tenant_id,plan_code,status,trial_ends_at)
select id,'professional','trialing',now() + interval '30 days' from public.tenants
on conflict (tenant_id) do nothing;

create or replace function public.bootstrap_tenant_subscription() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.tenant_subscriptions(tenant_id,plan_code,status,trial_ends_at)
  values(new.id,'professional','trialing',now()+interval '30 days') on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_bootstrap_tenant_subscription on public.tenants;
create trigger trg_bootstrap_tenant_subscription after insert on public.tenants for each row execute function public.bootstrap_tenant_subscription();

-- RLS
alter table public.material_masters enable row level security;
alter table public.machine_masters enable row level security;
alter table public.process_masters enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_rates enable row level security;
alter table public.assemblies enable row level security;
alter table public.assembly_items enable row level security;
alter table public.quantity_breaks enable row level security;
alter table public.approval_requests enable row level security;
alter table public.actual_job_costs enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.integration_connections enable row level security;

grant select,insert,update on public.material_masters, public.machine_masters, public.process_masters, public.suppliers, public.supplier_rates to authenticated;
grant select,insert,update,delete on public.assemblies, public.assembly_items, public.quantity_breaks, public.approval_requests, public.actual_job_costs to authenticated;
grant select on public.subscription_plans to authenticated;
grant select on public.tenant_subscriptions to authenticated;
grant select,insert,update on public.integration_connections to authenticated;

create policy material_read on public.material_masters for select to authenticated using (public.is_tenant_member(tenant_id));
create policy material_write on public.material_masters for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]));
create policy machine_read on public.machine_masters for select to authenticated using (public.is_tenant_member(tenant_id));
create policy machine_write on public.machine_masters for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]));
create policy process_master_read on public.process_masters for select to authenticated using (public.is_tenant_member(tenant_id));
create policy process_master_write on public.process_masters for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]));
create policy supplier_read on public.suppliers for select to authenticated using (public.is_tenant_member(tenant_id));
create policy supplier_write on public.suppliers for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','finance']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','finance']::public.member_role[]));
create policy supplier_rate_read on public.supplier_rates for select to authenticated using (public.is_tenant_member(tenant_id));
create policy supplier_rate_write on public.supplier_rates for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','finance']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','finance']::public.member_role[]));
create policy assembly_read on public.assemblies for select to authenticated using (public.is_tenant_member(tenant_id));
create policy assembly_write on public.assemblies for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator']::public.member_role[]));
create policy assembly_item_read on public.assembly_items for select to authenticated using (public.is_tenant_member(tenant_id));
create policy assembly_item_write on public.assembly_items for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','estimator']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator']::public.member_role[]));
create policy qty_read on public.quantity_breaks for select to authenticated using (public.is_tenant_member(tenant_id));
create policy qty_write on public.quantity_breaks for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales']::public.member_role[]));
create policy approvals_read on public.approval_requests for select to authenticated using (public.is_tenant_member(tenant_id));
create policy approvals_insert on public.approval_requests for insert to authenticated with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales']::public.member_role[]) and requested_by=auth.uid());
create policy approvals_update on public.approval_requests for update to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','approver']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','approver']::public.member_role[]));
create policy actual_read on public.actual_job_costs for select to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','estimator','production','finance']::public.member_role[]));
create policy actual_write on public.actual_job_costs for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin','production','finance']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin','production','finance']::public.member_role[]));
create policy plans_read on public.subscription_plans for select to authenticated using (true);
create policy tenant_subscription_read on public.tenant_subscriptions for select to authenticated using (public.is_tenant_member(tenant_id));
create policy integration_read on public.integration_connections for select to authenticated using (public.is_tenant_member(tenant_id));
create policy integration_write on public.integration_connections for all to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[])) with check (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]));

create index material_lookup_idx on public.material_masters(tenant_id,active,code);
create index machine_lookup_idx on public.machine_masters(tenant_id,active,machine_type);
create index process_master_lookup_idx on public.process_masters(tenant_id,active,code);
create index supplier_lookup_idx on public.suppliers(tenant_id,active,name);
create index approvals_queue_idx on public.approval_requests(tenant_id,status,requested_at desc);
create index actual_costs_rfq_idx on public.actual_job_costs(tenant_id,rfq_id);
