-- ============================================================
-- Session 07.01 — Live Meeting Manager schema additions
-- ============================================================

-- guest_speaker: per-meeting guest records (advisory 1.2 — not linked to PERSON)
CREATE TABLE IF NOT EXISTS guest_speaker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  agenda_item_id UUID REFERENCES agenda_item(id) ON DELETE SET NULL,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  topic TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE guest_speaker IS 'Guest speakers for public comment sections. Not linked to PERSON records per advisory 1.2.';

CREATE INDEX IF NOT EXISTS idx_guest_speaker_meeting ON guest_speaker(meeting_id);
CREATE INDEX IF NOT EXISTS idx_guest_speaker_town ON guest_speaker(town_id);

ALTER TABLE guest_speaker ENABLE ROW LEVEL SECURITY;

CREATE POLICY guest_speaker_select ON guest_speaker
  FOR SELECT USING (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

CREATE POLICY guest_speaker_insert ON guest_speaker
  FOR INSERT WITH CHECK (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

CREATE POLICY guest_speaker_delete ON guest_speaker
  FOR DELETE USING (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

-- agenda_item_transition: time tracking per agenda item
CREATE TABLE IF NOT EXISTS agenda_item_transition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  agenda_item_id UUID NOT NULL REFERENCES agenda_item(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

COMMENT ON TABLE agenda_item_transition IS 'Tracks time spent on each agenda item during live meetings.';

CREATE INDEX IF NOT EXISTS idx_agenda_item_transition_meeting ON agenda_item_transition(meeting_id);
CREATE INDEX IF NOT EXISTS idx_agenda_item_transition_item ON agenda_item_transition(agenda_item_id);
CREATE INDEX IF NOT EXISTS idx_agenda_item_transition_town ON agenda_item_transition(town_id);

ALTER TABLE agenda_item_transition ENABLE ROW LEVEL SECURITY;

CREATE POLICY transition_select ON agenda_item_transition
  FOR SELECT USING (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

CREATE POLICY transition_insert ON agenda_item_transition
  FOR INSERT WITH CHECK (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

CREATE POLICY transition_update ON agenda_item_transition
  FOR UPDATE USING (
    town_id IN (
      SELECT ((auth.jwt()->'app_metadata'->>'claims')::jsonb->>'town_id')::uuid
    )
  );

-- meeting: add live-meeting tracking columns
ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS current_agenda_item_id UUID REFERENCES agenda_item(id) ON DELETE SET NULL;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS presiding_officer_id UUID REFERENCES board_member(id) ON DELETE SET NULL;

ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS recording_secretary_id UUID;

-- agenda_item: add operator_notes column
ALTER TABLE agenda_item
  ADD COLUMN IF NOT EXISTS operator_notes TEXT;
