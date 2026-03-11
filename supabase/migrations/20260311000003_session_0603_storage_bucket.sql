-- ============================================================
-- Session 06.03: Create 'documents' storage bucket for PDFs
-- ============================================================
-- Stores generated agenda packets, meeting notices, and other
-- documents. Public read access for published documents.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow service_role to upload (API server uses service role key)
-- Public read is handled by the bucket being public.

-- RLS policy: authenticated users can read documents from their town
CREATE POLICY "Town members can read their documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (
      SELECT (current_setting('request.jwt.claims', true)::json ->> 'town_id')
    )
  );

-- Allow service_role full access (implicit via service role key)
