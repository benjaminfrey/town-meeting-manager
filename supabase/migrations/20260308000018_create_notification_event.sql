-- ============================================================
-- Town Meeting Manager — Notification Enums & NOTIFICATION_EVENT table
-- ============================================================
-- Unified notification event system serving email (Postmark,
-- Phase 1) and SMS (Twilio, Phase 2).
--
-- Flow: Event Trigger → notification_event created →
--       Subscriber query by event_type + channel →
--       notification_delivery per subscriber per channel
-- ============================================================

-- Notification delivery status
CREATE TYPE notification_status AS ENUM (
  'pending', 'processing', 'sent', 'delivered', 'failed', 'bounced'
);

-- Notification channel
CREATE TYPE notification_channel AS ENUM ('email', 'sms');

CREATE TABLE notification_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status notification_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

COMMENT ON TABLE notification_event IS 'Notification triggers. Each event may produce multiple deliveries across channels and subscribers.';
COMMENT ON COLUMN notification_event.event_type IS 'Event type: meeting_scheduled, agenda_published, meeting_cancelled, minutes_approved, minutes_published, straw_poll_created, etc.';
COMMENT ON COLUMN notification_event.payload IS 'Event-specific data: { meeting_id, board_id, agenda_url, ... }';
COMMENT ON COLUMN notification_event.processed_at IS 'When the event was picked up for delivery processing.';
