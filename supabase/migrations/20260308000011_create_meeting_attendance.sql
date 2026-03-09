-- ============================================================
-- Town Meeting Manager — MEETING_ATTENDANCE table
-- ============================================================
-- Attendance record for a meeting. Tracks board members and
-- any non-member attendees (e.g., staff acting as recording
-- secretary).
--
-- Recording secretary is tracked HERE (per meeting), not on
-- user_account (per advisory 1.2). Any admin, staff, or board
-- member can serve as recording secretary for a given meeting.
-- ============================================================

CREATE TABLE meeting_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  board_member_id UUID REFERENCES board_member(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  status attendance_status NOT NULL DEFAULT 'present',
  is_recording_secretary BOOLEAN NOT NULL DEFAULT false,
  arrived_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,

  -- Each person has one attendance record per meeting
  CONSTRAINT attendance_unique_per_meeting UNIQUE (meeting_id, person_id)
);

COMMENT ON TABLE meeting_attendance IS 'Attendance record for a meeting. Tracks board members and any non-member attendees (staff acting as rec sec).';
COMMENT ON COLUMN meeting_attendance.board_member_id IS 'Null for non-board-member attendees (e.g., staff serving as recording secretary).';
COMMENT ON COLUMN meeting_attendance.is_recording_secretary IS 'True if this person is serving as recording secretary for this meeting. Can be admin, staff, or board member.';
