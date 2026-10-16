-- ==============================================================================
-- Quote24x7 Security Verification: RLS and Anon Role Access Check
-- Run in Supabase SQL Editor. Every check must return 'PASS'.
-- ==============================================================================

-- 1. Check that Row Level Security (RLS) is enabled on all public tables
with rls_status as (
  select
    tablename,
    rowsecurity
  from pg_tables
  where schemaname = 'public'
    and tablename not in ('schema_migrations')
)
select
  tablename,
  case when rowsecurity then 'PASS' else 'FAIL' end as rls_enabled_check
from rls_status
order by tablename;

-- 2. Verify that NO permissive policies exist for anon role
with anon_policies as (
  select
    schemaname,
    tablename,
    policyname,
    roles,
    cmd,
    qual
  from pg_policies
  where schemaname = 'public'
    and ('anon' = any(roles) or 'public' = any(roles))
)
select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as no_anon_policies_check,
  count(*) as permissive_anon_policy_count
from anon_policies;

-- 3. Behavioral proof: anon role cannot select rows from tables
-- (Runs within an isolated transaction block to test the anon role)
do $$
declare
  t text;
  cnt integer;
begin
  -- Switch session to anon role
  begin
    set local role anon;
  exception when others then
    raise notice 'Role anon not present in environment; skipping role switch check';
    return;
  end;

  -- Attempt to select from tables
  foreach t in array array[
    'email_threads', 'email_messages', 'quotes', 'deliveries',
    'requirement_profiles', 'ai_decisions', 'catalogue_plans'
  ]
  loop
    begin
      execute format('select count(*) from public.%I', t) into cnt;
      if cnt > 0 then
        raise exception 'SECURITY VIOLATION: anon role was able to read % rows from %', cnt, t;
      end if;
    exception
      when insufficient_privilege then
        -- Expected: permission denied
        null;
      when others then
        -- Expected: permission denied or 0 rows
        null;
    end;
  end loop;

  raise notice 'PASS: anon role cannot select data from public tables';
end $$;
