-- ============================================================
-- Town Meeting Manager — RLS Policies: AGENDA_ITEM, MOTION,
--   VOTE_RECORD, MEETING_ATTENDANCE
-- ============================================================
-- These tables are scoped by town_id for multi-tenant isolation.
-- Write access is checked against the permissions JSONB using
-- action codes from advisory 1.2.
--
-- Note: These tables don't have a direct board_id column, so
-- board-specific permission checks would require a join through
-- meeting. For MVP performance, we use has_permission() which
-- checks global permissions only. Board-level granularity can
-- be added later if needed.
-- ============================================================

-- ─── AGENDA_ITEM ─────────────────────────────────────────────

-- All authenticated users in the town can read agenda items (V1)
CREATE POLICY agenda_item_select ON agenda_item
  FOR SELECT USING (town_id = get_current_town_id());

-- A2 (Build/edit agenda items) required to create
CREATE POLICY agenda_item_insert ON agenda_item
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_permission('A2')
  );

-- A2 required to update
CREATE POLICY agenda_item_update ON agenda_item
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('A2')
  );

-- ─── MOTION ──────────────────────────────────────────────────

-- All authenticated users in the town can read motions
CREATE POLICY motion_select ON motion
  FOR SELECT USING (town_id = get_current_town_id());

-- M3 (Capture motions, seconds, votes) required to create
CREATE POLICY motion_insert ON motion
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_permission('M3')
  );

-- M3 required to update (e.g., recording the outcome)
CREATE POLICY motion_update ON motion
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('M3')
  );

-- ─── VOTE_RECORD ─────────────────────────────────────────────

-- All authenticated users in the town can read vote records
CREATE POLICY vote_record_select ON vote_record
  FOR SELECT USING (town_id = get_current_town_id());

-- Vote records can be created by:
--   1. Staff/admin with M3 (Capture motions, seconds, votes) — recording others' votes
--   2. Board members voting for themselves (M8: Vote as board member)
CREATE POLICY vote_record_insert ON vote_record
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND (
      has_permission('M3')
      OR (
        get_current_role() = 'board_member'
        AND board_member_id IN (
          SELECT bm.id FROM board_member bm
          WHERE bm.person_id = get_current_person_id()
          AND bm.status = 'active'
        )
      )
    )
  );

-- Vote records can be updated by staff/admin with M3
-- (e.g., correcting a vote recording error)
CREATE POLICY vote_record_update ON vote_record
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('M3')
  );

-- ─── MEETING_ATTENDANCE ──────────────────────────────────────

-- All authenticated users in the town can read attendance
CREATE POLICY attendance_select ON meeting_attendance
  FOR SELECT USING (town_id = get_current_town_id());

-- M2 (Record attendance) required to create
CREATE POLICY attendance_insert ON meeting_attendance
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_permission('M2')
  );

-- M2 required to update (mark arrived, departed, recording secretary)
CREATE POLICY attendance_update ON meeting_attendance
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('M2')
  );
