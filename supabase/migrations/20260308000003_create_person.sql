-- ============================================================
-- Town Meeting Manager — PERSON table
-- ============================================================
-- Identity anchor — links user_account, board_members, and
-- resident_account. Never deleted, only archived.
--
-- A person can have:
--   user_account (0 or 1) — app login
--   board_members (0 to many) — board memberships
--   resident_account (0 or 1) — civic engagement (Phase 2)
-- ============================================================

CREATE TABLE person (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,

  -- Email is unique within a town (not globally)
  CONSTRAINT person_email_unique_per_town UNIQUE (town_id, email)
);

COMMENT ON TABLE person IS 'Identity anchor — links user_account, board_members, and resident_account. Never deleted, only archived.';
COMMENT ON COLUMN person.archived_at IS 'When set, login credentials are deleted but public record data (name, title, votes) is retained indefinitely.';
