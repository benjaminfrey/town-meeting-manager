-- ============================================================
-- Town Meeting Manager — MINUTES_SECTION table
-- ============================================================
-- A section within a minutes document, typically corresponding
-- to an agenda item. Sections are ordered by sort_order and
-- each contains structured JSON content.
-- ============================================================

CREATE TABLE minutes_section (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minutes_document_id UUID NOT NULL REFERENCES minutes_document(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  content_json JSONB NOT NULL DEFAULT '{}',
  source_agenda_item_id UUID REFERENCES agenda_item(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE minutes_section IS 'A section within a minutes document, typically corresponding to an agenda item.';
COMMENT ON COLUMN minutes_section.section_type IS 'Section type: header, attendance, agenda_item, motion, public_comment, executive_session, adjournment, other.';
COMMENT ON COLUMN minutes_section.source_agenda_item_id IS 'Links this minutes section back to the agenda item it documents.';
COMMENT ON COLUMN minutes_section.content_json IS 'Structured JSON content for this section: discussion summary, motions, votes, speakers, etc.';
