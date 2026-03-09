-- ============================================================
-- Town Meeting Manager — RLS Policies: BOARD & BOARD_MEMBER
-- ============================================================
-- BOARD: All authenticated users can read boards (needed for
-- navigation, meeting context, board rosters). Only admin can
-- create/modify boards (T3: Manage board configuration).
--
-- BOARD_MEMBER: All authenticated users can read memberships
-- (needed for voting context, attendance, quorum checks).
-- Only admin can create/modify memberships (T3).
-- No client-side DELETE — archival sets status to 'archived'.
-- ============================================================

-- ─── BOARD ───────────────────────────────────────────────────

-- All authenticated users in the town can read boards
CREATE POLICY board_select ON board
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin can create boards (T3)
CREATE POLICY board_insert ON board
  FOR INSERT WITH CHECK (town_id = get_current_town_id() AND is_admin());

-- Admin can update boards (T3)
CREATE POLICY board_update ON board
  FOR UPDATE USING (town_id = get_current_town_id() AND is_admin());

-- ─── BOARD_MEMBER ────────────────────────────────────────────

-- All authenticated users in the town can read board memberships
CREATE POLICY board_member_select ON board_member
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin can create board memberships (T3)
CREATE POLICY board_member_insert ON board_member
  FOR INSERT WITH CHECK (town_id = get_current_town_id() AND is_admin());

-- Admin can update board memberships (T3)
CREATE POLICY board_member_update ON board_member
  FOR UPDATE USING (town_id = get_current_town_id() AND is_admin());
