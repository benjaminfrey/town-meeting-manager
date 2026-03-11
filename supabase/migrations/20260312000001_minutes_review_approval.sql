-- ============================================================
-- Town Meeting Manager — Minutes Review & Approval Workflow
-- ============================================================
-- Session 09.02: Adds columns for tracked changes, amendment
-- history, and links agenda items to minutes for auto-approval.
-- ============================================================

-- ─── minutes_document additions ──────────────────────────────

-- Snapshot of content_json at generation time (for tracked changes diff)
ALTER TABLE minutes_document
  ADD COLUMN IF NOT EXISTS original_content_json JSONB;

COMMENT ON COLUMN minutes_document.original_content_json
  IS 'Snapshot of content_json at generation time. Used for tracked changes diff.';

-- Amendment history: array of { round, returned_at, reason, returned_by, resubmitted_at }
ALTER TABLE minutes_document
  ADD COLUMN IF NOT EXISTS amendments_history JSONB DEFAULT '[]';

COMMENT ON COLUMN minutes_document.amendments_history
  IS 'Array tracking each round of amendments: { round, returned_at, reason, returned_by, resubmitted_at }.';

-- Flag set when the approval motion contains "as amended"
ALTER TABLE minutes_document
  ADD COLUMN IF NOT EXISTS approved_as_amended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN minutes_document.approved_as_amended
  IS 'True if the board approved the minutes "as amended."';

-- ─── agenda_item additions ───────────────────────────────────

-- Link a minutes-approval agenda item to the specific minutes document
ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS source_minutes_document_id UUID REFERENCES minutes_document(id) ON DELETE SET NULL;

COMMENT ON COLUMN agenda_item.source_minutes_document_id
  IS 'FK linking a minutes-approval agenda item to the minutes document being approved.';

CREATE INDEX IF NOT EXISTS idx_agenda_item_source_minutes_doc
  ON agenda_item(source_minutes_document_id)
  WHERE source_minutes_document_id IS NOT NULL;
