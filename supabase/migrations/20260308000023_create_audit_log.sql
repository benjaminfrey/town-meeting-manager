-- ============================================================
-- Town Meeting Manager — AUDIT_LOG table
-- ============================================================
-- Immutable audit trail. Tracks who did what and when.
-- Required for multi-admin accountability per advisory 1.2.
--
-- NOTE: user_account_id uses ON DELETE SET NULL (not CASCADE)
-- so audit records survive user archival/deletion.
-- ============================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  user_account_id UUID REFERENCES user_account(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS 'Immutable audit trail. Tracks who did what and when. Required for multi-admin accountability.';
COMMENT ON COLUMN audit_log.action IS 'Action performed: create, update, delete, archive, publish, approve, login, permission_change, etc.';
COMMENT ON COLUMN audit_log.entity_type IS 'Type of entity acted upon: meeting, agenda_item, minutes_document, user_account, etc.';
COMMENT ON COLUMN audit_log.entity_id IS 'Primary key of the affected entity.';
COMMENT ON COLUMN audit_log.details IS 'Additional context: old/new values, IP address, reason for action.';
COMMENT ON COLUMN audit_log.user_account_id IS 'The user who performed the action. SET NULL on delete to preserve audit trail.';
