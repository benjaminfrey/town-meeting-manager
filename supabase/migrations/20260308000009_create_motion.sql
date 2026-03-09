-- ============================================================
-- Town Meeting Manager — MOTION table
-- ============================================================
-- A formal motion made during a meeting on an agenda item.
-- Tracks who moved, seconded, and the outcome.
-- Motion types follow Roberts Rules of Order.
-- ============================================================

CREATE TABLE motion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_item_id UUID NOT NULL REFERENCES agenda_item(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  motion_text TEXT NOT NULL,
  motion_type motion_type NOT NULL DEFAULT 'main',
  moved_by UUID REFERENCES board_member(id),
  seconded_by UUID REFERENCES board_member(id),
  status motion_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE motion IS 'A formal motion made during a meeting on an agenda item. Tracks who moved, seconded, and the outcome.';
COMMENT ON COLUMN motion.motion_type IS 'Roberts Rules motion classification: main, amendment, substitute, table, etc.';
COMMENT ON COLUMN motion.moved_by IS 'The board_member who made the motion.';
COMMENT ON COLUMN motion.seconded_by IS 'The board_member who seconded. Null if no second required or not yet seconded.';
