-- Keep the membership helper out of the exposed API schema (Supabase lint
-- 0029). Policies reference the function by OID, so they keep working; the app
-- learns membership by reading public.members instead of calling an RPC.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_member() set schema private;
