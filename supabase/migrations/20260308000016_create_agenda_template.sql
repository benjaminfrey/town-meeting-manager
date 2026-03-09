-- ============================================================
-- Town Meeting Manager — AGENDA_TEMPLATE table
-- ============================================================
-- Reusable agenda structure templates. Can be board-specific
-- (board_id set) or town-wide (board_id = null).
-- The default template is auto-applied when creating a new
-- meeting for a board.
-- ============================================================

CREATE TABLE agenda_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID REFERENCES board(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sections JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT template_name_unique_per_board UNIQUE (board_id, name)
);

COMMENT ON TABLE agenda_template IS 'Reusable agenda structure templates. Board-specific or town-wide (board_id = null).';
COMMENT ON COLUMN agenda_template.sections IS 'JSON array of section definitions: [{ section_type, title, sort_order, default_items: [...] }]';
COMMENT ON COLUMN agenda_template.is_default IS 'If true, this template is auto-applied when creating a new meeting for this board.';
