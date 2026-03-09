-- ============================================================
-- Town Meeting Manager — Indexes
-- ============================================================
-- PostgreSQL does NOT auto-index foreign keys. These indexes
-- cover all FKs plus commonly queried columns and composite
-- patterns for efficient queries.
-- ============================================================

-- ─── Person ────────────────────────────────────────────────
CREATE INDEX idx_person_town_id ON person(town_id);
CREATE INDEX idx_person_email ON person(email);
CREATE INDEX idx_person_archived ON person(town_id) WHERE archived_at IS NULL;

-- ─── User Account ──────────────────────────────────────────
CREATE INDEX idx_user_account_town_id ON user_account(town_id);
CREATE INDEX idx_user_account_person_id ON user_account(person_id);
CREATE INDEX idx_user_account_auth_user_id ON user_account(auth_user_id);
CREATE INDEX idx_user_account_role ON user_account(town_id, role);

-- ─── Board ─────────────────────────────────────────────────
CREATE INDEX idx_board_town_id ON board(town_id);
CREATE INDEX idx_board_type ON board(town_id, board_type);

-- ─── Board Member ──────────────────────────────────────────
CREATE INDEX idx_board_member_person_id ON board_member(person_id);
CREATE INDEX idx_board_member_board_id ON board_member(board_id);
CREATE INDEX idx_board_member_town_id ON board_member(town_id);
CREATE INDEX idx_board_member_active ON board_member(board_id, status) WHERE status = 'active';

-- ─── Meeting ───────────────────────────────────────────────
CREATE INDEX idx_meeting_board_id ON meeting(board_id);
CREATE INDEX idx_meeting_town_id ON meeting(town_id);
CREATE INDEX idx_meeting_status ON meeting(town_id, status);
CREATE INDEX idx_meeting_date ON meeting(town_id, scheduled_date);
CREATE INDEX idx_meeting_created_by ON meeting(created_by);

-- ─── Agenda Item ───────────────────────────────────────────
CREATE INDEX idx_agenda_item_meeting_id ON agenda_item(meeting_id);
CREATE INDEX idx_agenda_item_town_id ON agenda_item(town_id);
CREATE INDEX idx_agenda_item_parent ON agenda_item(parent_item_id);
CREATE INDEX idx_agenda_item_sort ON agenda_item(meeting_id, sort_order);

-- ─── Motion ────────────────────────────────────────────────
CREATE INDEX idx_motion_agenda_item_id ON motion(agenda_item_id);
CREATE INDEX idx_motion_meeting_id ON motion(meeting_id);
CREATE INDEX idx_motion_town_id ON motion(town_id);
CREATE INDEX idx_motion_moved_by ON motion(moved_by);
CREATE INDEX idx_motion_status ON motion(meeting_id, status);

-- ─── Vote Record ───────────────────────────────────────────
CREATE INDEX idx_vote_record_motion_id ON vote_record(motion_id);
CREATE INDEX idx_vote_record_meeting_id ON vote_record(meeting_id);
CREATE INDEX idx_vote_record_town_id ON vote_record(town_id);
CREATE INDEX idx_vote_record_board_member_id ON vote_record(board_member_id);

-- ─── Meeting Attendance ────────────────────────────────────
CREATE INDEX idx_attendance_meeting_id ON meeting_attendance(meeting_id);
CREATE INDEX idx_attendance_town_id ON meeting_attendance(town_id);
CREATE INDEX idx_attendance_person_id ON meeting_attendance(person_id);
CREATE INDEX idx_attendance_board_member_id ON meeting_attendance(board_member_id);
