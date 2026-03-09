-- ============================================================
-- Town Meeting Manager — SUBSCRIBER_NOTIFICATION_PREFERENCE table
-- ============================================================
-- Per-subscriber, per-channel, per-event-type notification
-- preferences. Includes TCPA compliance fields for SMS consent
-- tracking (timestamp, method, exact disclosure text).
-- ============================================================

CREATE TABLE subscriber_notification_preference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  consent_timestamp TIMESTAMPTZ,
  consent_method TEXT,
  consent_record TEXT,

  CONSTRAINT subscriber_pref_unique UNIQUE (person_id, channel, event_type)
);

COMMENT ON TABLE subscriber_notification_preference IS 'Per-subscriber, per-channel, per-event-type notification preferences.';
COMMENT ON COLUMN subscriber_notification_preference.consent_timestamp IS 'TCPA compliance: when the subscriber consented to SMS. Required for SMS channel.';
COMMENT ON COLUMN subscriber_notification_preference.consent_method IS 'TCPA compliance: how consent was given (web_form, in_person, etc.).';
COMMENT ON COLUMN subscriber_notification_preference.consent_record IS 'TCPA compliance: exact text/disclosure shown to the subscriber at time of consent.';
