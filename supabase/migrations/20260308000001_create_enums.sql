-- ============================================================
-- Town Meeting Manager — Enum Types
-- ============================================================
-- PostgreSQL enum types used across all tables.
-- Values are aligned with packages/shared/src/constants/enums.ts
-- ============================================================

-- User roles (4 app-level roles, per advisory 1.2)
CREATE TYPE user_role AS ENUM ('sys_admin', 'admin', 'staff', 'board_member');

-- Municipality types (Maine-specific)
CREATE TYPE municipality_type AS ENUM ('town', 'city', 'plantation');

-- Board types (13 types covering Maine municipal boards)
CREATE TYPE board_type AS ENUM (
  'select_board', 'planning_board', 'zoning_board', 'budget_committee',
  'conservation_commission', 'parks_recreation', 'harbor_committee',
  'shellfish_commission', 'cemetery_committee', 'road_committee',
  'comp_plan_committee', 'broadband_committee', 'other'
);

-- Board member status
CREATE TYPE board_member_status AS ENUM ('active', 'archived');

-- Meeting formality levels
CREATE TYPE meeting_formality AS ENUM ('informal', 'semi_formal', 'formal');

-- Meeting status lifecycle: draft → noticed → open → adjourned → minutes_draft → approved
CREATE TYPE meeting_status AS ENUM (
  'draft', 'noticed', 'open', 'adjourned', 'minutes_draft', 'approved', 'cancelled'
);

-- Minutes styles
CREATE TYPE minutes_style AS ENUM ('action', 'summary', 'narrative');

-- Agenda item status
CREATE TYPE agenda_item_status AS ENUM ('pending', 'active', 'completed', 'tabled', 'deferred');

-- Motion types (Roberts Rules of Order)
CREATE TYPE motion_type AS ENUM (
  'main', 'amendment', 'substitute', 'table', 'untable',
  'postpone', 'reconsider', 'adjourn'
);

-- Motion status
CREATE TYPE motion_status AS ENUM (
  'pending', 'seconded', 'in_vote', 'passed', 'failed', 'tabled', 'withdrawn'
);

-- Vote types
CREATE TYPE vote_type AS ENUM ('yes', 'no', 'abstain', 'recusal', 'absent');

-- Attendance status
CREATE TYPE attendance_status AS ENUM (
  'present', 'absent', 'remote', 'excused', 'late_arrival', 'early_departure'
);

-- Minutes document status
CREATE TYPE minutes_document_status AS ENUM ('draft', 'review', 'approved', 'published');

-- Minutes generation method
CREATE TYPE minutes_generated_by AS ENUM ('manual', 'ai', 'hybrid');

-- Exhibit visibility (used in session 01.06)
CREATE TYPE exhibit_visibility AS ENUM ('public', 'board_only', 'admin_only');
