-- ============================================================
-- Onboarding Wizard — Server-side RPC Function
-- ============================================================
-- SECURITY DEFINER function that creates all town records in
-- a single transaction, bypassing RLS. Called from the client
-- via supabase.rpc('complete_onboarding', {...}).
--
-- This replaces the individual PostgREST inserts which required
-- complex RLS onboarding policies (a new user has no town_id
-- in their JWT, so standard RLS blocks all writes).
-- ============================================================

CREATE OR REPLACE FUNCTION complete_onboarding(
  -- Town fields
  p_town_name           TEXT,
  p_state               TEXT DEFAULT 'ME',
  p_municipality_type   TEXT DEFAULT 'town',
  p_population_range    TEXT DEFAULT NULL,
  p_meeting_formality   TEXT DEFAULT 'semi_formal',
  p_minutes_style       TEXT DEFAULT 'action',
  p_presiding_officer   TEXT DEFAULT NULL,
  p_minutes_recorder    TEXT DEFAULT NULL,
  p_staff_roles_present JSONB DEFAULT '[]'::jsonb,
  -- Governing board fields
  p_board_name          TEXT DEFAULT 'Select Board',
  p_member_count        INTEGER DEFAULT NULL,
  p_election_method     TEXT DEFAULT NULL,
  p_officer_election_method TEXT DEFAULT NULL,
  p_seat_titles         JSONB DEFAULT '[]'::jsonb,
  p_district_based      BOOLEAN DEFAULT false,
  p_staggered_terms     BOOLEAN DEFAULT false,
  -- Additional boards (JSONB array of objects)
  p_additional_boards   JSONB DEFAULT '[]'::jsonb,
  -- Person fields
  p_contact_name        TEXT DEFAULT NULL,
  p_contact_email       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_town_id UUID;
  v_board   JSONB;
BEGIN
  -- Verify the caller is authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify the user doesn't already have a town
  IF EXISTS (SELECT 1 FROM user_account WHERE auth_user_id = v_user_id) THEN
    RAISE EXCEPTION 'User already belongs to a town';
  END IF;

  -- 1. Create town
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

  -- 2. Create governing board
  INSERT INTO board (
    town_id, name, member_count, election_method,
    officer_election_method, is_governing_board,
    seat_titles, district_based, staggered_terms
  ) VALUES (
    v_town_id, p_board_name, p_member_count, p_election_method,
    p_officer_election_method, true,
    p_seat_titles, p_district_based, p_staggered_terms
  );

  -- 3. Create additional boards
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

  -- 4. Create person record
  INSERT INTO person (id, town_id, name, email)
  VALUES (v_user_id, v_town_id, COALESCE(p_contact_name, 'Admin'), p_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    town_id = EXCLUDED.town_id,
    name = EXCLUDED.name,
    email = EXCLUDED.email;

  -- 5. Create user_account record
  INSERT INTO user_account (id, person_id, town_id, role, auth_user_id)
  VALUES (v_user_id, v_user_id, v_town_id, 'admin', v_user_id)
  ON CONFLICT (id) DO UPDATE SET
    town_id = EXCLUDED.town_id,
    role = EXCLUDED.role;

  RETURN v_town_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION complete_onboarding TO authenticated;

COMMENT ON FUNCTION complete_onboarding IS
  'Onboarding wizard completion: creates town, boards, person, and user_account in a single transaction.';
