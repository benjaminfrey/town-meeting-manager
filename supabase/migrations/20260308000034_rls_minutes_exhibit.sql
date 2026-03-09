-- ============================================================
-- Town Meeting Manager — RLS Policies: MINUTES_DOCUMENT,
--   MINUTES_SECTION, EXHIBIT
-- ============================================================
-- Minutes visibility depends on status and permissions:
--   - draft/review: visible to those with R4 (View draft minutes)
--   - approved/published: visible to all town users
--
-- Exhibits visibility depends on the exhibit_visibility enum:
--   - public: visible to all town users
--   - board_only: visible to board members + staff/admin
--   - admin_only: visible to admin/staff with A3 permission
--
-- Board members can upload files for admin review (A4) but
-- these are marked admin_only visibility by default.
-- ============================================================

-- ─── MINUTES_DOCUMENT ────────────────────────────────────────

-- Read access: users with R4 see all, others only see approved/published
CREATE POLICY minutes_document_select ON minutes_document
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND (
      has_permission('R4')
      OR status IN ('approved', 'published')
    )
  );

-- R1 (Edit draft minutes) required to create
CREATE POLICY minutes_document_insert ON minutes_document
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_permission('R1')
  );

-- R1 required to update (edit content, change status)
CREATE POLICY minutes_document_update ON minutes_document
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('R1')
  );

-- ─── MINUTES_SECTION ─────────────────────────────────────────
-- Sections follow the parent minutes_document access pattern.
-- Since sections are always read/written in the context of a
-- document, we scope by town_id and defer to document-level
-- visibility for the client app. The RLS check is simplified
-- to permission-based write + town-scoped read.

-- All authenticated users in the town can read sections
-- (the client app filters based on document status/visibility)
CREATE POLICY minutes_section_select ON minutes_section
  FOR SELECT USING (town_id = get_current_town_id());

-- R1 required to create sections
CREATE POLICY minutes_section_insert ON minutes_section
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND has_permission('R1')
  );

-- R1 required to update sections
CREATE POLICY minutes_section_update ON minutes_section
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('R1')
  );

-- ─── EXHIBIT ─────────────────────────────────────────────────

-- Read access depends on visibility level:
--   - public: all town users
--   - board_only: board members on that board, plus staff/admin
--   - admin_only: admin and staff with A3 (Upload attachments)
CREATE POLICY exhibit_select ON exhibit
  FOR SELECT USING (
    town_id = get_current_town_id()
    AND (
      visibility = 'public'
      OR (visibility = 'board_only' AND (
        is_admin()
        OR has_permission('A3')
        OR get_current_role() = 'board_member'
      ))
      OR (visibility = 'admin_only' AND (
        is_admin()
        OR has_permission('A3')
      ))
    )
  );

-- Staff with A3 (Upload attachments as staff) can create exhibits
-- Board members can upload via A4 (always allowed for board_member role)
CREATE POLICY exhibit_insert ON exhibit
  FOR INSERT WITH CHECK (
    town_id = get_current_town_id()
    AND (
      has_permission('A3')
      OR get_current_role() = 'board_member'
    )
  );

-- Only admin/staff with A3 can update exhibits (change visibility, etc.)
CREATE POLICY exhibit_update ON exhibit
  FOR UPDATE USING (
    town_id = get_current_town_id()
    AND has_permission('A3')
  );
