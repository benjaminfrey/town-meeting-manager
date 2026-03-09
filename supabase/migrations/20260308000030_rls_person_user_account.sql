-- ============================================================
-- Town Meeting Manager — RLS Policies: PERSON & USER_ACCOUNT
-- ============================================================
-- PERSON: All authenticated users in the town can read persons
-- (needed for meeting attendance, board rosters, etc.).
-- Only admin can create/modify persons (T2: Manage user accounts).
--
-- USER_ACCOUNT: All users in the town can read (needed for
-- display of created_by, moved_by references). Only admin can
-- create/modify accounts (T2, T4: Manage user accounts, set
-- permissions). No client-side DELETE — archival sets archived_at.
-- ============================================================

-- ─── PERSON ──────────────────────────────────────────────────

-- All authenticated users in the town can read persons
CREATE POLICY person_select ON person
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin can create persons (T2)
CREATE POLICY person_insert ON person
  FOR INSERT WITH CHECK (town_id = get_current_town_id() AND is_admin());

-- Admin can update persons (T2)
CREATE POLICY person_update ON person
  FOR UPDATE USING (town_id = get_current_town_id() AND is_admin());

-- ─── USER_ACCOUNT ────────────────────────────────────────────

-- All authenticated users in the town can read user accounts
-- (needed to resolve FK references like meeting.created_by, motion.moved_by)
CREATE POLICY user_account_select ON user_account
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin can create user accounts (T2)
CREATE POLICY user_account_insert ON user_account
  FOR INSERT WITH CHECK (town_id = get_current_town_id() AND is_admin());

-- Admin can update user accounts (T2, T4: set permissions)
CREATE POLICY user_account_update ON user_account
  FOR UPDATE USING (town_id = get_current_town_id() AND is_admin());
