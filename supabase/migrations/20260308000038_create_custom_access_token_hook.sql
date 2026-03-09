-- ============================================================
-- Town Meeting Manager — Custom Access Token Hook
-- ============================================================
--
-- JWT Claims Structure for Town Meeting Manager
-- ================================================
--
-- The custom_access_token_hook injects these claims into every JWT:
--
-- {
--   "sub": "<auth-user-uuid>",
--   "aud": "authenticated",
--   "role": "authenticated",
--   "app_metadata": {
--     "town_id": "<town-uuid>",              -- Multi-tenant isolation key
--     "role": "admin|staff|board_member",     -- App role for permission checking
--     "person_id": "<person-uuid>",           -- PERSON entity identifier
--     "user_account_id": "<user-account-uuid>" -- User account identifier
--   },
--   "exp": <timestamp>,
--   "iat": <timestamp>
-- }
--
-- These claims are consumed by:
-- 1. RLS helper functions (session 01.07):
--    - get_current_town_id()  -> app_metadata.town_id
--    - get_current_role()     -> app_metadata.role
--    - get_current_person_id() -> app_metadata.person_id
--    - has_permission()       -> looks up user_account by user_account_id
--
-- 2. PowerSync sync rules (session 01.04):
--    - token_parameters.town_id -> filters all data by town
--
-- 3. Client-side:
--    - supabase.auth.getUser() -> user.app_metadata.role -> UI permission gates
--
-- Auth Flow:
-- 1. Admin creates PERSON + user_account -> invites user via Supabase Auth admin API
-- 2. User accepts invite -> handle_new_user() links auth.users to existing user_account
-- 3. User logs in -> custom_access_token_hook() injects claims from user_account
-- 4. Client receives JWT with all claims -> initializes PowerSync -> RLS enforces isolation
--
-- ============================================================

-- Custom access token hook
-- Called by GoTrue on every token generation (login, refresh)
-- Injects town_id, role, person_id, user_account_id into JWT app_metadata
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  claims JSONB;
  user_account_record RECORD;
BEGIN
  -- Extract current claims from the event
  claims := event -> 'claims';

  -- Look up the user's active account details
  SELECT
    ua.id AS user_account_id,
    ua.town_id,
    ua.role,
    ua.person_id
  INTO user_account_record
  FROM public.user_account ua
  WHERE ua.auth_user_id = (event ->> 'user_id')::UUID
  AND ua.archived_at IS NULL
  LIMIT 1;

  IF user_account_record IS NOT NULL THEN
    -- Inject custom claims into app_metadata
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      COALESCE(claims -> 'app_metadata', '{}'::JSONB) ||
      jsonb_build_object(
        'town_id', user_account_record.town_id::TEXT,
        'role', user_account_record.role::TEXT,
        'person_id', user_account_record.person_id::TEXT,
        'user_account_id', user_account_record.user_account_id::TEXT
      )
    );
  END IF;
  -- If no active user_account found (archived or deleted),
  -- claims are left unchanged; RLS will deny access since
  -- town_id will be null in the JWT.

  -- Return the modified event with updated claims
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to the supabase_auth_admin role
-- (GoTrue connects as supabase_auth_admin to call this function)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from all other roles for security
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;

COMMENT ON FUNCTION public.custom_access_token_hook IS 'GoTrue custom access token hook. Injects town_id, role, person_id, user_account_id into JWT app_metadata on every token generation.';
