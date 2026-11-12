-- Enterprise role permissions layered on top of the original conservative policies.
grant update on public.tenants, public.memberships to authenticated;

create policy tenant_update on public.tenants for update to authenticated
using (public.has_tenant_role(id,array['owner','admin']::public.member_role[]))
with check (public.has_tenant_role(id,array['owner','admin']::public.member_role[]));

create policy membership_update on public.memberships for update to authenticated
using (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]))
with check (public.has_tenant_role(tenant_id,array['owner','admin']::public.member_role[]));

-- Sales can maintain commercial RFQ state; approvers can write approval outcome fields.
drop policy if exists rfqs_update on public.rfqs;
create policy rfqs_update on public.rfqs for update to authenticated
using (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales','approver']::public.member_role[]))
with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales','approver']::public.member_role[]));

-- Sales may create immutable commercial snapshots.
drop policy if exists quote_versions_insert on public.quote_versions;
create policy quote_versions_insert on public.quote_versions for insert to authenticated
with check (public.has_tenant_role(tenant_id,array['owner','admin','estimator','sales']::public.member_role[]) and created_by=auth.uid());

-- Keep exactly one pending approval per RFQ, while retaining unlimited historical decisions.
alter table public.approval_requests drop constraint if exists approval_requests_rfq_id_status_key;
create unique index if not exists approval_requests_one_pending_idx on public.approval_requests(rfq_id) where status='pending';
