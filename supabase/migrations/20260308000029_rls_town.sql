-- ============================================================
-- Town Meeting Manager — RLS Policies: TOWN
-- ============================================================
-- Multi-tenant isolation: users can only see/modify their own town.
-- T1 (manage town settings) is admin-only.
-- Towns are created via the onboarding wizard (server-side with
-- service_role), so no INSERT policy is needed for client access.
-- Towns are never deleted via client.
-- ============================================================

-- All authenticated users in the town can read their own town
CREATE POLICY town_select ON town
  FOR SELECT USING (id = get_current_town_id());

-- Only admin can update town settings (T1: Manage town profile/settings)
CREATE POLICY town_update ON town
  FOR UPDATE USING (id = get_current_town_id() AND is_admin());
