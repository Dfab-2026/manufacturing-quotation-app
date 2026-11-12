-- Additional enterprise roles. Kept in a separate migration so PostgreSQL can commit enum values
-- before policies in the next migration reference them.
alter type public.member_role add value if not exists 'sales';
alter type public.member_role add value if not exists 'approver';
alter type public.member_role add value if not exists 'production';
alter type public.member_role add value if not exists 'finance';
