-- ============================================================
-- Town Meeting Manager — Enable RLS on All Tables
-- ============================================================
-- Row-Level Security must be enabled on every table in the
-- public schema. The service_role key (used by server-side
-- operations, migrations, and seed data) bypasses RLS entirely.
--
-- Note: After enabling RLS, a table returns NO rows by default
-- until policies are added. The subsequent migration files
-- (000029–000036) create the actual policies.
-- ============================================================

-- Core tables (session 01.05)
ALTER TABLE town ENABLE ROW LEVEL SECURITY;
ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE board ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendance ENABLE ROW LEVEL SECURITY;

-- Extended tables (session 01.06)
ALTER TABLE minutes_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE minutes_section ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE exhibit ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE town_notification_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
