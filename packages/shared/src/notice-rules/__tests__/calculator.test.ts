import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getNoticeDeadline, forecastEarliestMeetingDate } from "../calculator.js";

// Helper: create a Date for N days from a reference date
function daysFrom(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

describe("getNoticeDeadline", () => {
  const NOW = new Date("2026-03-12T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("regular board meeting: 24-hour rule — ok when >3 days away", () => {
    const meetingDate = daysFrom(NOW, 10);
    const result = getNoticeDeadline({
      meetingDate,
      meetingTime: "18:00",
      state: "ME",
      meetingType: "regular",
    });
    expect(result.rule?.id).toBe("ME_OPEN_MEETINGS_BOARD");
    expect(result.warningLevel).toBe("ok");
    expect(result.deadlineDate).toBeTruthy();
    expect(result.statuteCitation).toBe("1 M.R.S.A. §403");
  });

  it("regular board meeting: 24-hour rule — warning when 2 days until deadline", () => {
    // Meeting is 3 days away, deadline is 24h before = 2 days from now
    const meetingDate = daysFrom(NOW, 3);
    const result = getNoticeDeadline({
      meetingDate,
      meetingTime: "18:00",
      state: "ME",
      meetingType: "regular",
    });
    expect(result.rule?.id).toBe("ME_OPEN_MEETINGS_BOARD");
    expect(result.warningLevel).toBe("warning");
  });

  it("regular board meeting: 24-hour rule — danger when <24 hours until deadline", () => {
    // Meeting is tomorrow at noon, deadline is in 0 hours (right now)
    const meetingDate = new Date("2026-03-13T13:00:00.000Z"); // 25h from now
    const result = getNoticeDeadline({
      meetingDate,
      meetingTime: "13:00",
      state: "ME",
      meetingType: "regular",
    });
    // Deadline is 13:00 today - now is 12:00 today = 1 hour until deadline
    expect(result.warningLevel).toBe("danger");
  });

  it("regular board meeting: 24-hour rule — overdue when deadline passed", () => {
    const meetingDate = new Date("2026-03-12T10:00:00.000Z"); // meeting was earlier today
    const result = getNoticeDeadline({
      meetingDate,
      meetingTime: "10:00",
      state: "ME",
      meetingType: "regular",
    });
    expect(result.warningLevel).toBe("overdue");
    expect(result.advisoryMessage).toMatch(/deadline has passed/i);
  });

  it("special town meeting: 14-day rule, ok", () => {
    const meetingDate = daysFrom(NOW, 20);
    const result = getNoticeDeadline({
      meetingDate,
      state: "ME",
      meetingType: "special_town_meeting",
    });
    expect(result.rule?.id).toBe("ME_SPECIAL_TOWN_MEETING");
    expect(result.minimumNoticeDays).toBeUndefined(); // check via rule
    expect(result.rule?.minimumNoticeDays).toBe(14);
    expect(result.warningLevel).toBe("ok");
    expect(result.statuteCitation).toBe("30-A M.R.S.A. §2521");
  });

  it("zoning ordinance hearing with actionType: 14-day rule", () => {
    const meetingDate = daysFrom(NOW, 20);
    const result = getNoticeDeadline({
      meetingDate,
      state: "ME",
      meetingType: "public_hearing",
      actionTypes: ["zoning_ordinance"],
    });
    expect(result.rule?.id).toBe("ME_ZONING_ORDINANCE_HEARING");
    expect(result.rule?.minimumNoticeDays).toBe(14);
    expect(result.statuteCitation).toBe("30-A M.R.S.A. §4352");
  });

  it("budget public hearing with actionType: 10-day rule", () => {
    const meetingDate = daysFrom(NOW, 15);
    const result = getNoticeDeadline({
      meetingDate,
      state: "ME",
      meetingType: "public_hearing",
      actionTypes: ["budget"],
    });
    expect(result.rule?.id).toBe("ME_BUDGET_COMMITTEE");
    expect(result.rule?.minimumNoticeDays).toBe(10);
  });

  it("overdue: 14-day rule deadline already passed", () => {
    const meetingDate = daysFrom(NOW, 10); // only 10 days away, needs 14
    const result = getNoticeDeadline({
      meetingDate,
      state: "ME",
      meetingType: "special_town_meeting",
    });
    expect(result.warningLevel).toBe("overdue");
    expect(result.advisoryMessage).toMatch(/deadline has passed/i);
  });

  it("returns no-rule result for unsupported state", () => {
    const meetingDate = daysFrom(NOW, 10);
    const result = getNoticeDeadline({
      meetingDate,
      state: "CA",
      meetingType: "regular",
    });
    expect(result.rule).toBeNull();
    expect(result.warningLevel).toBe("ok");
  });

  it("public hearing without matching actionType returns no rule", () => {
    const meetingDate = daysFrom(NOW, 20);
    const result = getNoticeDeadline({
      meetingDate,
      state: "ME",
      meetingType: "public_hearing",
      // no actionTypes — no general rule for public_hearing without actionType
    });
    expect(result.rule).toBeNull();
  });
});

describe("forecastEarliestMeetingDate", () => {
  it("special town meeting: earliest date is 14 days from today", () => {
    const today = new Date(2026, 2, 12); // March 12, 2026 local time
    const result = forecastEarliestMeetingDate({
      fromDate: today,
      state: "ME",
      meetingType: "special_town_meeting",
    });
    expect(result.rule?.id).toBe("ME_SPECIAL_TOWN_MEETING");
    expect(result.earliestMeetingDate).toBeTruthy();
    const expected = new Date(2026, 2, 26); // March 26, 2026 local time
    expect(result.earliestMeetingDate!.toDateString()).toBe(
      expected.toDateString()
    );
    expect(result.explanation).toMatch(/14 calendar days/i);
    expect(result.explanation).toMatch(/March 26/i);
  });

  it("zoning ordinance hearing: earliest date is 14 days from today", () => {
    const today = new Date(2026, 2, 12); // March 12, 2026 local time
    const result = forecastEarliestMeetingDate({
      fromDate: today,
      state: "ME",
      meetingType: "public_hearing",
      actionTypes: ["zoning_ordinance"],
    });
    expect(result.rule?.id).toBe("ME_ZONING_ORDINANCE_HEARING");
    const expected = new Date(2026, 2, 26); // March 26, 2026 local time
    expect(result.earliestMeetingDate!.toDateString()).toBe(
      expected.toDateString()
    );
    expect(result.explanation).toMatch(/30-A M.R.S.A. §4352/);
  });

  it("regular board meeting: earliest date is 1 day from today (24h rule)", () => {
    const today = new Date(2026, 2, 12); // March 12, 2026 local time
    const result = forecastEarliestMeetingDate({
      fromDate: today,
      state: "ME",
      meetingType: "regular",
    });
    expect(result.rule?.id).toBe("ME_OPEN_MEETINGS_BOARD");
    // 24 hours = ceiling 1 day
    const expected = new Date(2026, 2, 13); // March 13, 2026 local time
    expect(result.earliestMeetingDate!.toDateString()).toBe(
      expected.toDateString()
    );
  });

  it("returns null for unsupported state", () => {
    const result = forecastEarliestMeetingDate({
      fromDate: new Date(),
      state: "TX",
      meetingType: "regular",
    });
    expect(result.rule).toBeNull();
    expect(result.earliestMeetingDate).toBeNull();
  });
});
