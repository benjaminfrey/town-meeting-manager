-- ============================================================
-- Town Meeting Manager — Development Seed Data
-- ============================================================
-- Realistic Maine town government data for development.
-- Uses Newcastle, Maine (Lincoln County) as the sample town.
--
-- NOTE: Creates no identity-provider records. user_account.auth_user_id
-- is left NULL; Better Auth (Stage 1 Task C1) owns identity.
--
-- ─── Every id below must be an RFC-VALID uuid ──────────────────────────
--
-- Not a style rule. Every tRPC procedure validates its ids with
-- `z.uuid()`, and Zod 4 enforces the RFC: the first nibble of the third
-- group must be the VERSION (1-8) and the first nibble of the fourth must
-- be the VARIANT (8, 9, a or b). Postgres's own `uuid` type does not care,
-- so an id like `bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb` stores and joins
-- perfectly and then makes every screen that reads it answer
-- `400 Bad Request — Invalid UUID`. That is what the whole of this file
-- used to be: "run the app against the seed" had been impossible since the
-- first `z.uuid()` landed, and nobody had tried until wave 5's browser
-- check. Fixed by giving each id a `4` and an `8` in those two positions
-- (`bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb`), which keeps the ids readable
-- and keeps them distinct.
--
-- So: keep the mnemonic shape, keep the `-4xxx-8xxx-`. A new id that
-- repeats a letter straight through will load here and break the app.
-- ============================================================

-- ─── TENANT CONTEXT ────────────────────────────────────────
-- Every table below is under FORCE ROW LEVEL SECURITY
-- (packages/api/drizzle/0000_baseline.sql § 3), which binds the table OWNER
-- too — so this seed does not get a free pass just because it runs as the
-- role that created the tables. Without this line every INSERT below fails
-- with "new row violates row-level security policy" for any role that is not
-- a superuser. That is not a nuisance to work around; it is the seed proving
-- the tenancy model is actually on.
--
-- It matters that this is exercised: locally and in CI the seed runs as a
-- superuser, which bypasses RLS regardless, so a missing tenant context here
-- would stay invisible until the first deploy to the VM — where migrations
-- run as the non-superuser tmm_owner. Verified by running this seed as a
-- non-superuser owner.
--
-- `false` (session-scoped, not SET LOCAL) is deliberate and is the one place
-- it is correct: psql applies this file outside any transaction, so a
-- transaction-scoped setting would revert before the next statement. The
-- application code never does this — see Task B3's withTenant, which uses
-- SET LOCAL so tenant context cannot outlive a request on a pooled
-- connection.
--
-- The value is Newcastle's town id, the same literal every INSERT below uses.
DO $$ BEGIN PERFORM set_config('app.town_id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', false); END $$;

-- ─── TOWN ──────────────────────────────────────────────────

INSERT INTO town (id, name, state, municipality_type, population_range,
  contact_name, contact_role, meeting_formality, minutes_style,
  presiding_officer_default, minutes_recorder_default, subdomain)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Newcastle', 'ME', 'town', '1000_to_2500',
  'Margaret Bragdon', 'Town Clerk',
  'semi_formal', 'action',
  'Chair', 'Town Clerk',
  'newcastle'
);

-- ─── PERSONS ───────────────────────────────────────────────
-- 6 persons with varied roles:
-- 1 admin (Town Clerk), 1 staff (Deputy Clerk), 1 staff (Town Planner)
-- 3 board members

-- Margaret Bragdon — Town Clerk (admin)
INSERT INTO person (id, town_id, name, email)
VALUES ('11111111-1111-4111-8111-111111111111',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Margaret Bragdon', 'mbragdon@newcastle.me.us');

-- Sarah Mitchell — Deputy Clerk (staff)
INSERT INTO person (id, town_id, name, email)
VALUES ('22222222-2222-4222-8222-222222222222',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Sarah Mitchell', 'smitchell@newcastle.me.us');

-- David Chen — Town Planner (staff)
INSERT INTO person (id, town_id, name, email)
VALUES ('33333333-3333-4333-8333-333333333333',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'David Chen', 'dchen@newcastle.me.us');

-- Robert Hanley — Select Board Chair (board member)
INSERT INTO person (id, town_id, name, email)
VALUES ('44444444-4444-4444-8444-444444444444',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Robert Hanley', 'rhanley@newcastle.me.us');

-- Ellen Dickens — Select Board Member & Planning Board Chair (board member)
INSERT INTO person (id, town_id, name, email)
VALUES ('55555555-5555-4555-8555-555555555555',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Ellen Dickens', 'edickens@newcastle.me.us');

-- Thomas Wren — Select Board Member (board member)
INSERT INTO person (id, town_id, name, email)
VALUES ('66666666-6666-4666-8666-666666666666',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Thomas Wren', 'twren@newcastle.me.us');

-- ─── USER ACCOUNTS ─────────────────────────────────────────
-- auth_user_id is NULL — will be linked in session 01.08

-- Margaret Bragdon — admin (Town Clerk)
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'admin', 'Town Clerk',
  '{"global": {}, "board_overrides": []}');

-- Sarah Mitchell — staff (Deputy Clerk template)
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'staff', 'Deputy Clerk',
  '{"global": {"A2": true, "A3": true, "A6": true, "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "R1": true, "R2": true, "R3": true, "R4": true, "R6": true}, "board_overrides": []}');

-- David Chen — staff (Board-Specific Staff: Planning Board only)
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa3333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'staff', 'Town Planner',
  '{"global": {}, "board_overrides": [{"board_id": "bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "permissions": {"A1": true, "A2": true, "A3": true, "A5": true, "A6": true, "M1": true, "M2": true, "M3": true, "M4": true, "M5": true, "M6": true, "M7": true, "R1": true, "R2": true, "R3": true, "R4": true, "R5": true, "R6": true}}]}');

-- Robert Hanley — board_member
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa4444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '44444444-4444-4444-8444-444444444444',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'board_member', 'Chair',
  '{"global": {}, "board_overrides": []}');

-- Ellen Dickens — board_member
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa5555-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '55555555-5555-4555-8555-555555555555',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'board_member', NULL,
  '{"global": {}, "board_overrides": []}');

-- Thomas Wren — board_member
INSERT INTO user_account (id, person_id, town_id, role, gov_title, permissions)
VALUES ('aaaa6666-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '66666666-6666-4666-8666-666666666666',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'board_member', NULL,
  '{"global": {}, "board_overrides": []}');

-- ─── BOARDS ────────────────────────────────────────────────

-- Select Board (governing body, 5 seats, at-large election)
INSERT INTO board (id, town_id, name, board_type, member_count,
  election_method, officer_election_method, is_governing_board)
VALUES ('bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Select Board', 'select_board', 5,
  'at_large', 'vote_of_board', true);

-- Planning Board (7 seats, at-large election)
INSERT INTO board (id, town_id, name, board_type, member_count,
  election_method, officer_election_method, meeting_formality_override)
VALUES ('bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Planning Board', 'planning_board', 7,
  'at_large', 'vote_of_board', 'formal');

-- ─── BOARD MEMBERSHIPS ─────────────────────────────────────

-- Robert Hanley — Select Board Chair
INSERT INTO board_member (id, person_id, board_id, town_id,
  seat_title, term_start, term_end, status)
VALUES ('cccc1111-cccc-4ccc-8ccc-cccccccccccc',
  '44444444-4444-4444-8444-444444444444',
  'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Chair', '2025-06-01', '2028-06-01', 'active');

-- Ellen Dickens — Select Board Member
INSERT INTO board_member (id, person_id, board_id, town_id,
  seat_title, term_start, term_end, status)
VALUES ('cccc2222-cccc-4ccc-8ccc-cccccccccccc',
  '55555555-5555-4555-8555-555555555555',
  'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Member', '2024-06-01', '2027-06-01', 'active');

-- Thomas Wren — Select Board Member
INSERT INTO board_member (id, person_id, board_id, town_id,
  seat_title, term_start, term_end, status)
VALUES ('cccc3333-cccc-4ccc-8ccc-cccccccccccc',
  '66666666-6666-4666-8666-666666666666',
  'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Member', '2025-06-01', '2028-06-01', 'active');

-- Ellen Dickens — Planning Board Chair (multi-board membership)
INSERT INTO board_member (id, person_id, board_id, town_id,
  seat_title, term_start, term_end, status)
VALUES ('cccc4444-cccc-4ccc-8ccc-cccccccccccc',
  '55555555-5555-4555-8555-555555555555',
  'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Chair', '2024-06-01', '2027-06-01', 'active');

-- ─── MEETINGS ──────────────────────────────────────────────

-- Upcoming Select Board regular meeting
INSERT INTO meeting (id, board_id, town_id, title,
  scheduled_date, scheduled_time, location, status, created_by)
VALUES ('dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Select Board Regular Meeting',
  '2026-03-24', '18:00',
  'Newcastle Town Office — Meeting Room',
  'noticed',
  'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ─── AGENDA ITEMS ──────────────────────────────────────────

-- 1. Call to Order
INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title)
VALUES ('eeee0001-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'procedural', 1, 'Call to Order');

-- 2. Pledge of Allegiance
INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title)
VALUES ('eeee0002-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'ceremonial', 2, 'Pledge of Allegiance');

-- 3. Approval of Minutes
INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title, description)
VALUES ('eeee0003-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'minutes_approval', 3,
  'Approval of Minutes from March 10, 2026',
  'Review and approve minutes from the regular meeting of March 10, 2026.');

-- 4. Road Maintenance Budget
INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title, description, presenter, estimated_duration)
VALUES ('eeee0004-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'action', 4,
  'FY2027 Road Maintenance Budget Approval',
  'Review and approve the proposed FY2027 road maintenance budget of $285,000 including paving of Academy Hill Road.',
  'Road Commissioner',
  20);

-- 5. Transfer Station Fee Schedule
INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title, description, estimated_duration)
VALUES ('eeee0005-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'action', 5,
  'Transfer Station Fee Schedule Update',
  'Discuss and vote on proposed updates to the transfer station fee schedule for demolition debris and bulky waste.',
  15);

-- ─── MOTIONS ───────────────────────────────────────────────

-- Motion on Road Maintenance Budget
INSERT INTO motion (id, agenda_item_id, meeting_id, town_id,
  motion_text, motion_type, moved_by, seconded_by, status)
VALUES ('ffff1111-ffff-4fff-8fff-ffffffffffff',
  'eeee0004-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Move to approve the FY2027 road maintenance budget of $285,000 as presented.',
  'main',
  'cccc2222-cccc-4ccc-8ccc-cccccccccccc',  -- Ellen Dickens
  'cccc3333-cccc-4ccc-8ccc-cccccccccccc',  -- Thomas Wren
  'passed');

-- Motion on Transfer Station Fees
INSERT INTO motion (id, agenda_item_id, meeting_id, town_id,
  motion_text, motion_type, moved_by, seconded_by, status)
VALUES ('ffff2222-ffff-4fff-8fff-ffffffffffff',
  'eeee0005-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Move to table the transfer station fee schedule update pending further public input.',
  'table',
  'cccc1111-cccc-4ccc-8ccc-cccccccccccc',  -- Robert Hanley
  'cccc2222-cccc-4ccc-8ccc-cccccccccccc',  -- Ellen Dickens
  'passed');

-- ─── VOTE RECORDS ──────────────────────────────────────────

-- Votes on Road Maintenance Budget (passed 3-0)
INSERT INTO vote_record (motion_id, meeting_id, town_id, board_member_id, vote)
VALUES
  ('ffff1111-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc1111-cccc-4ccc-8ccc-cccccccccccc', 'yes'),
  ('ffff1111-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc2222-cccc-4ccc-8ccc-cccccccccccc', 'yes'),
  ('ffff1111-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc3333-cccc-4ccc-8ccc-cccccccccccc', 'yes');

-- Votes on Table Motion for Transfer Station (passed 2-1)
INSERT INTO vote_record (motion_id, meeting_id, town_id, board_member_id, vote)
VALUES
  ('ffff2222-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc1111-cccc-4ccc-8ccc-cccccccccccc', 'yes'),
  ('ffff2222-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc2222-cccc-4ccc-8ccc-cccccccccccc', 'yes'),
  ('ffff2222-ffff-4fff-8fff-ffffffffffff', 'dddd1111-dddd-4ddd-8ddd-dddddddddddd',
   'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'cccc3333-cccc-4ccc-8ccc-cccccccccccc', 'no');

-- ─── MEETING ATTENDANCE ────────────────────────────────────

-- Board members present at the Select Board meeting
INSERT INTO meeting_attendance (meeting_id, town_id, board_member_id, person_id,
  status, is_recording_secretary)
VALUES
  -- Robert Hanley — Chair, present
  ('dddd1111-dddd-4ddd-8ddd-dddddddddddd', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'cccc1111-cccc-4ccc-8ccc-cccccccccccc', '44444444-4444-4444-8444-444444444444',
   'present', false),
  -- Ellen Dickens — Member, present
  ('dddd1111-dddd-4ddd-8ddd-dddddddddddd', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'cccc2222-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555',
   'present', false),
  -- Thomas Wren — Member, present
  ('dddd1111-dddd-4ddd-8ddd-dddddddddddd', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'cccc3333-cccc-4ccc-8ccc-cccccccccccc', '66666666-6666-4666-8666-666666666666',
   'present', false),
  -- Margaret Bragdon — Town Clerk, recording secretary (not a board member)
  ('dddd1111-dddd-4ddd-8ddd-dddddddddddd', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   NULL, '11111111-1111-4111-8111-111111111111',
   'present', true);

-- ============================================================
-- Verification
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '=== Seed data loaded successfully ===';
  RAISE NOTICE 'Town: Newcastle, ME';
  RAISE NOTICE 'Persons: 6 (1 admin, 2 staff, 3 board members)';
  RAISE NOTICE 'Boards: 2 (Select Board, Planning Board)';
  RAISE NOTICE 'Board memberships: 4 (3 Select Board + 1 Planning Board)';
  RAISE NOTICE 'Meetings: 1 (Select Board regular meeting)';
  RAISE NOTICE 'Agenda items: 5';
  RAISE NOTICE 'Motions: 2 with vote records';
  RAISE NOTICE 'Attendance: 4 (3 board members + 1 recording secretary)';
END
$$;
