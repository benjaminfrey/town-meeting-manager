-- ============================================================
-- Town Meeting Manager — USER_ACCOUNT table
-- ============================================================
-- Application login account linked to a PERSON.
-- One person has at most one user_account.
--
-- Permissions are stored as JSONB (not computed from templates):
--   { global: { A1: true, A2: false, ... },
--     board_overrides: [{ board_id: "...", permissions: { A1: true } }] }
--
-- Staff and board_member roles are mutually exclusive on a PERSON
-- (enforced at app layer per advisory 1.2, not via DB constraint
-- since the check requires inspecting board_member table).
-- ============================================================

CREATE TABLE user_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL UNIQUE REFERENCES person(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  gov_title TEXT,
  permissions JSONB NOT NULL DEFAULT '{"global": {}, "board_overrides": []}',
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

COMMENT ON TABLE user_account IS 'Application login account linked to a PERSON. One person has at most one user_account.';
COMMENT ON COLUMN user_account.role IS 'App role: sys_admin, admin, staff, board_member. Staff and board_member are mutually exclusive on the same PERSON.';
COMMENT ON COLUMN user_account.gov_title IS 'Display label only (Town Clerk, Treasurer, etc.) — has no effect on permissions.';
COMMENT ON COLUMN user_account.permissions IS 'JSONB permissions matrix: { global: { action: bool }, board_overrides: [{ board_id, permissions: { action: bool } }] }';
COMMENT ON COLUMN user_account.auth_user_id IS 'FK to Supabase Auth (auth.users). Null if account is archived or pending invitation.';
