-- ============================================================
-- Town Meeting Manager — RLS Policies: NOTIFICATION_EVENT,
--   NOTIFICATION_DELIVERY, SUBSCRIBER_NOTIFICATION_PREFERENCE,
--   TOWN_NOTIFICATION_CONFIG
-- ============================================================
-- Notification management is admin/staff with C2 permission.
-- Subscribers can view and manage their own preferences.
-- Town notification config (API keys, SMTP settings) is
-- admin-only.
--
-- Write operations on notification_event and notification_delivery
-- are primarily server-side (service_role), but we allow admin
-- read access for monitoring and troubleshooting.
-- ============================================================

-- ─── NOTIFICATION_EVENT ──────────────────────────────────────

-- Admin and staff with C2 (Manage notification settings) can read events
CREATE POLICY notification_event_select ON notification_event
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND has_permission('C2')
  );

-- Events are created server-side (service_role bypasses RLS),
-- but allow admin to insert for manual notifications
CREATE POLICY notification_event_insert ON notification_event
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- ─── NOTIFICATION_DELIVERY ──────────────────────────────────

-- Admin/staff with C2 can read all deliveries for monitoring;
-- subscribers can see their own deliveries
CREATE POLICY notification_delivery_select ON notification_delivery
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND (
      has_permission('C2')
      OR subscriber_id = get_current_person_id()
    )
  );

-- Deliveries are created server-side only (no client insert policy needed,
-- but we add one for admin for edge cases)
CREATE POLICY notification_delivery_insert ON notification_delivery
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- ─── SUBSCRIBER_NOTIFICATION_PREFERENCE ─────────────────────

-- Users can read their own preferences;
-- admin/staff with C2 can read all preferences for management
CREATE POLICY subscriber_pref_select ON subscriber_notification_preference
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND (
      person_id = get_current_person_id()
      OR has_permission('C2')
    )
  );

-- Users can create their own preferences;
-- admin can create preferences for others (e.g., bulk setup)
CREATE POLICY subscriber_pref_insert ON subscriber_notification_preference
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND (
      person_id = get_current_person_id()
      OR is_admin()
    )
  );

-- Users can update their own preferences;
-- admin can update preferences for others
CREATE POLICY subscriber_pref_update ON subscriber_notification_preference
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND (
      person_id = get_current_person_id()
      OR is_admin()
    )
  );

-- ─── TOWN_NOTIFICATION_CONFIG ───────────────────────────────

-- Admin only — contains sensitive API keys and SMTP credentials
CREATE POLICY town_notification_config_select ON town_notification_config
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- Admin only for insert (initial setup)
CREATE POLICY town_notification_config_insert ON town_notification_config
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- Admin only for update (rotate keys, change settings)
CREATE POLICY town_notification_config_update ON town_notification_config
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND is_admin()
  );
