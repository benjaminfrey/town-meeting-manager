/**
 * Kysely database type interface for type-safe SQL queries.
 *
 * Maps each PowerSync table name to its row type for use with
 * wrapPowerSyncWithKysely<Database>(). This enables fully typed
 * Kysely queries against the local SQLite database.
 */

import type {
  Person,
  UserAccount,
  BoardMember,
  ResidentAccount,
  Town,
  Board,
  Meeting,
  AgendaItem,
  AgendaTemplate,
  Motion,
  VoteRecord,
  MeetingAttendance,
  MinutesDocument,
  MinutesSection,
  Exhibit,
  NotificationEvent,
  NotificationDelivery,
} from "@town-meeting/shared/types";

/**
 * Database interface for Kysely.
 *
 * Each key matches a table name in the PowerSync schema (AppSchema).
 * Values are the corresponding TypeScript interfaces from the shared package.
 */
export interface Database {
  persons: Person;
  user_accounts: UserAccount;
  board_members: BoardMember;
  resident_accounts: ResidentAccount;
  towns: Town;
  boards: Board;
  meetings: Meeting;
  agenda_items: AgendaItem;
  agenda_templates: AgendaTemplate;
  motions: Motion;
  vote_records: VoteRecord;
  meeting_attendance: MeetingAttendance;
  minutes_documents: MinutesDocument;
  minutes_sections: MinutesSection;
  exhibits: Exhibit;
  notification_events: NotificationEvent;
  notification_deliveries: NotificationDelivery;
}
