-- ============================================================
-- Session 06.02: Meeting Creation & Agenda Building schema
-- ============================================================
-- Adds missing columns to meeting, agenda_item, and exhibit
-- tables needed for meeting creation and agenda building.
-- ============================================================

-- meeting: add meeting_type, formality_override, agenda_status
ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS meeting_type TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS formality_override TEXT;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS agenda_status TEXT NOT NULL DEFAULT 'draft';

COMMENT ON COLUMN meeting.meeting_type IS 'Type: regular, special, public_hearing, emergency.';
COMMENT ON COLUMN meeting.formality_override IS 'Per-meeting formality override. Null uses board/town default.';
COMMENT ON COLUMN meeting.agenda_status IS 'Agenda lifecycle: draft or published.';

-- agenda_item: add Item Commentary fields (advisory Q1)
ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS staff_resource TEXT;

ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS background TEXT;

ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS recommendation TEXT;

ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS suggested_motion TEXT;

COMMENT ON COLUMN agenda_item.staff_resource IS 'Staff resource for this item (Item Commentary).';
COMMENT ON COLUMN agenda_item.background IS 'Background context for this item (Item Commentary).';
COMMENT ON COLUMN agenda_item.recommendation IS 'Staff recommendation for this item (Item Commentary).';
COMMENT ON COLUMN agenda_item.suggested_motion IS 'Pre-drafted motion text (Item Commentary). Supports ___ and [TBD] placeholders.';

-- exhibit: add file_name, change default visibility to public (advisory Q6)
ALTER TABLE exhibit
  ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE exhibit
  ALTER COLUMN visibility SET DEFAULT 'public';

COMMENT ON COLUMN exhibit.file_name IS 'Original filename for display.';
