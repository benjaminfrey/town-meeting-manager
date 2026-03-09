-- ============================================================
-- Town Meeting Manager — RLS Helper Functions
-- ============================================================
-- Functions that extract JWT claims and evaluate permissions.
-- All are SECURITY DEFINER so they run as the function owner
-- (postgres) and can read user_account even after RLS is enabled.
--
-- JWT claims are set by the custom_access_token_hook (session 01.08):
--   app_metadata.town_id
--   app_metadata.role
--   app_metadata.person_id
--   app_metadata.user_account_id
-- ============================================================

-- ─── Extract town_id from JWT ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_current_town_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'town_id')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_current_town_id IS 'Extract town_id from the authenticated user''s JWT app_metadata claims.';

-- ─── Extract role from JWT ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_current_role()
RETURNS TEXT AS $$
BEGIN
  RETURN auth.jwt() -> 'app_metadata' ->> 'role';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_current_role IS 'Extract app role (admin/staff/board_member/sys_admin) from JWT claims.';

-- ─── Extract person_id from JWT ───────────────────────────────
CREATE OR REPLACE FUNCTION get_current_person_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'person_id')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_current_person_id IS 'Extract person_id from JWT claims.';

-- ─── Extract user_account_id from JWT ─────────────────────────
CREATE OR REPLACE FUNCTION get_current_user_account_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'user_account_id')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_current_user_account_id IS 'Extract user_account_id from JWT claims.';

-- ─── Check if current user is admin ───────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN get_current_role() = 'admin';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_admin IS 'True if the authenticated user has the admin role.';

-- ─── Check global permission ──────────────────────────────────
-- Checks user_account.permissions -> 'global' -> action_code.
-- Admin always returns true. sys_admin always returns false.
-- Action codes: A1-A7, M1-M8, R1-R6, C1-C5 (see advisory 1.2).
CREATE OR REPLACE FUNCTION has_permission(action_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_permissions JSONB;
  v_role TEXT;
BEGIN
  v_role := get_current_role();

  -- Admin always has all permissions
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- sys_admin has no meeting management permissions
  IF v_role = 'sys_admin' THEN
    RETURN false;
  END IF;

  -- Look up the user's global permissions
  SELECT permissions -> 'global' INTO user_permissions
  FROM user_account
  WHERE id = get_current_user_account_id();

  IF user_permissions IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE((user_permissions ->> action_code)::BOOLEAN, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_permission IS 'Check if the current user has a specific global permission by action code (A1, M3, R1, etc.). Admin always returns true.';

-- ─── Check board-scoped permission ────────────────────────────
-- Checks board_overrides first, then falls back to global.
-- This is the primary check for board-related actions where a
-- staff member might have different permissions per board.
CREATE OR REPLACE FUNCTION has_board_permission(action_code TEXT, target_board_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_perms JSONB;
  override_elem JSONB;
  board_override JSONB;
  v_role TEXT;
BEGIN
  v_role := get_current_role();

  -- Admin always has all permissions
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- sys_admin has no meeting management permissions
  IF v_role = 'sys_admin' THEN
    RETURN false;
  END IF;

  -- Look up the user's full permissions JSONB
  SELECT permissions INTO user_perms
  FROM user_account
  WHERE id = get_current_user_account_id();

  IF user_perms IS NULL THEN
    RETURN false;
  END IF;

  -- Check board-specific overrides first
  IF user_perms -> 'board_overrides' IS NOT NULL THEN
    FOR override_elem IN SELECT jsonb_array_elements(user_perms -> 'board_overrides')
    LOOP
      IF (override_elem ->> 'board_id')::UUID = target_board_id THEN
        board_override := override_elem -> 'permissions';
        IF board_override IS NOT NULL AND board_override ? action_code THEN
          RETURN COALESCE((board_override ->> action_code)::BOOLEAN, false);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Fall back to global permissions
  RETURN COALESCE((user_perms -> 'global' ->> action_code)::BOOLEAN, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_board_permission IS 'Check if the current user has a specific permission for a specific board. Checks board_overrides first, then falls back to global permissions. Admin always returns true.';
