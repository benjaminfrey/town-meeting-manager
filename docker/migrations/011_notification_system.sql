-- ============================================================
-- Migration 011: Notification System
-- Session 11.01 — Postmark Integration & Notification Event System
-- Apply with:
--   PGPASSWORD=<POSTGRES_PASSWORD from docker/.env> \
--     psql -h localhost -p 54322 -U postgres -d postgres \
--     -f docker/migrations/011_notification_system.sql
-- ============================================================

-- ─── Enums ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE notification_event_type AS ENUM (
    'meeting_scheduled',
    'meeting_cancelled',
    'agenda_published',
    'minutes_review',
    'minutes_approved',
    'minutes_published',
    'admin_alert',
    'user_invited',
    'password_reset',
    'straw_poll_created'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_event_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_delivery_status AS ENUM (
    'pending',
    'sent',
    'delivered',
    'bounced',
    'failed',
    'complained'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM (
    'email',
    'sms'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── town_notification_config ────────────────────────────────────────
-- Per-town Postmark sender configuration

CREATE TABLE IF NOT EXISTS town_notification_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id               UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  postmark_server_token TEXT,             -- encrypted at rest; NULL = use global default
  postmark_sender_email TEXT NOT NULL,    -- notifications@townname.townmeetingmanager.com
  postmark_sender_name  TEXT NOT NULL,    -- "Town of Newcastle"
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_town_notification_config UNIQUE (town_id)
);

-- ─── notification_event ──────────────────────────────────────────────
-- One record per notification trigger

CREATE TABLE IF NOT EXISTS notification_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id      UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  event_type   notification_event_type NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       notification_event_status NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_event_town_created
  ON notification_event (town_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_event_status
  ON notification_event (status)
  WHERE status IN ('pending', 'processing');

-- ─── notification_delivery ───────────────────────────────────────────
-- One record per notification per subscriber

CREATE TABLE IF NOT EXISTS notification_delivery (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL REFERENCES notification_event(id) ON DELETE CASCADE,
  subscriber_id        UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  channel              notification_channel NOT NULL DEFAULT 'email',
  status               notification_delivery_status NOT NULL DEFAULT 'pending',
  postmark_message_id  TEXT,               -- MessageID returned by Postmark
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  opened_at            TIMESTAMPTZ,
  error_message        TEXT,
  retry_count          INT NOT NULL DEFAULT 0,
  next_retry_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_event
  ON notification_delivery (event_id);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_subscriber
  ON notification_delivery (subscriber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_postmark
  ON notification_delivery (postmark_message_id)
  WHERE postmark_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_delivery_retry
  ON notification_delivery (next_retry_at)
  WHERE status IN ('sent', 'failed') AND retry_count < 3 AND next_retry_at IS NOT NULL;

-- ─── subscriber_notification_preference ─────────────────────────────
-- Per-user opt-in/opt-out for each event type + channel

CREATE TABLE IF NOT EXISTS subscriber_notification_preference (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  event_type    notification_event_type NOT NULL,
  channel       notification_channel NOT NULL DEFAULT 'email',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_subscriber_pref UNIQUE (subscriber_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_pref_lookup
  ON subscriber_notification_preference (subscriber_id, event_type, channel);

-- ─── Add bounce/complaint flags to user_account ──────────────────────
-- Used to skip sending to hard-bounced or complained addresses

DO $$ BEGIN
  ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_bounced      BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_bounced_at   TIMESTAMPTZ;
  ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_complained    BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_complained_at TIMESTAMPTZ;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'user_account table not found — skipping bounce flag columns';
END $$;

-- ─── RLS policies ────────────────────────────────────────────────────

ALTER TABLE town_notification_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_notification_preference ENABLE ROW LEVEL SECURITY;

-- town_notification_config: admin/sys_admin can read+write own town
CREATE POLICY town_notification_config_select ON town_notification_config
  FOR SELECT TO authenticated
  USING (
    town_id IN (
      SELECT town_id FROM user_account
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'sys_admin')
    )
  );

CREATE POLICY town_notification_config_update ON town_notification_config
  FOR UPDATE TO authenticated
  USING (
    town_id IN (
      SELECT town_id FROM user_account
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'sys_admin')
    )
  );

-- notification_event: admin can view own town's events
CREATE POLICY notification_event_select ON notification_event
  FOR SELECT TO authenticated
  USING (
    town_id IN (
      SELECT town_id FROM user_account
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'sys_admin')
    )
  );

-- notification_delivery: subscriber sees own deliveries; admin sees all in town
CREATE POLICY notification_delivery_select ON notification_delivery
  FOR SELECT TO authenticated
  USING (
    subscriber_id IN (
      SELECT id FROM user_account WHERE auth_user_id = auth.uid()
    )
    OR
    event_id IN (
      SELECT id FROM notification_event
      WHERE town_id IN (
        SELECT town_id FROM user_account
        WHERE auth_user_id = auth.uid()
          AND role IN ('admin', 'sys_admin')
      )
    )
  );

-- subscriber_notification_preference: each user manages their own prefs
CREATE POLICY subscriber_pref_all ON subscriber_notification_preference
  FOR ALL TO authenticated
  USING (
    subscriber_id IN (
      SELECT id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );
