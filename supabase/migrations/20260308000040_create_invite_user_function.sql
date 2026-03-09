-- ============================================================
-- Town Meeting Manager — invite_user() Validation Function
-- ============================================================
-- Called by the admin before sending an invite through the
-- Supabase Auth admin API. Validates that:
-- 1. The caller is an admin
-- 2. The person record exists in the correct town
-- 3. The user_account record exists and is linked to the person
--
-- The actual invite email is sent via the Supabase Auth Admin API
-- (using the service_role key) from the application layer, NOT
-- from this database function. This function only validates
-- preconditions.
--
-- When the user accepts the invite:
-- 1. Supabase Auth creates the auth.users record
-- 2. handle_new_user() trigger fires
-- 3. The trigger links auth.users to the existing user_account
-- 4. custom_access_token_hook() enriches all future JWTs
-- ============================================================

CREATE OR REPLACE FUNCTION public.invite_user(
  p_email TEXT,
  p_town_id UUID,
  p_person_id UUID,
  p_user_account_id UUID,
  p_role TEXT,
  p_redirect_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  -- Verify the calling user is an admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can invite users';
  END IF;

  -- Verify the caller's town matches the target town
  IF get_current_town_id() <> p_town_id THEN
    RAISE EXCEPTION 'Cannot invite users to a different town';
  END IF;

  -- Verify the person exists in this town
  IF NOT EXISTS (
    SELECT 1 FROM person WHERE id = p_person_id AND town_id = p_town_id
  ) THEN
    RAISE EXCEPTION 'Person not found in this town';
  END IF;

  -- Verify the user_account exists and is linked to this person
  IF NOT EXISTS (
    SELECT 1 FROM user_account
    WHERE id = p_user_account_id
    AND person_id = p_person_id
    AND town_id = p_town_id
  ) THEN
    RAISE EXCEPTION 'User account not found for this person in this town';
  END IF;

  -- Verify the user_account doesn't already have an auth link
  IF EXISTS (
    SELECT 1 FROM user_account
    WHERE id = p_user_account_id
    AND auth_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'User account already has an auth login linked';
  END IF;

  -- All validations passed — return success
  -- The application layer will now call the Supabase Auth Admin API
  -- to send the actual invite email
  RETURN jsonb_build_object(
    'success', true,
    'email', p_email,
    'person_id', p_person_id,
    'user_account_id', p_user_account_id,
    'redirect_url', p_redirect_url
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.invite_user IS 'Validates preconditions for inviting a user. Called by admin before the Supabase Auth Admin API invite call.';
