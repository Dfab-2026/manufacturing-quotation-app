begin;
select plan(8);

-- These tests verify that critical tables have RLS enabled and anon is not granted write access.
select ok((select relrowsecurity from pg_class where oid='public.rfqs'::regclass), 'rfqs RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.drawings'::regclass), 'drawings RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.master_rates'::regclass), 'master_rates RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.cost_lines'::regclass), 'cost_lines RLS enabled');
select ok(not has_table_privilege('anon','public.rfqs','insert'), 'anon cannot insert RFQs');
select ok(not has_table_privilege('anon','public.drawings','select'), 'anon cannot read drawings');
select ok(not has_table_privilege('anon','public.master_rates','update'), 'anon cannot update rates');
select ok(not has_table_privilege('anon','public.audit_logs','select'), 'anon cannot read audit logs');

select * from finish();
rollback;
