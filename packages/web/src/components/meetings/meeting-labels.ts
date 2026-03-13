// ─── Meeting Status ──────────────────────────────────────────────────

export const MEETING_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  noticed: "Noticed",
  open: "Open",
  adjourned: "Adjourned",
  minutes_draft: "Minutes Draft",
  approved: "Approved",
  cancelled: "Cancelled",
};

export const MEETING_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  noticed: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  open: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  adjourned: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  minutes_draft: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

// ─── Meeting Type ────────────────────────────────────────────────────

export const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  special: "Special",
  annual_town_meeting: "Annual Town Meeting",
  special_town_meeting: "Special Town Meeting",
  public_hearing: "Public Hearing",
  workshop: "Workshop",
  emergency: "Emergency",
};

// ─── Agenda Status ───────────────────────────────────────────────────

export const AGENDA_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
};

export const AGENDA_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  published: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

// ─── Exhibit ─────────────────────────────────────────────────────────

export const EXHIBIT_TYPE_LABELS: Record<string, string> = {
  staff_report: "Staff Report",
  plan: "Plan",
  legal_notice: "Legal Notice",
  application: "Application",
  correspondence: "Correspondence",
  supporting_document: "Supporting Document",
  other: "Other",
};

export const EXHIBIT_VISIBILITY_LABELS: Record<string, string> = {
  public: "Public",
  board_only: "Board Only",
  admin_only: "Admin Only",
};
