-- ============================================================
-- Session 06.03: Document Generation Pipeline — schema changes
-- ============================================================
-- Adds document URL and generation timestamp columns to the
-- meeting table for storing generated agenda packets and
-- meeting notices.
-- ============================================================

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS agenda_packet_url TEXT;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS meeting_notice_url TEXT;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS agenda_packet_generated_at TIMESTAMPTZ;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS meeting_notice_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN meeting.agenda_packet_url IS 'Supabase Storage URL of the last generated agenda packet PDF.';
COMMENT ON COLUMN meeting.meeting_notice_url IS 'Supabase Storage URL of the last generated meeting notice PDF.';
COMMENT ON COLUMN meeting.agenda_packet_generated_at IS 'Timestamp of the last agenda packet generation.';
COMMENT ON COLUMN meeting.meeting_notice_generated_at IS 'Timestamp of the last meeting notice generation.';
