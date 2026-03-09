-- ============================================================
-- Town Meeting Manager — NOTIFICATION_DELIVERY table
-- ============================================================
-- Individual delivery record per subscriber per channel.
-- Tracks Postmark/Twilio delivery status via webhooks.
-- ============================================================

CREATE TABLE notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES notification_event(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  status notification_status NOT NULL DEFAULT 'pending',
  external_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

COMMENT ON TABLE notification_delivery IS 'Individual delivery record per subscriber per channel. Tracks Postmark/Twilio delivery status.';
COMMENT ON COLUMN notification_delivery.external_id IS 'Provider message ID (Postmark MessageID or Twilio MessageSid) for delivery tracking.';
COMMENT ON COLUMN notification_delivery.error_message IS 'Error details if delivery failed or bounced.';
