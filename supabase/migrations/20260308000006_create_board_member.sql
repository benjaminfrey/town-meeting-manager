-- ============================================================
-- Town Meeting Manager — BOARD_MEMBER table
-- ============================================================
-- Links a PERSON to a BOARD with term dates.
-- A person can serve on multiple boards simultaneously.
-- Historical memberships are preserved via status = 'archived'.
-- ============================================================

CREATE TABLE board_member (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  seat_title TEXT,
  term_start DATE NOT NULL,
  term_end DATE,
  status board_member_status NOT NULL DEFAULT 'active',
  is_default_rec_sec BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A person can only have one active membership per board
  CONSTRAINT board_member_unique_active UNIQUE (person_id, board_id, status)
);

COMMENT ON TABLE board_member IS 'Links a PERSON to a BOARD with term dates. A person can serve on multiple boards simultaneously.';
COMMENT ON COLUMN board_member.seat_title IS 'Position on the board: Chair, Vice Chair, Member, Secretary, etc.';
COMMENT ON COLUMN board_member.is_default_rec_sec IS 'If true, this member is the default recording secretary for this board.';
COMMENT ON COLUMN board_member.term_end IS 'Null for indefinite appointments. Set when term expires or member resigns.';
