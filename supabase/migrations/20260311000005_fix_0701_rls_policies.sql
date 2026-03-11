-- ============================================================
-- Fix Session 07.01 RLS policies
--
-- The 07.01 migration used raw JWT path extraction:
--   (auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id'
-- but the actual JWT structure places town_id at:
--   auth.jwt()->'app_metadata'->>'town_id'
--
-- Fix: replace with the existing get_current_town_id() helper
-- used by all other tables.
-- ============================================================

-- ─── agenda_item_transition ────────────────────────────────

DROP POLICY IF EXISTS transition_select ON agenda_item_transition;
CREATE POLICY transition_select ON agenda_item_transition
  FOR SELECT USING (town_id = get_current_town_id());

DROP POLICY IF EXISTS transition_insert ON agenda_item_transition;
CREATE POLICY transition_insert ON agenda_item_transition
  FOR INSERT WITH CHECK (town_id = get_current_town_id());

DROP POLICY IF EXISTS transition_update ON agenda_item_transition;
CREATE POLICY transition_update ON agenda_item_transition
  FOR UPDATE USING (town_id = get_current_town_id());

-- ─── guest_speaker ─────────────────────────────────────────

DROP POLICY IF EXISTS guest_speaker_select ON guest_speaker;
CREATE POLICY guest_speaker_select ON guest_speaker
  FOR SELECT USING (town_id = get_current_town_id());

DROP POLICY IF EXISTS guest_speaker_insert ON guest_speaker;
CREATE POLICY guest_speaker_insert ON guest_speaker
  FOR INSERT WITH CHECK (town_id = get_current_town_id());

DROP POLICY IF EXISTS guest_speaker_delete ON guest_speaker;
CREATE POLICY guest_speaker_delete ON guest_speaker
  FOR DELETE USING (town_id = get_current_town_id());
