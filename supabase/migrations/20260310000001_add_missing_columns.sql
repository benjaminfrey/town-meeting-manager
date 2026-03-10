-- ============================================================
-- Add missing columns to town, board, and person tables
-- ============================================================
-- These columns are referenced by the onboarding wizard
-- (completeWizard.ts) and the PowerSync schema but were
-- missing from the original table definitions.
-- ============================================================

-- town: staff_roles_present (JSON array of staff role strings)
ALTER TABLE town
  ADD COLUMN IF NOT EXISTS staff_roles_present JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN town.staff_roles_present IS 'Staff roles present in the town (e.g. town_manager, town_clerk). JSON array.';

-- town: seal_url (for town logo/seal)
ALTER TABLE town
  ADD COLUMN IF NOT EXISTS seal_url TEXT;

ALTER TABLE town
  ADD COLUMN IF NOT EXISTS retention_policy_acknowledged_at TIMESTAMPTZ;

-- board: seat_titles (for role_titled election method)
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS seat_titles JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN board.seat_titles IS 'Ordered list of seat titles for role_titled election method. JSON array of strings.';

-- board: elected_or_appointed
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS elected_or_appointed TEXT DEFAULT 'elected';

COMMENT ON COLUMN board.elected_or_appointed IS 'Whether board members are elected or appointed: elected, appointed.';

-- board: quorum/motion fields (added in board management session)
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS quorum_type TEXT DEFAULT 'majority';

ALTER TABLE board
  ADD COLUMN IF NOT EXISTS quorum_value INTEGER;

ALTER TABLE board
  ADD COLUMN IF NOT EXISTS motion_display_format TEXT DEFAULT 'formal';

COMMENT ON COLUMN board.quorum_type IS 'How quorum is calculated: majority, two_thirds, fixed_number.';
COMMENT ON COLUMN board.quorum_value IS 'Fixed quorum number (used when quorum_type = fixed_number).';
COMMENT ON COLUMN board.motion_display_format IS 'How motions are displayed: formal, informal.';

-- person: display_name alias — the wizard uses display_name but the
-- column is "name". We'll just fix the code to use "name" instead.
-- No column change needed for person.
