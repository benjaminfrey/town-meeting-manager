-- ============================================================
-- Town Meeting Manager — MINUTES_DOCUMENT table
-- ============================================================
-- The minutes for a meeting. One per meeting (UNIQUE on meeting_id).
-- JSON is the canonical source; HTML and PDF are rendered outputs.
--
-- Status lifecycle: draft → review → approved (by board vote) → published
-- ============================================================

CREATE TABLE minutes_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES meeting(id) ON DELETE CASCADE,
  town_id UUID NOT NULL REFERENCES town(id) ON DELETE CASCADE,
  status minutes_document_status NOT NULL DEFAULT 'draft',
  content_json JSONB NOT NULL DEFAULT '{}',
  html_rendered TEXT,
  pdf_storage_path TEXT,
  generated_by minutes_generated_by NOT NULL DEFAULT 'manual',
  approved_at TIMESTAMPTZ,
  approved_by_motion_id UUID REFERENCES motion(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE minutes_document IS 'The minutes for a meeting. One per meeting. JSON is the canonical source; HTML and PDF are rendered outputs.';
COMMENT ON COLUMN minutes_document.content_json IS 'Structured JSON representation of the complete minutes. Source of truth for rendering.';
COMMENT ON COLUMN minutes_document.html_rendered IS 'Pre-rendered HTML for the public portal. Regenerated when content_json changes.';
COMMENT ON COLUMN minutes_document.pdf_storage_path IS 'Path in Supabase Storage to the generated PDF.';
COMMENT ON COLUMN minutes_document.approved_by_motion_id IS 'The motion by which the board voted to approve these minutes.';
