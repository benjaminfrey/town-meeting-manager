-- ============================================================
-- Town Meeting Manager — TOWN_NOTIFICATION_CONFIG table
-- ============================================================
-- Per-town notification provider configuration.
-- Postmark for email (Phase 1), Twilio for SMS (Phase 2).
-- API tokens are stored encrypted — decrypted only at send time.
-- ============================================================

CREATE TABLE town_notification_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  town_id UUID NOT NULL UNIQUE REFERENCES town(id) ON DELETE CASCADE,
  -- Postmark (Phase 1)
  postmark_server_token_encrypted TEXT,
  postmark_sender_email TEXT,
  postmark_sender_name TEXT,
  -- Twilio (Phase 2)
  twilio_messaging_service_sid TEXT,
  twilio_phone_number TEXT,
  sms_quiet_hours_start TIME DEFAULT '21:00',
  sms_quiet_hours_end TIME DEFAULT '08:00',
  sms_opt_in_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE town_notification_config IS 'Per-town notification provider configuration. Stores encrypted API tokens.';
COMMENT ON COLUMN town_notification_config.postmark_server_token_encrypted IS 'Encrypted Postmark server API token. Decrypted only at send time.';
COMMENT ON COLUMN town_notification_config.sms_quiet_hours_start IS 'No SMS sent after this time (TCPA compliance). Default 9 PM.';
COMMENT ON COLUMN town_notification_config.sms_quiet_hours_end IS 'No SMS sent before this time (TCPA compliance). Default 8 AM.';
COMMENT ON COLUMN town_notification_config.sms_opt_in_message IS 'Customizable consent disclosure text shown to subscribers when opting in to SMS.';
