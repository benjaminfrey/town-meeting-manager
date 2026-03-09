-- ============================================================
-- Town Meeting Manager — handle_new_user() Auth Trigger
-- ============================================================
-- Triggered AFTER INSERT on auth.users.
--
-- Two scenarios:
--
-- 1. INVITED USER (normal flow):
--    Admin creates PERSON + user_account first, then sends invite.
--    When the user accepts the invite, auth.users is created.
--    This trigger links the auth user to the existing user_account
--    by matching on email, and sets app_metadata on auth.users.
--
-- 2. INITIAL ADMIN (onboarding flow):
--    During first-time setup, no PERSON or user_account exists yet.
--    The signup includes town_id in user_metadata. This trigger
--    creates the PERSON and user_account records automatically
--    and grants the admin role.
--
-- The app_metadata set here is what custom_access_token_hook reads
-- on subsequent logins. It's also available client-side via
-- supabase.auth.getUser().
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  existing_account public.user_account%ROWTYPE;
  new_person_id UUID;
  new_account_id UUID;
BEGIN
  -- Scenario 1: Check if a user_account already exists for this email
  -- (admin created the account before sending the invite)
  SELECT ua.* INTO existing_account
  FROM public.user_account ua
  JOIN public.person p ON ua.person_id = p.id
  WHERE p.email = NEW.email
  AND ua.auth_user_id IS NULL
  LIMIT 1;

  IF existing_account.id IS NOT NULL THEN
    -- Link the auth user to the existing user_account
    UPDATE public.user_account
    SET auth_user_id = NEW.id
    WHERE id = existing_account.id;

    -- Set app_metadata on the auth user for JWT claims
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) ||
      jsonb_build_object(
        'town_id', existing_account.town_id::TEXT,
        'role', existing_account.role::TEXT,
        'person_id', existing_account.person_id::TEXT,
        'user_account_id', existing_account.id::TEXT
      )
    WHERE id = NEW.id;

  ELSE
    -- Scenario 2: No pre-existing account — initial admin setup (onboarding)
    -- The town_id must be provided in user_metadata during signup
    IF NEW.raw_user_meta_data ->> 'town_id' IS NOT NULL THEN
      new_person_id := gen_random_uuid();
      new_account_id := gen_random_uuid();

      INSERT INTO public.person (id, town_id, name, email, created_at)
      VALUES (
        new_person_id,
        (NEW.raw_user_meta_data ->> 'town_id')::UUID,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        now()
      );

      INSERT INTO public.user_account (id, person_id, town_id, role, auth_user_id, permissions, created_at)
      VALUES (
        new_account_id,
        new_person_id,
        (NEW.raw_user_meta_data ->> 'town_id')::UUID,
        'admin',
        NEW.id,
        '{"global": {}, "board_overrides": []}',
        now()
      );

      -- Set app_metadata
      UPDATE auth.users
      SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) ||
        jsonb_build_object(
          'town_id', NEW.raw_user_meta_data ->> 'town_id',
          'role', 'admin',
          'person_id', new_person_id::TEXT,
          'user_account_id', new_account_id::TEXT
        )
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS 'Links new auth users to existing user_account (invite flow) or creates initial admin records (onboarding flow). Sets app_metadata for JWT claims.';
