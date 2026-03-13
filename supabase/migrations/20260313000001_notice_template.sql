-- Notice template blocks stored on board (null = not configured)
ALTER TABLE board
  ADD COLUMN notice_template_blocks JSONB;

-- Notice tracking on meeting
ALTER TABLE meeting
  ADD COLUMN notice_generated_at TIMESTAMPTZ,
  ADD COLUMN notice_pdf_storage_path TEXT,
  ADD COLUMN notice_published_at TIMESTAMPTZ;

-- meeting_type is a text column, so new values (annual_town_meeting,
-- special_town_meeting, workshop) are supported without a schema change.
