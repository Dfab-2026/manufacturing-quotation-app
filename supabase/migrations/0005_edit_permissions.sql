grant delete on public.process_routes, public.cost_lines to authenticated;

create policy routes_delete on public.process_routes for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));

create policy costs_delete on public.cost_lines for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin','estimator']::public.member_role[]));
