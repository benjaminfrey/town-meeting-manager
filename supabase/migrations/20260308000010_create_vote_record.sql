-- ============================================================
-- Town Meeting Manager — VOTE_RECORD table
-- ============================================================
-- Individual vote cast by a board member on a motion.
-- Required by Maine law (30-A M.R.S.A. §2605) to be recorded.
-- Recusal requires a stated reason per disclosure requirements.
-- ============================================================

CREATE TABLE vote_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motion_id UUID NOT NULL REFERENCES motion(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  board_member_id UUID NOT NULL REFERENCES board_member(id) ON DELETE CASCADE,
  vote vote_type NOT NULL,
  recusal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each board member votes once per motion
  CONSTRAINT vote_record_unique_per_motion UNIQUE (motion_id, board_member_id)
);

COMMENT ON TABLE vote_record IS 'Individual vote cast by a board member on a motion. Required by Maine law to be recorded.';
COMMENT ON COLUMN vote_record.recusal_reason IS 'Required when vote = recusal. Recorded per 30-A M.R.S.A. §2605(4) disclosure requirement.';
