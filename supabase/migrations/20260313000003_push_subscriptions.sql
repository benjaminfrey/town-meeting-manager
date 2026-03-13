-- Push notification subscriptions table
-- Stores Web Push API subscription data per user per device/browser

CREATE TABLE IF NOT EXISTS push_subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_account_id, endpoint)
);

-- Index for looking up subscriptions by user
CREATE INDEX idx_push_subscription_user ON push_subscription(user_account_id);

-- Add notification_preferences JSONB column to user_account if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_account' AND column_name = 'notification_preferences'
  ) THEN
    ALTER TABLE user_account ADD COLUMN notification_preferences JSONB DEFAULT '{}';
  END IF;
END
$$;
