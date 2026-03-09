/**
 * Government-specific formatting utilities for display strings.
 */

/**
 * Format a government title for display.
 * Returns the gov_title if provided, otherwise the role label.
 */
export function formatGovernmentTitle(
  govTitle: string | null,
  roleLabel: string,
): string {
  return govTitle?.trim() || roleLabel;
}

/**
 * Format a board member's display name with their seat title.
 * e.g., "Jane Smith (Chair)" or "Jane Smith"
 */
export function formatBoardMemberDisplay(
  name: string,
  seatTitle: string | null,
): string {
  if (seatTitle?.trim()) {
    return `${name} (${seatTitle.trim()})`;
  }
  return name;
}

/**
 * Format a meeting title with board name and date.
 * e.g., "Planning Board — Regular Meeting — Jan 15, 2025"
 */
export function formatMeetingTitle(
  boardName: string,
  meetingType: string,
  scheduledDate: string,
): string {
  const meetingTypeLabel = meetingType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const date = new Date(scheduledDate + "T00:00:00");
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${boardName} — ${meetingTypeLabel} — ${dateStr}`;
}

/**
 * Format a time string (HH:MM) for display.
 * e.g., "18:30" → "6:30 PM"
 */
export function formatMeetingTime(time: string): string {
  const parts = time.split(":");
  const hoursStr = parts[0] ?? "0";
  const minutesStr = parts[1] ?? "00";
  const hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${minutes} ${period}`;
}
