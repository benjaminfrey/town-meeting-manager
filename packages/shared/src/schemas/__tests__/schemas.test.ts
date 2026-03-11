import { describe, it, expect } from "vitest";
import { PersonSchema, UserAccountSchema, BoardMemberSchema } from "../person.schema.js";
import { BoardSchema } from "../board.schema.js";
import { MeetingSchema } from "../meeting.schema.js";
import { AgendaItemSchema } from "../agenda.schema.js";
import { MotionSchema } from "../motion.schema.js";

// ─── Helpers ────────────────────────────────────────────────────────

const UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const UUID2 = "b1ffcd00-ad1c-4f09-8c7e-7ccace491b22";
const NOW = "2026-03-10T14:30:00.000Z";
const TODAY = "2026-03-10";

// ─── PersonSchema ───────────────────────────────────────────────────

describe("PersonSchema", () => {
  const validPerson = {
    id: UUID,
    town_id: UUID2,
    name: "Jane Smith",
    email: "jane@newcastle.me.us",
    created_at: NOW,
    archived_at: null,
  };

  it("parses valid person data", () => {
    expect(PersonSchema.safeParse(validPerson).success).toBe(true);
  });

  it("rejects name shorter than 2 characters", () => {
    const result = PersonSchema.safeParse({ ...validPerson, name: "J" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = PersonSchema.safeParse({ ...validPerson, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects missing town_id", () => {
    const { town_id, ...noTown } = validPerson;
    const result = PersonSchema.safeParse(noTown);
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID id", () => {
    const result = PersonSchema.safeParse({ ...validPerson, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("allows null archived_at", () => {
    expect(PersonSchema.safeParse({ ...validPerson, archived_at: null }).success).toBe(true);
  });

  it("allows valid datetime for archived_at", () => {
    expect(PersonSchema.safeParse({ ...validPerson, archived_at: NOW }).success).toBe(true);
  });
});

// ─── UserAccountSchema ──────────────────────────────────────────────

describe("UserAccountSchema", () => {
  const validAccount = {
    id: UUID,
    person_id: UUID2,
    town_id: UUID,
    role: "admin",
    gov_title: null,
    permissions: {
      global: {},
      board_overrides: [],
    },
    auth_user_id: UUID,
    created_at: NOW,
    archived_at: null,
  };

  it("parses valid user account", () => {
    expect(UserAccountSchema.safeParse(validAccount).success).toBe(true);
  });

  it("accepts all valid roles", () => {
    for (const role of ["sys_admin", "admin", "staff", "board_member"]) {
      expect(UserAccountSchema.safeParse({ ...validAccount, role }).success).toBe(true);
    }
  });

  it("rejects invalid role 'superadmin'", () => {
    const result = UserAccountSchema.safeParse({ ...validAccount, role: "superadmin" });
    expect(result.success).toBe(false);
  });

  it("rejects missing person_id", () => {
    const { person_id, ...noPersonId } = validAccount;
    const result = UserAccountSchema.safeParse(noPersonId);
    expect(result.success).toBe(false);
  });

  it("accepts permissions with board_overrides", () => {
    const perms = {
      global: { create_meeting: true },
      board_overrides: [{ board_id: UUID, permissions: { edit_agenda: true } }],
    };
    expect(UserAccountSchema.safeParse({ ...validAccount, permissions: perms }).success).toBe(true);
  });

  it("accepts gov_title string", () => {
    expect(UserAccountSchema.safeParse({ ...validAccount, gov_title: "Town Clerk" }).success).toBe(true);
  });
});

// ─── BoardSchema ────────────────────────────────────────────────────

describe("BoardSchema", () => {
  const validBoard = {
    id: UUID,
    town_id: UUID2,
    name: "Select Board",
    board_type: "select_board",
    elected_or_appointed: "elected",
    member_count: 5,
    election_method: "at_large",
    officer_election_method: "vote_of_board",
    district_based: false,
    staggered_terms: false,
    is_governing_board: true,
    meeting_formality_override: null,
    minutes_style_override: null,
    quorum_type: null,
    quorum_value: null,
    motion_display_format: null,
    created_at: NOW,
    archived_at: null,
  };

  it("parses valid board data", () => {
    expect(BoardSchema.safeParse(validBoard).success).toBe(true);
  });

  it("rejects name shorter than 2 characters", () => {
    const result = BoardSchema.safeParse({ ...validBoard, name: "X" });
    expect(result.success).toBe(false);
  });

  it("rejects negative member_count", () => {
    const result = BoardSchema.safeParse({ ...validBoard, member_count: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects member_count over 25", () => {
    const result = BoardSchema.safeParse({ ...validBoard, member_count: 26 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid board_type", () => {
    const result = BoardSchema.safeParse({ ...validBoard, board_type: "invalid_type" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid board types", () => {
    const types = [
      "select_board", "planning_board", "zoning_board", "budget_committee",
      "conservation_commission", "parks_recreation", "harbor_committee",
      "shellfish_commission", "cemetery_committee", "road_committee",
      "comp_plan_committee", "broadband_committee", "other",
    ];
    for (const board_type of types) {
      expect(BoardSchema.safeParse({ ...validBoard, board_type }).success).toBe(true);
    }
  });

  it("accepts nullable formality override", () => {
    expect(BoardSchema.safeParse({ ...validBoard, meeting_formality_override: "formal" }).success).toBe(true);
  });
});

// ─── MeetingSchema ──────────────────────────────────────────────────

describe("MeetingSchema", () => {
  const validMeeting = {
    id: UUID,
    board_id: UUID2,
    town_id: UUID,
    title: "Regular Meeting",
    meeting_type: "regular",
    scheduled_date: TODAY,
    scheduled_time: "18:30",
    location: "Town Hall",
    status: "draft",
    agenda_status: "draft",
    formality_override: null,
    started_at: null,
    ended_at: null,
    created_by: UUID,
    created_at: NOW,
    updated_at: NOW,
  };

  it("parses valid meeting data", () => {
    expect(MeetingSchema.safeParse(validMeeting).success).toBe(true);
  });

  it("rejects missing board_id", () => {
    const { board_id, ...noBoard } = validMeeting;
    expect(MeetingSchema.safeParse(noBoard).success).toBe(false);
  });

  it("rejects invalid scheduled_time format", () => {
    const result = MeetingSchema.safeParse({ ...validMeeting, scheduled_time: "6:30 PM" });
    expect(result.success).toBe(false);
  });

  it("accepts valid HH:MM time format", () => {
    expect(MeetingSchema.safeParse({ ...validMeeting, scheduled_time: "09:00" }).success).toBe(true);
  });

  it("rejects invalid meeting_type", () => {
    const result = MeetingSchema.safeParse({ ...validMeeting, meeting_type: "workshop" });
    expect(result.success).toBe(false);
  });
});

// ─── AgendaItemSchema ───────────────────────────────────────────────

describe("AgendaItemSchema", () => {
  const validItem = {
    id: UUID,
    meeting_id: UUID2,
    town_id: UUID,
    section_type: "action",
    sort_order: 1,
    title: "Approve Minutes",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: null,
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: null,
    status: "pending",
    created_at: NOW,
    updated_at: NOW,
  };

  it("parses valid agenda item", () => {
    expect(AgendaItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = AgendaItemSchema.safeParse({ ...validItem, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects negative sort_order", () => {
    const result = AgendaItemSchema.safeParse({ ...validItem, sort_order: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts sort_order of 0", () => {
    expect(AgendaItemSchema.safeParse({ ...validItem, sort_order: 0 }).success).toBe(true);
  });
});

// ─── MotionSchema ───────────────────────────────────────────────────

describe("MotionSchema", () => {
  const validMotion = {
    id: UUID,
    agenda_item_id: UUID2,
    meeting_id: UUID,
    town_id: UUID,
    motion_text: "Motion to approve the minutes as written",
    motion_type: "main",
    moved_by: UUID2,
    seconded_by: null,
    status: "pending",
    created_at: NOW,
  };

  it("parses valid motion data", () => {
    expect(MotionSchema.safeParse(validMotion).success).toBe(true);
  });

  it("rejects empty motion_text", () => {
    const result = MotionSchema.safeParse({ ...validMotion, motion_text: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid motion_type", () => {
    const result = MotionSchema.safeParse({ ...validMotion, motion_type: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid motion types", () => {
    const types = ["main", "amendment", "substitute", "table", "untable", "postpone", "reconsider", "adjourn"];
    for (const motion_type of types) {
      expect(MotionSchema.safeParse({ ...validMotion, motion_type }).success).toBe(true);
    }
  });

  it("accepts seconded_by as UUID", () => {
    expect(MotionSchema.safeParse({ ...validMotion, seconded_by: UUID }).success).toBe(true);
  });
});
