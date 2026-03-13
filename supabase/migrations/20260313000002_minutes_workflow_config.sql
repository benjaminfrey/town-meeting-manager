-- Session 14.x: Minutes approval workflow configuration
-- Advisory 3.5 — configurable settings for minutes workflow

-- ─── Town-level defaults ────────────────────────────────────────────────

ALTER TABLE town
  ADD COLUMN IF NOT EXISTS audio_retention_policy TEXT NOT NULL DEFAULT 'retain_30_days'
    CHECK (audio_retention_policy IN ('purge_on_approval','retain_30_days','retain_90_days','retain_indefinitely')),
  ADD COLUMN IF NOT EXISTS auto_publish_on_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minutes_review_window_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS minutes_workflow_configured_at TIMESTAMPTZ;

COMMENT ON COLUMN town.audio_retention_policy IS 'How long meeting audio recordings are retained after minutes approval';
COMMENT ON COLUMN town.auto_publish_on_approval IS 'Automatically publish minutes to public portal when approval motion passes';
COMMENT ON COLUMN town.minutes_review_window_days IS 'Days before next meeting that draft minutes must be distributed to board members';
COMMENT ON COLUMN town.minutes_workflow_configured_at IS 'Set when admin first saves the minutes workflow settings; used for ProgressChecklist';

-- ─── Board-level overrides ──────────────────────────────────────────────

ALTER TABLE board
  ADD COLUMN IF NOT EXISTS minutes_consent_agenda BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minutes_requires_second BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS r4_board_member_default BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS audio_retention_policy_override TEXT
    CHECK (audio_retention_policy_override IN ('purge_on_approval','retain_30_days','retain_90_days','retain_indefinitely')),
  ADD COLUMN IF NOT EXISTS auto_publish_on_approval_override BOOLEAN;

COMMENT ON COLUMN board.minutes_consent_agenda IS 'Allow approval of minutes by consent agenda (no separate motion)';
COMMENT ON COLUMN board.minutes_requires_second IS 'Whether motion to approve minutes requires a second';
COMMENT ON COLUMN board.r4_board_member_default IS 'Default R4 permission: can board members view draft minutes before approval';
COMMENT ON COLUMN board.audio_retention_policy_override IS 'Board override for audio retention; null = inherit town default';
COMMENT ON COLUMN board.auto_publish_on_approval_override IS 'Board override for auto-publish; null = inherit town default';

-- ─── Minutes addendum table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS minutes_addendum (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minutes_document_id UUID NOT NULL REFERENCES minutes_document(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id),
  adopting_meeting_id UUID NOT NULL REFERENCES meeting(id),
  adopting_motion_id UUID REFERENCES motion(id),
  content_json JSONB NOT NULL,
  html_rendered TEXT,
  description TEXT NOT NULL,
  created_by UUID REFERENCES user_account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_minutes_addendum_document ON minutes_addendum(minutes_document_id);
CREATE INDEX IF NOT EXISTS idx_minutes_addendum_town ON minutes_addendum(town_id);

COMMENT ON TABLE minutes_addendum IS 'Post-adoption amendments to approved minutes (Advisory 3.5 §4.2)';

-- ─── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE minutes_addendum ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read addenda for their town"
  ON minutes_addendum FOR SELECT
  TO authenticated
  USING (
    town_id IN (
      SELECT ua.town_id FROM user_account ua WHERE ua.id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert addenda for their town"
  ON minutes_addendum FOR INSERT
  TO authenticated
  WITH CHECK (
    town_id IN (
      SELECT ua.town_id FROM user_account ua WHERE ua.id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can update addenda for their town"
  ON minutes_addendum FOR UPDATE
  TO authenticated
  USING (
    town_id IN (
      SELECT ua.town_id FROM user_account ua WHERE ua.id = auth.uid()
    )
  );
