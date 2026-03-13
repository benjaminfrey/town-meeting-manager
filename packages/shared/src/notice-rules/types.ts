import type { MeetingType } from "../constants/enums.js";

export type { MeetingType };

export interface NoticeRule {
  id: string;
  state: string;
  label: string;
  /** Meeting types this rule applies to */
  meetingTypes: MeetingType[];
  /** Optional action type sub-filter (e.g. 'zoning_ordinance', 'subdivision', 'budget') */
  actionTypes?: string[];
  /** Minimum notice in calendar days (use this OR minimumNoticeHours) */
  minimumNoticeDays?: number;
  /** Minimum notice in hours (use this OR minimumNoticeDays) */
  minimumNoticeHours?: number;
  /** Statutory citation, e.g. "1 M.R.S.A. §403" */
  statuteCitation: string;
  /** Human-readable description of the rule */
  description: string;
}

export type WarningLevel = "ok" | "warning" | "danger" | "overdue";

export interface ComplianceResult {
  rule: NoticeRule | null;
  /** Latest date/time by which notice must be posted */
  deadlineDate: Date | null;
  /** Days from now until the deadline (negative = overdue) */
  daysUntilDeadline: number | null;
  warningLevel: WarningLevel;
  /** Human-readable advisory message */
  advisoryMessage: string;
  /** The statute citation for the controlling rule */
  statuteCitation: string | null;
}

export interface ForecastResult {
  rule: NoticeRule | null;
  /** Earliest date the meeting can be held if notice is posted on fromDate */
  earliestMeetingDate: Date | null;
  /** Human-readable explanation */
  explanation: string;
}
