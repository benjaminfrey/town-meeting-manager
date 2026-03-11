-- ============================================================
-- Town Meeting Manager — Add minutes generation columns
-- ============================================================
-- Extends minutes_document with columns needed for the generation
-- pipeline: board_id, minutes_style, submitted_for_review_at,
-- published_at, created_by.
-- ============================================================

ALTER TABLE minutes_document
  ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES board(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS minutes_style TEXT NOT NULL DEFAULT 'summary',
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES user_account(id) ON DELETE SET NULL;

-- Backfill board_id from the meeting table for any existing rows
UPDATE minutes_document md
SET board_id = m.board_id
FROM meeting m
WHERE md.meeting_id = m.id
  AND md.board_id IS NULL;

-- Add certification_format to boards
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS certification_format TEXT NOT NULL DEFAULT 'prepared_by';

-- Add member_reference_style to boards
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS member_reference_style TEXT NOT NULL DEFAULT 'title_and_last_name';

-- Index for querying minutes by board
CREATE INDEX IF NOT EXISTS idx_minutes_document_board_id ON minutes_document(board_id);
