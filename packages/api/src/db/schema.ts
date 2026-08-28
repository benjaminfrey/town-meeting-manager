// ============================================================================
// THIS FILE DOES NOT DEFINE ROW LEVEL SECURITY. THAT IS DELIBERATE.
//
// Decision (Stage 1, Task B2; the resolution of the warning this banner used
// to carry): the `pgPolicy()` calls that `drizzle-kit pull` generated were
// DELETED rather than completed. RLS lives in hand-written SQL, in
// `packages/api/drizzle/0000_baseline.sql` § 3, which is the source of truth
// for every policy.
//
// The problem being solved: `pull` silently dropped the `USING`/`WITH CHECK`
// clause from 53 of the 79 policies it emitted — every policy after the first
// on each table (Task 4 / B1, task-4-report.md §2.1). `drizzle-kit generate`
// from that file emitted 79 live `CREATE POLICY` statements, 53 of them
// unconditionally permissive, on tenant-isolation-critical tables. Not
// hypothetical: that was `generate`'s actual default output.
//
// Why deletion rather than hand-writing the 53 missing predicates:
//
//   1. Drizzle cannot express most of the security model anyway. It has no
//      representation for `FORCE ROW LEVEL SECURITY` at all — grep for it
//      across drizzle-orm@0.45.2 and drizzle-kit@0.31.10 and there are zero
//      hits, while `enableRLS()` does exist — and FORCE is the single
//      statement without which the whole model is decorative for the table
//      owner. It also cannot model the 13 SQL functions every policy calls
//      (`get_current_town_id()` and friends), the 9 triggers, the 132
//      `COMMENT ON` objects, the grants, or the `tmm_app` role. More than half
//      the security-relevant DDL is permanently outside this file. Declaring
//      it "the source of truth for RLS" would be a fiction that rots.
//   2. Two copies of a security predicate with nothing keeping them in sync is
//      worse than one. The next `pull` would reintroduce the same silent
//      clause loss into the copy that looks authoritative.
//   3. With no `pgPolicy()` here, `drizzle-kit generate` emits no
//      `CREATE POLICY` at all — so "generate silently produces wide-open
//      policies" stops being a documented hazard and becomes structurally
//      impossible.
//
// The cost, and how it is covered: a table added through this file and
// `generate` would get no RLS. `src/db/__tests__/schema-invariants.test.ts`
// asserts that every table in `public` has RLS enabled AND forced AND exactly
// one tenancy policy — so a new table without RLS fails the suite rather than
// shipping open. Add the table here, add its policy to a new forward-only
// migration in `packages/api/drizzle/`, and that test tells you if you forgot.
//
// ─── THE ONE THING THAT WOULD SILENTLY UNDO ALL OF THIS: `pnpm db:pull` ────
//
// `drizzle-kit pull` overwrites this file wholesale. Run against a
// baseline-built database it regenerates the RLS policies as `pgPolicy()`
// calls — dropping the USING/WITH CHECK clause from every policy after the
// first on each table, which is the exact defect described above — and deletes
// this banner in the same stroke, erasing the warning about what it just did.
//
// `pnpm db:pull` is therefore GUARDED: it refuses to run without
// `ALLOW_DB_PULL=1` (see packages/api/scripts/db-pull.sh). If you do re-pull,
// you must delete every `pgPolicy()` call and restore this banner by hand
// before committing. The invariants test cannot catch this for you — it checks
// the database, and a schema.ts that has grown policies back only does damage
// at the next `drizzle-kit generate`.
// ============================================================================

import {
  pgTable,
  uuid,
  index,
  foreignKey,
  unique,
  text,
  date,
  boolean,
  timestamp,
  integer,
  jsonb,
  time,
  bigint,
  type AnyPgColumn,
  check,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// HAND-APPLIED FIX, not `pull` output (Task 4 / B1 hand-review, Step 5):
// `drizzle-kit pull` emitted `unknown("search_vector")` for both tsvector
// columns below. `unknown` is a TypeScript *type* exported by
// drizzle-orm/pg-core, not a callable column builder — the generated code
// does not compile (`error TS2693: 'unknown' only refers to a type, but is
// being used as a value here`). drizzle-orm@0.45.2's pg-core has no
// first-class `tsvector` column builder, so pull's fallback path emits an
// invalid reference instead of degrading to something loadable. This
// `customType` is the standard drizzle-orm workaround for a column type
// the library doesn't model natively — it does not add or infer anything
// pull didn't already know (the column's SQL type, `tsvector`, is exactly
// what pull's own SQL migration output and every other tool agree it is).
// Column existence, name, nullability, and the GIN indexes over these two
// columns are unchanged from pull's output. See task-4-report.md.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const agendaItemStatus = pgEnum("agenda_item_status", [
  "pending",
  "active",
  "completed",
  "tabled",
  "deferred",
]);
export const attendanceStatus = pgEnum("attendance_status", [
  "present",
  "absent",
  "remote",
  "excused",
  "late_arrival",
  "early_departure",
]);
export const boardMemberStatus = pgEnum("board_member_status", ["active", "archived"]);
export const boardType = pgEnum("board_type", [
  "select_board",
  "planning_board",
  "zoning_board",
  "budget_committee",
  "conservation_commission",
  "parks_recreation",
  "harbor_committee",
  "shellfish_commission",
  "cemetery_committee",
  "road_committee",
  "comp_plan_committee",
  "broadband_committee",
  "other",
]);
export const exhibitVisibility = pgEnum("exhibit_visibility", [
  "public",
  "board_only",
  "admin_only",
]);
export const meetingFormality = pgEnum("meeting_formality", ["informal", "semi_formal", "formal"]);
export const meetingStatus = pgEnum("meeting_status", [
  "draft",
  "noticed",
  "open",
  "adjourned",
  "minutes_draft",
  "approved",
  "cancelled",
]);
export const minutesDocumentStatus = pgEnum("minutes_document_status", [
  "draft",
  "review",
  "approved",
  "published",
]);
export const minutesGeneratedBy = pgEnum("minutes_generated_by", ["manual", "ai", "hybrid"]);
export const minutesStyle = pgEnum("minutes_style", ["action", "summary", "narrative"]);
export const motionStatus = pgEnum("motion_status", [
  "pending",
  "seconded",
  "in_vote",
  "passed",
  "failed",
  "tabled",
  "withdrawn",
]);
export const motionType = pgEnum("motion_type", [
  "main",
  "amendment",
  "substitute",
  "table",
  "untable",
  "postpone",
  "reconsider",
  "adjourn",
]);
export const municipalityType = pgEnum("municipality_type", ["town", "city", "plantation"]);
export const notificationChannel = pgEnum("notification_channel", ["email", "sms"]);
export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "processing",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "completed",
  "complained",
]);
export const userRole = pgEnum("user_role", ["sys_admin", "admin", "staff", "board_member"]);
export const voteType = pgEnum("vote_type", ["yes", "no", "abstain", "recusal", "absent"]);

export const boardMember = pgTable(
  "board_member",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    personId: uuid("person_id").notNull(),
    boardId: uuid("board_id").notNull(),
    townId: uuid("town_id").notNull(),
    seatTitle: text("seat_title"),
    termStart: date("term_start").notNull(),
    termEnd: date("term_end"),
    status: boardMemberStatus().default("active").notNull(),
    isDefaultRecSec: boolean("is_default_rec_sec").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_board_member_active")
      .using("btree", table.boardId.asc().nullsLast(), table.status.asc().nullsLast())
      .where(sql`(status = 'active'::board_member_status)`),
    index("idx_board_member_board_id").using("btree", table.boardId.asc().nullsLast()),
    index("idx_board_member_person_id").using("btree", table.personId.asc().nullsLast()),
    index("idx_board_member_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.personId],
      foreignColumns: [person.id],
      name: "board_member_person_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.boardId],
      foreignColumns: [board.id],
      name: "board_member_board_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "board_member_town_id_fkey",
    }).onDelete("cascade"),
    unique("board_member_unique_active").on(table.personId, table.boardId, table.status),
  ],
);

export const voteRecord = pgTable(
  "vote_record",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    motionId: uuid("motion_id").notNull(),
    meetingId: uuid("meeting_id").notNull(),
    townId: uuid("town_id").notNull(),
    boardMemberId: uuid("board_member_id").notNull(),
    vote: voteType().notNull(),
    recusalReason: text("recusal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_vote_record_board_member_id").using("btree", table.boardMemberId.asc().nullsLast()),
    index("idx_vote_record_meeting_id").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_vote_record_motion_id").using("btree", table.motionId.asc().nullsLast()),
    index("idx_vote_record_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.motionId],
      foreignColumns: [motion.id],
      name: "vote_record_motion_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "vote_record_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "vote_record_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.boardMemberId],
      foreignColumns: [boardMember.id],
      name: "vote_record_board_member_id_fkey",
    }).onDelete("cascade"),
    unique("vote_record_unique_per_motion").on(table.motionId, table.boardMemberId),
  ],
);

export const meetingAttendance = pgTable(
  "meeting_attendance",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    townId: uuid("town_id").notNull(),
    boardMemberId: uuid("board_member_id"),
    personId: uuid("person_id").notNull(),
    status: attendanceStatus().default("present").notNull(),
    isRecordingSecretary: boolean("is_recording_secretary").default(false).notNull(),
    arrivedAt: timestamp("arrived_at", { withTimezone: true, mode: "string" }),
    departedAt: timestamp("departed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_attendance_board_member_id").using("btree", table.boardMemberId.asc().nullsLast()),
    index("idx_attendance_meeting_id").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_attendance_person_id").using("btree", table.personId.asc().nullsLast()),
    index("idx_attendance_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "meeting_attendance_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "meeting_attendance_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.boardMemberId],
      foreignColumns: [boardMember.id],
      name: "meeting_attendance_board_member_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.personId],
      foreignColumns: [person.id],
      name: "meeting_attendance_person_id_fkey",
    }).onDelete("cascade"),
    unique("attendance_unique_per_meeting").on(table.meetingId, table.personId),
  ],
);

export const minutesSection = pgTable(
  "minutes_section",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    minutesDocumentId: uuid("minutes_document_id").notNull(),
    townId: uuid("town_id").notNull(),
    sectionType: text("section_type").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    title: text(),
    contentJson: jsonb("content_json").default({}).notNull(),
    sourceAgendaItemId: uuid("source_agenda_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_minutes_section_doc_id").using("btree", table.minutesDocumentId.asc().nullsLast()),
    index("idx_minutes_section_sort").using(
      "btree",
      table.minutesDocumentId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast(),
    ),
    index("idx_minutes_section_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.minutesDocumentId],
      foreignColumns: [minutesDocument.id],
      name: "minutes_section_minutes_document_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "minutes_section_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceAgendaItemId],
      foreignColumns: [agendaItem.id],
      name: "minutes_section_source_agenda_item_id_fkey",
    }),
  ],
);

export const agendaTemplate = pgTable(
  "agenda_template",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    boardId: uuid("board_id"),
    townId: uuid("town_id").notNull(),
    name: text().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    sections: jsonb().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_agenda_template_board_id").using("btree", table.boardId.asc().nullsLast()),
    index("idx_agenda_template_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.boardId],
      foreignColumns: [board.id],
      name: "agenda_template_board_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "agenda_template_town_id_fkey",
    }).onDelete("cascade"),
    unique("template_name_unique_per_board").on(table.boardId, table.name),
  ],
);

export const notificationEvent = pgTable(
  "notification_event",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb().default({}).notNull(),
    status: notificationStatus().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_notification_event_status")
      .using("btree", table.status.asc().nullsLast())
      .where(
        sql`(status = ANY (ARRAY['pending'::notification_status, 'processing'::notification_status]))`,
      ),
    index("idx_notification_event_town_id").using("btree", table.townId.asc().nullsLast()),
    index("idx_notification_event_type").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.eventType.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "notification_event_town_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const subscriberNotificationPreference = pgTable(
  "subscriber_notification_preference",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    personId: uuid("person_id").notNull(),
    townId: uuid("town_id").notNull(),
    channel: notificationChannel().notNull(),
    eventType: text("event_type").notNull(),
    enabled: boolean().default(true).notNull(),
    consentTimestamp: timestamp("consent_timestamp", { withTimezone: true, mode: "string" }),
    consentMethod: text("consent_method"),
    consentRecord: text("consent_record"),
  },
  (table) => [
    index("idx_subscriber_pref_person").using("btree", table.personId.asc().nullsLast()),
    index("idx_subscriber_pref_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.personId],
      foreignColumns: [person.id],
      name: "subscriber_notification_preference_person_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "subscriber_notification_preference_town_id_fkey",
    }).onDelete("cascade"),
    unique("subscriber_pref_unique").on(table.personId, table.channel, table.eventType),
  ],
);

export const townNotificationConfig = pgTable(
  "town_notification_config",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id").notNull(),
    postmarkServerTokenEncrypted: text("postmark_server_token_encrypted"),
    postmarkSenderEmail: text("postmark_sender_email"),
    postmarkSenderName: text("postmark_sender_name"),
    twilioMessagingServiceSid: text("twilio_messaging_service_sid"),
    twilioPhoneNumber: text("twilio_phone_number"),
    smsQuietHoursStart: time("sms_quiet_hours_start").default("21:00:00"),
    smsQuietHoursEnd: time("sms_quiet_hours_end").default("08:00:00"),
    smsOptInMessage: text("sms_opt_in_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "town_notification_config_town_id_fkey",
    }).onDelete("cascade"),
    unique("town_notification_config_town_id_key").on(table.townId),
  ],
);

export const permissionTemplate = pgTable(
  "permission_template",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id"),
    name: text().notNull(),
    description: text(),
    permissions: jsonb().default({}).notNull(),
    isSystemDefault: boolean("is_system_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_permission_template_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "permission_template_town_id_fkey",
    }).onDelete("cascade"),
    unique("template_name_unique").on(table.townId, table.name),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id").notNull(),
    userAccountId: uuid("user_account_id"),
    action: text().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    details: jsonb().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_audit_log_created").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("idx_audit_log_entity").using(
      "btree",
      table.entityType.asc().nullsLast(),
      table.entityId.asc().nullsLast(),
    ),
    index("idx_audit_log_town_id").using("btree", table.townId.asc().nullsLast()),
    index("idx_audit_log_user").using("btree", table.userAccountId.asc().nullsLast()),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "audit_log_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userAccountId],
      foreignColumns: [userAccount.id],
      name: "audit_log_user_account_id_fkey",
    }).onDelete("set null"),
  ],
);

export const person = pgTable(
  "person",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id").notNull(),
    name: text().notNull(),
    email: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_person_archived")
      .using("btree", table.townId.asc().nullsLast())
      .where(sql`(archived_at IS NULL)`),
    index("idx_person_email").using("btree", table.email.asc().nullsLast()),
    index("idx_person_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "person_town_id_fkey",
    }).onDelete("cascade"),
    unique("person_email_unique_per_town").on(table.townId, table.email),
  ],
);

export const exhibit = pgTable(
  "exhibit",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    agendaItemId: uuid("agenda_item_id").notNull(),
    townId: uuid("town_id").notNull(),
    title: text().notNull(),
    fileStoragePath: text("file_storage_path").notNull(),
    fileType: text("file_type").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    fileSize: bigint("file_size", { mode: "number" }),
    exhibitType: text("exhibit_type"),
    uploadedBy: uuid("uploaded_by"),
    visibility: exhibitVisibility().default("public").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    fileName: text("file_name"),
  },
  (table) => [
    index("idx_exhibit_agenda_item_id").using("btree", table.agendaItemId.asc().nullsLast()),
    index("idx_exhibit_town_id").using("btree", table.townId.asc().nullsLast()),
    index("idx_exhibit_uploaded_by").using("btree", table.uploadedBy.asc().nullsLast()),
    foreignKey({
      columns: [table.agendaItemId],
      foreignColumns: [agendaItem.id],
      name: "exhibit_agenda_item_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "exhibit_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [userAccount.id],
      name: "exhibit_uploaded_by_fkey",
    }),
  ],
);

export const motion = pgTable(
  "motion",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    agendaItemId: uuid("agenda_item_id").notNull(),
    meetingId: uuid("meeting_id").notNull(),
    townId: uuid("town_id").notNull(),
    motionText: text("motion_text").notNull(),
    motionType: motionType("motion_type").default("main").notNull(),
    movedBy: uuid("moved_by"),
    secondedBy: uuid("seconded_by"),
    status: motionStatus().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    parentMotionId: uuid("parent_motion_id"),
    voteSummary: jsonb("vote_summary"),
  },
  (table) => [
    index("idx_motion_agenda_item_id").using("btree", table.agendaItemId.asc().nullsLast()),
    index("idx_motion_meeting_id").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_motion_moved_by").using("btree", table.movedBy.asc().nullsLast()),
    index("idx_motion_parent")
      .using("btree", table.parentMotionId.asc().nullsLast())
      .where(sql`(parent_motion_id IS NOT NULL)`),
    index("idx_motion_status").using(
      "btree",
      table.meetingId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("idx_motion_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.agendaItemId],
      foreignColumns: [agendaItem.id],
      name: "motion_agenda_item_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "motion_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "motion_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.movedBy],
      foreignColumns: [boardMember.id],
      name: "motion_moved_by_fkey",
    }),
    foreignKey({
      columns: [table.secondedBy],
      foreignColumns: [boardMember.id],
      name: "motion_seconded_by_fkey",
    }),
    foreignKey({
      columns: [table.parentMotionId],
      foreignColumns: [table.id],
      name: "motion_parent_motion_id_fkey",
    }),
  ],
);

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    eventId: uuid("event_id").notNull(),
    townId: uuid("town_id").notNull(),
    subscriberId: uuid("subscriber_id").notNull(),
    channel: notificationChannel().notNull(),
    status: notificationStatus().default("pending").notNull(),
    externalId: text("external_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
    postmarkMessageId: text("postmark_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }),
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_notification_delivery_event_id").using("btree", table.eventId.asc().nullsLast()),
    index("idx_notification_delivery_postmark")
      .using("btree", table.postmarkMessageId.asc().nullsLast())
      .where(sql`(postmark_message_id IS NOT NULL)`),
    index("idx_notification_delivery_retry")
      .using("btree", table.nextRetryAt.asc().nullsLast())
      .where(
        sql`((status = ANY (ARRAY['sent'::notification_status, 'failed'::notification_status])) AND (retry_count < 3) AND (next_retry_at IS NOT NULL))`,
      ),
    index("idx_notification_delivery_status")
      .using("btree", table.status.asc().nullsLast())
      .where(
        sql`(status = ANY (ARRAY['pending'::notification_status, 'processing'::notification_status]))`,
      ),
    index("idx_notification_delivery_subscriber").using(
      "btree",
      table.subscriberId.asc().nullsLast(),
    ),
    index("idx_notification_delivery_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [notificationEvent.id],
      name: "notification_delivery_event_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "notification_delivery_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.subscriberId],
      foreignColumns: [person.id],
      name: "notification_delivery_subscriber_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const guestSpeaker = pgTable(
  "guest_speaker",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    agendaItemId: uuid("agenda_item_id"),
    townId: uuid("town_id").notNull(),
    name: text().notNull(),
    address: text(),
    topic: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_guest_speaker_meeting").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_guest_speaker_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "guest_speaker_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.agendaItemId],
      foreignColumns: [agendaItem.id],
      name: "guest_speaker_agenda_item_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "guest_speaker_town_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const agendaItemTransition = pgTable(
  "agenda_item_transition",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    agendaItemId: uuid("agenda_item_id").notNull(),
    townId: uuid("town_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_agenda_item_transition_item").using("btree", table.agendaItemId.asc().nullsLast()),
    index("idx_agenda_item_transition_meeting").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_agenda_item_transition_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "agenda_item_transition_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.agendaItemId],
      foreignColumns: [agendaItem.id],
      name: "agenda_item_transition_agenda_item_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "agenda_item_transition_town_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const minutesDocument = pgTable(
  "minutes_document",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    townId: uuid("town_id").notNull(),
    status: minutesDocumentStatus().default("draft").notNull(),
    contentJson: jsonb("content_json").default({}).notNull(),
    htmlRendered: text("html_rendered"),
    pdfStoragePath: text("pdf_storage_path"),
    generatedBy: minutesGeneratedBy("generated_by").default("manual").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedByMotionId: uuid("approved_by_motion_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    boardId: uuid("board_id"),
    minutesStyle: text("minutes_style").default("summary").notNull(),
    submittedForReviewAt: timestamp("submitted_for_review_at", {
      withTimezone: true,
      mode: "string",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    createdBy: uuid("created_by"),
    originalContentJson: jsonb("original_content_json"),
    amendmentsHistory: jsonb("amendments_history").default([]),
    approvedAsAmended: boolean("approved_as_amended").default(false).notNull(),
    // TODO: failed to parse database type 'tsvector'
    searchVector: tsvector("search_vector"),
  },
  (table) => [
    index("idx_minutes_doc_meeting_id").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_minutes_doc_status").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("idx_minutes_doc_town_id").using("btree", table.townId.asc().nullsLast()),
    index("idx_minutes_document_board_id").using("btree", table.boardId.asc().nullsLast()),
    index("idx_minutes_document_search").using("gin", table.searchVector.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "minutes_document_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "minutes_document_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.approvedByMotionId],
      foreignColumns: [motion.id],
      name: "minutes_document_approved_by_motion_id_fkey",
    }),
    foreignKey({
      columns: [table.boardId],
      foreignColumns: [board.id],
      name: "minutes_document_board_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [userAccount.id],
      name: "minutes_document_created_by_fkey",
    }).onDelete("set null"),
    unique("minutes_document_meeting_id_key").on(table.meetingId),
  ],
);

export const executiveSession = pgTable(
  "executive_session",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    agendaItemId: uuid("agenda_item_id"),
    townId: uuid("town_id").notNull(),
    statutoryBasis: text("statutory_basis").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true, mode: "string" }),
    exitedAt: timestamp("exited_at", { withTimezone: true, mode: "string" }),
    entryMotionId: uuid("entry_motion_id"),
    postSessionActionMotionIds: jsonb("post_session_action_motion_ids").default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_executive_session_meeting").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_executive_session_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meeting.id],
      name: "executive_session_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.agendaItemId],
      foreignColumns: [agendaItem.id],
      name: "executive_session_agenda_item_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "executive_session_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.entryMotionId],
      foreignColumns: [motion.id],
      name: "executive_session_entry_motion_id_fkey",
    }).onDelete("set null"),
  ],
);

// HAND-APPLIED FIX, not `pull` output (Step 5 hand-review). The FK graph
// among `agendaItem`, `meeting`, `motion`, and `minutesDocument` forms one
// strongly connected component (each reachable from each), so TypeScript
// cannot infer any of their types without first knowing another's.
// `AnyPgColumn` was imported by `pull` for exactly this situation — it's
// Drizzle's own documented mechanism for circular/self-referencing tables
// — but never actually applied anywhere in the file (confirmed by tsc
// flagging it as the sole unused import). A minimum feedback-arc set for
// this cycle is the two edges below, both out-edges of `agendaItem`: wrap
// each forward reference in a thunk with an explicit `AnyPgColumn` return
// type, which defers inference instead of requiring it up front. Same
// runtime columns, FK names, and onDelete behavior as pull's output —
// only the *type-checking path* to them changes. Cutting just these two
// edges is sufficient to break the whole SCC; `meeting`'s own FK back to
// `agendaItem.id` (below) does not need to change.
const meetingIdRef = (): AnyPgColumn => meeting.id;
const minutesDocumentIdRef = (): AnyPgColumn => minutesDocument.id;

export const agendaItem = pgTable(
  "agenda_item",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").notNull(),
    townId: uuid("town_id").notNull(),
    sectionType: text("section_type").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    title: text().notNull(),
    description: text(),
    presenter: text(),
    estimatedDuration: integer("estimated_duration"),
    parentItemId: uuid("parent_item_id"),
    status: agendaItemStatus().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    staffResource: text("staff_resource"),
    background: text(),
    recommendation: text(),
    suggestedMotion: text("suggested_motion"),
    operatorNotes: text("operator_notes"),
    sourceMinutesDocumentId: uuid("source_minutes_document_id"),
    // TODO: failed to parse database type 'tsvector'
    searchVector: tsvector("search_vector"),
  },
  (table) => [
    index("idx_agenda_item_meeting_id").using("btree", table.meetingId.asc().nullsLast()),
    index("idx_agenda_item_parent").using("btree", table.parentItemId.asc().nullsLast()),
    index("idx_agenda_item_search").using("gin", table.searchVector.asc().nullsLast()),
    index("idx_agenda_item_sort").using(
      "btree",
      table.meetingId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast(),
    ),
    index("idx_agenda_item_source_minutes_doc")
      .using("btree", table.sourceMinutesDocumentId.asc().nullsLast())
      .where(sql`(source_minutes_document_id IS NOT NULL)`),
    index("idx_agenda_item_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.meetingId],
      foreignColumns: [meetingIdRef()],
      name: "agenda_item_meeting_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "agenda_item_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.parentItemId],
      foreignColumns: [table.id],
      name: "agenda_item_parent_item_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceMinutesDocumentId],
      foreignColumns: [minutesDocumentIdRef()],
      name: "agenda_item_source_minutes_document_id_fkey",
    }).onDelete("set null"),
  ],
);

export const futureItemQueue = pgTable(
  "future_item_queue",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    boardId: uuid("board_id").notNull(),
    townId: uuid("town_id").notNull(),
    sourceMeetingId: uuid("source_meeting_id"),
    sourceAgendaItemId: uuid("source_agenda_item_id"),
    title: text().notNull(),
    description: text(),
    source: text().notNull(),
    status: text().default("pending").notNull(),
    dismissedReason: text("dismissed_reason"),
    placedAgendaItemId: uuid("placed_agenda_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_future_item_queue_board").using("btree", table.boardId.asc().nullsLast()),
    index("idx_future_item_queue_source_meeting").using(
      "btree",
      table.sourceMeetingId.asc().nullsLast(),
    ),
    index("idx_future_item_queue_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.boardId],
      foreignColumns: [board.id],
      name: "future_item_queue_board_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "future_item_queue_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceMeetingId],
      foreignColumns: [meeting.id],
      name: "future_item_queue_source_meeting_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.sourceAgendaItemId],
      foreignColumns: [agendaItem.id],
      name: "future_item_queue_source_agenda_item_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.placedAgendaItemId],
      foreignColumns: [agendaItem.id],
      name: "future_item_queue_placed_agenda_item_id_fkey",
    }).onDelete("set null"),
  ],
);

export const board = pgTable(
  "board",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    townId: uuid("town_id").notNull(),
    name: text().notNull(),
    boardType: boardType("board_type").default("other").notNull(),
    memberCount: integer("member_count"),
    electionMethod: text("election_method"),
    officerElectionMethod: text("officer_election_method"),
    districtBased: boolean("district_based").default(false).notNull(),
    staggeredTerms: boolean("staggered_terms").default(false).notNull(),
    isGoverningBoard: boolean("is_governing_board").default(false).notNull(),
    meetingFormalityOverride: meetingFormality("meeting_formality_override"),
    minutesStyleOverride: minutesStyle("minutes_style_override"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
    seatTitles: jsonb("seat_titles").default([]),
    electedOrAppointed: text("elected_or_appointed").default("elected"),
    quorumType: text("quorum_type").default("majority"),
    quorumValue: integer("quorum_value"),
    motionDisplayFormat: text("motion_display_format").default("formal"),
    certificationFormat: text("certification_format").default("prepared_by").notNull(),
    memberReferenceStyle: text("member_reference_style").default("title_and_last_name").notNull(),
    noticeTemplateBlocks: jsonb("notice_template_blocks"),
    minutesConsentAgenda: boolean("minutes_consent_agenda").default(false).notNull(),
    minutesRequiresSecond: boolean("minutes_requires_second").default(true).notNull(),
    r4BoardMemberDefault: boolean("r4_board_member_default").default(true).notNull(),
    audioRetentionPolicyOverride: text("audio_retention_policy_override"),
    autoPublishOnApprovalOverride: boolean("auto_publish_on_approval_override"),
  },
  (table) => [
    index("idx_board_town_id").using("btree", table.townId.asc().nullsLast()),
    index("idx_board_type").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.boardType.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "board_town_id_fkey",
    }).onDelete("cascade"),
    unique("board_name_unique_per_town").on(table.townId, table.name),
    check(
      "board_audio_retention_policy_override_check",
      sql`audio_retention_policy_override = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text])`,
    ),
  ],
);

export const meeting = pgTable(
  "meeting",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    boardId: uuid("board_id").notNull(),
    townId: uuid("town_id").notNull(),
    title: text().notNull(),
    scheduledDate: date("scheduled_date").notNull(),
    scheduledTime: time("scheduled_time"),
    location: text(),
    status: meetingStatus().default("draft").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    meetingType: text("meeting_type").default("regular").notNull(),
    formalityOverride: text("formality_override"),
    agendaStatus: text("agenda_status").default("draft").notNull(),
    agendaPacketUrl: text("agenda_packet_url"),
    meetingNoticeUrl: text("meeting_notice_url"),
    agendaPacketGeneratedAt: timestamp("agenda_packet_generated_at", {
      withTimezone: true,
      mode: "string",
    }),
    meetingNoticeGeneratedAt: timestamp("meeting_notice_generated_at", {
      withTimezone: true,
      mode: "string",
    }),
    currentAgendaItemId: uuid("current_agenda_item_id"),
    presidingOfficerId: uuid("presiding_officer_id"),
    recordingSecretaryId: uuid("recording_secretary_id"),
    adjournment: jsonb(),
    noticeGeneratedAt: timestamp("notice_generated_at", { withTimezone: true, mode: "string" }),
    noticePdfStoragePath: text("notice_pdf_storage_path"),
    noticePublishedAt: timestamp("notice_published_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_meeting_board_id").using("btree", table.boardId.asc().nullsLast()),
    index("idx_meeting_created_by").using("btree", table.createdBy.asc().nullsLast()),
    index("idx_meeting_date").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.scheduledDate.asc().nullsLast(),
    ),
    index("idx_meeting_status").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("idx_meeting_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.boardId],
      foreignColumns: [board.id],
      name: "meeting_board_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "meeting_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [userAccount.id],
      name: "meeting_created_by_fkey",
    }),
    foreignKey({
      columns: [table.currentAgendaItemId],
      foreignColumns: [agendaItem.id],
      name: "meeting_current_agenda_item_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.presidingOfficerId],
      foreignColumns: [boardMember.id],
      name: "meeting_presiding_officer_id_fkey",
    }).onDelete("set null"),
  ],
);

export const town = pgTable(
  "town",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    state: text().default("ME").notNull(),
    municipalityType: municipalityType("municipality_type").default("town").notNull(),
    populationRange: text("population_range"),
    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    meetingFormality: meetingFormality("meeting_formality").default("semi_formal").notNull(),
    minutesStyle: minutesStyle("minutes_style").default("action").notNull(),
    presidingOfficerDefault: text("presiding_officer_default"),
    minutesRecorderDefault: text("minutes_recorder_default"),
    subdomain: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    staffRolesPresent: jsonb("staff_roles_present").default([]),
    sealUrl: text("seal_url"),
    retentionPolicyAcknowledgedAt: timestamp("retention_policy_acknowledged_at", {
      withTimezone: true,
      mode: "string",
    }),
    audioRetentionPolicy: text("audio_retention_policy").default("retain_30_days").notNull(),
    autoPublishOnApproval: boolean("auto_publish_on_approval").default(false).notNull(),
    minutesReviewWindowDays: integer("minutes_review_window_days").default(7).notNull(),
    minutesWorkflowConfiguredAt: timestamp("minutes_workflow_configured_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    unique("town_subdomain_key").on(table.subdomain),
    check(
      "town_audio_retention_policy_check",
      sql`audio_retention_policy = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text])`,
    ),
  ],
);

export const minutesAddendum = pgTable(
  "minutes_addendum",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    minutesDocumentId: uuid("minutes_document_id").notNull(),
    townId: uuid("town_id").notNull(),
    adoptingMeetingId: uuid("adopting_meeting_id").notNull(),
    adoptingMotionId: uuid("adopting_motion_id"),
    contentJson: jsonb("content_json").notNull(),
    htmlRendered: text("html_rendered"),
    description: text().notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_minutes_addendum_document").using(
      "btree",
      table.minutesDocumentId.asc().nullsLast(),
    ),
    index("idx_minutes_addendum_town").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.minutesDocumentId],
      foreignColumns: [minutesDocument.id],
      name: "minutes_addendum_minutes_document_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "minutes_addendum_town_id_fkey",
    }),
    foreignKey({
      columns: [table.adoptingMeetingId],
      foreignColumns: [meeting.id],
      name: "minutes_addendum_adopting_meeting_id_fkey",
    }),
    foreignKey({
      columns: [table.adoptingMotionId],
      foreignColumns: [motion.id],
      name: "minutes_addendum_adopting_motion_id_fkey",
    }),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [userAccount.id],
      name: "minutes_addendum_created_by_fkey",
    }),
  ],
);

export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userAccountId: uuid("user_account_id").notNull(),
    endpoint: text().notNull(),
    p256Dh: text("p256dh").notNull(),
    auth: text().notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_push_subscription_user").using("btree", table.userAccountId.asc().nullsLast()),
    foreignKey({
      columns: [table.userAccountId],
      foreignColumns: [userAccount.id],
      name: "push_subscription_user_account_id_fkey",
    }).onDelete("cascade"),
    unique("push_subscription_user_account_id_endpoint_key").on(
      table.userAccountId,
      table.endpoint,
    ),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    personId: uuid("person_id").notNull(),
    userAccountId: uuid("user_account_id"),
    townId: uuid("town_id").notNull(),
    token: text().notNull(),
    status: text().default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    email: text(),
    role: text(),
    invitedBy: uuid("invited_by"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_invitation_person_status").using(
      "btree",
      table.personId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("idx_invitation_token")
      .using("btree", table.token.asc().nullsLast())
      .where(sql`(status = 'pending'::text)`),
    foreignKey({
      columns: [table.personId],
      foreignColumns: [person.id],
      name: "invitation_person_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userAccountId],
      foreignColumns: [userAccount.id],
      name: "invitation_user_account_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "invitation_town_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [userAccount.id],
      name: "invitation_invited_by_fkey",
    }).onDelete("set null"),
    unique("invitation_token_key").on(table.token),
    check(
      "invitation_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'cancelled'::text])`,
    ),
  ],
);

export const userAccount = pgTable(
  "user_account",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    personId: uuid("person_id").notNull(),
    townId: uuid("town_id").notNull(),
    role: userRole().notNull(),
    govTitle: text("gov_title"),
    permissions: jsonb().default({ global: {}, board_overrides: [] }).notNull(),
    // `text`, not `uuid`: Better Auth generates its user ids in application
    // code as 32-character alphanumeric strings. Retyped by
    // drizzle/0001_better_auth_and_tenant_bridge.sql, which also adds the real
    // foreign key to better_auth."user"(id) ON DELETE SET NULL. The reference
    // is not declared here because that table lives in `auth/schema.ts` and
    // importing it would make this pulled schema depend on the auth layer.
    authUserId: text("auth_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
    notificationPreferences: jsonb("notification_preferences").default({}),
    email: text(),
    displayName: text("display_name"),
    emailBounced: boolean("email_bounced").default(false).notNull(),
    emailBouncedAt: timestamp("email_bounced_at", { withTimezone: true, mode: "string" }),
    emailComplained: boolean("email_complained").default(false).notNull(),
    emailComplainedAt: timestamp("email_complained_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_user_account_auth_user_id").using("btree", table.authUserId.asc().nullsLast()),
    index("idx_user_account_person_id").using("btree", table.personId.asc().nullsLast()),
    index("idx_user_account_role").using(
      "btree",
      table.townId.asc().nullsLast(),
      table.role.asc().nullsLast(),
    ),
    index("idx_user_account_town_id").using("btree", table.townId.asc().nullsLast()),
    foreignKey({
      columns: [table.personId],
      foreignColumns: [person.id],
      name: "user_account_person_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.townId],
      foreignColumns: [town.id],
      name: "user_account_town_id_fkey",
    }).onDelete("cascade"),
    unique("user_account_person_id_key").on(table.personId),
    unique("user_account_auth_user_id_key").on(table.authUserId),
  ],
);
