-- ============================================================
-- Town Meeting Manager — TOWN table
-- ============================================================
-- Municipal entity — each town using the platform has one record.
-- Multi-tenant isolation anchor: all other tables reference town_id.
-- ============================================================

CREATE TABLE town (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ME',
  municipality_type municipality_type NOT NULL DEFAULT 'town',
  population_range TEXT,
  contact_name TEXT,
  contact_role TEXT,
  meeting_formality meeting_formality NOT NULL DEFAULT 'semi_formal',
  minutes_style minutes_style NOT NULL DEFAULT 'action',
  presiding_officer_default TEXT,
  minutes_recorder_default TEXT,
  subdomain TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE town IS 'Municipal entity — each town using the platform has one record. Multi-tenant isolation anchor.';
COMMENT ON COLUMN town.subdomain IS 'Public portal URL: {subdomain}.townmeetingmanager.com';
COMMENT ON COLUMN town.meeting_formality IS 'Default formality level — can be overridden per board';
COMMENT ON COLUMN town.minutes_style IS 'Default minutes style — can be overridden per board';
COMMENT ON COLUMN town.population_range IS 'Population range category: under_1000, 1000_to_2500, 2500_to_5000, 5000_to_10000, over_10000';
