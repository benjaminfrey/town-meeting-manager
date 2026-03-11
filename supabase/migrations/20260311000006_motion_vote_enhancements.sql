-- ============================================================
-- Motion & Vote Enhancements
-- ============================================================
-- Adds parent_motion_id for amendment tracking and vote_summary
-- JSONB for storing computed vote tallies on motions.
-- ============================================================

-- Parent motion reference for amendments
ALTER TABLE motion ADD COLUMN parent_motion_id UUID REFERENCES motion(id);

-- Vote summary stored as JSONB for quick display
-- Example: {"yeas":4,"nays":1,"abstentions":0,"recusals":1,"absent":1,"result":"passed"}
ALTER TABLE motion ADD COLUMN vote_summary JSONB;

-- Index for efficient amendment lookups
CREATE INDEX idx_motion_parent ON motion(parent_motion_id) WHERE parent_motion_id IS NOT NULL;

COMMENT ON COLUMN motion.parent_motion_id IS 'References the parent motion when this is an amendment. NULL for top-level motions.';
COMMENT ON COLUMN motion.vote_summary IS 'Computed vote tally stored as JSONB after vote is recorded. Contains yeas, nays, abstentions, recusals, absent, and result.';
