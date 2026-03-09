-- ============================================================
-- Town Meeting Manager — PERMISSION_TEMPLATE table
-- ============================================================
-- Reusable permission sets for quick staff account setup.
-- 5 system defaults are shared across all towns (town_id = NULL).
-- Towns can create custom templates that override defaults.
-- ============================================================

CREATE TABLE permission_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID REFERENCES town(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  is_system_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT template_name_unique UNIQUE (town_id, name)
);

COMMENT ON TABLE permission_template IS 'Reusable permission sets for quick staff account setup. System defaults are shared; town-specific templates override.';
COMMENT ON COLUMN permission_template.town_id IS 'Null for system-wide defaults. Set for town-customized templates.';
COMMENT ON COLUMN permission_template.is_system_default IS 'True for the 5 built-in templates. System defaults cannot be deleted.';
COMMENT ON COLUMN permission_template.permissions IS 'JSONB matching the global permissions structure: { action_code: boolean, ... }';
