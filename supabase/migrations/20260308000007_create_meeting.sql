-- ============================================================
-- Town Meeting Manager — MEETING table
-- ============================================================
-- A scheduled or completed meeting of a board.
-- Status lifecycle: draft → noticed → open → adjourned →
--                   minutes_draft → approved. Can also be cancelled.
-- ============================================================

CREATE TABLE meeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  location TEXT,
  status meeting_status NOT NULL DEFAULT 'draft',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE meeting IS 'A scheduled or completed meeting of a board.';
COMMENT ON COLUMN meeting.status IS 'Lifecycle: draft → noticed → open → adjourned → minutes_draft → approved. Can also be cancelled.';
COMMENT ON COLUMN meeting.created_by IS 'The user_account that created this meeting (admin or staff with A1 permission).';
COMMENT ON COLUMN meeting.scheduled_time IS 'Time of day for the meeting. Null for TBD meetings.';
