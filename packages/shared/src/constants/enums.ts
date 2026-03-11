// ─── User & Identity ───────────────────────────────────────────────

export const UserRole = {
  SYS_ADMIN: "sys_admin",
  ADMIN: "admin",
  STAFF: "staff",
  BOARD_MEMBER: "board_member",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const BoardMemberStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;
export type BoardMemberStatus =
  (typeof BoardMemberStatus)[keyof typeof BoardMemberStatus];

// ─── Town & Board ──────────────────────────────────────────────────

export const MunicipalityType = {
  TOWN: "town",
  CITY: "city",
  PLANTATION: "plantation",
} as const;
export type MunicipalityType =
  (typeof MunicipalityType)[keyof typeof MunicipalityType];

export const PopulationRange = {
  UNDER_1000: "under_1000",
  FROM_1000_TO_2500: "1000_to_2500",
  FROM_2500_TO_5000: "2500_to_5000",
  FROM_5000_TO_10000: "5000_to_10000",
  OVER_10000: "over_10000",
} as const;
export type PopulationRange =
  (typeof PopulationRange)[keyof typeof PopulationRange];

export const BoardType = {
  SELECT_BOARD: "select_board",
  PLANNING_BOARD: "planning_board",
  ZONING_BOARD: "zoning_board",
  BUDGET_COMMITTEE: "budget_committee",
  CONSERVATION_COMMISSION: "conservation_commission",
  PARKS_RECREATION: "parks_recreation",
  HARBOR_COMMITTEE: "harbor_committee",
  SHELLFISH_COMMISSION: "shellfish_commission",
  CEMETERY_COMMITTEE: "cemetery_committee",
  ROAD_COMMITTEE: "road_committee",
  COMP_PLAN_COMMITTEE: "comp_plan_committee",
  BROADBAND_COMMITTEE: "broadband_committee",
  OTHER: "other",
} as const;
export type BoardType = (typeof BoardType)[keyof typeof BoardType];

export const ElectionMethod = {
  AT_LARGE: "at_large",
  ROLE_TITLED: "role_titled",
} as const;
export type ElectionMethod =
  (typeof ElectionMethod)[keyof typeof ElectionMethod];

export const OfficerElectionMethod = {
  VOTE_OF_BOARD: "vote_of_board",
  HIGHEST_VOTE_GETTER: "highest_vote_getter",
  APPOINTED_BY_AUTHORITY: "appointed_by_authority",
  ROTATION: "rotation",
} as const;
export type OfficerElectionMethod =
  (typeof OfficerElectionMethod)[keyof typeof OfficerElectionMethod];

// ─── Meeting ───────────────────────────────────────────────────────

export const MeetingFormality = {
  INFORMAL: "informal",
  SEMI_FORMAL: "semi_formal",
  FORMAL: "formal",
} as const;
export type MeetingFormality =
  (typeof MeetingFormality)[keyof typeof MeetingFormality];

export const MeetingStatus = {
  DRAFT: "draft",
  NOTICED: "noticed",
  OPEN: "open",
  ADJOURNED: "adjourned",
  MINUTES_DRAFT: "minutes_draft",
  APPROVED: "approved",
  CANCELLED: "cancelled",
} as const;
export type MeetingStatus =
  (typeof MeetingStatus)[keyof typeof MeetingStatus];

export const MeetingType = {
  REGULAR: "regular",
  SPECIAL: "special",
  PUBLIC_HEARING: "public_hearing",
  EMERGENCY: "emergency",
} as const;
export type MeetingType = (typeof MeetingType)[keyof typeof MeetingType];

// ─── Agenda ────────────────────────────────────────────────────────

export const MinutesBehavior = {
  SKIP: "skip",
  TIMESTAMP_ONLY: "timestamp_only",
  ACTION_ONLY: "action_only",
  SUMMARIZE: "summarize",
  FULL_RECORD: "full_record",
} as const;
export type MinutesBehavior =
  (typeof MinutesBehavior)[keyof typeof MinutesBehavior];

export const AgendaItemSectionType = {
  CEREMONIAL: "ceremonial",
  PROCEDURAL: "procedural",
  MINUTES_APPROVAL: "minutes_approval",
  FINANCIAL: "financial",
  PUBLIC_INPUT: "public_input",
  REPORT: "report",
  ACTION: "action",
  DISCUSSION: "discussion",
  PUBLIC_HEARING: "public_hearing",
  EXECUTIVE_SESSION: "executive_session",
  OTHER: "other",
} as const;
export type AgendaItemSectionType =
  (typeof AgendaItemSectionType)[keyof typeof AgendaItemSectionType];

export const AgendaItemStatus = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  TABLED: "tabled",
  DEFERRED: "deferred",
} as const;
export type AgendaItemStatus =
  (typeof AgendaItemStatus)[keyof typeof AgendaItemStatus];

// ─── Motion & Vote ─────────────────────────────────────────────────

export const MotionType = {
  MAIN: "main",
  AMENDMENT: "amendment",
  SUBSTITUTE: "substitute",
  TABLE: "table",
  UNTABLE: "untable",
  POSTPONE: "postpone",
  RECONSIDER: "reconsider",
  ADJOURN: "adjourn",
} as const;
export type MotionType = (typeof MotionType)[keyof typeof MotionType];

export const MotionStatus = {
  PENDING: "pending",
  SECONDED: "seconded",
  IN_VOTE: "in_vote",
  PASSED: "passed",
  FAILED: "failed",
  TABLED: "tabled",
  WITHDRAWN: "withdrawn",
} as const;
export type MotionStatus =
  (typeof MotionStatus)[keyof typeof MotionStatus];

export const VoteType = {
  YES: "yes",
  NO: "no",
  ABSTAIN: "abstain",
  RECUSAL: "recusal",
  ABSENT: "absent",
} as const;
export type VoteType = (typeof VoteType)[keyof typeof VoteType];

// ─── Attendance ────────────────────────────────────────────────────

export const AttendanceStatus = {
  PRESENT: "present",
  ABSENT: "absent",
  REMOTE: "remote",
  EXCUSED: "excused",
  LATE_ARRIVAL: "late_arrival",
  EARLY_DEPARTURE: "early_departure",
} as const;
export type AttendanceStatus =
  (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

// ─── Minutes ───────────────────────────────────────────────────────

export const MinutesStyle = {
  ACTION: "action",
  SUMMARY: "summary",
  NARRATIVE: "narrative",
} as const;
export type MinutesStyle =
  (typeof MinutesStyle)[keyof typeof MinutesStyle];

export const MinutesDocumentStatus = {
  DRAFT: "draft",
  REVIEW: "review",
  APPROVED: "approved",
  PUBLISHED: "published",
} as const;
export type MinutesDocumentStatus =
  (typeof MinutesDocumentStatus)[keyof typeof MinutesDocumentStatus];

export const MinutesGeneratedBy = {
  MANUAL: "manual",
  AI: "ai",
  HYBRID: "hybrid",
} as const;
export type MinutesGeneratedBy =
  (typeof MinutesGeneratedBy)[keyof typeof MinutesGeneratedBy];

export const MinutesSectionType = {
  HEADER: "header",
  ATTENDANCE: "attendance",
  AGENDA_ITEM: "agenda_item",
  MOTION: "motion",
  PUBLIC_COMMENT: "public_comment",
  EXECUTIVE_SESSION: "executive_session",
  ADJOURNMENT: "adjournment",
  OTHER: "other",
} as const;
export type MinutesSectionType =
  (typeof MinutesSectionType)[keyof typeof MinutesSectionType];

// ─── Quorum ───────────────────────────────────────────────────────

export const QuorumType = {
  SIMPLE_MAJORITY: "simple_majority",
  TWO_THIRDS: "two_thirds",
  THREE_QUARTERS: "three_quarters",
  FIXED_NUMBER: "fixed_number",
} as const;
export type QuorumType = (typeof QuorumType)[keyof typeof QuorumType];

// ─── Motion Display ───────────────────────────────────────────────

export const MotionDisplayFormat = {
  BLOCK_FORMAT: "block_format",
  INLINE_NARRATIVE: "inline_narrative",
} as const;
export type MotionDisplayFormat =
  (typeof MotionDisplayFormat)[keyof typeof MotionDisplayFormat];

// ─── Agenda Status ────────────────────────────────────────────────

export const AgendaStatus = {
  DRAFT: "draft",
  PUBLISHED: "published",
} as const;
export type AgendaStatus = (typeof AgendaStatus)[keyof typeof AgendaStatus];

// ─── Exhibit ───────────────────────────────────────────────────────

export const ExhibitType = {
  STAFF_REPORT: "staff_report",
  PLAN: "plan",
  LEGAL_NOTICE: "legal_notice",
  APPLICATION: "application",
  CORRESPONDENCE: "correspondence",
  SUPPORTING_DOCUMENT: "supporting_document",
  OTHER: "other",
} as const;
export type ExhibitType = (typeof ExhibitType)[keyof typeof ExhibitType];

export const ExhibitVisibility = {
  PUBLIC: "public",
  BOARD_ONLY: "board_only",
  ADMIN_ONLY: "admin_only",
} as const;
export type ExhibitVisibility =
  (typeof ExhibitVisibility)[keyof typeof ExhibitVisibility];

// ─── Notification ──────────────────────────────────────────────────

export const NotificationChannel = {
  EMAIL: "email",
  SMS: "sms",
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationEventType = {
  MEETING_SCHEDULED: "meeting_scheduled",
  AGENDA_PUBLISHED: "agenda_published",
  MEETING_CANCELLED: "meeting_cancelled",
  MINUTES_APPROVED: "minutes_approved",
  MINUTES_PUBLISHED: "minutes_published",
  STRAW_POLL_CREATED: "straw_poll_created",
} as const;
export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];
