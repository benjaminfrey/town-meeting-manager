import { getRulesForState } from "./rules/index.js";
import type { MeetingType, NoticeRule, ComplianceResult, ForecastResult } from "./types.js";

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Returns the most restrictive (largest notice requirement) rule from a set. */
function getMostRestrictiveRule(rules: NoticeRule[]): NoticeRule | null {
  if (rules.length === 0) return null;
  return rules.reduce((most, rule) => {
    const mostDays =
      most.minimumNoticeDays ?? (most.minimumNoticeHours ?? 0) / 24;
    const ruleDays =
      rule.minimumNoticeDays ?? (rule.minimumNoticeHours ?? 0) / 24;
    return ruleDays > mostDays ? rule : most;
  });
}

function filterRules(
  rules: NoticeRule[],
  meetingType: MeetingType,
  actionTypes?: string[]
): NoticeRule[] {
  return rules.filter((rule) => {
    if (!rule.meetingTypes.includes(meetingType)) return false;
    if (rule.actionTypes && rule.actionTypes.length > 0) {
      if (!actionTypes || actionTypes.length === 0) return false;
      return rule.actionTypes.some((at) => actionTypes.includes(at));
    }
    return true;
  });
}

export function getNoticeDeadline(params: {
  meetingDate: Date;
  meetingTime?: string; // "HH:MM" 24h format, optional
  state: string;
  meetingType: MeetingType;
  actionTypes?: string[];
}): ComplianceResult {
  const { meetingDate, meetingTime, state, meetingType, actionTypes } = params;

  const allRules = getRulesForState(state);
  const applicable = filterRules(allRules, meetingType, actionTypes);
  const rule = getMostRestrictiveRule(applicable);

  if (!rule) {
    return {
      rule: null,
      deadlineDate: null,
      daysUntilDeadline: null,
      warningLevel: "ok",
      advisoryMessage: "No notice requirement found for this meeting type and state.",
      statuteCitation: null,
    };
  }

  // Build the full meeting datetime
  let meetingDateTime = new Date(meetingDate);
  if (meetingTime) {
    const parts = meetingTime.split(":").map(Number);
    meetingDateTime.setHours(parts[0] ?? 0, parts[1] ?? 0, 0, 0);
  } else {
    // Default to end of day if no time specified
    meetingDateTime.setHours(23, 59, 0, 0);
  }

  // Calculate deadline
  let deadlineDate: Date;
  if (rule.minimumNoticeHours !== undefined) {
    deadlineDate = addHours(meetingDateTime, -rule.minimumNoticeHours);
  } else {
    deadlineDate = addCalendarDays(meetingDateTime, -(rule.minimumNoticeDays ?? 0));
    deadlineDate.setHours(0, 0, 0, 0);
  }

  const now = new Date();
  const msUntilDeadline = deadlineDate.getTime() - now.getTime();
  const daysUntilDeadline = msUntilDeadline / (1000 * 60 * 60 * 24);

  let warningLevel: ComplianceResult["warningLevel"];
  if (msUntilDeadline < 0) {
    warningLevel = "overdue";
  } else if (daysUntilDeadline < 1) {
    warningLevel = "danger";
  } else if (daysUntilDeadline <= 3) {
    warningLevel = "warning";
  } else {
    warningLevel = "ok";
  }

  const deadlineStr = deadlineDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let advisoryMessage: string;
  if (warningLevel === "overdue") {
    advisoryMessage = `Notice deadline has passed (was ${deadlineStr}) per ${rule.statuteCitation}. This notice is now advisory — you may still post it.`;
  } else if (warningLevel === "danger") {
    const hoursLeft = Math.ceil(msUntilDeadline / (1000 * 60 * 60));
    advisoryMessage = `Notice must be posted within ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""} (by ${deadlineStr}) per ${rule.statuteCitation}.`;
  } else {
    const daysLeft = Math.ceil(daysUntilDeadline);
    advisoryMessage = `Notice must be posted by ${deadlineStr} (${daysLeft} day${daysLeft !== 1 ? "s" : ""} from now) per ${rule.statuteCitation}.`;
  }

  return {
    rule,
    deadlineDate,
    daysUntilDeadline: Math.round(daysUntilDeadline * 10) / 10,
    warningLevel,
    advisoryMessage,
    statuteCitation: rule.statuteCitation,
  };
}

export function forecastEarliestMeetingDate(params: {
  fromDate: Date;
  state: string;
  meetingType: MeetingType;
  actionTypes?: string[];
}): ForecastResult {
  const { fromDate, state, meetingType, actionTypes } = params;

  const allRules = getRulesForState(state);
  const applicable = filterRules(allRules, meetingType, actionTypes);
  const rule = getMostRestrictiveRule(applicable);

  if (!rule) {
    return {
      rule: null,
      earliestMeetingDate: null,
      explanation: "No notice requirement found for this meeting type and state.",
    };
  }

  let noticeDays: number;
  if (rule.minimumNoticeHours !== undefined) {
    noticeDays = Math.ceil(rule.minimumNoticeHours / 24);
  } else {
    noticeDays = rule.minimumNoticeDays ?? 0;
  }

  const earliestMeetingDate = addCalendarDays(fromDate, noticeDays);

  const fromStr = fromDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const earliestStr = earliestMeetingDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const noticeStr =
    rule.minimumNoticeHours !== undefined
      ? `${rule.minimumNoticeHours} hours`
      : `${noticeDays} calendar day${noticeDays !== 1 ? "s" : ""}`;

  const explanation =
    `${rule.label} requires ${noticeStr} notice per ${rule.statuteCitation}. ` +
    `If notice is posted today (${fromStr}), the earliest meeting date is ${earliestStr}.`;

  return {
    rule,
    earliestMeetingDate,
    explanation,
  };
}
