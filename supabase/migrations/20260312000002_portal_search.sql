-- ─── Full-Text Search for Public Portal ────────────────────────

-- 1. Add tsvector columns
ALTER TABLE minutes_document ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE agenda_item ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. GIN indexes
CREATE INDEX IF NOT EXISTS idx_minutes_document_search ON minutes_document USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_agenda_item_search ON agenda_item USING GIN(search_vector);

-- 3. Helper: extract all searchable text from minutes content_json JSONB
CREATE OR REPLACE FUNCTION extract_minutes_text(doc JSONB) RETURNS TEXT AS $$
DECLARE
  result TEXT := '';
  section JSONB;
  item JSONB;
  motion JSONB;
BEGIN
  -- Meeting header
  result := result || ' ' || coalesce(doc->'meeting_header'->>'town_name', '');
  result := result || ' ' || coalesce(doc->'meeting_header'->>'board_name', '');

  -- Sections
  IF doc->'sections' IS NOT NULL THEN
    FOR section IN SELECT jsonb_array_elements(doc->'sections')
    LOOP
      result := result || ' ' || coalesce(section->>'title', '');
      IF section->'items' IS NOT NULL THEN
        FOR item IN SELECT jsonb_array_elements(section->'items')
        LOOP
          result := result || ' ' || coalesce(item->>'title', '');
          result := result || ' ' || coalesce(item->>'discussion_summary', '');
          result := result || ' ' || coalesce(item->>'operator_notes', '');
          result := result || ' ' || coalesce(item->>'background', '');
          result := result || ' ' || coalesce(item->>'recommendation', '');
          -- Motions
          IF item->'motions' IS NOT NULL THEN
            FOR motion IN SELECT jsonb_array_elements(item->'motions')
            LOOP
              result := result || ' ' || coalesce(motion->>'text', '');
            END LOOP;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN trim(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Trigger for minutes_document
CREATE OR REPLACE FUNCTION minutes_document_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(extract_minutes_text(NEW.content_json), ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS minutes_document_search_trigger ON minutes_document;
CREATE TRIGGER minutes_document_search_trigger
  BEFORE INSERT OR UPDATE OF content_json ON minutes_document
  FOR EACH ROW EXECUTE FUNCTION minutes_document_search_update();

-- 5. Trigger for agenda_item
CREATE OR REPLACE FUNCTION agenda_item_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.background, '') || ' ' ||
    coalesce(NEW.recommendation, '') || ' ' ||
    coalesce(NEW.suggested_motion, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agenda_item_search_trigger ON agenda_item;
CREATE TRIGGER agenda_item_search_trigger
  BEFORE INSERT OR UPDATE OF title, description, background, recommendation, suggested_motion ON agenda_item
  FOR EACH ROW EXECUTE FUNCTION agenda_item_search_update();

-- 6. Search function called via RPC
CREATE OR REPLACE FUNCTION portal_search(
  p_town_id UUID,
  p_query TEXT,
  p_type TEXT DEFAULT 'all',
  p_board_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  result_type TEXT,
  meeting_id UUID,
  meeting_date DATE,
  board_name TEXT,
  title TEXT,
  snippet TEXT,
  rank REAL,
  total_count BIGINT
) AS $$
DECLARE
  tsq tsquery := plainto_tsquery('english', p_query);
BEGIN
  RETURN QUERY
  WITH results AS (
    -- Minutes results
    SELECT
      'minutes'::TEXT AS result_type,
      md.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      m.title,
      ts_headline('english', extract_minutes_text(md.content_json), tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(md.search_vector, tsq) AS rank
    FROM minutes_document md
    JOIN meeting m ON md.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE md.town_id = p_town_id
      AND md.status = 'published'
      AND md.search_vector @@ tsq
      AND (p_type = 'all' OR p_type = 'minutes')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)

    UNION ALL

    -- Agenda results
    SELECT
      'agenda'::TEXT AS result_type,
      ai.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      ai.title,
      ts_headline('english',
        coalesce(ai.title, '') || ' ' || coalesce(ai.background, '') || ' ' || coalesce(ai.description, ''),
        tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(ai.search_vector, tsq) AS rank
    FROM agenda_item ai
    JOIN meeting m ON ai.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE ai.town_id = p_town_id
      AND m.agenda_status = 'published'
      AND ai.search_vector @@ tsq
      AND ai.parent_item_id IS NOT NULL  -- Only search actual items, not section headers
      AND (p_type = 'all' OR p_type = 'agenda')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)
  )
  SELECT
    r.result_type,
    r.meeting_id,
    r.meeting_date,
    r.board_name,
    r.title,
    r.snippet,
    r.rank,
    count(*) OVER () AS total_count
  FROM results r
  ORDER BY r.rank DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Backfill existing records
UPDATE minutes_document SET content_json = content_json WHERE content_json IS NOT NULL;
UPDATE agenda_item SET title = title WHERE title IS NOT NULL;
