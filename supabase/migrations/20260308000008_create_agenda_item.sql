-- ============================================================
-- Town Meeting Manager — AGENDA_ITEM table
-- ============================================================
-- Individual item on a meeting agenda.
-- Supports nested sub-items via parent_item_id for hierarchical
-- agendas (e.g., sub-items under New Business).
-- ============================================================

CREATE TABLE agenda_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  presenter TEXT,
  estimated_duration INTEGER,
  parent_item_id UUID REFERENCES agenda_item(id) ON DELETE CASCADE,
  status agenda_item_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agenda_item IS 'Individual item on a meeting agenda. Supports nested sub-items via parent_item_id.';
COMMENT ON COLUMN agenda_item.section_type IS 'Agenda section type: ceremonial, procedural, minutes_approval, financial, public_input, report, action, discussion, public_hearing, executive_session, other.';
COMMENT ON COLUMN agenda_item.estimated_duration IS 'Estimated duration in minutes.';
COMMENT ON COLUMN agenda_item.parent_item_id IS 'Self-referencing FK for sub-items (e.g., sub-items under New Business).';
