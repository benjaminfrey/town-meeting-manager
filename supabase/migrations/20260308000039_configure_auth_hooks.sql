-- ============================================================
-- Town Meeting Manager — Auth Hook Permissions
-- ============================================================
-- Grant supabase_auth_admin access to the tables it needs for:
-- 1. custom_access_token_hook() — reads user_account to inject
--    JWT claims on every token generation
-- 2. handle_new_user() — reads person/user_account by email,
--    updates user_account.auth_user_id, and creates new records
--    during onboarding
--
-- supabase_auth_admin is the role GoTrue uses to connect to the
-- database. It already has access to the auth schema but needs
-- explicit grants for public schema tables.
-- ============================================================

-- Schema access
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- custom_access_token_hook needs to read user_account
GRANT SELECT ON public.user_account TO supabase_auth_admin;

-- handle_new_user needs to read person (email lookup) and
-- update user_account (link auth_user_id)
GRANT SELECT ON public.person TO supabase_auth_admin;
GRANT UPDATE ON public.user_account TO supabase_auth_admin;

-- handle_new_user needs INSERT on person and user_account for
-- the initial admin onboarding flow
GRANT INSERT ON public.person TO supabase_auth_admin;
GRANT INSERT ON public.user_account TO supabase_auth_admin;
