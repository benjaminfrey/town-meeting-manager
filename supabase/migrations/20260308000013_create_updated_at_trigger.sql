-- ============================================================
-- Town Meeting Manager — updated_at Trigger
-- ============================================================
-- Auto-updates the updated_at column on row modification.
-- Applied to all tables that have an updated_at column.
-- ============================================================

-- Trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at columns
CREATE TRIGGER update_town_updated_at
  BEFORE UPDATE ON town
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meeting_updated_at
  BEFORE UPDATE ON meeting
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agenda_item_updated_at
  BEFORE UPDATE ON agenda_item
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
