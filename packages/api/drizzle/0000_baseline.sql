--
-- ============================================================================
-- Town Meeting Manager — BASELINE SCHEMA
-- ============================================================================
-- Stage 1, Task B2. This file is the schema. It replaces supabase/migrations/
-- as the thing that gets applied: `scripts/build-db-from-repo.sh` and
-- `packages/api/src/test/db-harness.ts` both apply
-- packages/api/drizzle/*.sql in journal order and nothing else.
--
-- supabase/migrations/ stays in the repository, unmodified, as the historical
-- record of how the schema got here. It is no longer applied by anything, and
-- it CANNOT be: 4 of its 58 files reference Supabase GoTrue's `auth` schema
-- and Storage's `storage` schema, which do not exist on plain PostgreSQL, and
-- the very first of those (`user_account.auth_user_id REFERENCES auth.users`,
-- 20260308000004:26) aborts the build at file 4 of 58. That is the wall this
-- baseline exists to get past. Migrations from here on are forward-only files
-- added alongside this one; this file is never edited in place.
--
-- ─── How this file was produced ────────────────────────────────────────────
--
-- Sections 1 and 2 are mechanically derived, not typed by hand:
--
--   1. A scratch database was built by applying all 58 corpus migrations with
--      scripts/dev/auth-shim.sql in place (the two files that cannot apply —
--      the Storage bucket and the superseded notification merge — roll back
--      individually; 20260827000001 supplies the latter's real shape). Result:
--      27 tables, 79 policies, 26 RLS-enabled, 0 forced.
--   2. scripts/dev/baseline-transform.sql was applied. That file is committed
--      and is the itemised record of every de-Supabase change: the GoTrue
--      functions and trigger dropped, the auth.users FK dropped, the four
--      identity helpers rewritten onto session settings, SET search_path added
--      to all 13 functions, the Storage policy and both foreign schemas
--      dropped, and all 79 policies dropped.
--   3. `pg_dump --schema-only --schema=public --no-owner --no-privileges`.
--      pg_dump renders what the database actually contains, so section 1 is
--      faithful by construction rather than by review — including the 132
--      COMMENT ON objects, 13 functions and 9 triggers that drizzle-kit pull
--      cannot see at all.
--
-- Sections 3 and 4 — the security model — are HAND-WRITTEN. They are the part
-- that has to be read rather than trusted.
--
-- NOTE: step 1 is no longer reproducible. scripts/dev/auth-shim.sql was
-- deleted in this same task, which is the point: nothing needs it any more.
-- baseline-transform.sql is kept as provenance, not as a runnable script.
--
-- ─── Contents ──────────────────────────────────────────────────────────────
--   Section 1  Schema: 17 enums, 27 tables, 13 functions, 9 triggers,
--              42 constraints, 78 foreign keys, 82 indexes, 132 comments
--   Section 2  Data: the 5 system-default permission templates
--   Section 3  Row level security: ENABLE + FORCE on all 27 tables,
--              28 tenancy policies
--   Section 4  Roles and grants: tmm_app, DML only
-- ============================================================================

SET check_function_bodies = false;
SET client_min_messages = warning;

--
-- ============================================================================
-- SECTION 1 — SCHEMA
-- ============================================================================
--

--
-- Name: agenda_item_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agenda_item_status AS ENUM (
    'pending',
    'active',
    'completed',
    'tabled',
    'deferred'
);


--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'present',
    'absent',
    'remote',
    'excused',
    'late_arrival',
    'early_departure'
);


--
-- Name: board_member_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.board_member_status AS ENUM (
    'active',
    'archived'
);


--
-- Name: board_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.board_type AS ENUM (
    'select_board',
    'planning_board',
    'zoning_board',
    'budget_committee',
    'conservation_commission',
    'parks_recreation',
    'harbor_committee',
    'shellfish_commission',
    'cemetery_committee',
    'road_committee',
    'comp_plan_committee',
    'broadband_committee',
    'other'
);


--
-- Name: exhibit_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exhibit_visibility AS ENUM (
    'public',
    'board_only',
    'admin_only'
);


--
-- Name: meeting_formality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.meeting_formality AS ENUM (
    'informal',
    'semi_formal',
    'formal'
);


--
-- Name: meeting_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.meeting_status AS ENUM (
    'draft',
    'noticed',
    'open',
    'adjourned',
    'minutes_draft',
    'approved',
    'cancelled'
);


--
-- Name: minutes_document_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.minutes_document_status AS ENUM (
    'draft',
    'review',
    'approved',
    'published'
);


--
-- Name: minutes_generated_by; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.minutes_generated_by AS ENUM (
    'manual',
    'ai',
    'hybrid'
);


--
-- Name: minutes_style; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.minutes_style AS ENUM (
    'action',
    'summary',
    'narrative'
);


--
-- Name: motion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.motion_status AS ENUM (
    'pending',
    'seconded',
    'in_vote',
    'passed',
    'failed',
    'tabled',
    'withdrawn'
);


--
-- Name: motion_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.motion_type AS ENUM (
    'main',
    'amendment',
    'substitute',
    'table',
    'untable',
    'postpone',
    'reconsider',
    'adjourn'
);


--
-- Name: municipality_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.municipality_type AS ENUM (
    'town',
    'city',
    'plantation'
);


--
-- Name: notification_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_channel AS ENUM (
    'email',
    'sms'
);


--
-- Name: notification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'delivered',
    'failed',
    'bounced',
    'completed',
    'complained'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'sys_admin',
    'admin',
    'staff',
    'board_member'
);


--
-- Name: vote_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vote_type AS ENUM (
    'yes',
    'no',
    'abstain',
    'recusal',
    'absent'
);


--
-- Name: agenda_item_search_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agenda_item_search_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.background, '') || ' ' ||
    coalesce(NEW.recommendation, '') || ' ' ||
    coalesce(NEW.suggested_motion, '')
  );
  RETURN NEW;
END;
$$;


--
-- Name: complete_onboarding(text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, jsonb, boolean, boolean, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_onboarding(p_town_name text, p_state text DEFAULT 'ME'::text, p_municipality_type text DEFAULT 'town'::text, p_population_range text DEFAULT NULL::text, p_meeting_formality text DEFAULT 'semi_formal'::text, p_minutes_style text DEFAULT 'action'::text, p_presiding_officer text DEFAULT NULL::text, p_minutes_recorder text DEFAULT NULL::text, p_staff_roles_present jsonb DEFAULT '[]'::jsonb, p_board_name text DEFAULT 'Select Board'::text, p_member_count integer DEFAULT NULL::integer, p_election_method text DEFAULT NULL::text, p_officer_election_method text DEFAULT NULL::text, p_seat_titles jsonb DEFAULT '[]'::jsonb, p_district_based boolean DEFAULT false, p_staggered_terms boolean DEFAULT false, p_additional_boards jsonb DEFAULT '[]'::jsonb, p_contact_name text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: FUNCTION complete_onboarding(p_town_name text, p_state text, p_municipality_type text, p_population_range text, p_meeting_formality text, p_minutes_style text, p_presiding_officer text, p_minutes_recorder text, p_staff_roles_present jsonb, p_board_name text, p_member_count integer, p_election_method text, p_officer_election_method text, p_seat_titles jsonb, p_district_based boolean, p_staggered_terms boolean, p_additional_boards jsonb, p_contact_name text, p_contact_email text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.complete_onboarding(p_town_name text, p_state text, p_municipality_type text, p_population_range text, p_meeting_formality text, p_minutes_style text, p_presiding_officer text, p_minutes_recorder text, p_staff_roles_present jsonb, p_board_name text, p_member_count integer, p_election_method text, p_officer_election_method text, p_seat_titles jsonb, p_district_based boolean, p_staggered_terms boolean, p_additional_boards jsonb, p_contact_name text, p_contact_email text) IS 'Onboarding wizard completion: creates town, boards, person, and user_account in one transaction. Identity comes from the app.user_account_id session setting (was auth.uid()). NOTE: under FORCE ROW LEVEL SECURITY this no longer bypasses RLS — app.town_id must already equal the town id being created. Task C1/D1 owns the replacement procedure.';


--
-- Name: extract_minutes_text(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extract_minutes_text(doc jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  result TEXT := '';
  section JSONB;
  item JSONB;
  motion JSONB;
BEGIN
  -- Meeting header
  result := result || ' ' || coalesce(doc->'meeting_header'->>'town_name', '');
  result := result || ' ' || coalesce(doc->'meeting_header'->>'board_name', '');

  -- Sections
  IF doc->'sections' IS NOT NULL THEN
    FOR section IN SELECT jsonb_array_elements(doc->'sections')
    LOOP
      result := result || ' ' || coalesce(section->>'title', '');
      IF section->'items' IS NOT NULL THEN
        FOR item IN SELECT jsonb_array_elements(section->'items')
        LOOP
          result := result || ' ' || coalesce(item->>'title', '');
          result := result || ' ' || coalesce(item->>'discussion_summary', '');
          result := result || ' ' || coalesce(item->>'operator_notes', '');
          result := result || ' ' || coalesce(item->>'background', '');
          result := result || ' ' || coalesce(item->>'recommendation', '');
          -- Motions
          IF item->'motions' IS NOT NULL THEN
            FOR motion IN SELECT jsonb_array_elements(item->'motions')
            LOOP
              result := result || ' ' || coalesce(motion->>'text', '');
            END LOOP;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN trim(result);
END;
$$;


--
-- Name: get_current_person_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_person_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN nullif(current_setting('app.person_id', true), '')::UUID;
END;
$$;


--
-- Name: FUNCTION get_current_person_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_person_id() IS 'Current person, from the app.person_id session setting.';


--
-- Name: get_current_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_role() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN nullif(current_setting('app.role', true), '');
END;
$$;


--
-- Name: FUNCTION get_current_role(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_role() IS 'App role (admin/staff/board_member/sys_admin) from the app.role session setting. No longer consulted by any RLS policy — authorization moved to TypeScript (Task D1); retained because has_permission/has_board_permission still build on it.';


--
-- Name: get_current_town_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_town_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN nullif(current_setting('app.town_id', true), '')::UUID;
END;
$$;


--
-- Name: FUNCTION get_current_town_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_town_id() IS 'Current tenant, from the app.town_id session setting the API sets with SET LOCAL inside each request transaction. NULL when unset, which makes every tenancy policy fail closed.';


--
-- Name: get_current_user_account_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_user_account_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN nullif(current_setting('app.user_account_id', true), '')::UUID;
END;
$$;


--
-- Name: FUNCTION get_current_user_account_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_user_account_id() IS 'Current user_account, from the app.user_account_id session setting.';


--
-- Name: has_board_permission(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_board_permission(action_code text, target_board_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  user_perms JSONB;
  override_elem JSONB;
  board_override JSONB;
  v_role TEXT;
BEGIN
  v_role := get_current_role();

  -- Admin always has all permissions
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- sys_admin has no meeting management permissions
  IF v_role = 'sys_admin' THEN
    RETURN false;
  END IF;

  -- Look up the user's full permissions JSONB
  SELECT permissions INTO user_perms
  FROM user_account
  WHERE id = get_current_user_account_id();

  IF user_perms IS NULL THEN
    RETURN false;
  END IF;

  -- Check board-specific overrides first
  IF user_perms -> 'board_overrides' IS NOT NULL THEN
    FOR override_elem IN SELECT jsonb_array_elements(user_perms -> 'board_overrides')
    LOOP
      IF (override_elem ->> 'board_id')::UUID = target_board_id THEN
        board_override := override_elem -> 'permissions';
        IF board_override IS NOT NULL AND board_override ? action_code THEN
          RETURN COALESCE((board_override ->> action_code)::BOOLEAN, false);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Fall back to global permissions
  RETURN COALESCE((user_perms -> 'global' ->> action_code)::BOOLEAN, false);
END;
$$;


--
-- Name: FUNCTION has_board_permission(action_code text, target_board_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_board_permission(action_code text, target_board_id uuid) IS 'Check if the current user has a specific permission for a specific board. Checks board_overrides first, then falls back to global permissions. Admin always returns true.';


--
-- Name: has_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_permission(action_code text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  user_permissions JSONB;
  v_role TEXT;
BEGIN
  v_role := get_current_role();

  -- Admin always has all permissions
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- sys_admin has no meeting management permissions
  IF v_role = 'sys_admin' THEN
    RETURN false;
  END IF;

  -- Look up the user's global permissions
  SELECT permissions -> 'global' INTO user_permissions
  FROM user_account
  WHERE id = get_current_user_account_id();

  IF user_permissions IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE((user_permissions ->> action_code)::BOOLEAN, false);
END;
$$;


--
-- Name: FUNCTION has_permission(action_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_permission(action_code text) IS 'Check if the current user has a specific global permission by action code (A1, M3, R1, etc.). Admin always returns true.';


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN get_current_role() = 'admin';
END;
$$;


--
-- Name: FUNCTION is_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_admin() IS 'True if the authenticated user has the admin role.';


--
-- Name: minutes_document_search_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.minutes_document_search_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(extract_minutes_text(NEW.content_json), ''));
  RETURN NEW;
END;
$$;


--
-- Name: portal_search(uuid, text, text, uuid, date, date, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_search(p_town_id uuid, p_query text, p_type text DEFAULT 'all'::text, p_board_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(result_type text, meeting_id uuid, meeting_date date, board_name text, title text, snippet text, rank real, total_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tsq tsquery := plainto_tsquery('english', p_query);
BEGIN
  RETURN QUERY
  WITH results AS (
    -- Minutes results
    SELECT
      'minutes'::TEXT AS result_type,
      md.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      m.title,
      ts_headline('english', extract_minutes_text(md.content_json), tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(md.search_vector, tsq) AS rank
    FROM minutes_document md
    JOIN meeting m ON md.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE md.town_id = p_town_id
      AND md.status = 'published'
      AND md.search_vector @@ tsq
      AND (p_type = 'all' OR p_type = 'minutes')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)

    UNION ALL

    -- Agenda results
    SELECT
      'agenda'::TEXT AS result_type,
      ai.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      ai.title,
      ts_headline('english',
        coalesce(ai.title, '') || ' ' || coalesce(ai.background, '') || ' ' || coalesce(ai.description, ''),
        tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(ai.search_vector, tsq) AS rank
    FROM agenda_item ai
    JOIN meeting m ON ai.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE ai.town_id = p_town_id
      AND m.agenda_status = 'published'
      AND ai.search_vector @@ tsq
      AND ai.parent_item_id IS NOT NULL  -- Only search actual items, not section headers
      AND (p_type = 'all' OR p_type = 'agenda')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)
  )
  SELECT
    r.result_type,
    r.meeting_id,
    r.meeting_date,
    r.board_name,
    r.title,
    r.snippet,
    r.rank,
    count(*) OVER () AS total_count
  FROM results r
  ORDER BY r.rank DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agenda_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    town_id uuid NOT NULL,
    section_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    description text,
    presenter text,
    estimated_duration integer,
    parent_item_id uuid,
    status public.agenda_item_status DEFAULT 'pending'::public.agenda_item_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_resource text,
    background text,
    recommendation text,
    suggested_motion text,
    operator_notes text,
    source_minutes_document_id uuid,
    search_vector tsvector
);


--
-- Name: TABLE agenda_item; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agenda_item IS 'Individual item on a meeting agenda. Supports nested sub-items via parent_item_id.';


--
-- Name: COLUMN agenda_item.section_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.section_type IS 'Agenda section type: ceremonial, procedural, minutes_approval, financial, public_input, report, action, discussion, public_hearing, executive_session, other.';


--
-- Name: COLUMN agenda_item.estimated_duration; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.estimated_duration IS 'Estimated duration in minutes.';


--
-- Name: COLUMN agenda_item.parent_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.parent_item_id IS 'Self-referencing FK for sub-items (e.g., sub-items under New Business).';


--
-- Name: COLUMN agenda_item.staff_resource; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.staff_resource IS 'Staff resource for this item (Item Commentary).';


--
-- Name: COLUMN agenda_item.background; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.background IS 'Background context for this item (Item Commentary).';


--
-- Name: COLUMN agenda_item.recommendation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.recommendation IS 'Staff recommendation for this item (Item Commentary).';


--
-- Name: COLUMN agenda_item.suggested_motion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.suggested_motion IS 'Pre-drafted motion text (Item Commentary). Supports ___ and [TBD] placeholders.';


--
-- Name: COLUMN agenda_item.source_minutes_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_item.source_minutes_document_id IS 'FK linking a minutes-approval agenda item to the minutes document being approved.';


--
-- Name: agenda_item_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_item_transition (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    agenda_item_id uuid NOT NULL,
    town_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: TABLE agenda_item_transition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agenda_item_transition IS 'Tracks time spent on each agenda item during live meetings.';


--
-- Name: agenda_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid,
    town_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agenda_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agenda_template IS 'Reusable agenda structure templates. Board-specific or town-wide (board_id = null).';


--
-- Name: COLUMN agenda_template.is_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_template.is_default IS 'If true, this template is auto-applied when creating a new meeting for this board.';


--
-- Name: COLUMN agenda_template.sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agenda_template.sections IS 'JSON array of section definitions: [{ section_type, title, sort_order, default_items: [...] }]';


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid NOT NULL,
    user_account_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_log IS 'Immutable audit trail. Tracks who did what and when. Required for multi-admin accountability.';


--
-- Name: COLUMN audit_log.user_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_log.user_account_id IS 'The user who performed the action. SET NULL on delete to preserve audit trail.';


--
-- Name: COLUMN audit_log.action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_log.action IS 'Action performed: create, update, delete, archive, publish, approve, login, permission_change, etc.';


--
-- Name: COLUMN audit_log.entity_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_log.entity_type IS 'Type of entity acted upon: meeting, agenda_item, minutes_document, user_account, etc.';


--
-- Name: COLUMN audit_log.entity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_log.entity_id IS 'Primary key of the affected entity.';


--
-- Name: COLUMN audit_log.details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_log.details IS 'Additional context: old/new values, IP address, reason for action.';


--
-- Name: board; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid NOT NULL,
    name text NOT NULL,
    board_type public.board_type DEFAULT 'other'::public.board_type NOT NULL,
    member_count integer,
    election_method text,
    officer_election_method text,
    district_based boolean DEFAULT false NOT NULL,
    staggered_terms boolean DEFAULT false NOT NULL,
    is_governing_board boolean DEFAULT false NOT NULL,
    meeting_formality_override public.meeting_formality,
    minutes_style_override public.minutes_style,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    seat_titles jsonb DEFAULT '[]'::jsonb,
    elected_or_appointed text DEFAULT 'elected'::text,
    quorum_type text DEFAULT 'majority'::text,
    quorum_value integer,
    motion_display_format text DEFAULT 'formal'::text,
    certification_format text DEFAULT 'prepared_by'::text NOT NULL,
    member_reference_style text DEFAULT 'title_and_last_name'::text NOT NULL,
    notice_template_blocks jsonb,
    minutes_consent_agenda boolean DEFAULT false NOT NULL,
    minutes_requires_second boolean DEFAULT true NOT NULL,
    r4_board_member_default boolean DEFAULT true NOT NULL,
    audio_retention_policy_override text,
    auto_publish_on_approval_override boolean,
    CONSTRAINT board_audio_retention_policy_override_check CHECK ((audio_retention_policy_override = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text])))
);


--
-- Name: TABLE board; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.board IS 'A municipal board, committee, or commission within a town.';


--
-- Name: COLUMN board.election_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.election_method IS 'How members are elected: at_large, role_titled.';


--
-- Name: COLUMN board.officer_election_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.officer_election_method IS 'How officers are selected: vote_of_board, highest_vote_getter, appointed_by_authority, rotation.';


--
-- Name: COLUMN board.is_governing_board; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.is_governing_board IS 'True for Select Board / City Council — the primary governing body.';


--
-- Name: COLUMN board.meeting_formality_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.meeting_formality_override IS 'Overrides town.meeting_formality for this board. Null = use town default.';


--
-- Name: COLUMN board.minutes_style_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.minutes_style_override IS 'Overrides town.minutes_style for this board. Null = use town default.';


--
-- Name: COLUMN board.seat_titles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.seat_titles IS 'Ordered list of seat titles for role_titled election method. JSON array of strings.';


--
-- Name: COLUMN board.elected_or_appointed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.elected_or_appointed IS 'Whether board members are elected or appointed: elected, appointed.';


--
-- Name: COLUMN board.quorum_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.quorum_type IS 'How quorum is calculated: majority, two_thirds, fixed_number.';


--
-- Name: COLUMN board.quorum_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.quorum_value IS 'Fixed quorum number (used when quorum_type = fixed_number).';


--
-- Name: COLUMN board.motion_display_format; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.motion_display_format IS 'How motions are displayed: formal, informal.';


--
-- Name: COLUMN board.minutes_consent_agenda; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.minutes_consent_agenda IS 'Allow approval of minutes by consent agenda (no separate motion)';


--
-- Name: COLUMN board.minutes_requires_second; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.minutes_requires_second IS 'Whether motion to approve minutes requires a second';


--
-- Name: COLUMN board.r4_board_member_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.r4_board_member_default IS 'Default R4 permission: can board members view draft minutes before approval';


--
-- Name: COLUMN board.audio_retention_policy_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.audio_retention_policy_override IS 'Board override for audio retention; null = inherit town default';


--
-- Name: COLUMN board.auto_publish_on_approval_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board.auto_publish_on_approval_override IS 'Board override for auto-publish; null = inherit town default';


--
-- Name: board_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    board_id uuid NOT NULL,
    town_id uuid NOT NULL,
    seat_title text,
    term_start date NOT NULL,
    term_end date,
    status public.board_member_status DEFAULT 'active'::public.board_member_status NOT NULL,
    is_default_rec_sec boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE board_member; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.board_member IS 'Links a PERSON to a BOARD with term dates. A person can serve on multiple boards simultaneously.';


--
-- Name: COLUMN board_member.seat_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_member.seat_title IS 'Position on the board: Chair, Vice Chair, Member, Secretary, etc.';


--
-- Name: COLUMN board_member.term_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_member.term_end IS 'Null for indefinite appointments. Set when term expires or member resigns.';


--
-- Name: COLUMN board_member.is_default_rec_sec; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_member.is_default_rec_sec IS 'If true, this member is the default recording secretary for this board.';


--
-- Name: executive_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.executive_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    agenda_item_id uuid,
    town_id uuid NOT NULL,
    statutory_basis text NOT NULL,
    entered_at timestamp with time zone,
    exited_at timestamp with time zone,
    entry_motion_id uuid,
    post_session_action_motion_ids jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exhibit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exhibit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agenda_item_id uuid NOT NULL,
    town_id uuid NOT NULL,
    title text NOT NULL,
    file_storage_path text NOT NULL,
    file_type text NOT NULL,
    file_size bigint,
    exhibit_type text,
    uploaded_by uuid,
    visibility public.exhibit_visibility DEFAULT 'public'::public.exhibit_visibility NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    file_name text
);


--
-- Name: TABLE exhibit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.exhibit IS 'File attachments for agenda items — maps, plans, letters, reports, staff memos.';


--
-- Name: COLUMN exhibit.file_storage_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exhibit.file_storage_path IS 'Path in Supabase Storage.';


--
-- Name: COLUMN exhibit.file_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exhibit.file_type IS 'MIME type of the file (application/pdf, image/jpeg, etc.).';


--
-- Name: COLUMN exhibit.exhibit_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exhibit.exhibit_type IS 'Descriptive label: staff_report, plan, legal_notice, application, correspondence, supporting_document, other.';


--
-- Name: COLUMN exhibit.visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exhibit.visibility IS 'admin_only = admin/staff only; board_only = board members can see; public = visible on public portal.';


--
-- Name: COLUMN exhibit.file_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exhibit.file_name IS 'Original filename for display.';


--
-- Name: future_item_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.future_item_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    town_id uuid NOT NULL,
    source_meeting_id uuid,
    source_agenda_item_id uuid,
    title text NOT NULL,
    description text,
    source text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    dismissed_reason text,
    placed_agenda_item_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guest_speaker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_speaker (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    agenda_item_id uuid,
    town_id uuid NOT NULL,
    name text NOT NULL,
    address text,
    topic text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE guest_speaker; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_speaker IS 'Guest speakers for public comment sections. Not linked to PERSON records per advisory 1.2.';


--
-- Name: invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    user_account_id uuid,
    town_id uuid NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone,
    email text,
    role text,
    invited_by uuid,
    sent_at timestamp with time zone,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invitation_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: meeting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    town_id uuid NOT NULL,
    title text NOT NULL,
    scheduled_date date NOT NULL,
    scheduled_time time without time zone,
    location text,
    status public.meeting_status DEFAULT 'draft'::public.meeting_status NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    meeting_type text DEFAULT 'regular'::text NOT NULL,
    formality_override text,
    agenda_status text DEFAULT 'draft'::text NOT NULL,
    agenda_packet_url text,
    meeting_notice_url text,
    agenda_packet_generated_at timestamp with time zone,
    meeting_notice_generated_at timestamp with time zone,
    current_agenda_item_id uuid,
    presiding_officer_id uuid,
    recording_secretary_id uuid,
    adjournment jsonb,
    notice_generated_at timestamp with time zone,
    notice_pdf_storage_path text,
    notice_published_at timestamp with time zone
);


--
-- Name: TABLE meeting; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meeting IS 'A scheduled or completed meeting of a board.';


--
-- Name: COLUMN meeting.scheduled_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.scheduled_time IS 'Time of day for the meeting. Null for TBD meetings.';


--
-- Name: COLUMN meeting.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.status IS 'Lifecycle: draft → noticed → open → adjourned → minutes_draft → approved. Can also be cancelled.';


--
-- Name: COLUMN meeting.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.created_by IS 'The user_account that created this meeting (admin or staff with A1 permission).';


--
-- Name: COLUMN meeting.meeting_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.meeting_type IS 'Type: regular, special, public_hearing, emergency.';


--
-- Name: COLUMN meeting.formality_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.formality_override IS 'Per-meeting formality override. Null uses board/town default.';


--
-- Name: COLUMN meeting.agenda_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.agenda_status IS 'Agenda lifecycle: draft or published.';


--
-- Name: COLUMN meeting.agenda_packet_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.agenda_packet_url IS 'Supabase Storage URL of the last generated agenda packet PDF.';


--
-- Name: COLUMN meeting.meeting_notice_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.meeting_notice_url IS 'Supabase Storage URL of the last generated meeting notice PDF.';


--
-- Name: COLUMN meeting.agenda_packet_generated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.agenda_packet_generated_at IS 'Timestamp of the last agenda packet generation.';


--
-- Name: COLUMN meeting.meeting_notice_generated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting.meeting_notice_generated_at IS 'Timestamp of the last meeting notice generation.';


--
-- Name: meeting_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    town_id uuid NOT NULL,
    board_member_id uuid,
    person_id uuid NOT NULL,
    status public.attendance_status DEFAULT 'present'::public.attendance_status NOT NULL,
    is_recording_secretary boolean DEFAULT false NOT NULL,
    arrived_at timestamp with time zone,
    departed_at timestamp with time zone
);


--
-- Name: TABLE meeting_attendance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meeting_attendance IS 'Attendance record for a meeting. Tracks board members and any non-member attendees (staff acting as rec sec).';


--
-- Name: COLUMN meeting_attendance.board_member_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_attendance.board_member_id IS 'Null for non-board-member attendees (e.g., staff serving as recording secretary).';


--
-- Name: COLUMN meeting_attendance.is_recording_secretary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_attendance.is_recording_secretary IS 'True if this person is serving as recording secretary for this meeting. Can be admin, staff, or board member.';


--
-- Name: minutes_addendum; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minutes_addendum (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minutes_document_id uuid NOT NULL,
    town_id uuid NOT NULL,
    adopting_meeting_id uuid NOT NULL,
    adopting_motion_id uuid,
    content_json jsonb NOT NULL,
    html_rendered text,
    description text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: TABLE minutes_addendum; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.minutes_addendum IS 'Post-adoption amendments to approved minutes (Advisory 3.5 §4.2)';


--
-- Name: minutes_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minutes_document (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    town_id uuid NOT NULL,
    status public.minutes_document_status DEFAULT 'draft'::public.minutes_document_status NOT NULL,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    html_rendered text,
    pdf_storage_path text,
    generated_by public.minutes_generated_by DEFAULT 'manual'::public.minutes_generated_by NOT NULL,
    approved_at timestamp with time zone,
    approved_by_motion_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    board_id uuid,
    minutes_style text DEFAULT 'summary'::text NOT NULL,
    submitted_for_review_at timestamp with time zone,
    published_at timestamp with time zone,
    created_by uuid,
    original_content_json jsonb,
    amendments_history jsonb DEFAULT '[]'::jsonb,
    approved_as_amended boolean DEFAULT false NOT NULL,
    search_vector tsvector
);


--
-- Name: TABLE minutes_document; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.minutes_document IS 'The minutes for a meeting. One per meeting. JSON is the canonical source; HTML and PDF are rendered outputs.';


--
-- Name: COLUMN minutes_document.content_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.content_json IS 'Structured JSON representation of the complete minutes. Source of truth for rendering.';


--
-- Name: COLUMN minutes_document.html_rendered; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.html_rendered IS 'Pre-rendered HTML for the public portal. Regenerated when content_json changes.';


--
-- Name: COLUMN minutes_document.pdf_storage_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.pdf_storage_path IS 'Path in Supabase Storage to the generated PDF.';


--
-- Name: COLUMN minutes_document.approved_by_motion_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.approved_by_motion_id IS 'The motion by which the board voted to approve these minutes.';


--
-- Name: COLUMN minutes_document.original_content_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.original_content_json IS 'Snapshot of content_json at generation time. Used for tracked changes diff.';


--
-- Name: COLUMN minutes_document.amendments_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.amendments_history IS 'Array tracking each round of amendments: { round, returned_at, reason, returned_by, resubmitted_at }.';


--
-- Name: COLUMN minutes_document.approved_as_amended; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_document.approved_as_amended IS 'True if the board approved the minutes "as amended."';


--
-- Name: minutes_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minutes_section (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minutes_document_id uuid NOT NULL,
    town_id uuid NOT NULL,
    section_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    title text,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_agenda_item_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE minutes_section; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.minutes_section IS 'A section within a minutes document, typically corresponding to an agenda item.';


--
-- Name: COLUMN minutes_section.section_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_section.section_type IS 'Section type: header, attendance, agenda_item, motion, public_comment, executive_session, adjournment, other.';


--
-- Name: COLUMN minutes_section.content_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_section.content_json IS 'Structured JSON content for this section: discussion summary, motions, votes, speakers, etc.';


--
-- Name: COLUMN minutes_section.source_agenda_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.minutes_section.source_agenda_item_id IS 'Links this minutes section back to the agenda item it documents.';


--
-- Name: motion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.motion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agenda_item_id uuid NOT NULL,
    meeting_id uuid NOT NULL,
    town_id uuid NOT NULL,
    motion_text text NOT NULL,
    motion_type public.motion_type DEFAULT 'main'::public.motion_type NOT NULL,
    moved_by uuid,
    seconded_by uuid,
    status public.motion_status DEFAULT 'pending'::public.motion_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_motion_id uuid,
    vote_summary jsonb
);


--
-- Name: TABLE motion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.motion IS 'A formal motion made during a meeting on an agenda item. Tracks who moved, seconded, and the outcome.';


--
-- Name: COLUMN motion.motion_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.motion.motion_type IS 'Roberts Rules motion classification: main, amendment, substitute, table, etc.';


--
-- Name: COLUMN motion.moved_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.motion.moved_by IS 'The board_member who made the motion.';


--
-- Name: COLUMN motion.seconded_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.motion.seconded_by IS 'The board_member who seconded. Null if no second required or not yet seconded.';


--
-- Name: COLUMN motion.parent_motion_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.motion.parent_motion_id IS 'References the parent motion when this is an amendment. NULL for top-level motions.';


--
-- Name: COLUMN motion.vote_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.motion.vote_summary IS 'Computed vote tally stored as JSONB after vote is recorded. Contains yeas, nays, abstentions, recusals, absent, and result.';


--
-- Name: notification_delivery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    town_id uuid NOT NULL,
    subscriber_id uuid NOT NULL,
    channel public.notification_channel NOT NULL,
    status public.notification_status DEFAULT 'pending'::public.notification_status NOT NULL,
    external_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    postmark_message_id text,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone
);


--
-- Name: TABLE notification_delivery; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_delivery IS 'Individual delivery record per subscriber per channel. Tracks Postmark/Twilio delivery status.';


--
-- Name: COLUMN notification_delivery.external_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_delivery.external_id IS 'Provider message ID (Postmark MessageID or Twilio MessageSid) for delivery tracking.';


--
-- Name: COLUMN notification_delivery.error_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_delivery.error_message IS 'Error details if delivery failed or bounced.';


--
-- Name: COLUMN notification_delivery.postmark_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_delivery.postmark_message_id IS 'MessageID returned by Postmark at send time. Distinct from external_id, which is set from provider webhooks generally (Postmark or, in Phase 2, Twilio) — kept separately rather than merged (see header).';


--
-- Name: COLUMN notification_delivery.retry_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_delivery.retry_count IS 'Number of delivery attempts made so far. Retry backoff schedule lives in notification-service.ts.';


--
-- Name: COLUMN notification_delivery.next_retry_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_delivery.next_retry_at IS 'When the retry processor should next attempt this delivery. Null when no retry is scheduled.';


--
-- Name: notification_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.notification_status DEFAULT 'pending'::public.notification_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: TABLE notification_event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_event IS 'Notification triggers. Each event may produce multiple deliveries across channels and subscribers.';


--
-- Name: COLUMN notification_event.event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_event.event_type IS 'Event type: meeting_scheduled, agenda_published, meeting_cancelled, minutes_approved, minutes_published, straw_poll_created, etc.';


--
-- Name: COLUMN notification_event.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_event.payload IS 'Event-specific data: { meeting_id, board_id, agenda_url, ... }';


--
-- Name: COLUMN notification_event.processed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_event.processed_at IS 'When the event was picked up for delivery processing.';


--
-- Name: permission_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid,
    name text NOT NULL,
    description text,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_system_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE permission_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission_template IS 'Reusable permission sets for quick staff account setup. System defaults are shared; town-specific templates override.';


--
-- Name: COLUMN permission_template.town_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_template.town_id IS 'Null for system-wide defaults. Set for town-customized templates.';


--
-- Name: COLUMN permission_template.permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_template.permissions IS 'JSONB matching the global permissions structure: { action_code: boolean, ... }';


--
-- Name: COLUMN permission_template.is_system_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_template.is_system_default IS 'True for the 5 built-in templates. System defaults cannot be deleted.';


--
-- Name: person; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: TABLE person; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.person IS 'Identity anchor — links user_account, board_members, and resident_account. Never deleted, only archived.';


--
-- Name: COLUMN person.archived_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.person.archived_at IS 'When set, login credentials are deleted but public record data (name, title, votes) is retained indefinitely.';


--
-- Name: push_subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscription (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_account_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriber_notification_preference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriber_notification_preference (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    town_id uuid NOT NULL,
    channel public.notification_channel NOT NULL,
    event_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    consent_timestamp timestamp with time zone,
    consent_method text,
    consent_record text
);


--
-- Name: TABLE subscriber_notification_preference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscriber_notification_preference IS 'Per-subscriber, per-channel, per-event-type notification preferences.';


--
-- Name: COLUMN subscriber_notification_preference.consent_timestamp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriber_notification_preference.consent_timestamp IS 'TCPA compliance: when the subscriber consented to SMS. Required for SMS channel.';


--
-- Name: COLUMN subscriber_notification_preference.consent_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriber_notification_preference.consent_method IS 'TCPA compliance: how consent was given (web_form, in_person, etc.).';


--
-- Name: COLUMN subscriber_notification_preference.consent_record; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriber_notification_preference.consent_record IS 'TCPA compliance: exact text/disclosure shown to the subscriber at time of consent.';


--
-- Name: town; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.town (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    state text DEFAULT 'ME'::text NOT NULL,
    municipality_type public.municipality_type DEFAULT 'town'::public.municipality_type NOT NULL,
    population_range text,
    contact_name text,
    contact_role text,
    meeting_formality public.meeting_formality DEFAULT 'semi_formal'::public.meeting_formality NOT NULL,
    minutes_style public.minutes_style DEFAULT 'action'::public.minutes_style NOT NULL,
    presiding_officer_default text,
    minutes_recorder_default text,
    subdomain text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_roles_present jsonb DEFAULT '[]'::jsonb,
    seal_url text,
    retention_policy_acknowledged_at timestamp with time zone,
    audio_retention_policy text DEFAULT 'retain_30_days'::text NOT NULL,
    auto_publish_on_approval boolean DEFAULT false NOT NULL,
    minutes_review_window_days integer DEFAULT 7 NOT NULL,
    minutes_workflow_configured_at timestamp with time zone,
    CONSTRAINT town_audio_retention_policy_check CHECK ((audio_retention_policy = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text])))
);


--
-- Name: TABLE town; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.town IS 'Municipal entity — each town using the platform has one record. Multi-tenant isolation anchor.';


--
-- Name: COLUMN town.population_range; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.population_range IS 'Population range category: under_1000, 1000_to_2500, 2500_to_5000, 5000_to_10000, over_10000';


--
-- Name: COLUMN town.meeting_formality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.meeting_formality IS 'Default formality level — can be overridden per board';


--
-- Name: COLUMN town.minutes_style; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.minutes_style IS 'Default minutes style — can be overridden per board';


--
-- Name: COLUMN town.subdomain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.subdomain IS 'Public portal URL: {subdomain}.townmeetingmanager.com';


--
-- Name: COLUMN town.staff_roles_present; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.staff_roles_present IS 'Staff roles present in the town (e.g. town_manager, town_clerk). JSON array.';


--
-- Name: COLUMN town.audio_retention_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.audio_retention_policy IS 'How long meeting audio recordings are retained after minutes approval';


--
-- Name: COLUMN town.auto_publish_on_approval; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.auto_publish_on_approval IS 'Automatically publish minutes to public portal when approval motion passes';


--
-- Name: COLUMN town.minutes_review_window_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.minutes_review_window_days IS 'Days before next meeting that draft minutes must be distributed to board members';


--
-- Name: COLUMN town.minutes_workflow_configured_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town.minutes_workflow_configured_at IS 'Set when admin first saves the minutes workflow settings; used for ProgressChecklist';


--
-- Name: town_notification_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.town_notification_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    town_id uuid NOT NULL,
    postmark_server_token_encrypted text,
    postmark_sender_email text,
    postmark_sender_name text,
    twilio_messaging_service_sid text,
    twilio_phone_number text,
    sms_quiet_hours_start time without time zone DEFAULT '21:00:00'::time without time zone,
    sms_quiet_hours_end time without time zone DEFAULT '08:00:00'::time without time zone,
    sms_opt_in_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE town_notification_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.town_notification_config IS 'Per-town notification provider configuration. Stores encrypted API tokens.';


--
-- Name: COLUMN town_notification_config.postmark_server_token_encrypted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town_notification_config.postmark_server_token_encrypted IS 'Encrypted Postmark server API token. Decrypted only at send time.';


--
-- Name: COLUMN town_notification_config.sms_quiet_hours_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town_notification_config.sms_quiet_hours_start IS 'No SMS sent after this time (TCPA compliance). Default 9 PM.';


--
-- Name: COLUMN town_notification_config.sms_quiet_hours_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town_notification_config.sms_quiet_hours_end IS 'No SMS sent before this time (TCPA compliance). Default 8 AM.';


--
-- Name: COLUMN town_notification_config.sms_opt_in_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.town_notification_config.sms_opt_in_message IS 'Customizable consent disclosure text shown to subscribers when opting in to SMS.';


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    town_id uuid NOT NULL,
    role public.user_role NOT NULL,
    gov_title text,
    permissions jsonb DEFAULT '{"global": {}, "board_overrides": []}'::jsonb NOT NULL,
    auth_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    notification_preferences jsonb DEFAULT '{}'::jsonb,
    email text,
    display_name text,
    email_bounced boolean DEFAULT false NOT NULL,
    email_bounced_at timestamp with time zone,
    email_complained boolean DEFAULT false NOT NULL,
    email_complained_at timestamp with time zone
);


--
-- Name: TABLE user_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_account IS 'Application login account linked to a PERSON. One person has at most one user_account.';


--
-- Name: COLUMN user_account.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.role IS 'App role: sys_admin, admin, staff, board_member. Staff and board_member are mutually exclusive on the same PERSON.';


--
-- Name: COLUMN user_account.gov_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.gov_title IS 'Display label only (Town Clerk, Treasurer, etc.) — has no effect on permissions.';


--
-- Name: COLUMN user_account.permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.permissions IS 'JSONB permissions matrix: { global: { action: bool }, board_overrides: [{ board_id, permissions: { action: bool } }] }';


--
-- Name: COLUMN user_account.auth_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.auth_user_id IS 'External identity-provider subject id. Unconstrained: the FK to Supabase GoTrue''s auth.users was dropped when GoTrue was removed (Stage 1 Task B2). Better Auth (Task C1) owns identity now and decides this column''s final fate — retype to match Better Auth''s user id, re-point as a real FK, or drop in favour of a new column. Until C1 lands, nothing writes it and nothing enforces it.';


--
-- Name: COLUMN user_account.email_bounced; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.email_bounced IS 'Set true on a hard Postmark bounce — skip future sends to this account. Deliberately still account-scoped, not person-scoped: an account-less person has nothing that can bounce yet (see header).';


--
-- Name: COLUMN user_account.email_complained; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_account.email_complained IS 'Set true on a Postmark spam complaint — skip future sends to this account.';


--
-- Name: vote_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    motion_id uuid NOT NULL,
    meeting_id uuid NOT NULL,
    town_id uuid NOT NULL,
    board_member_id uuid NOT NULL,
    vote public.vote_type NOT NULL,
    recusal_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE vote_record; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vote_record IS 'Individual vote cast by a board member on a motion. Required by Maine law to be recorded.';


--
-- Name: COLUMN vote_record.recusal_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vote_record.recusal_reason IS 'Required when vote = recusal. Recorded per 30-A M.R.S.A. §2605(4) disclosure requirement.';


--
-- Name: agenda_item agenda_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item
    ADD CONSTRAINT agenda_item_pkey PRIMARY KEY (id);


--
-- Name: agenda_item_transition agenda_item_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item_transition
    ADD CONSTRAINT agenda_item_transition_pkey PRIMARY KEY (id);


--
-- Name: agenda_template agenda_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_template
    ADD CONSTRAINT agenda_template_pkey PRIMARY KEY (id);


--
-- Name: meeting_attendance attendance_unique_per_meeting; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT attendance_unique_per_meeting UNIQUE (meeting_id, person_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: board_member board_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_member
    ADD CONSTRAINT board_member_pkey PRIMARY KEY (id);


--
-- Name: board_member board_member_unique_active; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_member
    ADD CONSTRAINT board_member_unique_active UNIQUE (person_id, board_id, status);


--
-- Name: board board_name_unique_per_town; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board
    ADD CONSTRAINT board_name_unique_per_town UNIQUE (town_id, name);


--
-- Name: board board_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board
    ADD CONSTRAINT board_pkey PRIMARY KEY (id);


--
-- Name: executive_session executive_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_session
    ADD CONSTRAINT executive_session_pkey PRIMARY KEY (id);


--
-- Name: exhibit exhibit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit
    ADD CONSTRAINT exhibit_pkey PRIMARY KEY (id);


--
-- Name: future_item_queue future_item_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_pkey PRIMARY KEY (id);


--
-- Name: guest_speaker guest_speaker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_speaker
    ADD CONSTRAINT guest_speaker_pkey PRIMARY KEY (id);


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);


--
-- Name: invitation invitation_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_token_key UNIQUE (token);


--
-- Name: meeting_attendance meeting_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT meeting_attendance_pkey PRIMARY KEY (id);


--
-- Name: meeting meeting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_pkey PRIMARY KEY (id);


--
-- Name: minutes_addendum minutes_addendum_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_pkey PRIMARY KEY (id);


--
-- Name: minutes_document minutes_document_meeting_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_meeting_id_key UNIQUE (meeting_id);


--
-- Name: minutes_document minutes_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_pkey PRIMARY KEY (id);


--
-- Name: minutes_section minutes_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_section
    ADD CONSTRAINT minutes_section_pkey PRIMARY KEY (id);


--
-- Name: motion motion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery notification_delivery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_pkey PRIMARY KEY (id);


--
-- Name: notification_event notification_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_event
    ADD CONSTRAINT notification_event_pkey PRIMARY KEY (id);


--
-- Name: permission_template permission_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_template
    ADD CONSTRAINT permission_template_pkey PRIMARY KEY (id);


--
-- Name: person person_email_unique_per_town; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT person_email_unique_per_town UNIQUE (town_id, email);


--
-- Name: person person_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT person_pkey PRIMARY KEY (id);


--
-- Name: push_subscription push_subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_pkey PRIMARY KEY (id);


--
-- Name: push_subscription push_subscription_user_account_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_user_account_id_endpoint_key UNIQUE (user_account_id, endpoint);


--
-- Name: subscriber_notification_preference subscriber_notification_preference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriber_notification_preference
    ADD CONSTRAINT subscriber_notification_preference_pkey PRIMARY KEY (id);


--
-- Name: subscriber_notification_preference subscriber_pref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriber_notification_preference
    ADD CONSTRAINT subscriber_pref_unique UNIQUE (person_id, channel, event_type);


--
-- Name: permission_template template_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_template
    ADD CONSTRAINT template_name_unique UNIQUE (town_id, name);


--
-- Name: agenda_template template_name_unique_per_board; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_template
    ADD CONSTRAINT template_name_unique_per_board UNIQUE (board_id, name);


--
-- Name: town_notification_config town_notification_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.town_notification_config
    ADD CONSTRAINT town_notification_config_pkey PRIMARY KEY (id);


--
-- Name: town_notification_config town_notification_config_town_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.town_notification_config
    ADD CONSTRAINT town_notification_config_town_id_key UNIQUE (town_id);


--
-- Name: town town_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.town
    ADD CONSTRAINT town_pkey PRIMARY KEY (id);


--
-- Name: town town_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.town
    ADD CONSTRAINT town_subdomain_key UNIQUE (subdomain);


--
-- Name: user_account user_account_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: user_account user_account_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_person_id_key UNIQUE (person_id);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (id);


--
-- Name: vote_record vote_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_pkey PRIMARY KEY (id);


--
-- Name: vote_record vote_record_unique_per_motion; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_unique_per_motion UNIQUE (motion_id, board_member_id);


--
-- Name: idx_agenda_item_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_meeting_id ON public.agenda_item USING btree (meeting_id);


--
-- Name: idx_agenda_item_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_parent ON public.agenda_item USING btree (parent_item_id);


--
-- Name: idx_agenda_item_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_search ON public.agenda_item USING gin (search_vector);


--
-- Name: idx_agenda_item_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_sort ON public.agenda_item USING btree (meeting_id, sort_order);


--
-- Name: idx_agenda_item_source_minutes_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_source_minutes_doc ON public.agenda_item USING btree (source_minutes_document_id) WHERE (source_minutes_document_id IS NOT NULL);


--
-- Name: idx_agenda_item_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_town_id ON public.agenda_item USING btree (town_id);


--
-- Name: idx_agenda_item_transition_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_transition_item ON public.agenda_item_transition USING btree (agenda_item_id);


--
-- Name: idx_agenda_item_transition_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_transition_meeting ON public.agenda_item_transition USING btree (meeting_id);


--
-- Name: idx_agenda_item_transition_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_item_transition_town ON public.agenda_item_transition USING btree (town_id);


--
-- Name: idx_agenda_template_board_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_template_board_id ON public.agenda_template USING btree (board_id);


--
-- Name: idx_agenda_template_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_template_town_id ON public.agenda_template USING btree (town_id);


--
-- Name: idx_attendance_board_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_board_member_id ON public.meeting_attendance USING btree (board_member_id);


--
-- Name: idx_attendance_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_meeting_id ON public.meeting_attendance USING btree (meeting_id);


--
-- Name: idx_attendance_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_person_id ON public.meeting_attendance USING btree (person_id);


--
-- Name: idx_attendance_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_town_id ON public.meeting_attendance USING btree (town_id);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (town_id, created_at);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_log_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_town_id ON public.audit_log USING btree (town_id);


--
-- Name: idx_audit_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_account_id);


--
-- Name: idx_board_member_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_member_active ON public.board_member USING btree (board_id, status) WHERE (status = 'active'::public.board_member_status);


--
-- Name: idx_board_member_board_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_member_board_id ON public.board_member USING btree (board_id);


--
-- Name: idx_board_member_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_member_person_id ON public.board_member USING btree (person_id);


--
-- Name: idx_board_member_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_member_town_id ON public.board_member USING btree (town_id);


--
-- Name: idx_board_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_town_id ON public.board USING btree (town_id);


--
-- Name: idx_board_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_type ON public.board USING btree (town_id, board_type);


--
-- Name: idx_executive_session_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_executive_session_meeting ON public.executive_session USING btree (meeting_id);


--
-- Name: idx_executive_session_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_executive_session_town ON public.executive_session USING btree (town_id);


--
-- Name: idx_exhibit_agenda_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibit_agenda_item_id ON public.exhibit USING btree (agenda_item_id);


--
-- Name: idx_exhibit_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibit_town_id ON public.exhibit USING btree (town_id);


--
-- Name: idx_exhibit_uploaded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibit_uploaded_by ON public.exhibit USING btree (uploaded_by);


--
-- Name: idx_future_item_queue_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_future_item_queue_board ON public.future_item_queue USING btree (board_id);


--
-- Name: idx_future_item_queue_source_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_future_item_queue_source_meeting ON public.future_item_queue USING btree (source_meeting_id);


--
-- Name: idx_future_item_queue_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_future_item_queue_town ON public.future_item_queue USING btree (town_id);


--
-- Name: idx_guest_speaker_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_speaker_meeting ON public.guest_speaker USING btree (meeting_id);


--
-- Name: idx_guest_speaker_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_speaker_town ON public.guest_speaker USING btree (town_id);


--
-- Name: idx_invitation_person_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitation_person_status ON public.invitation USING btree (person_id, status);


--
-- Name: idx_invitation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitation_token ON public.invitation USING btree (token) WHERE (status = 'pending'::text);


--
-- Name: idx_meeting_board_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_board_id ON public.meeting USING btree (board_id);


--
-- Name: idx_meeting_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_created_by ON public.meeting USING btree (created_by);


--
-- Name: idx_meeting_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_date ON public.meeting USING btree (town_id, scheduled_date);


--
-- Name: idx_meeting_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_status ON public.meeting USING btree (town_id, status);


--
-- Name: idx_meeting_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_town_id ON public.meeting USING btree (town_id);


--
-- Name: idx_minutes_addendum_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_addendum_document ON public.minutes_addendum USING btree (minutes_document_id);


--
-- Name: idx_minutes_addendum_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_addendum_town ON public.minutes_addendum USING btree (town_id);


--
-- Name: idx_minutes_doc_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_doc_meeting_id ON public.minutes_document USING btree (meeting_id);


--
-- Name: idx_minutes_doc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_doc_status ON public.minutes_document USING btree (town_id, status);


--
-- Name: idx_minutes_doc_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_doc_town_id ON public.minutes_document USING btree (town_id);


--
-- Name: idx_minutes_document_board_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_document_board_id ON public.minutes_document USING btree (board_id);


--
-- Name: idx_minutes_document_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_document_search ON public.minutes_document USING gin (search_vector);


--
-- Name: idx_minutes_section_doc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_section_doc_id ON public.minutes_section USING btree (minutes_document_id);


--
-- Name: idx_minutes_section_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_section_sort ON public.minutes_section USING btree (minutes_document_id, sort_order);


--
-- Name: idx_minutes_section_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minutes_section_town_id ON public.minutes_section USING btree (town_id);


--
-- Name: idx_motion_agenda_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_agenda_item_id ON public.motion USING btree (agenda_item_id);


--
-- Name: idx_motion_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_meeting_id ON public.motion USING btree (meeting_id);


--
-- Name: idx_motion_moved_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_moved_by ON public.motion USING btree (moved_by);


--
-- Name: idx_motion_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_parent ON public.motion USING btree (parent_motion_id) WHERE (parent_motion_id IS NOT NULL);


--
-- Name: idx_motion_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_status ON public.motion USING btree (meeting_id, status);


--
-- Name: idx_motion_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_motion_town_id ON public.motion USING btree (town_id);


--
-- Name: idx_notification_delivery_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_event_id ON public.notification_delivery USING btree (event_id);


--
-- Name: idx_notification_delivery_postmark; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_postmark ON public.notification_delivery USING btree (postmark_message_id) WHERE (postmark_message_id IS NOT NULL);


--
-- Name: idx_notification_delivery_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_retry ON public.notification_delivery USING btree (next_retry_at) WHERE ((status = ANY (ARRAY['sent'::public.notification_status, 'failed'::public.notification_status])) AND (retry_count < 3) AND (next_retry_at IS NOT NULL));


--
-- Name: idx_notification_delivery_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_status ON public.notification_delivery USING btree (status) WHERE (status = ANY (ARRAY['pending'::public.notification_status, 'processing'::public.notification_status]));


--
-- Name: idx_notification_delivery_subscriber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_subscriber ON public.notification_delivery USING btree (subscriber_id);


--
-- Name: idx_notification_delivery_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_town_id ON public.notification_delivery USING btree (town_id);


--
-- Name: idx_notification_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_event_status ON public.notification_event USING btree (status) WHERE (status = ANY (ARRAY['pending'::public.notification_status, 'processing'::public.notification_status]));


--
-- Name: idx_notification_event_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_event_town_id ON public.notification_event USING btree (town_id);


--
-- Name: idx_notification_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_event_type ON public.notification_event USING btree (town_id, event_type);


--
-- Name: idx_permission_template_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_template_town ON public.permission_template USING btree (town_id);


--
-- Name: idx_person_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_archived ON public.person USING btree (town_id) WHERE (archived_at IS NULL);


--
-- Name: idx_person_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_email ON public.person USING btree (email);


--
-- Name: idx_person_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_town_id ON public.person USING btree (town_id);


--
-- Name: idx_push_subscription_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscription_user ON public.push_subscription USING btree (user_account_id);


--
-- Name: idx_subscriber_pref_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriber_pref_person ON public.subscriber_notification_preference USING btree (person_id);


--
-- Name: idx_subscriber_pref_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriber_pref_town ON public.subscriber_notification_preference USING btree (town_id);


--
-- Name: idx_user_account_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_auth_user_id ON public.user_account USING btree (auth_user_id);


--
-- Name: idx_user_account_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_person_id ON public.user_account USING btree (person_id);


--
-- Name: idx_user_account_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_role ON public.user_account USING btree (town_id, role);


--
-- Name: idx_user_account_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_town_id ON public.user_account USING btree (town_id);


--
-- Name: idx_vote_record_board_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_record_board_member_id ON public.vote_record USING btree (board_member_id);


--
-- Name: idx_vote_record_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_record_meeting_id ON public.vote_record USING btree (meeting_id);


--
-- Name: idx_vote_record_motion_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_record_motion_id ON public.vote_record USING btree (motion_id);


--
-- Name: idx_vote_record_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_record_town_id ON public.vote_record USING btree (town_id);


--
-- Name: agenda_item agenda_item_search_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agenda_item_search_trigger BEFORE INSERT OR UPDATE OF title, description, background, recommendation, suggested_motion ON public.agenda_item FOR EACH ROW EXECUTE FUNCTION public.agenda_item_search_update();


--
-- Name: minutes_document minutes_document_search_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER minutes_document_search_trigger BEFORE INSERT OR UPDATE OF content_json ON public.minutes_document FOR EACH ROW EXECUTE FUNCTION public.minutes_document_search_update();


--
-- Name: agenda_item update_agenda_item_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_agenda_item_updated_at BEFORE UPDATE ON public.agenda_item FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agenda_template update_agenda_template_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_agenda_template_updated_at BEFORE UPDATE ON public.agenda_template FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: meeting update_meeting_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_meeting_updated_at BEFORE UPDATE ON public.meeting FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: minutes_document update_minutes_document_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_minutes_document_updated_at BEFORE UPDATE ON public.minutes_document FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: minutes_section update_minutes_section_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_minutes_section_updated_at BEFORE UPDATE ON public.minutes_section FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: town_notification_config update_town_notification_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_town_notification_config_updated_at BEFORE UPDATE ON public.town_notification_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: town update_town_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_town_updated_at BEFORE UPDATE ON public.town FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agenda_item agenda_item_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item
    ADD CONSTRAINT agenda_item_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: agenda_item agenda_item_parent_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item
    ADD CONSTRAINT agenda_item_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES public.agenda_item(id) ON DELETE CASCADE;


--
-- Name: agenda_item agenda_item_source_minutes_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item
    ADD CONSTRAINT agenda_item_source_minutes_document_id_fkey FOREIGN KEY (source_minutes_document_id) REFERENCES public.minutes_document(id) ON DELETE SET NULL;


--
-- Name: agenda_item agenda_item_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item
    ADD CONSTRAINT agenda_item_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: agenda_item_transition agenda_item_transition_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item_transition
    ADD CONSTRAINT agenda_item_transition_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE CASCADE;


--
-- Name: agenda_item_transition agenda_item_transition_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item_transition
    ADD CONSTRAINT agenda_item_transition_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: agenda_item_transition agenda_item_transition_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_item_transition
    ADD CONSTRAINT agenda_item_transition_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: agenda_template agenda_template_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_template
    ADD CONSTRAINT agenda_template_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE CASCADE;


--
-- Name: agenda_template agenda_template_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_template
    ADD CONSTRAINT agenda_template_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_account_id_fkey FOREIGN KEY (user_account_id) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: board_member board_member_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_member
    ADD CONSTRAINT board_member_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE CASCADE;


--
-- Name: board_member board_member_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_member
    ADD CONSTRAINT board_member_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: board_member board_member_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_member
    ADD CONSTRAINT board_member_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: board board_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board
    ADD CONSTRAINT board_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: executive_session executive_session_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_session
    ADD CONSTRAINT executive_session_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE SET NULL;


--
-- Name: executive_session executive_session_entry_motion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_session
    ADD CONSTRAINT executive_session_entry_motion_id_fkey FOREIGN KEY (entry_motion_id) REFERENCES public.motion(id) ON DELETE SET NULL;


--
-- Name: executive_session executive_session_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_session
    ADD CONSTRAINT executive_session_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: executive_session executive_session_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executive_session
    ADD CONSTRAINT executive_session_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: exhibit exhibit_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit
    ADD CONSTRAINT exhibit_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE CASCADE;


--
-- Name: exhibit exhibit_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit
    ADD CONSTRAINT exhibit_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: exhibit exhibit_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit
    ADD CONSTRAINT exhibit_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.user_account(id);


--
-- Name: future_item_queue future_item_queue_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE CASCADE;


--
-- Name: future_item_queue future_item_queue_placed_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_placed_agenda_item_id_fkey FOREIGN KEY (placed_agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE SET NULL;


--
-- Name: future_item_queue future_item_queue_source_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_source_agenda_item_id_fkey FOREIGN KEY (source_agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE SET NULL;


--
-- Name: future_item_queue future_item_queue_source_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_source_meeting_id_fkey FOREIGN KEY (source_meeting_id) REFERENCES public.meeting(id) ON DELETE SET NULL;


--
-- Name: future_item_queue future_item_queue_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.future_item_queue
    ADD CONSTRAINT future_item_queue_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: guest_speaker guest_speaker_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_speaker
    ADD CONSTRAINT guest_speaker_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE SET NULL;


--
-- Name: guest_speaker guest_speaker_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_speaker
    ADD CONSTRAINT guest_speaker_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: guest_speaker guest_speaker_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_speaker
    ADD CONSTRAINT guest_speaker_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: invitation invitation_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation
    ADD CONSTRAINT invitation_user_account_id_fkey FOREIGN KEY (user_account_id) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: meeting_attendance meeting_attendance_board_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT meeting_attendance_board_member_id_fkey FOREIGN KEY (board_member_id) REFERENCES public.board_member(id) ON DELETE CASCADE;


--
-- Name: meeting_attendance meeting_attendance_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT meeting_attendance_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: meeting_attendance meeting_attendance_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT meeting_attendance_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: meeting_attendance meeting_attendance_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendance
    ADD CONSTRAINT meeting_attendance_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: meeting meeting_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE CASCADE;


--
-- Name: meeting meeting_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_account(id);


--
-- Name: meeting meeting_current_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_current_agenda_item_id_fkey FOREIGN KEY (current_agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE SET NULL;


--
-- Name: meeting meeting_presiding_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_presiding_officer_id_fkey FOREIGN KEY (presiding_officer_id) REFERENCES public.board_member(id) ON DELETE SET NULL;


--
-- Name: meeting meeting_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: minutes_addendum minutes_addendum_adopting_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_adopting_meeting_id_fkey FOREIGN KEY (adopting_meeting_id) REFERENCES public.meeting(id);


--
-- Name: minutes_addendum minutes_addendum_adopting_motion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_adopting_motion_id_fkey FOREIGN KEY (adopting_motion_id) REFERENCES public.motion(id);


--
-- Name: minutes_addendum minutes_addendum_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_account(id);


--
-- Name: minutes_addendum minutes_addendum_minutes_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_minutes_document_id_fkey FOREIGN KEY (minutes_document_id) REFERENCES public.minutes_document(id) ON DELETE CASCADE;


--
-- Name: minutes_addendum minutes_addendum_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_addendum
    ADD CONSTRAINT minutes_addendum_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id);


--
-- Name: minutes_document minutes_document_approved_by_motion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_approved_by_motion_id_fkey FOREIGN KEY (approved_by_motion_id) REFERENCES public.motion(id);


--
-- Name: minutes_document minutes_document_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board(id) ON DELETE CASCADE;


--
-- Name: minutes_document minutes_document_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_account(id) ON DELETE SET NULL;


--
-- Name: minutes_document minutes_document_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: minutes_document minutes_document_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_document
    ADD CONSTRAINT minutes_document_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: minutes_section minutes_section_minutes_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_section
    ADD CONSTRAINT minutes_section_minutes_document_id_fkey FOREIGN KEY (minutes_document_id) REFERENCES public.minutes_document(id) ON DELETE CASCADE;


--
-- Name: minutes_section minutes_section_source_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_section
    ADD CONSTRAINT minutes_section_source_agenda_item_id_fkey FOREIGN KEY (source_agenda_item_id) REFERENCES public.agenda_item(id);


--
-- Name: minutes_section minutes_section_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes_section
    ADD CONSTRAINT minutes_section_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: motion motion_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_agenda_item_id_fkey FOREIGN KEY (agenda_item_id) REFERENCES public.agenda_item(id) ON DELETE CASCADE;


--
-- Name: motion motion_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: motion motion_moved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_moved_by_fkey FOREIGN KEY (moved_by) REFERENCES public.board_member(id);


--
-- Name: motion motion_parent_motion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_parent_motion_id_fkey FOREIGN KEY (parent_motion_id) REFERENCES public.motion(id);


--
-- Name: motion motion_seconded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_seconded_by_fkey FOREIGN KEY (seconded_by) REFERENCES public.board_member(id);


--
-- Name: motion motion_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.motion
    ADD CONSTRAINT motion_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: notification_delivery notification_delivery_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.notification_event(id) ON DELETE CASCADE;


--
-- Name: notification_delivery notification_delivery_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: notification_delivery notification_delivery_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery
    ADD CONSTRAINT notification_delivery_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: notification_event notification_event_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_event
    ADD CONSTRAINT notification_event_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: permission_template permission_template_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_template
    ADD CONSTRAINT permission_template_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: person person_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT person_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: push_subscription push_subscription_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscription
    ADD CONSTRAINT push_subscription_user_account_id_fkey FOREIGN KEY (user_account_id) REFERENCES public.user_account(id) ON DELETE CASCADE;


--
-- Name: subscriber_notification_preference subscriber_notification_preference_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriber_notification_preference
    ADD CONSTRAINT subscriber_notification_preference_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: subscriber_notification_preference subscriber_notification_preference_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriber_notification_preference
    ADD CONSTRAINT subscriber_notification_preference_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: town_notification_config town_notification_config_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.town_notification_config
    ADD CONSTRAINT town_notification_config_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: user_account user_account_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE CASCADE;


--
-- Name: user_account user_account_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;


--
-- Name: vote_record vote_record_board_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_board_member_id_fkey FOREIGN KEY (board_member_id) REFERENCES public.board_member(id) ON DELETE CASCADE;


--
-- Name: vote_record vote_record_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meeting(id) ON DELETE CASCADE;


--
-- Name: vote_record vote_record_motion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_motion_id_fkey FOREIGN KEY (motion_id) REFERENCES public.motion(id) ON DELETE CASCADE;


--
-- Name: vote_record vote_record_town_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_record
    ADD CONSTRAINT vote_record_town_id_fkey FOREIGN KEY (town_id) REFERENCES public.town(id) ON DELETE CASCADE;

--
-- ============================================================================
-- SECTION 2 — DATA: system-default permission templates
-- ============================================================================
-- Five templates shared by every town (town_id IS NULL, is_system_default).
-- Verbatim from supabase/migrations/20260308000026_seed_permission_templates.sql.
--
-- Position matters: these are inserted BEFORE section 3 turns on FORCE ROW
-- LEVEL SECURITY. After that point even the table owner is bound by the
-- tenancy policy, and rows with town_id IS NULL satisfy no tenant's predicate,
-- so this insert would fail. Adding a policy that let anyone write
-- system-default rows would be the wrong fix.
-- ============================================================================

-- 5 system-default templates (town_id = NULL, is_system_default = true).
-- These serve as starting points when an admin creates a new
-- staff account. The admin picks a template, then adjusts
-- individual permissions as needed.
--
-- Permission codes from advisory 1.2:
--   A1-A7: Agenda & Meeting Prep
--   M1-M8: Live Meeting Operations
--   R1-R6: Minutes & Records
--   C1-C5: Civic Engagement
--   T1-T4: Town & System Management (admin-only, not in templates)
--   V1-V5: View & Download (always allowed, not in templates)
-- ============================================================

-- 1. Town Clerk — Full operational access across all boards.
--    Closest to admin without system governance (T1-T4).
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0001-0000-0000-0000-000000000000',
  NULL,
  'Town Clerk',
  'Full operational access across all boards. Closest to admin without system governance (T1-T4).',
  '{
    "A1": true, "A2": true, "A3": true, "A5": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "M6": true, "M7": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R5": true, "R6": true,
    "C1": true, "C2": true, "C3": true, "C4": true, "C5": true
  }',
  true
);

-- 2. Deputy Clerk — Minutes and records focused.
--    Can run meetings and take minutes but cannot publish or manage civic engagement.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0002-0000-0000-0000-000000000000',
  NULL,
  'Deputy Clerk',
  'Minutes and records focused. Can run meetings and take minutes but cannot publish or manage civic engagement.',
  '{
    "A2": true, "A3": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R6": true
  }',
  true
);

-- 3. Board-Specific Staff — Full access on designated boards only.
--    Same capabilities as Town Clerk but intended for board_overrides use
--    (e.g., Town Planner on Planning Board, CEO on Zoning Board).
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0003-0000-0000-0000-000000000000',
  NULL,
  'Board-Specific Staff',
  'Full operational access on designated boards only (e.g., Town Planner, CEO). Apply via board_overrides.',
  '{
    "A1": true, "A2": true, "A3": true, "A5": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "M6": true, "M7": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R5": true, "R6": true
  }',
  true
);

-- 4. General Staff — View-oriented.
--    Can upload documents and view records but cannot run meetings or manage agendas.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0004-0000-0000-0000-000000000000',
  NULL,
  'General Staff',
  'View-oriented. Can upload documents and view records but cannot run meetings or manage agendas.',
  '{
    "A3": true,
    "R4": true, "R6": true
  }',
  true
);

-- 5. Recording Secretary Only — Meeting recording and minutes.
--    For a dedicated recording secretary who only needs meeting
--    recording and minutes capabilities on designated boards.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0005-0000-0000-0000-000000000000',
  NULL,
  'Recording Secretary Only',
  'Meeting recording and minutes only. For dedicated recording secretaries on designated boards.',
  '{
    "M2": true, "M3": true, "M4": true, "M5": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R6": true
  }',
  true
);

--
-- ============================================================================
-- SECTION 3 — ROW LEVEL SECURITY
-- ============================================================================
-- Everything above this line is a faithful rendering of the schema the
-- historical corpus produces. Everything below is the security model, and it
-- is deliberately hand-written rather than dumped: it is the part a reviewer
-- has to read.
--
-- THE MODEL: RLS enforces TENANCY ONLY.
--
--   Every table gets exactly one FOR ALL policy whose USING and WITH CHECK are
--   the same tenancy predicate. That covers SELECT, INSERT, UPDATE and DELETE
--   with one statement, so there is no command a future reader has to notice
--   was left out. (The historical corpus had 79 per-command policies and no
--   DELETE policy on 22 of 26 tables — harmless while a service_role key
--   bypassed RLS, fatal once the application connects as tmm_app under FORCE.)
--
--   The 30-action permission matrix (A1-A7, M1-M8, R1-R6, C1-C5, T1-T4) does
--   NOT live here any more. Every action-code and role predicate that used to
--   sit inside these policies is itemised in
--   .superpowers/sdd/2026-08-26-stage-1-platform/task-5-report.md and is
--   reimplemented as a tested tRPC procedure guard in Task D1. Nothing was
--   dropped without being written down.
--
--   Why remove them rather than keep them as defence in depth: they were not
--   defence, they were noise that could not be told apart from tenancy. A
--   policy reading `town_id = get_current_town_id() AND has_permission('R4')`
--   denies every row when app.user_account_id is unset — which is exactly what
--   a *working* tenancy check also looks like from the outside. Task B3's gate
--   would have passed on tables where tenancy was broken, because the
--   permission half was failing closed for an unrelated reason. A gate that
--   can pass for the wrong reason is not a gate.
--
-- FAIL-CLOSED: get_current_town_id() returns NULL when app.town_id is unset,
-- and `town_id = NULL` is NULL, not true — so a connection that never
-- established a tenant sees nothing and writes nothing.
-- ============================================================================

--
-- ─── 3.1 Enable and FORCE row level security ────────────────────────────────
--
-- ENABLE alone is not enough. A table's OWNER bypasses its own policies
-- silently — no error, no warning, every row returned. Migrations run as
-- tmm_owner, which owns every table here, so without FORCE the entire model
-- below is decorative for exactly the role most likely to be misconfigured
-- into an application connection string. FORCE is what makes it real.
--
-- Note that FORCE binds the owner too, which is why the permission_template
-- system defaults are inserted in section 2 (above), before this point.

ALTER TABLE public.agenda_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_item_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exhibit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.future_item_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_speaker ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_addendum ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_section ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.town ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.town_notification_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_record ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agenda_item FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_item_transition FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.board FORCE ROW LEVEL SECURITY;
ALTER TABLE public.board_member FORCE ROW LEVEL SECURITY;
ALTER TABLE public.executive_session FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exhibit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.future_item_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guest_speaker FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invitation FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance FORCE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_addendum FORCE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_document FORCE ROW LEVEL SECURITY;
ALTER TABLE public.minutes_section FORCE ROW LEVEL SECURITY;
ALTER TABLE public.motion FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_event FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permission_template FORCE ROW LEVEL SECURITY;
ALTER TABLE public.person FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscription FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_notification_preference FORCE ROW LEVEL SECURITY;
ALTER TABLE public.town FORCE ROW LEVEL SECURITY;
ALTER TABLE public.town_notification_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_account FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vote_record FORCE ROW LEVEL SECURITY;

--
-- ─── 3.2 Tenancy policies ───────────────────────────────────────────────────
--
-- One per table, named <table>_tenant_isolation, so "every table has exactly
-- one policy and its predicate is that table's tenancy predicate" is a single
-- invariant a query can check. See
-- packages/api/src/db/__tests__/schema-invariants.test.ts, which asserts it.

CREATE POLICY agenda_item_tenant_isolation ON public.agenda_item
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY agenda_item_transition_tenant_isolation ON public.agenda_item_transition
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY agenda_template_tenant_isolation ON public.agenda_template
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY audit_log_tenant_isolation ON public.audit_log
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY board_tenant_isolation ON public.board
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY board_member_tenant_isolation ON public.board_member
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY executive_session_tenant_isolation ON public.executive_session
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY exhibit_tenant_isolation ON public.exhibit
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY future_item_queue_tenant_isolation ON public.future_item_queue
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY guest_speaker_tenant_isolation ON public.guest_speaker
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY invitation_tenant_isolation ON public.invitation
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY meeting_tenant_isolation ON public.meeting
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY meeting_attendance_tenant_isolation ON public.meeting_attendance
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY minutes_addendum_tenant_isolation ON public.minutes_addendum
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY minutes_document_tenant_isolation ON public.minutes_document
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY minutes_section_tenant_isolation ON public.minutes_section
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY motion_tenant_isolation ON public.motion
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY notification_delivery_tenant_isolation ON public.notification_delivery
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY notification_event_tenant_isolation ON public.notification_event
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY permission_template_tenant_isolation ON public.permission_template
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY person_tenant_isolation ON public.person
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

-- push_subscription is the one table with neither a town_id column nor any
-- claim to be tenant-free: it holds Web Push endpoints and keys, which are
-- per-person secrets. It had NO RLS at all in the corpus. It reaches a tenant
-- only through user_account, so the predicate goes through that FK. The
-- subquery is itself subject to user_account's own tenancy policy, which
-- narrows it identically — belt and braces, no recursion (user_account's
-- policy does not reference push_subscription).
CREATE POLICY push_subscription_tenant_isolation ON public.push_subscription
  FOR ALL
  USING (user_account_id IN (SELECT ua.id FROM user_account ua WHERE ua.town_id = get_current_town_id()))
  WITH CHECK (user_account_id IN (SELECT ua.id FROM user_account ua WHERE ua.town_id = get_current_town_id()));

CREATE POLICY subscriber_notification_preference_tenant_isolation ON public.subscriber_notification_preference
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

-- `town` IS the tenant, so its own id is the predicate. WITH CHECK on the
-- same expression means a row can only be created for the tenant the session
-- is already in: onboarding must generate the town id, set app.town_id to it,
-- and only then insert. That is deliberate — it keeps town creation possible
-- under FORCE RLS without opening an unconditional INSERT path.
CREATE POLICY town_tenant_isolation ON public.town
  FOR ALL
  USING (id = get_current_town_id())
  WITH CHECK (id = get_current_town_id());

CREATE POLICY town_notification_config_tenant_isolation ON public.town_notification_config
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY user_account_tenant_isolation ON public.user_account
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

CREATE POLICY vote_record_tenant_isolation ON public.vote_record
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());

--
-- The one additional policy in the schema. permission_template holds five
-- system-default rows with town_id IS NULL that every town reads and no town
-- may write; the tenancy policy above correctly excludes them from writes, and
-- this permissive SELECT policy adds them back for reads only.
CREATE POLICY permission_template_system_defaults_readable ON public.permission_template
  FOR SELECT
  USING (is_system_default = true AND town_id IS NULL);

--
-- ============================================================================
-- SECTION 4 — ROLES AND GRANTS
-- ============================================================================
-- These MUST live in the applied corpus, not in an ops runbook.
-- scripts/build-db-from-repo.sh runs `DROP SCHEMA public CASCADE` before every
-- build, which destroys any grant applied out of band — and the build would
-- then report success against a database the application cannot use at all.
--
-- tmm_app is the runtime role. It owns nothing, is never superuser, has no
-- BYPASSRLS, and gets DML only: no DDL, no TRUNCATE, no REFERENCES, no
-- ownership. Never `GRANT ALL`. Table owners bypass RLS unless FORCEd, so
-- "tmm_app must never own a table" is a security property, not tidiness.
--
-- CREATE ROLE here is deliberate. The alternative — wrapping the grants in a
-- plain `IF EXISTS (SELECT 1 FROM pg_roles ...)` — would make a build on a
-- cluster without the role silently skip every grant and still exit 0, which is
-- the precise failure this section exists to prevent. So: create it if this
-- role is allowed to, and if it is not, FAIL LOUDLY with the command to run.
-- Never skip.
--
-- Creating a role needs CREATEROLE, which the migration role legitimately may
-- not have (verified: a plain non-superuser database owner cannot). On such a
-- cluster tmm_app is created once, out of band, by a superuser — with a
-- password, since that is the connection the application actually opens:
--
--     CREATE ROLE tmm_app LOGIN PASSWORD '...';
--     GRANT tmm_app TO tmm_owner;   -- optional; lets tmm_owner SET ROLE
--
-- Postgres roles are CLUSTER-scoped: a role created here survives DROP
-- DATABASE. The vitest global teardown
-- (packages/api/src/test/global-teardown.ts) drops it after a test run for
-- exactly that reason.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tmm_app') THEN
    BEGIN
      CREATE ROLE tmm_app NOLOGIN;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'role tmm_app does not exist and % cannot create it (needs CREATEROLE). Create it once per cluster as a superuser: CREATE ROLE tmm_app LOGIN PASSWORD ''...''; then re-run this migration.',
          current_user;
      WHEN duplicate_object OR unique_violation THEN
        -- Lost a race with a concurrent build. Roles are cluster-scoped, and
        -- the test harness creates databases in parallel, so two sessions can
        -- both pass the NOT EXISTS check above and collide on pg_authid's
        -- unique index — which surfaces as 23505 unique_violation, NOT the
        -- 42710 duplicate_object a naive guard catches. Either way the role
        -- now exists, which is all this block wanted.
        NULL;
    END;
  END IF;
END
$$;

-- Lets whoever built this database reach tmm_app with SET ROLE, without a
-- second connection string or a password. Task B3's isolation gate depends on
-- being able to do that: a test that runs as the owner proves nothing, because
-- owners are exactly who FORCE exists to constrain. A superuser can SET ROLE
-- without membership, so this only matters for a non-superuser owner — and if
-- that owner did not create tmm_app it has no ADMIN OPTION and cannot grant it
-- to itself. That is a warning, not a build failure: it costs a convenience,
-- not a security property, and the ops command above fixes it.
DO $$
BEGIN
  -- pg_has_role is true for a superuser and for an existing member, so neither
  -- gets a redundant grant (or a redundant warning).
  IF NOT pg_has_role(current_user, 'tmm_app', 'MEMBER') THEN
    BEGIN
      EXECUTE format('GRANT tmm_app TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'could not GRANT tmm_app TO %; SET ROLE tmm_app will not work on this connection. Run as a superuser: GRANT tmm_app TO %;', current_user, current_user;
    END;
  END IF;
END
$$;

-- ─── The public schema's own privileges ─────────────────────────────────────
--
-- Stated explicitly because otherwise the two builders disagree, and they
-- disagree in a way that only shows up as a privilege difference nobody would
-- think to look for. A database created by `createdb` inherits an initdb
-- `public` schema that has USAGE granted to PUBLIC and carries a standard
-- comment; scripts/build-db-from-repo.sh runs `DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;`, and a hand-created schema has neither. So the test
-- harness's databases had USAGE-to-PUBLIC and the gate's databases did not —
-- verified by diffing pg_dump output from both, which is the only way this
-- kind of drift surfaces.
--
-- Converging on the hardened side: no role reaches this schema unless it was
-- granted it by name. tmm_app is granted below; the owner has it by
-- ownership; superusers bypass. Nothing else should be in here at all.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
COMMENT ON SCHEMA public IS 'standard public schema';

GRANT USAGE ON SCHEMA public TO tmm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tmm_app;

-- Explicit rather than relying on the EXECUTE-to-PUBLIC default: the RLS
-- policies above cannot be evaluated at all without EXECUTE on
-- get_current_town_id(), so if someone later revokes the PUBLIC default as a
-- hardening step, every query would start failing instead of tmm_app quietly
-- keeping the access it needs.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tmm_app;

-- Applies to tables created LATER by whoever runs migrations, so a new table
-- is not invisible to the application until someone remembers a grant.
-- Recorded per grantor: it takes effect for objects created by the role that
-- executes this statement, which is the role that runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tmm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO tmm_app;

