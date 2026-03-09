-- ============================================================
-- Town Meeting Manager — RLS Policies: MEETING
-- ============================================================
-- All authenticated users in the town can read meetings (V4).
-- Creating meetings requires A1 (Create a new meeting), checked
-- per-board via has_board_permission.
-- Updating meetings (status changes, start/end) requires either
-- admin or M1 (Start/run a live meeting) for that board.
-- No client-side DELETE — meetings are cancelled via status change.
-- ============================================================

-- All authenticated users in the town can read meetings
CREATE POLICY meeting_select ON meeting
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin and staff with A1 permission for this board can create meetings
CREATE POLICY meeting_insert ON meeting
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_board_permission('A1', board_id)
  );

-- Admin and staff with M1 permission can update meetings
-- (start meeting, end meeting, change status, update details)
CREATE POLICY meeting_update ON meeting
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND (
      is_admin()
      OR has_board_permission('A1', board_id)
      OR has_board_permission('M1', board_id)
    )
  );
