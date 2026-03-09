-- ============================================================
-- Town Meeting Manager — RLS Policies: AUDIT_LOG,
--   PERMISSION_TEMPLATE, AGENDA_TEMPLATE
-- ============================================================
-- AUDIT_LOG: Read-only for admin. Writes happen server-side
-- (service_role), but we allow client-side insert from any
-- authenticated user so the app can log client-side actions.
-- No UPDATE or DELETE — the audit log is immutable.
--
-- PERMISSION_TEMPLATE: All authenticated users can read system
-- defaults (town_id IS NULL) and their own town's templates.
-- Only admin can create/modify town-specific templates.
-- System defaults (is_system_default = true) are immutable.
--
-- AGENDA_TEMPLATE: All authenticated users can read templates
-- (needed for meeting creation). Only admin can manage them.
-- ============================================================

-- ─── AUDIT_LOG ───────────────────────────────────────────────

-- Admin can read the audit log for their town
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- Any authenticated user in the town can insert audit entries
-- (the app logs actions like "user viewed agenda", "user downloaded PDF")
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
  );

-- No UPDATE or DELETE policies — audit log is immutable

-- ─── PERMISSION_TEMPLATE ─────────────────────────────────────

-- All authenticated users can read:
--   1. System defaults (town_id IS NULL, is_system_default = true)
--   2. Their own town's custom templates
CREATE POLICY permission_template_select ON permission_template
  FOR SELECT USING (
    is_system_default = true
    OR town_id = get_current_town_id()
  );

-- Admin can create town-specific templates (not system defaults)
CREATE POLICY permission_template_insert ON permission_template
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND is_admin()
    AND is_system_default = false
  );

-- Admin can update town-specific templates (not system defaults)
CREATE POLICY permission_template_update ON permission_template
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND is_admin()
    AND is_system_default = false
  );

-- Admin can delete town-specific templates (not system defaults)
CREATE POLICY permission_template_delete ON permission_template
  FOR DELETE USING (
    town_id = get_current_town_id()
    AND is_admin()
    AND is_system_default = false
  );

-- ─── AGENDA_TEMPLATE ─────────────────────────────────────────

-- All authenticated users in the town can read agenda templates
-- (needed when creating meetings, viewing template library)
CREATE POLICY agenda_template_select ON agenda_template
  FOR SELECT USING (town_id = get_current_town_id());

-- Admin can create agenda templates
CREATE POLICY agenda_template_insert ON agenda_template
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- Admin can update agenda templates
CREATE POLICY agenda_template_update ON agenda_template
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND is_admin()
  );

-- Admin can delete agenda templates
CREATE POLICY agenda_template_delete ON agenda_template
  FOR DELETE USING (
    town_id = get_current_town_id()
    AND is_admin()
  );
