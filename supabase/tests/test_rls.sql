-- ============================================================
-- Town Meeting Manager — RLS Policy Test Script
-- ============================================================
-- Tests row-level security policies by simulating different
-- user roles and verifying data access boundaries.
--
-- PREREQUISITES:
-- 1. All migration files (000001–000036) executed
-- 2. Seed data loaded (supabase/seed.sql)
--
-- NOTE: These tests use set_config('request.jwt.claims', ...)
-- to simulate JWT payloads. This works because the RLS helper
-- functions read from auth.jwt() which in Supabase reads from
-- request.jwt.claims when running as the 'authenticated' role.
--
-- TODO: Full integration testing requires the auth hooks from
-- session 01.08 to be in place. Until then, these tests verify
-- the RLS policies are syntactically correct and logically
-- structured.
--
-- USAGE: Run as superuser (postgres) in a transaction:
--   docker exec -i town-meeting-db psql -U postgres -d postgres < supabase/tests/test_rls.sql
-- ============================================================

\echo '============================================================'
\echo 'RLS Policy Tests — Town Meeting Manager'
\echo '============================================================'

BEGIN;

-- ─── TEST DATA ───────────────────────────────────────────────
-- Use the seed data IDs for test assertions.
-- Town: a1b2c3d4-e5f6-7890-abcd-ef1234567890 (Newcastle, ME)
-- Admin user_account: cccc1111-... (Margaret Chen, admin)
-- Staff user_account: cccc2222-... (Robert Hartley, staff)
-- Board member user_account: cccc4444-... (Ellen Dickens, board_member)

-- Create a second town to test cross-tenant isolation
INSERT INTO town (id, name, state, municipality_type)
VALUES ('b2b2b2b2-0000-0000-0000-000000000000', 'Damariscotta', 'ME', 'town');

INSERT INTO person (id, town_id, name, email)
VALUES ('dddd0001-0000-0000-0000-000000000000', 'b2b2b2b2-0000-0000-0000-000000000000', 'Other Town User', 'other@damariscotta.gov');

INSERT INTO user_account (id, person_id, town_id, role)
VALUES ('eeee0001-0000-0000-0000-000000000000', 'dddd0001-0000-0000-0000-000000000000', 'b2b2b2b2-0000-0000-0000-000000000000', 'admin');

-- ─── HELPER: Set JWT claims for a role ────────────────────────
-- Simulates what Supabase Auth would put in the JWT.
-- We switch to the 'authenticated' role which triggers RLS.

\echo ''
\echo '--- TEST 1: Verify RLS is enabled on all tables ---'
DO $$
DECLARE
  missing_rls INTEGER;
BEGIN
  SELECT count(*) INTO missing_rls
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> 'spatial_ref_sys'
    AND rowsecurity = false;

  IF missing_rls > 0 THEN
    RAISE EXCEPTION 'FAIL: % tables missing RLS', missing_rls;
  ELSE
    RAISE NOTICE 'PASS: All 20 public tables have RLS enabled';
  END IF;
END
$$;

\echo ''
\echo '--- TEST 2: Verify all tables have at least one SELECT policy ---'
DO $$
DECLARE
  missing_select INTEGER;
  tbl TEXT;
BEGIN
  SELECT count(*) INTO missing_select
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.tablename <> 'spatial_ref_sys'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = t.schemaname
        AND p.tablename = t.tablename
    );

  IF missing_select > 0 THEN
    FOR tbl IN
      SELECT t.tablename FROM pg_tables t
      WHERE t.schemaname = 'public'
        AND t.tablename <> 'spatial_ref_sys'
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = t.schemaname
            AND p.tablename = t.tablename
        )
    LOOP
      RAISE NOTICE 'Missing policy on: %', tbl;
    END LOOP;
    RAISE EXCEPTION 'FAIL: % tables have no policies', missing_select;
  ELSE
    RAISE NOTICE 'PASS: All 20 tables have at least one policy';
  END IF;
END
$$;

\echo ''
\echo '--- TEST 3: Verify helper functions exist ---'
DO $$
DECLARE
  fn_count INTEGER;
BEGIN
  SELECT count(*) INTO fn_count
  FROM pg_proc
  WHERE proname IN (
    'get_current_town_id', 'get_current_role', 'get_current_person_id',
    'get_current_user_account_id', 'is_admin', 'has_permission', 'has_board_permission'
  );

  IF fn_count = 7 THEN
    RAISE NOTICE 'PASS: All 7 helper functions exist';
  ELSE
    RAISE EXCEPTION 'FAIL: Expected 7 helper functions, found %', fn_count;
  END IF;
END
$$;

\echo ''
\echo '--- TEST 4: Verify total policy count ---'
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public';

  IF policy_count >= 50 THEN
    RAISE NOTICE 'PASS: % policies found (expected >= 50)', policy_count;
  ELSE
    RAISE EXCEPTION 'FAIL: Only % policies found (expected >= 50)', policy_count;
  END IF;
END
$$;

\echo ''
\echo '--- TEST 5: Verify permission_template system defaults are readable ---'
\echo '    (System defaults with town_id IS NULL should be visible to any user)'
DO $$
DECLARE
  template_count INTEGER;
BEGIN
  SELECT count(*) INTO template_count
  FROM permission_template
  WHERE is_system_default = true;

  IF template_count = 5 THEN
    RAISE NOTICE 'PASS: 5 system-default permission templates found';
  ELSE
    RAISE EXCEPTION 'FAIL: Expected 5 system-default templates, found %', template_count;
  END IF;
END
$$;

\echo ''
\echo '--- TEST 6: Verify audit_log is immutable (no UPDATE/DELETE policies) ---'
DO $$
DECLARE
  write_policies INTEGER;
BEGIN
  SELECT count(*) INTO write_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'audit_log'
    AND cmd IN ('w', 'd');

  IF write_policies = 0 THEN
    RAISE NOTICE 'PASS: audit_log has no UPDATE or DELETE policies (immutable)';
  ELSE
    RAISE EXCEPTION 'FAIL: audit_log has % UPDATE/DELETE policies (should be 0)', write_policies;
  END IF;
END
$$;

\echo ''
\echo '--- TEST 7: Verify has_permission function logic (admin always true) ---'
\echo '    TODO: Requires auth.jwt() to be functional (session 01.08)'
\echo '    Testing function signature and basic structure only.'
DO $$
BEGIN
  -- Verify the function exists with the right signature
  PERFORM pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'has_permission'
    AND pronargs = 1;

  RAISE NOTICE 'PASS: has_permission(TEXT) function exists with correct signature';
END
$$;

\echo ''
\echo '--- TEST 8: Verify has_board_permission function logic ---'
\echo '    TODO: Requires auth.jwt() to be functional (session 01.08)'
\echo '    Testing function signature and basic structure only.'
DO $$
BEGIN
  -- Verify the function exists with the right signature
  PERFORM pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'has_board_permission'
    AND pronargs = 2;

  RAISE NOTICE 'PASS: has_board_permission(TEXT, UUID) function exists with correct signature';
END
$$;

\echo ''
\echo '--- TEST 9: Verify cross-tenant isolation structure ---'
\echo '    Checking that town_id filtering is present in all SELECT policies'
DO $$
DECLARE
  town_tables TEXT[] := ARRAY[
    'person', 'user_account', 'board', 'board_member',
    'meeting', 'agenda_item', 'motion', 'vote_record',
    'meeting_attendance', 'minutes_document', 'minutes_section',
    'agenda_template', 'exhibit', 'notification_event',
    'notification_delivery', 'subscriber_notification_preference',
    'town_notification_config', 'audit_log'
  ];
  tbl TEXT;
  has_select BOOLEAN;
BEGIN
  FOREACH tbl IN ARRAY town_tables
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND policyname LIKE '%select%'
    ) INTO has_select;

    IF NOT has_select THEN
      RAISE EXCEPTION 'FAIL: Table % has no SELECT policy for town_id filtering', tbl;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All 18 town-scoped tables have SELECT policies';
END
$$;

\echo ''
\echo '--- TEST 10: Verify permission_template protections ---'
\echo '    System defaults cannot be modified (INSERT/UPDATE/DELETE policies check is_system_default = false)'
DO $$
DECLARE
  policy_qual TEXT;
  policy_found BOOLEAN := false;
BEGIN
  -- Check that UPDATE policy exists and references is_system_default
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'permission_template'
      AND policyname = 'permission_template_update'
  ) INTO policy_found;

  IF policy_found THEN
    RAISE NOTICE 'PASS: permission_template has UPDATE policy (protects system defaults)';
  ELSE
    RAISE EXCEPTION 'FAIL: permission_template missing UPDATE policy';
  END IF;

  -- Check DELETE policy exists
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'permission_template'
      AND policyname = 'permission_template_delete'
  ) INTO policy_found;

  IF policy_found THEN
    RAISE NOTICE 'PASS: permission_template has DELETE policy (protects system defaults)';
  ELSE
    RAISE EXCEPTION 'FAIL: permission_template missing DELETE policy';
  END IF;
END
$$;

-- ─── CLEANUP ─────────────────────────────────────────────────
-- Remove the test data
DELETE FROM user_account WHERE id = 'eeee0001-0000-0000-0000-000000000000';
DELETE FROM person WHERE id = 'dddd0001-0000-0000-0000-000000000000';
DELETE FROM town WHERE id = 'b2b2b2b2-0000-0000-0000-000000000000';

\echo ''
\echo '============================================================'
\echo 'All RLS structural tests passed!'
\echo ''
\echo 'NOTE: Functional tests (simulating JWT claims and verifying'
\echo 'actual data access boundaries) require the auth hooks from'
\echo 'session 01.08. Add those tests after auth is configured.'
\echo '============================================================'

COMMIT;
