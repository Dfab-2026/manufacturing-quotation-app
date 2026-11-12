-- Prevent cross-tenant references even when writes are made by privileged services.

alter table public.customers add constraint customers_id_tenant_unique unique (id, tenant_id);
alter table public.rfqs add constraint rfqs_id_tenant_unique unique (id, tenant_id);
alter table public.drawings add constraint drawings_id_tenant_unique unique (id, tenant_id);
alter table public.parts add constraint parts_id_tenant_unique unique (id, tenant_id);
alter table public.master_rates add constraint rates_id_tenant_unique unique (id, tenant_id);
alter table public.process_routes add constraint routes_id_tenant_unique unique (id, tenant_id);

alter table public.rfqs
  add constraint rfqs_customer_same_tenant
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id);

alter table public.drawings
  add constraint drawings_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade;

alter table public.analysis_jobs
  add constraint jobs_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade,
  add constraint jobs_drawing_same_tenant
  foreign key (drawing_id, tenant_id)
  references public.drawings(id, tenant_id)
  on delete cascade;

alter table public.drawing_extractions
  add constraint extractions_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade,
  add constraint extractions_drawing_same_tenant
  foreign key (drawing_id, tenant_id)
  references public.drawings(id, tenant_id)
  on delete cascade;

alter table public.parts
  add constraint parts_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade,
  add constraint parts_drawing_same_tenant
  foreign key (drawing_id, tenant_id)
  references public.drawings(id, tenant_id)
  on delete set null;

alter table public.process_routes
  add constraint routes_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade,
  add constraint routes_part_same_tenant
  foreign key (part_id, tenant_id)
  references public.parts(id, tenant_id)
  on delete cascade,
  add constraint routes_rate_same_tenant
  foreign key (rate_id, tenant_id)
  references public.master_rates(id, tenant_id)
  on delete set null;

alter table public.cost_lines
  add constraint costs_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade,
  add constraint costs_part_same_tenant
  foreign key (part_id, tenant_id)
  references public.parts(id, tenant_id)
  on delete cascade,
  add constraint costs_route_same_tenant
  foreign key (route_id, tenant_id)
  references public.process_routes(id, tenant_id)
  on delete cascade;

alter table public.quote_versions
  add constraint quote_versions_rfq_same_tenant
  foreign key (rfq_id, tenant_id)
  references public.rfqs(id, tenant_id)
  on delete cascade;
