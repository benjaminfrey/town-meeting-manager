-- ============================================================
-- Migration 012: Invitation Table + Email Fields
-- Session 11.02 — Email Preference Management & Invitation Flow
-- Apply with:
--   PGPASSWORD=<POSTGRES_PASSWORD from docker/.env> \
--     psql -h localhost -p 54322 -U postgres -d postgres \
--     -f docker/migrations/012_invitation_email.sql
-- ============================================================

-- ─── Create invitation table ──────────────────────────────────────────
-- Tracks board member / staff invitations sent via email

CREATE TABLE IF NOT EXISTS invitation (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID         NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  user_account_id UUID         REFERENCES user_account(id) ON DELETE SET NULL,
  town_id         UUID         NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  token           TEXT         NOT NULL UNIQUE,
  status          TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at      TIMESTAMPTZ,
  -- email tracking fields
  email           TEXT,
  role            TEXT,
  invited_by      UUID         REFERENCES user_account(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;

-- Admins/staff can see invitations for their town
CREATE POLICY "town_members_see_invitations" ON invitation
  FOR SELECT USING (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

-- Admins/staff can insert invitations for their town
CREATE POLICY "town_members_insert_invitations" ON invitation
  FOR INSERT WITH CHECK (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

-- Admins/staff can update invitations for their town
CREATE POLICY "town_members_update_invitations" ON invitation
  FOR UPDATE USING (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

-- Index for token lookups (public validation endpoint)
CREATE INDEX IF NOT EXISTS idx_invitation_token
  ON invitation (token)
  WHERE status = 'pending';

-- Index for person lookups (MemberRoster)
CREATE INDEX IF NOT EXISTS idx_invitation_person_status
  ON invitation (person_id, status);

-- ─── Add email column to user_account ────────────────────────────────
-- Denormalized email for notification lookups (set when invitation accepted)

ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS email         TEXT,
  ADD COLUMN IF NOT EXISTS display_name  TEXT;

-- ─── Backfill email + display_name from person ───────────────────────
-- For existing user accounts that have a linked person

UPDATE user_account ua
SET
  email        = p.email,
  display_name = p.name
FROM person p
WHERE ua.person_id = p.id
  AND (ua.email IS NULL OR ua.display_name IS NULL);
