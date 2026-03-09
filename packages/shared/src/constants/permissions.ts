// ─── 30 Governable Actions ─────────────────────────────────────────
// Organized by functional area per advisory 1.2

export const PERMISSIONS = {
  // Town & System Management (T1-T4: admin only, cannot be delegated)
  T1: "manage_town_settings",
  T2: "manage_user_accounts",
  T3: "manage_board_config",
  T4: "set_permissions",

  // Agenda & Meeting Prep (A1-A7)
  A1: "create_meeting",
  A2: "edit_agenda",
  A3: "upload_attachments_staff",
  A4: "upload_files_board_member",
  A5: "publish_agenda",
  A6: "generate_agenda_packet",
  A7: "submit_questions_comments",

  // Live Meeting Operations (M1-M8)
  M1: "start_run_meeting",
  M2: "record_attendance",
  M3: "capture_motions_votes",
  M4: "record_recusal",
  M5: "serve_recording_secretary",
  M6: "trigger_executive_session",
  M7: "manage_speaker_queue",
  M8: "vote_as_board_member",

  // Minutes & Records (R1-R6)
  R1: "edit_draft_minutes",
  R2: "generate_ai_minutes",
  R3: "submit_minutes_review",
  R4: "view_draft_minutes",
  R5: "publish_approved_minutes",
  R6: "export_minutes",

  // Civic Engagement (C1-C5)
  C1: "create_straw_polls",
  C2: "manage_notification_settings",
  C3: "manage_resident_accounts",
  C4: "moderate_public_comments",
  C5: "configure_public_portal",
} as const;

export type PermissionAction =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All 30 permission action values as an array */
export const ALL_PERMISSION_ACTIONS = Object.values(
  PERMISSIONS,
) as PermissionAction[];

/** Actions that are admin-only and cannot be delegated to staff */
export const ADMIN_ONLY_ACTIONS: PermissionAction[] = [
  PERMISSIONS.T1,
  PERMISSIONS.T2,
  PERMISSIONS.T3,
  PERMISSIONS.T4,
];

/** Actions that board members always have (not configurable) */
export const BOARD_MEMBER_ALWAYS_ACTIONS: PermissionAction[] = [
  PERMISSIONS.A4,
  PERMISSIONS.A7,
  PERMISSIONS.M8,
];

/** View & download actions — always allowed for authenticated users */
export const VIEW_ACTIONS = {
  V1: "view_agenda",
  V2: "download_agenda_pdf",
  V3: "view_approved_minutes",
  V4: "view_meeting_calendar",
  V5: "view_board_member_directory",
} as const;

export type ViewAction = (typeof VIEW_ACTIONS)[keyof typeof VIEW_ACTIONS];

// ─── Permissions Matrix Types ──────────────────────────────────────

export interface BoardPermissionOverride {
  board_id: string;
  permissions: Partial<Record<PermissionAction, boolean>>;
}

export interface PermissionsMatrix {
  global: Record<PermissionAction, boolean>;
  board_overrides: BoardPermissionOverride[];
}

// ─── Permission Template Types ─────────────────────────────────────

export interface PermissionTemplateDefinition {
  name: string;
  description: string;
  /** Whether this template applies to all boards or only designated ones */
  scope: "all_boards" | "designated_boards";
  /** The permission actions granted by this template */
  permissions: PermissionAction[];
}

// ─── 5 Default Permission Templates (from advisory 1.2) ───────────

/** Town Clerk: Full operational access, closest to admin without T1-T4 */
export const TEMPLATE_TOWN_CLERK: PermissionTemplateDefinition = {
  name: "Town Clerk",
  description:
    "Full operational access. Closest to admin without system governance (T1-T4).",
  scope: "all_boards",
  permissions: [
    // Agenda & Meeting Prep
    PERMISSIONS.A1,
    PERMISSIONS.A2,
    PERMISSIONS.A3,
    PERMISSIONS.A5,
    PERMISSIONS.A6,
    // Live Meeting Operations
    PERMISSIONS.M1,
    PERMISSIONS.M2,
    PERMISSIONS.M3,
    PERMISSIONS.M4,
    PERMISSIONS.M5,
    PERMISSIONS.M6,
    PERMISSIONS.M7,
    // Minutes & Records
    PERMISSIONS.R1,
    PERMISSIONS.R2,
    PERMISSIONS.R3,
    PERMISSIONS.R4,
    PERMISSIONS.R5,
    PERMISSIONS.R6,
    // Civic Engagement
    PERMISSIONS.C1,
    PERMISSIONS.C2,
    PERMISSIONS.C3,
    PERMISSIONS.C4,
    PERMISSIONS.C5,
  ],
};

/** Deputy Clerk: Minutes and records focused. Can run meetings but cannot publish or manage civic engagement. */
export const TEMPLATE_DEPUTY_CLERK: PermissionTemplateDefinition = {
  name: "Deputy Clerk",
  description:
    "Minutes and records focused. Can run meetings and take minutes but cannot publish or manage civic engagement.",
  scope: "all_boards",
  permissions: [
    PERMISSIONS.A2,
    PERMISSIONS.A3,
    PERMISSIONS.A6,
    PERMISSIONS.M1,
    PERMISSIONS.M2,
    PERMISSIONS.M3,
    PERMISSIONS.M4,
    PERMISSIONS.M5,
    PERMISSIONS.R1,
    PERMISSIONS.R2,
    PERMISSIONS.R3,
    PERMISSIONS.R4,
    PERMISSIONS.R6,
  ],
};

/** Board-Specific Staff: Full operational access but only for designated boards. */
export const TEMPLATE_BOARD_SPECIFIC_STAFF: PermissionTemplateDefinition = {
  name: "Board-Specific Staff",
  description:
    "Full operational access but only for designated boards (e.g., Town Planner, CEO).",
  scope: "designated_boards",
  permissions: [
    PERMISSIONS.A1,
    PERMISSIONS.A2,
    PERMISSIONS.A3,
    PERMISSIONS.A5,
    PERMISSIONS.A6,
    PERMISSIONS.M1,
    PERMISSIONS.M2,
    PERMISSIONS.M3,
    PERMISSIONS.M4,
    PERMISSIONS.M5,
    PERMISSIONS.M6,
    PERMISSIONS.M7,
    PERMISSIONS.R1,
    PERMISSIONS.R2,
    PERMISSIONS.R3,
    PERMISSIONS.R4,
    PERMISSIONS.R5,
    PERMISSIONS.R6,
  ],
};

/** General Staff: View-oriented. Can upload documents and view records but cannot run meetings. */
export const TEMPLATE_GENERAL_STAFF: PermissionTemplateDefinition = {
  name: "General Staff",
  description:
    "View-oriented. Can upload documents and view records but cannot run meetings or manage agendas.",
  scope: "all_boards",
  permissions: [PERMISSIONS.A3, PERMISSIONS.R4, PERMISSIONS.R6],
};

/** Recording Secretary Only: Dedicated recording secretary — meeting recording and minutes only. */
export const TEMPLATE_RECORDING_SECRETARY: PermissionTemplateDefinition = {
  name: "Recording Secretary Only",
  description:
    "For a dedicated recording secretary — only meeting recording and minutes capabilities.",
  scope: "designated_boards",
  permissions: [
    PERMISSIONS.M2,
    PERMISSIONS.M3,
    PERMISSIONS.M4,
    PERMISSIONS.M5,
    PERMISSIONS.R1,
    PERMISSIONS.R2,
    PERMISSIONS.R3,
    PERMISSIONS.R4,
    PERMISSIONS.R6,
  ],
};

/** All 5 default templates */
export const DEFAULT_PERMISSION_TEMPLATES: PermissionTemplateDefinition[] = [
  TEMPLATE_TOWN_CLERK,
  TEMPLATE_DEPUTY_CLERK,
  TEMPLATE_BOARD_SPECIFIC_STAFF,
  TEMPLATE_GENERAL_STAFF,
  TEMPLATE_RECORDING_SECRETARY,
];

// ─── Utility: Build a PermissionsMatrix from a template ────────────

/**
 * Creates a PermissionsMatrix with all actions set to false,
 * then enables the actions specified in the template.
 */
export function buildPermissionsFromTemplate(
  template: PermissionTemplateDefinition,
): Record<PermissionAction, boolean> {
  const matrix = {} as Record<PermissionAction, boolean>;
  for (const action of ALL_PERMISSION_ACTIONS) {
    matrix[action] = template.permissions.includes(action);
  }
  return matrix;
}
