-- Session 07.03: Executive Session, Adjournment, and Future Items Queue
-- =====================================================================
-- Adds:
--   1. executive_session table — tracks closed sessions per Maine 1 M.R.S.A. 405(6)
--   2. future_item_queue table — persistent per-board queue for tabled/deferred/future items
--   3. adjournment JSONB column on meeting — stores adjournment method and metadata

-- ─── Executive Session Table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS executive_session (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  agenda_item_id UUID REFERENCES agenda_item(id) ON DELETE SET NULL,
  town_id       UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  statutory_basis TEXT NOT NULL,  -- e.g. "1 MRSA 405(6)(E)"
  entered_at    TIMESTAMPTZ,     -- NULL until entry motion passes
  exited_at     TIMESTAMPTZ,     -- NULL until return to public session
  entry_motion_id UUID REFERENCES motion(id) ON DELETE SET NULL,
  post_session_action_motion_ids JSONB DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executive_session_meeting ON executive_session(meeting_id);
CREATE INDEX IF NOT EXISTS idx_executive_session_town ON executive_session(town_id);

-- RLS policies (same pattern as guest_speaker from 20260311000004)
ALTER TABLE executive_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY "executive_session_select" ON executive_session
  FOR SELECT USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "executive_session_insert" ON executive_session
  FOR INSERT WITH CHECK (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "executive_session_update" ON executive_session
  FOR UPDATE USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "executive_session_delete" ON executive_session
  FOR DELETE USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

-- ─── Future Item Queue Table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS future_item_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id              UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  town_id               UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  source_meeting_id     UUID REFERENCES meeting(id) ON DELETE SET NULL,
  source_agenda_item_id UUID REFERENCES agenda_item(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  source                TEXT NOT NULL,  -- 'tabled' | 'deferred' | 'future_queue'
  status                TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'placed' | 'dismissed'
  dismissed_reason      TEXT,
  placed_agenda_item_id UUID REFERENCES agenda_item(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_future_item_queue_board ON future_item_queue(board_id);
CREATE INDEX IF NOT EXISTS idx_future_item_queue_town ON future_item_queue(town_id);
CREATE INDEX IF NOT EXISTS idx_future_item_queue_source_meeting ON future_item_queue(source_meeting_id);

-- RLS policies
ALTER TABLE future_item_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "future_item_queue_select" ON future_item_queue
  FOR SELECT USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "future_item_queue_insert" ON future_item_queue
  FOR INSERT WITH CHECK (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "future_item_queue_update" ON future_item_queue
  FOR UPDATE USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

CREATE POLICY "future_item_queue_delete" ON future_item_queue
  FOR DELETE USING (
    town_id = (
      SELECT ((current_setting('request.jwt.claims', true)::jsonb) -> 'app_metadata' ->> 'town_id')::uuid
    )
  );

-- ─── Adjournment Column on Meeting ────────────────────────────────────

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS adjournment JSONB;
-- Stores: { method, adjourned_by, adjourned_by_name, motion_id, timestamp, note }
