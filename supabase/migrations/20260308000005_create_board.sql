-- ============================================================
-- Town Meeting Manager — BOARD table
-- ============================================================
-- A municipal board, committee, or commission within a town.
-- Supports formality and minutes style overrides at the board level.
-- ============================================================

CREATE TABLE board (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  board_type board_type NOT NULL DEFAULT 'other',
  member_count INTEGER,
  election_method TEXT,
  officer_election_method TEXT,
  district_based BOOLEAN NOT NULL DEFAULT false,
  staggered_terms BOOLEAN NOT NULL DEFAULT false,
  is_governing_board BOOLEAN NOT NULL DEFAULT false,
  meeting_formality_override meeting_formality,
  minutes_style_override minutes_style,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,

  CONSTRAINT board_name_unique_per_town UNIQUE (town_id, name)
);

COMMENT ON TABLE board IS 'A municipal board, committee, or commission within a town.';
COMMENT ON COLUMN board.is_governing_board IS 'True for Select Board / City Council — the primary governing body.';
COMMENT ON COLUMN board.meeting_formality_override IS 'Overrides town.meeting_formality for this board. Null = use town default.';
COMMENT ON COLUMN board.minutes_style_override IS 'Overrides town.minutes_style for this board. Null = use town default.';
COMMENT ON COLUMN board.election_method IS 'How members are elected: at_large, role_titled.';
COMMENT ON COLUMN board.officer_election_method IS 'How officers are selected: vote_of_board, highest_vote_getter, appointed_by_authority, rotation.';
