-- ============================================================
-- Baseline derivation, part 1 of 2: de-Supabase the schema
-- ============================================================
-- NOT a migration. NOT applied by any builder. NOT RUNNABLE ANY MORE.
--
-- This is the itemised record of how packages/api/drizzle/0000_baseline.sql
-- was derived from the historical supabase/migrations corpus. It is committed
-- so that "what exactly changed between the corpus and the baseline?" has an
-- answer a reviewer can read, rather than only a 4000-line pg_dump to diff.
-- Every de-Supabase change is here; the RLS policy rewrite is in the
-- baseline's own section 3, hand-written for the same reason.
--
-- It ran once, against a scratch database that had the full corpus applied
-- with scripts/dev/auth-shim.sql in place. That shim was deleted in the same
-- task — which is the whole point, nothing needs it now — so this file cannot
-- be re-run and is provenance, not tooling. packages/api/drizzle/0000_baseline.sql
-- is the source of truth from here on; change the schema with a new
-- forward-only migration beside it, never by editing this.
--
-- Everything here removes a Supabase/GoTrue/Storage dependency or
-- hardens a SECURITY DEFINER function. The RLS policy rewrite is NOT
-- here — it is hand-written in derive-baseline.sh so that the
-- security-critical half of the baseline is reviewable prose SQL rather
-- than a pg_dump normalisation.
-- ============================================================

-- ─── 1. GoTrue-specific objects ──────────────────────────────
-- handle_new_user() is an AFTER INSERT trigger on auth.users: with no
-- GoTrue there is no auth.users and nothing to trigger.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- custom_access_token_hook() is GoTrue's JWT claims hook. Identity now
-- arrives as session settings (app.town_id etc.) set by the API, not as
-- JWT claims, so there is nothing for a token hook to enrich.
DROP FUNCTION IF EXISTS public.custom_access_token_hook(JSONB);

-- invite_user() validated preconditions for a Supabase Auth Admin API
-- invite call. Zero call sites in packages/* (only a stale row in the
-- generated packages/shared/src/types/database.ts). A SECURITY DEFINER
-- function with no callers is pure attack surface; Better Auth (Task C1)
-- owns invitations now.
DROP FUNCTION IF EXISTS public.invite_user(TEXT, UUID, UUID, UUID, TEXT, TEXT);

-- ─── 2. The FK that halted every build ───────────────────────
-- supabase/migrations/20260308000004_create_user_account.sql:26 —
-- `auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL`
-- — is file 4 of 58 and the reason the corpus could never be applied to
-- plain Postgres. The COLUMN stays (dropping it would break ~40 TS call
-- sites and three RLS policies for no benefit today); only the FK to the
-- GoTrue-owned table goes. The UNIQUE constraint is retained.
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_auth_user_id_fkey;

COMMENT ON COLUMN user_account.auth_user_id IS
  'External identity-provider subject id. Unconstrained: the FK to Supabase GoTrue''s auth.users was dropped when GoTrue was removed (Stage 1 Task B2). Better Auth (Task C1) owns identity now and decides this column''s final fate — retype to match Better Auth''s user id, re-point as a real FK, or drop in favour of a new column. Until C1 lands, nothing writes it and nothing enforces it.';

-- ─── 3. Identity helpers: JWT claims -> session settings ─────
-- The four helpers that read identity directly. `current_setting(x, true)`
-- returns NULL for an unset variable instead of raising 42704 — without
-- the second argument every query on a session that has not set the
-- variable would throw. nullif(...,'') converts the empty string that
-- `SET app.town_id = ''` would produce into NULL rather than a cast error.
--
-- The API sets these per-transaction with SET LOCAL (see Task B3's
-- withTenant), so they revert at transaction end and cannot leak to the
-- next request on a pooled connection.

CREATE OR REPLACE FUNCTION get_current_town_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN nullif(current_setting('app.town_id', true), '')::UUID;
END;
$$;

COMMENT ON FUNCTION get_current_town_id IS 'Current tenant, from the app.town_id session setting the API sets with SET LOCAL inside each request transaction. NULL when unset, which makes every tenancy policy fail closed.';

CREATE OR REPLACE FUNCTION get_current_role()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN nullif(current_setting('app.role', true), '');
END;
$$;

COMMENT ON FUNCTION get_current_role IS 'App role (admin/staff/board_member/sys_admin) from the app.role session setting. No longer consulted by any RLS policy — authorization moved to TypeScript (Task D1); retained because has_permission/has_board_permission still build on it.';

CREATE OR REPLACE FUNCTION get_current_person_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN nullif(current_setting('app.person_id', true), '')::UUID;
END;
$$;

COMMENT ON FUNCTION get_current_person_id IS 'Current person, from the app.person_id session setting.';

CREATE OR REPLACE FUNCTION get_current_user_account_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN nullif(current_setting('app.user_account_id', true), '')::UUID;
END;
$$;

COMMENT ON FUNCTION get_current_user_account_id IS 'Current user_account, from the app.user_account_id session setting.';

-- ─── 4. SET search_path on every remaining SECURITY DEFINER ──
-- A SECURITY DEFINER function with a mutable search_path is a privilege
-- escalation vector: anyone who can create an object in a schema that
-- resolves earlier than the intended one hijacks the call. ALTER FUNCTION
-- is used for the three whose bodies are unchanged, so their logic is not
-- retyped (and cannot be mistranscribed) just to attach a setting.
ALTER FUNCTION is_admin() SET search_path = pg_catalog, public;
ALTER FUNCTION has_permission(TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION has_board_permission(TEXT, UUID) SET search_path = pg_catalog, public;

-- complete_onboarding already carried `SET search_path = public`; it is
-- widened to `pg_catalog, public` by the CREATE OR REPLACE in §5, which it
-- needs anyway to drop its auth.uid() dependency.

-- The five SECURITY INVOKER functions are pinned too. Cheap, and it means
-- "every function in this schema has an explicit search_path" is a
-- property that can be asserted mechanically rather than a per-function
-- judgement call that rots as functions are added.
ALTER FUNCTION update_updated_at_column() SET search_path = pg_catalog, public;
ALTER FUNCTION extract_minutes_text(JSONB) SET search_path = pg_catalog, public;
ALTER FUNCTION minutes_document_search_update() SET search_path = pg_catalog, public;
ALTER FUNCTION agenda_item_search_update() SET search_path = pg_catalog, public;
ALTER FUNCTION portal_search(UUID, TEXT, TEXT, UUID, DATE, DATE, INTEGER, INTEGER) SET search_path = pg_catalog, public;

-- ─── 5. complete_onboarding: auth.uid() -> session setting ───
-- Body is otherwise byte-identical to
-- supabase/migrations/20260310000003_onboarding_rpc.sql. Only the
-- identity read changes.
--
-- KNOWN GAP, deliberately not solved here (see task-5-report.md §"Hand-offs"):
-- this function is SECURITY DEFINER specifically so it could bypass RLS to
-- create the very first town. FORCE ROW LEVEL SECURITY (§ RLS section of the
-- baseline) removes that bypass for the table owner too, so from now on it
-- can only insert a town when app.town_id already equals the id it is
-- creating. The town_insert policy is written to make exactly that work,
-- but wiring it up is Task C1/D1's onboarding procedure, not this task's.
CREATE OR REPLACE FUNCTION complete_onboarding(
  p_town_name           TEXT,
  p_state               TEXT DEFAULT 'ME',
  p_municipality_type   TEXT DEFAULT 'town',
  p_population_range    TEXT DEFAULT NULL,
  p_meeting_formality   TEXT DEFAULT 'semi_formal',
  p_minutes_style       TEXT DEFAULT 'action',
  p_presiding_officer   TEXT DEFAULT NULL,
  p_minutes_recorder    TEXT DEFAULT NULL,
  p_staff_roles_present JSONB DEFAULT '[]'::jsonb,
  p_board_name          TEXT DEFAULT 'Select Board',
  p_member_count        INTEGER DEFAULT NULL,
  p_election_method     TEXT DEFAULT NULL,
  p_officer_election_method TEXT DEFAULT NULL,
  p_seat_titles         JSONB DEFAULT '[]'::jsonb,
  p_district_based      BOOLEAN DEFAULT false,
  p_staggered_terms     BOOLEAN DEFAULT false,
  p_additional_boards   JSONB DEFAULT '[]'::jsonb,
  p_contact_name        TEXT DEFAULT NULL,
  p_contact_email       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
  v_town_id UUID;
  v_board   JSONB;
BEGIN
  -- Caller identity, from the session setting the API establishes.
  v_user_id := nullif(current_setting('app.user_account_id', true), '')::UUID;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM user_account WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'User already belongs to a town';
  END IF;

  INSERT INTO town (
    name, state, municipality_type, population_range,
    meeting_formality, minutes_style,
    presiding_officer_default, minutes_recorder_default,
    staff_roles_present
  ) VALUES (
    p_town_name, p_state, p_municipality_type::municipality_type, p_population_range,
    p_meeting_formality::meeting_formality, p_minutes_style::minutes_style,
    p_presiding_officer, p_minutes_recorder,
    p_staff_roles_present
  )
  RETURNING id INTO v_town_id;

  INSERT INTO board (
    town_id, name, member_count, election_method,
    officer_election_method, is_governing_board,
    seat_titles, district_based, staggered_terms
  ) VALUES (
    v_town_id, p_board_name, p_member_count, p_election_method,
    p_officer_election_method, true,
    p_seat_titles, p_district_based, p_staggered_terms
  );

  FOR v_board IN SELECT * FROM jsonb_array_elements(p_additional_boards) LOOP
    INSERT INTO board (
      town_id, name, member_count, elected_or_appointed, is_governing_board
    ) VALUES (
      v_town_id,
      v_board->>'name',
      (v_board->>'memberCount')::INTEGER,
      COALESCE(v_board->>'electedOrAppointed', 'elected'),
      false
    );
  END LOOP;

  INSERT INTO person (id, town_id, name, email)
  VALUES (v_user_id, v_town_id, COALESCE(p_contact_name, 'Admin'), p_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    town_id = EXCLUDED.town_id,
    name = EXCLUDED.name,
    email = EXCLUDED.email;

  INSERT INTO user_account (id, person_id, town_id, role)
  VALUES (v_user_id, v_user_id, v_town_id, 'admin')
  ON CONFLICT (id) DO UPDATE SET
    town_id = EXCLUDED.town_id,
    role = EXCLUDED.role;

  RETURN v_town_id;
END;
$$;

COMMENT ON FUNCTION complete_onboarding IS
  'Onboarding wizard completion: creates town, boards, person, and user_account in one transaction. Identity comes from the app.user_account_id session setting (was auth.uid()). NOTE: under FORCE ROW LEVEL SECURITY this no longer bypasses RLS — app.town_id must already equal the town id being created. Task C1/D1 owns the replacement procedure.';

-- ─── 6. Supabase Storage ─────────────────────────────────────
-- supabase/migrations/20260311000003_session_0603_storage_bucket.sql
-- registered a `documents` bucket in storage.buckets and put an RLS policy
-- on storage.objects keyed on storage.foldername(). It is the second of the
-- two migrations no builder could ever apply. Nothing in the public schema
-- depended on it: document locations are plain TEXT url columns added by
-- 20260311000002_session_0603_document_urls.sql, which survive untouched.
-- Task F2 owns filesystem storage and the authorization that replaces the
-- storage.objects policy; there is no public-schema object to create here.
DROP POLICY IF EXISTS "Town members can read their documents" ON storage.objects;

-- ─── 7. Supabase/GoTrue role grants ──────────────────────────
-- 20260308000039_configure_auth_hooks.sql granted supabase_auth_admin
-- rights on public.person / public.user_account for the two GoTrue
-- functions dropped in §1. 20260310000003 granted EXECUTE on
-- complete_onboarding to `authenticated`. None of these four roles exist
-- outside a Supabase deployment.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r);
      EXECUTE format('DROP OWNED BY %I', r);
    END IF;
  END LOOP;
END $$;

-- ─── 8. The auth and storage schemas themselves ──────────────
-- With §1-§7 done nothing in the public schema references either. Dropping
-- them here is what makes the pg_dump in derive-baseline.sh incapable of
-- emitting an auth.* or storage.* reference even by accident.
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;

-- ─── 9. Every RLS policy currently on the schema ─────────────
-- Dropped wholesale. derive-baseline.sh's hand-written section replaces
-- them with the tenancy-only set. Dropping by enumeration (rather than by
-- name) means a policy added to the corpus later cannot survive unnoticed
-- into the baseline with its old predicate.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
