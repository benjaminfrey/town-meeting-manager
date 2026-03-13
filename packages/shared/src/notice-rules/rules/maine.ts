/**
 * Maine meeting notice rules dataset.
 *
 * LEGAL REVIEW DISCLAIMER: This dataset is provided for informational and
 * advisory purposes only. It is not a substitute for legal advice. Rules are
 * based on publicly available Maine statutes as of 2025. Municipal clerks and
 * administrators should verify current statutory requirements and consult
 * legal counsel for official compliance determinations. Statutory requirements
 * may change; this dataset may not reflect the most current law.
 *
 * Sources: Maine Revised Statutes Annotated (M.R.S.A.)
 */

import type { NoticeRule } from "../types.js";

export const MAINE_RULES: NoticeRule[] = [
  {
    id: "ME_OPEN_MEETINGS_BOARD",
    state: "ME",
    label: "Board Meeting Notice",
    meetingTypes: ["regular", "special", "workshop", "emergency"],
    minimumNoticeHours: 24,
    statuteCitation: "1 M.R.S.A. §403",
    description:
      "All public proceedings of a governmental body require at least 24 hours advance notice posted in a conspicuous public place.",
  },
  {
    id: "ME_TOWN_MEETING_WARRANT",
    state: "ME",
    label: "Annual Town Meeting Warrant",
    meetingTypes: ["annual_town_meeting"],
    minimumNoticeDays: 14,
    statuteCitation: "30-A M.R.S.A. §2521",
    description:
      "Warrant for annual town meeting must be posted at least 14 calendar days before the meeting.",
  },
  {
    id: "ME_SPECIAL_TOWN_MEETING",
    state: "ME",
    label: "Special Town Meeting Warrant",
    meetingTypes: ["special_town_meeting"],
    minimumNoticeDays: 14,
    statuteCitation: "30-A M.R.S.A. §2521",
    description:
      "Warrant for special town meeting must be posted at least 14 calendar days before the meeting.",
  },
  {
    id: "ME_ZONING_ORDINANCE_HEARING",
    state: "ME",
    label: "Zoning Ordinance Public Hearing",
    meetingTypes: ["public_hearing"],
    actionTypes: ["zoning_ordinance"],
    minimumNoticeDays: 14,
    statuteCitation: "30-A M.R.S.A. §4352",
    description:
      "Public hearing on a proposed zoning ordinance or amendment must be advertised at least 14 days in advance.",
  },
  {
    id: "ME_SUBDIVISION_HEARING",
    state: "ME",
    label: "Subdivision Review Public Hearing",
    meetingTypes: ["public_hearing"],
    actionTypes: ["subdivision"],
    minimumNoticeDays: 14,
    statuteCitation: "30-A M.R.S.A. §4403",
    description:
      "Public hearing on a subdivision application must be noticed at least 14 calendar days in advance.",
  },
  {
    id: "ME_BUDGET_COMMITTEE",
    state: "ME",
    label: "Budget Committee Public Hearing",
    meetingTypes: ["public_hearing"],
    actionTypes: ["budget"],
    minimumNoticeDays: 10,
    statuteCitation: "30-A M.R.S.A. §2902",
    description:
      "Budget committee public hearing must be noticed at least 10 calendar days in advance.",
  },
];
