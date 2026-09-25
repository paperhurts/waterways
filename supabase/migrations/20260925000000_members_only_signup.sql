-- Only people on the members list can get an account. Supabase Auth calls this
-- "before user created" hook on every first sign-in; rejecting it means no
-- account is made and no sign-in email is sent, so the form can't be used to
-- email arbitrary addresses. Existing accounts are unaffected.
--
-- Enable it in the dashboard: Authentication > Hooks > Before User Created >
-- Postgres function private.hook_members_only.
create function private.hook_members_only(event jsonb) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.members m
      where m.email = lower(coalesce(event -> 'user' ->> 'email', ''))
    ) then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email isn''t on the journal''s list. Ask someone on it to add you under People.'
    ))
  end;
$$;
revoke all on function private.hook_members_only(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_members_only(jsonb) to supabase_auth_admin;
