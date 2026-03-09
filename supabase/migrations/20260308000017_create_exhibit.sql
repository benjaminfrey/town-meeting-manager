-- ============================================================
-- Town Meeting Manager — EXHIBIT table
-- ============================================================
-- File attachments for agenda items: maps, plans, letters,
-- reports, applications, staff memos, and other supporting
-- documents. Files are stored in Supabase Storage.
-- ============================================================

CREATE TABLE exhibit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_item_id UUID NOT NULL REFERENCES agenda_item(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT,
  exhibit_type TEXT,
  uploaded_by UUID REFERENCES user_account(id),
  visibility exhibit_visibility NOT NULL DEFAULT 'admin_only',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE exhibit IS 'File attachments for agenda items — maps, plans, letters, reports, staff memos.';
COMMENT ON COLUMN exhibit.file_storage_path IS 'Path in Supabase Storage.';
COMMENT ON COLUMN exhibit.file_type IS 'MIME type of the file (application/pdf, image/jpeg, etc.).';
COMMENT ON COLUMN exhibit.exhibit_type IS 'Descriptive label: staff_report, plan, legal_notice, application, correspondence, supporting_document, other.';
COMMENT ON COLUMN exhibit.visibility IS 'admin_only = admin/staff only; board_only = board members can see; public = visible on public portal.';
