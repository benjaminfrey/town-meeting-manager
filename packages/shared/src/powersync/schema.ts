/**
 * PowerSync schema definitions for offline-first local SQLite tables.
 *
 * These define the client-side table structure that PowerSync uses for
 * local replication from Supabase. Column types map to SQLite types:
 * - column.text → TEXT
 * - column.integer → INTEGER
 * - column.real → REAL
 *
 * Note: UUIDs, datetimes, and JSON are stored as TEXT in SQLite.
 * The 'id' column is automatically provided by PowerSync as the primary key.
 */

import { column, Schema, TableV2 } from "@powersync/common";

// ─── People & Identity ──────────────────────────────────────────────

export const persons = new TableV2({
  town_id: column.text,
  name: column.text,
  email: column.text,
  created_at: column.text,
  archived_at: column.text,
});

export const user_accounts = new TableV2({
  person_id: column.text,
  town_id: column.text,
  role: column.text,
  gov_title: column.text,
  permissions: column.text, // JSON stored as text
  auth_user_id: column.text,
  created_at: column.text,
  archived_at: column.text,
});

export const board_members = new TableV2({
  person_id: column.text,
  board_id: column.text,
  town_id: column.text,
  seat_title: column.text,
  term_start: column.text,
  term_end: column.text,
  status: column.text,
  is_default_rec_sec: column.integer, // boolean → 0/1
  created_at: column.text,
});

export const resident_accounts = new TableV2({
  person_id: column.text,
  town_id: column.text,
  notification_preferences: column.text, // JSON stored as text
  created_at: column.text,
  archived_at: column.text,
});

export const invitations = new TableV2({
  person_id: column.text,
  user_account_id: column.text,
  town_id: column.text,
  token: column.text,
  expires_at: column.text,
  status: column.text, // 'pending' | 'accepted' | 'expired'
  created_at: column.text,
});

// ─── Town & Board ───────────────────────────────────────────────────

export const towns = new TableV2({
  name: column.text,
  state: column.text,
  municipality_type: column.text,
  population_range: column.text,
  contact_name: column.text,
  contact_role: column.text,
  meeting_formality: column.text,
  minutes_style: column.text,
  presiding_officer_default: column.text,
  minutes_recorder_default: column.text,
  staff_roles_present: column.text, // JSON array stored as text
  subdomain: column.text,
  seal_url: column.text,
  retention_policy_acknowledged_at: column.text,
  created_at: column.text,
  updated_at: column.text,
});

export const boards = new TableV2({
  town_id: column.text,
  name: column.text,
  board_type: column.text,
  elected_or_appointed: column.text,
  member_count: column.integer,
  election_method: column.text,
  officer_election_method: column.text,
  district_based: column.integer, // boolean → 0/1
  staggered_terms: column.integer, // boolean → 0/1
  is_governing_board: column.integer, // boolean → 0/1
  meeting_formality_override: column.text,
  minutes_style_override: column.text,
  quorum_type: column.text,
  quorum_value: column.integer,
  motion_display_format: column.text,
  created_at: column.text,
  archived_at: column.text,
});

// ─── Meetings ───────────────────────────────────────────────────────

export const meetings = new TableV2({
  board_id: column.text,
  town_id: column.text,
  title: column.text,
  meeting_type: column.text,
  scheduled_date: column.text,
  scheduled_time: column.text,
  location: column.text,
  status: column.text,
  agenda_status: column.text,
  formality_override: column.text,
  started_at: column.text,
  ended_at: column.text,
  created_by: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// ─── Agenda ─────────────────────────────────────────────────────────

export const agenda_items = new TableV2({
  meeting_id: column.text,
  town_id: column.text,
  section_type: column.text,
  sort_order: column.integer,
  title: column.text,
  description: column.text,
  presenter: column.text,
  estimated_duration: column.integer,
  parent_item_id: column.text,
  status: column.text,
  staff_resource: column.text,
  background: column.text,
  recommendation: column.text,
  suggested_motion: column.text,
  created_at: column.text,
  updated_at: column.text,
});

export const agenda_templates = new TableV2({
  board_id: column.text,
  town_id: column.text,
  name: column.text,
  is_default: column.integer, // boolean → 0/1
  sections: column.text, // JSON stored as text
  created_at: column.text,
  updated_at: column.text,
});

// ─── Motions & Votes ────────────────────────────────────────────────

export const motions = new TableV2({
  agenda_item_id: column.text,
  meeting_id: column.text,
  town_id: column.text,
  motion_text: column.text,
  motion_type: column.text,
  moved_by: column.text,
  seconded_by: column.text,
  status: column.text,
  created_at: column.text,
});

export const vote_records = new TableV2({
  motion_id: column.text,
  meeting_id: column.text,
  town_id: column.text,
  board_member_id: column.text,
  vote: column.text,
  recusal_reason: column.text,
  created_at: column.text,
});

export const meeting_attendance = new TableV2({
  meeting_id: column.text,
  town_id: column.text,
  board_member_id: column.text,
  person_id: column.text,
  status: column.text,
  is_recording_secretary: column.integer, // boolean → 0/1
  arrived_at: column.text,
  departed_at: column.text,
});

// ─── Minutes ────────────────────────────────────────────────────────

export const minutes_documents = new TableV2({
  meeting_id: column.text,
  town_id: column.text,
  status: column.text,
  content_json: column.text, // JSON stored as text
  html_rendered: column.text,
  pdf_storage_path: column.text,
  generated_by: column.text,
  approved_at: column.text,
  approved_by_motion_id: column.text,
  created_at: column.text,
  updated_at: column.text,
});

export const minutes_sections = new TableV2({
  minutes_document_id: column.text,
  town_id: column.text,
  section_type: column.text,
  sort_order: column.integer,
  title: column.text,
  content_json: column.text, // JSON stored as text
  source_agenda_item_id: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// ─── Exhibits ───────────────────────────────────────────────────────

export const exhibits = new TableV2({
  agenda_item_id: column.text,
  town_id: column.text,
  title: column.text,
  file_storage_path: column.text,
  file_type: column.text,
  file_size: column.integer,
  file_name: column.text,
  exhibit_type: column.text,
  visibility: column.text,
  uploaded_by: column.text,
  sort_order: column.integer,
  created_at: column.text,
});

// ─── Notifications ──────────────────────────────────────────────────

export const notification_events = new TableV2({
  town_id: column.text,
  event_type: column.text,
  payload: column.text, // JSON stored as text
  status: column.text,
  created_at: column.text,
  processed_at: column.text,
});

export const notification_deliveries = new TableV2({
  event_id: column.text,
  town_id: column.text,
  subscriber_id: column.text,
  channel: column.text,
  status: column.text,
  external_id: column.text,
  error_message: column.text,
  created_at: column.text,
  delivered_at: column.text,
});

// ─── Combined Schema ────────────────────────────────────────────────
//
// Schema keys use SINGULAR Postgres table names (matching sync-rules.yaml
// FROM clauses). viewName on each table preserves the PLURAL names used
// in all existing SQL queries throughout the web app.

export const AppSchema = new Schema({
  person: new TableV2(persons.columnMap, { viewName: "persons" }),
  user_account: new TableV2(user_accounts.columnMap, { viewName: "user_accounts" }),
  board_member: new TableV2(board_members.columnMap, { viewName: "board_members" }),
  resident_account: new TableV2(resident_accounts.columnMap, { viewName: "resident_accounts" }),
  invitation: new TableV2(invitations.columnMap, { viewName: "invitations" }),
  town: new TableV2(towns.columnMap, { viewName: "towns" }),
  board: new TableV2(boards.columnMap, { viewName: "boards" }),
  meeting: new TableV2(meetings.columnMap, { viewName: "meetings" }),
  agenda_item: new TableV2(agenda_items.columnMap, { viewName: "agenda_items" }),
  agenda_template: new TableV2(agenda_templates.columnMap, { viewName: "agenda_templates" }),
  motion: new TableV2(motions.columnMap, { viewName: "motions" }),
  vote_record: new TableV2(vote_records.columnMap, { viewName: "vote_records" }),
  meeting_attendance: new TableV2(meeting_attendance.columnMap),
  minutes_document: new TableV2(minutes_documents.columnMap, { viewName: "minutes_documents" }),
  minutes_section: new TableV2(minutes_sections.columnMap, { viewName: "minutes_sections" }),
  exhibit: new TableV2(exhibits.columnMap, { viewName: "exhibits" }),
  notification_event: new TableV2(notification_events.columnMap, { viewName: "notification_events" }),
  notification_delivery: new TableV2(notification_deliveries.columnMap, { viewName: "notification_deliveries" }),
});
