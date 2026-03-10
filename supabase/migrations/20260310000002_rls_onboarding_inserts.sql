-- ============================================================
-- RLS Policies for Self-Service Updates
-- ============================================================
-- The onboarding wizard uses a SECURITY DEFINER RPC function
-- (complete_onboarding) that bypasses RLS, so no INSERT
-- policies are needed for onboarding.
--
-- This migration adds policies for users to update their own
-- records after onboarding is complete.
-- ============================================================

-- Allow users to update their own user_account record.
-- Needed for profile changes, permission updates by admin, etc.
CREATE POLICY user_account_update_own ON user_account
  FOR UPDATE TO authenticated
  USING (person_id = auth.uid());
