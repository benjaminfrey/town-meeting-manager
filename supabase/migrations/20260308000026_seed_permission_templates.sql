-- ============================================================
-- Town Meeting Manager — Default Permission Templates
-- ============================================================
-- 5 system-default templates (town_id = NULL, is_system_default = true).
-- These serve as starting points when an admin creates a new
-- staff account. The admin picks a template, then adjusts
-- individual permissions as needed.
--
-- Permission codes from advisory 1.2:
--   A1-A7: Agenda & Meeting Prep
--   M1-M8: Live Meeting Operations
--   R1-R6: Minutes & Records
--   C1-C5: Civic Engagement
--   T1-T4: Town & System Management (admin-only, not in templates)
--   V1-V5: View & Download (always allowed, not in templates)
-- ============================================================

-- 1. Town Clerk — Full operational access across all boards.
--    Closest to admin without system governance (T1-T4).
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0001-0000-0000-0000-000000000000',
  NULL,
  'Town Clerk',
  'Full operational access across all boards. Closest to admin without system governance (T1-T4).',
  '{
    "A1": true, "A2": true, "A3": true, "A5": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "M6": true, "M7": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R5": true, "R6": true,
    "C1": true, "C2": true, "C3": true, "C4": true, "C5": true
  }',
  true
);

-- 2. Deputy Clerk — Minutes and records focused.
--    Can run meetings and take minutes but cannot publish or manage civic engagement.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0002-0000-0000-0000-000000000000',
  NULL,
  'Deputy Clerk',
  'Minutes and records focused. Can run meetings and take minutes but cannot publish or manage civic engagement.',
  '{
    "A2": true, "A3": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R6": true
  }',
  true
);

-- 3. Board-Specific Staff — Full access on designated boards only.
--    Same capabilities as Town Clerk but intended for board_overrides use
--    (e.g., Town Planner on Planning Board, CEO on Zoning Board).
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0003-0000-0000-0000-000000000000',
  NULL,
  'Board-Specific Staff',
  'Full operational access on designated boards only (e.g., Town Planner, CEO). Apply via board_overrides.',
  '{
    "A1": true, "A2": true, "A3": true, "A5": true, "A6": true,
    "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "M6": true, "M7": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R5": true, "R6": true
  }',
  true
);

-- 4. General Staff — View-oriented.
--    Can upload documents and view records but cannot run meetings or manage agendas.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0004-0000-0000-0000-000000000000',
  NULL,
  'General Staff',
  'View-oriented. Can upload documents and view records but cannot run meetings or manage agendas.',
  '{
    "A3": true,
    "R4": true, "R6": true
  }',
  true
);

-- 5. Recording Secretary Only — Meeting recording and minutes.
--    For a dedicated recording secretary who only needs meeting
--    recording and minutes capabilities on designated boards.
INSERT INTO permission_template (id, town_id, name, description, permissions, is_system_default)
VALUES (
  'aaaa0005-0000-0000-0000-000000000000',
  NULL,
  'Recording Secretary Only',
  'Meeting recording and minutes only. For dedicated recording secretaries on designated boards.',
  '{
    "M2": true, "M3": true, "M4": true, "M5": true,
    "R1": true, "R2": true, "R3": true, "R4": true, "R6": true
  }',
  true
);
