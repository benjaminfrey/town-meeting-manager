-- ============================================================
-- Town Meeting Manager — Extended updated_at Triggers
-- ============================================================
-- Apply the update_updated_at_column() trigger (created in
-- session 01.05) to all new tables with updated_at columns.
-- ============================================================

CREATE TRIGGER update_minutes_document_updated_at
  BEFORE UPDATE ON minutes_document
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_minutes_section_updated_at
  BEFORE UPDATE ON minutes_section
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agenda_template_updated_at
  BEFORE UPDATE ON agenda_template
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_town_notification_config_updated_at
  BEFORE UPDATE ON town_notification_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
