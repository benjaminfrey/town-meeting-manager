// @ts-nocheck -- test file: array index accesses are safe by construction
/**
 * Minutes Generation Pipeline Tests
 *
 * Tests for assembleMinutesJson() and formatMinutes() — the two core
 * functions that produce the canonical MinutesContentJson structure
 * and the formatted HTML output for rendering / PDF export.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleMinutesJson } from "../minutes-assembler.js";
import { formatMinutes } from "../minutes-formatters.js";
import type { MinutesContentJson, MinutesRenderOptions } from "@town-meeting/shared";

// ─── Mock Supabase builder ────────────────────────────────────────────

/**
 * Creates a chainable query builder that handles all PostgREST-style
 * method chaining patterns used in minutes-assembler.ts.
 *
 * When awaited directly  → returns { data: array, error: null }
 * When .single() called  → returns { data: firstItem|null, error: null }
 * When .maybeSingle()    → returns { data: firstItem|null, error: null }
 */
function makeBuilder(data: unknown | unknown[] | null) {
  const arr = Array.isArray(data) ? data : data !== null ? [data] : [];
  const single = arr[0] ?? null;

  const builder: Record<string, unknown> = {};
  builder["select"] = () => builder;
  builder["eq"] = () => builder;
  builder["order"] = () => builder;
  builder["in"] = () => builder;
  builder["not"] = () => builder;
  builder["single"] = () => Promise.resolve({ data: single, error: null });
  builder["maybeSingle"] = () => Promise.resolve({ data: single, error: null });
  builder["then"] = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: arr, error: null }).then(resolve, reject);
  return builder;
}

/**
 * Creates a mock SupabaseClient for testing assembleMinutesJson.
 */
function createMockSupabase(
  tables: Record<string, unknown | unknown[] | null>,
): SupabaseClient {
  return {
    from: (table: string) => {
      const data = table in tables ? tables[table] : [];
      return makeBuilder(data ?? []);
    },
  } as unknown as SupabaseClient;
}

// ─── Test data ────────────────────────────────────────────────────────

const MEETING_ID = "meeting-1";
const BOARD_ID = "board-1";
const TOWN_ID = "town-1";

const BM_ALICE = "bm-alice";
const BM_BOB = "bm-bob";
const BM_CAROL = "bm-carol";
const BM_DAVID = "bm-david";
const BM_EVE = "bm-eve";

const P_ALICE = "person-alice";
const P_BOB = "person-bob";
const P_CAROL = "person-carol";
const P_DAVID = "person-david";
const P_EVE = "person-eve";

const SEC_CALL = "section-call-to-order";
const SEC_PUBLIC = "section-public-comment";
const SEC_NEW_BIZ = "section-new-business";
const SEC_ADJ = "section-adjournment";

const ITEM_BUDGET = "item-budget";
const ITEM_CONTRACT = "item-contract";
const ITEM_POLICY = "item-policy";

const MOT_BUDGET = "motion-budget";
const MOT_CONTRACT = "motion-contract";
const MOT_POLICY = "motion-policy";

const baseMeeting = {
  id: MEETING_ID,
  board_id: BOARD_ID,
  town_id: TOWN_ID,
  title: "Regular Meeting",
  meeting_type: "regular",
  scheduled_date: "2026-03-13",
  location: "Town Hall, 1 Main St",
  started_at: "2026-03-13T19:00:00.000Z",
  ended_at: "2026-03-13T20:45:00.000Z",
  presiding_officer_id: BM_ALICE,
  recording_secretary_id: BM_DAVID,
  adjournment: {
    method: "without_objection",
    timestamp: "2026-03-13T20:45:00.000Z",
    adjourned_by: null,
    motion_id: null,
  },
};

const baseBoard = {
  id: BOARD_ID,
  name: "Select Board",
  board_type: "select_board",
  member_count: 5,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
  certification_format: "prepared_by",
  member_reference_style: "last_name_only",
  minutes_style_override: null,
  meeting_formality_override: null,
};

const baseTown = {
  id: TOWN_ID,
  name: "Testville",
  minutes_style: "summary",
  meeting_formality: "formal",
};

const boardMembers = [
  { id: BM_ALICE, person_id: P_ALICE, seat_title: "Chair", status: "active", is_default_rec_sec: false },
  { id: BM_BOB, person_id: P_BOB, seat_title: null, status: "active", is_default_rec_sec: false },
  { id: BM_CAROL, person_id: P_CAROL, seat_title: null, status: "active", is_default_rec_sec: false },
  { id: BM_DAVID, person_id: P_DAVID, seat_title: "Clerk", status: "active", is_default_rec_sec: true },
  { id: BM_EVE, person_id: P_EVE, seat_title: null, status: "active", is_default_rec_sec: false },
];

const persons = [
  { id: P_ALICE, name: "Alice Johnson" },
  { id: P_BOB, name: "Bob Smith" },
  { id: P_CAROL, name: "Carol Davis" },
  { id: P_DAVID, name: "David Wilson" },
  { id: P_EVE, name: "Eve Martinez" },
];

// 4 present, Eve absent
const attendance = [
  { id: "att-alice", board_member_id: BM_ALICE, person_id: P_ALICE, status: "present", is_recording_secretary: false, arrived_at: null, departed_at: null },
  { id: "att-bob", board_member_id: BM_BOB, person_id: P_BOB, status: "present", is_recording_secretary: false, arrived_at: null, departed_at: null },
  { id: "att-carol", board_member_id: BM_CAROL, person_id: P_CAROL, status: "present", is_recording_secretary: false, arrived_at: null, departed_at: null },
  { id: "att-david", board_member_id: BM_DAVID, person_id: P_DAVID, status: "present", is_recording_secretary: true, arrived_at: null, departed_at: null },
];

const sectionItems = [
  { id: SEC_CALL, meeting_id: MEETING_ID, section_type: "call_to_order", sort_order: 0, title: "Call to Order", description: null, presenter: null, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
  { id: SEC_PUBLIC, meeting_id: MEETING_ID, section_type: "public_input", sort_order: 1, title: "Public Comment", description: null, presenter: null, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
  { id: SEC_NEW_BIZ, meeting_id: MEETING_ID, section_type: "agenda_item", sort_order: 2, title: "New Business", description: null, presenter: null, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
  { id: SEC_ADJ, meeting_id: MEETING_ID, section_type: "adjournment", sort_order: 3, title: "Adjournment", description: null, presenter: null, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
];

const childItems = [
  { id: ITEM_BUDGET, meeting_id: MEETING_ID, section_type: "agenda_item", sort_order: 0, title: "FY2027 Budget Approval", description: "The board reviewed the proposed budget.", presenter: null, parent_item_id: SEC_NEW_BIZ, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
  { id: ITEM_CONTRACT, meeting_id: MEETING_ID, section_type: "agenda_item", sort_order: 1, title: "Contract Award — ABC Contractors", description: "Award paving contract.", presenter: null, parent_item_id: SEC_NEW_BIZ, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
  { id: ITEM_POLICY, meeting_id: MEETING_ID, section_type: "agenda_item", sort_order: 2, title: "Personnel Policy Amendment", description: "Proposed amendment to Section 4.", presenter: null, parent_item_id: SEC_NEW_BIZ, status: "completed", staff_resource: null, background: null, recommendation: null, operator_notes: null },
];

const agendaItems = [...sectionItems, ...childItems];

const motions = [
  { id: MOT_BUDGET, agenda_item_id: ITEM_BUDGET, meeting_id: MEETING_ID, motion_text: "Approve the FY2027 operating budget as presented.", motion_type: "main", moved_by: BM_ALICE, seconded_by: BM_BOB, status: "passed", parent_motion_id: null, created_at: "2026-03-13T19:30:00.000Z" },
  { id: MOT_CONTRACT, agenda_item_id: ITEM_CONTRACT, meeting_id: MEETING_ID, motion_text: "Award the paving contract to ABC Contractors for $485,000.", motion_type: "main", moved_by: BM_ALICE, seconded_by: BM_CAROL, status: "passed", parent_motion_id: null, created_at: "2026-03-13T19:50:00.000Z" },
  { id: MOT_POLICY, agenda_item_id: ITEM_POLICY, meeting_id: MEETING_ID, motion_text: "Amend the personnel policy Section 4 as proposed.", motion_type: "main", moved_by: BM_BOB, seconded_by: BM_CAROL, status: "failed", parent_motion_id: null, created_at: "2026-03-13T20:10:00.000Z" },
];

// Budget: 4 yeas, 0 nays → passed unanimously (no absent vote records)
// Contract: Bob recuses, 3 yeas → passed
// Policy: 1 yea, 3 nays → failed
const voteRecords = [
  { id: "vb-alice", motion_id: MOT_BUDGET, board_member_id: BM_ALICE, vote: "yea", recusal_reason: null },
  { id: "vb-bob", motion_id: MOT_BUDGET, board_member_id: BM_BOB, vote: "yea", recusal_reason: null },
  { id: "vb-carol", motion_id: MOT_BUDGET, board_member_id: BM_CAROL, vote: "yea", recusal_reason: null },
  { id: "vb-david", motion_id: MOT_BUDGET, board_member_id: BM_DAVID, vote: "yea", recusal_reason: null },

  { id: "vc-alice", motion_id: MOT_CONTRACT, board_member_id: BM_ALICE, vote: "yea", recusal_reason: null },
  { id: "vc-bob", motion_id: MOT_CONTRACT, board_member_id: BM_BOB, vote: "recusal", recusal_reason: "conflict of interest" },
  { id: "vc-carol", motion_id: MOT_CONTRACT, board_member_id: BM_CAROL, vote: "yea", recusal_reason: null },
  { id: "vc-david", motion_id: MOT_CONTRACT, board_member_id: BM_DAVID, vote: "yea", recusal_reason: null },

  { id: "vp-alice", motion_id: MOT_POLICY, board_member_id: BM_ALICE, vote: "nay", recusal_reason: null },
  { id: "vp-bob", motion_id: MOT_POLICY, board_member_id: BM_BOB, vote: "yea", recusal_reason: null },
  { id: "vp-carol", motion_id: MOT_POLICY, board_member_id: BM_CAROL, vote: "nay", recusal_reason: null },
  { id: "vp-david", motion_id: MOT_POLICY, board_member_id: BM_DAVID, vote: "nay", recusal_reason: null },
];

function buildFullMockSupabase() {
  return createMockSupabase({
    meeting: baseMeeting,
    board: baseBoard,
    town: baseTown,
    agenda_item: agendaItems,
    meeting_attendance: attendance,
    motion: motions,
    vote_record: voteRecords,
    executive_session: [],
    agenda_item_transition: [],
    guest_speaker: [],
    board_member: boardMembers,
    person: persons,
    agenda_template: null,
    exhibit: [],
  });
}

// ─── assembleMinutesJson Tests ────────────────────────────────────────

describe("assembleMinutesJson", () => {
  it("returns a valid MinutesContentJson for a completed meeting", async () => {
    const supabase = buildFullMockSupabase();
    const result = await assembleMinutesJson(supabase, MEETING_ID);

    expect(result).toMatchObject({
      meeting_header: expect.objectContaining({
        town_name: "Testville",
        board_name: "Select Board",
      }),
      attendance: expect.objectContaining({
        quorum: expect.objectContaining({ met: true }),
      }),
    });
    expect(result.sections).toHaveLength(4);
  });

  describe("meeting header", () => {
    it("populates all header fields from meeting/board/town records", async () => {
      const supabase = buildFullMockSupabase();
      const { meeting_header: h } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(h.town_name).toBe("Testville");
      expect(h.board_name).toBe("Select Board");
      expect(h.board_type).toBe("select_board");
      expect(h.meeting_date).toBe("2026-03-13");
      expect(h.meeting_type).toBe("regular");
      expect(h.location).toBe("Town Hall, 1 Main St");
      expect(h.called_to_order_at).toBe("2026-03-13T19:00:00.000Z");
      expect(h.adjourned_at).toBe("2026-03-13T20:45:00.000Z");
    });
  });

  describe("attendance", () => {
    it("places present members in members_present, absent in members_absent", async () => {
      const supabase = buildFullMockSupabase();
      const { attendance: att } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(att.members_present).toHaveLength(4);
      expect(att.members_absent).toHaveLength(1);

      const presentNames = att.members_present.map((m) => m.name);
      expect(presentNames).toContain("Alice Johnson");
      expect(presentNames).toContain("Bob Smith");
      expect(presentNames).not.toContain("Eve Martinez");

      expect(att.members_absent[0].name).toBe("Eve Martinez");
    });

    it("identifies presiding officer from meeting.presiding_officer_id", async () => {
      const supabase = buildFullMockSupabase();
      const { attendance: att } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(att.presiding_officer).toBe("Alice Johnson");
    });

    it("identifies recording secretary from attendance.is_recording_secretary", async () => {
      const supabase = buildFullMockSupabase();
      const { attendance: att } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(att.recording_secretary).toBe("David Wilson");
    });

    it("marks quorum met when majority is present (4 of 5)", async () => {
      const supabase = buildFullMockSupabase();
      const { attendance: att } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(att.quorum.met).toBe(true);
      expect(att.quorum.present_count).toBe(4);
      expect(att.quorum.total_members).toBe(5);
    });

    it("marks quorum not met when fewer than majority present", async () => {
      const supabase = createMockSupabase({
        meeting: baseMeeting,
        board: baseBoard,
        town: baseTown,
        agenda_item: sectionItems,
        // Only 2 of 5 present
        meeting_attendance: [
          { id: "att-alice", board_member_id: BM_ALICE, person_id: P_ALICE, status: "present", is_recording_secretary: false, arrived_at: null, departed_at: null },
          { id: "att-bob", board_member_id: BM_BOB, person_id: P_BOB, status: "present", is_recording_secretary: false, arrived_at: null, departed_at: null },
        ],
        motion: [],
        vote_record: [],
        executive_session: [],
        agenda_item_transition: [],
        guest_speaker: [],
        board_member: boardMembers,
        person: persons,
        agenda_template: null,
        exhibit: [],
      });

      const { attendance: att } = await assembleMinutesJson(supabase, MEETING_ID);
      expect(att.quorum.met).toBe(false);
      expect(att.quorum.present_count).toBe(2);
    });
  });

  describe("content sections", () => {
    it("produces one section per parent agenda item, in sort order", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      expect(result.sections[0].title).toBe("Call to Order");
      expect(result.sections[1].title).toBe("Public Comment");
      expect(result.sections[2].title).toBe("New Business");
      expect(result.sections[3].title).toBe("Adjournment");
    });

    it("nests child items inside their parent section", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      expect(newBiz.items).toHaveLength(3);

      const titles = newBiz.items.map((i) => i.title);
      expect(titles).toContain("FY2027 Budget Approval");
      expect(titles).toContain("Contract Award — ABC Contractors");
      expect(titles).toContain("Personnel Policy Amendment");
    });

    it("sets marked_none=true for completed sections with no children, motions, or speakers", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const publicSection = result.sections.find((s) => s.section_type === "public_input")!;
      expect(publicSection.marked_none).toBe(true);
    });

    it("sets marked_none=false for sections that have child items", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      expect(newBiz.marked_none).toBe(false);
    });
  });

  describe("motions and votes", () => {
    it("attaches motions to their content items with mover and seconder names", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      const budgetItem = newBiz.items.find((i) => i.title === "FY2027 Budget Approval")!;

      expect(budgetItem.motions).toHaveLength(1);
      expect(budgetItem.motions[0].text).toBe("Approve the FY2027 operating budget as presented.");
      expect(budgetItem.motions[0].moved_by).toBe("Alice Johnson");
      expect(budgetItem.motions[0].seconded_by).toBe("Bob Smith");
      expect(budgetItem.motions[0].status).toBe("passed");
    });

    it("tallies vote record rows into yeas/nays/abstentions/absent", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      const budgetItem = newBiz.items.find((i) => i.title === "FY2027 Budget Approval")!;
      const vote = budgetItem.motions[0].vote!;

      expect(vote.yeas).toBe(4);
      expect(vote.nays).toBe(0);
      expect(vote.abstentions).toBe(0);
      expect(vote.absent).toBe(0);
      expect(vote.result).toBe("passed");
      expect(vote.type).toBe("roll_call");
    });

    it("excludes recusal vote from yea/nay counts", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      const contractItem = newBiz.items.find((i) => i.title === "Contract Award — ABC Contractors")!;
      const vote = contractItem.motions[0].vote!;

      // Bob recused — only 3 valid votes counted
      expect(vote.yeas).toBe(3);
      expect(vote.nays).toBe(0);
      expect(vote.result).toBe("passed");
    });

    it("builds recusal records on the parent content item", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      const contractItem = newBiz.items.find((i) => i.title === "Contract Award — ABC Contractors")!;

      expect(contractItem.recusals).toHaveLength(1);
      expect(contractItem.recusals[0].member).toBe("Bob Smith");
      expect(contractItem.recusals[0].reason).toBe("conflict of interest");
    });

    it("records a failed motion with correct vote tallies", async () => {
      const supabase = buildFullMockSupabase();
      const result = await assembleMinutesJson(supabase, MEETING_ID);

      const newBiz = result.sections.find((s) => s.title === "New Business")!;
      const policyItem = newBiz.items.find((i: { title: string; motions: { vote: { yeas: number; nays: number; result: string } | null }[] }) => i.title === "Personnel Policy Amendment")!;
      const vote = policyItem.motions[0].vote!;

      expect(vote.yeas).toBe(1);
      expect(vote.nays).toBe(3);
      expect(vote.result).toBe("failed");
    });
  });

  describe("adjournment", () => {
    it("builds without_objection adjournment", async () => {
      const supabase = buildFullMockSupabase();
      const { adjournment } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(adjournment).not.toBeNull();
      expect(adjournment!.method).toBe("without_objection");
      expect(adjournment!.timestamp).toBe("2026-03-13T20:45:00.000Z");
    });

    it("returns null adjournment when meeting has no adjournment field", async () => {
      const supabase = createMockSupabase({
        meeting: { ...baseMeeting, adjournment: null },
        board: baseBoard,
        town: baseTown,
        agenda_item: sectionItems,
        meeting_attendance: attendance,
        motion: [],
        vote_record: [],
        executive_session: [],
        agenda_item_transition: [],
        guest_speaker: [],
        board_member: boardMembers,
        person: persons,
        agenda_template: null,
        exhibit: [],
      });

      const { adjournment } = await assembleMinutesJson(supabase, MEETING_ID);
      expect(adjournment).toBeNull();
    });
  });

  describe("certification", () => {
    it("sets recording secretary name for prepared_by format", async () => {
      const supabase = buildFullMockSupabase();
      const { certification } = await assembleMinutesJson(supabase, MEETING_ID);

      expect(certification.format).toBe("prepared_by");
      expect(certification.recording_secretary?.name).toBe("David Wilson");
    });
  });

  describe("error handling", () => {
    it("throws a descriptive error when meeting fetch fails", async () => {
      const errorBuilder = {
        select: () => errorBuilder,
        eq: () => errorBuilder,
        single: () => Promise.resolve({ data: null, error: { message: "Row not found" } }),
      };
      const supabase = { from: () => errorBuilder } as unknown as SupabaseClient;

      await expect(assembleMinutesJson(supabase, "bad-id")).rejects.toThrow(
        "Failed to fetch meeting",
      );
    });
  });
});

// ─── formatMinutes Tests ──────────────────────────────────────────────

const BASE_OPTIONS: MinutesRenderOptions = {
  minutes_style: "summary",
  motion_display_format: "inline_narrative",
  member_reference_style: "last_name_only",
  certification_format: "prepared_by",
  is_draft: true,
  town_seal_url: null,
};

/** Build a minimal MinutesContentJson for formatter tests */
function makeContent(overrides: Partial<MinutesContentJson> = {}): MinutesContentJson {
  return {
    meeting_header: {
      town_name: "Testville",
      board_name: "Select Board",
      board_type: "select_board",
      meeting_date: "2026-03-13",
      meeting_type: "regular",
      location: "Town Hall",
      called_to_order_at: "2026-03-13T19:00:00.000Z",
      adjourned_at: "2026-03-13T20:45:00.000Z",
    },
    attendance: {
      members_present: [
        { name: "Alice Johnson", seat_title: "Chair", status: "present", arrived_at: null, is_presiding_officer: true, is_recording_secretary: false },
        { name: "Bob Smith", seat_title: null, status: "present", arrived_at: null, is_presiding_officer: false, is_recording_secretary: false },
        { name: "Carol Davis", seat_title: null, status: "present", arrived_at: null, is_presiding_officer: false, is_recording_secretary: false },
        { name: "David Wilson", seat_title: "Clerk", status: "present", arrived_at: null, is_presiding_officer: false, is_recording_secretary: true },
      ],
      members_absent: [
        { name: "Eve Martinez", seat_title: null, status: "absent", arrived_at: null, is_presiding_officer: false, is_recording_secretary: false },
      ],
      staff_present: [],
      presiding_officer: "Alice Johnson",
      presiding_officer_succession: null,
      recording_secretary: "David Wilson",
      quorum: { met: true, present_count: 4, required_count: 3, total_members: 5 },
    },
    sections: [
      {
        title: "New Business",
        sort_order: 0,
        section_type: "agenda_item",
        minutes_behavior: "summarize",
        is_fixed: false,
        marked_none: false,
        executive_session: null,
        items: [
          {
            title: "FY2027 Budget",
            section_ref: "item-1",
            section_type: "agenda_item",
            minutes_behavior: "summarize",
            is_fixed: false,
            discussion_summary: "The board reviewed the proposed budget.",
            motions: [
              {
                text: "Approve the FY2027 operating budget as presented.",
                motion_type: "main",
                moved_by: "Alice Johnson",
                seconded_by: "Bob Smith",
                status: "passed",
                amendments: [],
                vote: {
                  type: "roll_call",
                  result: "passed",
                  yeas: 4,
                  nays: 0,
                  abstentions: 0,
                  absent: 0,
                  individual_votes: [],
                },
              },
            ],
            recusals: [],
            speakers: [],
            operator_notes: null,
            staff_resource: null,
            background: null,
            recommendation: null,
            timestamp_start: null,
            timestamp_end: null,
            status: "completed",
          },
        ],
      },
    ],
    adjournment: {
      method: "without_objection",
      adjourned_by: null,
      timestamp: "2026-03-13T20:45:00.000Z",
      motion: null,
    },
    certification: {
      format: "prepared_by",
      recording_secretary: { name: "David Wilson", title: "Clerk" },
      board_members: [],
    },
    ...overrides,
  };
}

describe("formatMinutes", () => {
  describe("vote result formatting", () => {
    it("returns 'Passed unanimously' when nays=0, abstentions=0, absent=0", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.sections[0].formatted_text).toContain("Passed unanimously");
    });

    it("returns 'Passed X-Y' when there are dissenting nays", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.motions[0]!.vote = {
        type: "roll_call", result: "passed", yeas: 3, nays: 2, abstentions: 0, absent: 0, individual_votes: [],
      };
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.sections[0].formatted_text).toContain("Passed 3-2");
    });

    it("returns 'Failed X-Y' for a failed motion", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.motions[0]!.vote = {
        type: "roll_call", result: "failed", yeas: 1, nays: 3, abstentions: 0, absent: 0, individual_votes: [],
      };
      content.sections[0]!.items[0]!.motions[0]!.status = "failed";
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.sections[0].formatted_text).toContain("Failed 1-3");
    });

    it("appends abstention count to vote result", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.motions[0]!.vote = {
        type: "roll_call", result: "passed", yeas: 3, nays: 1, abstentions: 1, absent: 0, individual_votes: [],
      };
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.sections[0].formatted_text).toContain("1 abstaining");
    });

    it("does NOT say 'unanimously' when absent > 0", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.motions[0]!.vote = {
        type: "roll_call", result: "passed", yeas: 4, nays: 0, abstentions: 0, absent: 1, individual_votes: [],
      };
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.sections[0].formatted_text).not.toContain("unanimously");
    });
  });

  describe("member reference styles", () => {
    it("last_name_only: uses only surname", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, member_reference_style: "last_name_only" });
      const text = formatted.sections[0].formatted_text;

      // "Johnson moved" pattern (not "Alice Johnson moved")
      expect(text).toMatch(/Johnson moved/);
      expect(text).toMatch(/Smith seconded/);
    });

    it("full_name_first_then_last: uses full name first mention, last name after", () => {
      const content = makeContent();
      // Add second motion with same mover to test subsequent-mention behavior
      content.sections[0]!.items[0]!.motions.push({
        text: "Approve the consent agenda.",
        motion_type: "main",
        moved_by: "Alice Johnson",
        seconded_by: "Bob Smith",
        status: "passed",
        amendments: [],
        vote: { type: "roll_call", result: "passed", yeas: 4, nays: 0, abstentions: 0, absent: 0, individual_votes: [] },
      });

      const formatted = formatMinutes(content, { ...BASE_OPTIONS, member_reference_style: "full_name_first_then_last" });
      const text = formatted.sections[0].formatted_text;

      // First mention is full name
      expect(text).toContain("Alice Johnson moved");
    });

    it("does not throw for any recognized style", () => {
      const styles: Array<MinutesRenderOptions["member_reference_style"]> = [
        "last_name_only",
        "title_and_last_name",
        "full_name_first_then_last",
      ];
      const content = makeContent();
      for (const style of styles) {
        expect(() => formatMinutes(content, { ...BASE_OPTIONS, member_reference_style: style })).not.toThrow();
      }
    });
  });

  describe("motion display formats", () => {
    it("inline_narrative: produces '[Mover] moved [text]. [Seconder] seconded. [Result].' pattern", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, motion_display_format: "inline_narrative" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toMatch(/Johnson moved Approve the FY2027/);
      expect(text).toMatch(/Smith seconded/);
    });

    it("block_format: produces div.motion-block HTML", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, motion_display_format: "block_format" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain('<div class="motion-block">');
      expect(text).toContain("Motion:</span>");
      expect(text).toContain("Moved by:</span>");
      expect(text).toContain("Second:</span>");
      expect(text).toContain("Vote:</span>");
      expect(text).toContain("Result:</span>");
    });

    it("block_format: vote line shows Yea/Nay counts", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, motion_display_format: "block_format" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("Yea: 4");
      expect(text).toContain("Nay: 0");
    });

    it("block_format: passed motion shows 'The motion carried.'", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, motion_display_format: "block_format" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("The motion carried.");
    });

    it("block_format: failed motion shows 'The motion failed.'", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.motions[0]!.status = "failed";
      content.sections[0]!.items[0]!.motions[0]!.vote = {
        type: "roll_call", result: "failed", yeas: 1, nays: 3, abstentions: 0, absent: 0, individual_votes: [],
      };
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, motion_display_format: "block_format" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("The motion failed.");
    });
  });

  describe("minutes styles", () => {
    it("action: includes motions but not discussion summary text", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, minutes_style: "action" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("moved");
      expect(text).not.toContain("The board reviewed the proposed budget.");
    });

    it("summary: includes discussion summary and motions", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, minutes_style: "summary" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("The board reviewed the proposed budget.");
      expect(text).toContain("moved");
    });

    it("summary: shows placeholder when no discussion summary is present", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.discussion_summary = null;
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, minutes_style: "summary" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("[Discussion summary to be added during review]");
    });

    it("narrative: shows 'Detailed discussion' placeholder when no summary", () => {
      const content = makeContent();
      content.sections[0]!.items[0]!.discussion_summary = null;
      const formatted = formatMinutes(content, { ...BASE_OPTIONS, minutes_style: "narrative" });
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("[Detailed discussion to be added during review]");
    });

    it("falls back to summary style for unknown style value", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, {
        ...BASE_OPTIONS,
        minutes_style: "unknown_style" as MinutesRenderOptions["minutes_style"],
      });
      // Should not throw, and should produce text similar to summary
      const text = formatted.sections[0].formatted_text;
      expect(text).toContain("moved");
    });
  });

  describe("section omit behavior", () => {
    it("sections with minutes_behavior='skip' have omit=true", () => {
      const content = makeContent({
        sections: [
          {
            title: "Internal Notes",
            sort_order: 0,
            section_type: "agenda_item",
            minutes_behavior: "skip",
            is_fixed: false,
            marked_none: false,
            executive_session: null,
            items: [
              {
                title: "Some note",
                section_ref: null,
                section_type: "agenda_item",
                minutes_behavior: "skip",
                is_fixed: false,
                discussion_summary: "Internal text",
                motions: [],
                recusals: [],
                speakers: [],
                operator_notes: null,
                staff_resource: null,
                background: null,
                recommendation: null,
                timestamp_start: null,
                timestamp_end: null,
                status: "completed",
              },
            ],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.sections[0].omit).toBe(true);
    });

    it("fixed empty sections show '<p>None.</p>' (not omitted)", () => {
      const content = makeContent({
        sections: [
          {
            title: "Public Comment",
            sort_order: 0,
            section_type: "public_input",
            minutes_behavior: "summarize",
            is_fixed: true,
            marked_none: true,
            executive_session: null,
            items: [],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.sections[0].omit).toBe(false);
      expect(formatted.sections[0].formatted_text).toBe("<p>None.</p>");
    });

    it("non-fixed sections with no items and marked_none=false are omitted", () => {
      const content = makeContent({
        sections: [
          {
            title: "Old Business",
            sort_order: 0,
            section_type: "agenda_item",
            minutes_behavior: "summarize",
            is_fixed: false,
            marked_none: false,
            executive_session: null,
            items: [],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.sections[0].omit).toBe(true);
    });
  });

  describe("speaker identification", () => {
    it("public_hearing speakers include name + address in output", () => {
      const content = makeContent({
        sections: [
          {
            title: "Public Hearing — 123 Main St",
            sort_order: 0,
            section_type: "public_hearing",
            minutes_behavior: "summarize",
            is_fixed: false,
            marked_none: false,
            executive_session: null,
            items: [
              {
                title: "Public Hearing",
                section_ref: null,
                section_type: "public_hearing",
                minutes_behavior: "summarize",
                is_fixed: false,
                discussion_summary: "Hearing opened.",
                motions: [],
                recusals: [],
                speakers: [
                  { name: "Jane Doe", address: "456 Elm St", topic: "zoning variance" },
                ],
                operator_notes: null,
                staff_resource: null,
                background: null,
                recommendation: null,
                timestamp_start: null,
                timestamp_end: null,
                status: "completed",
              },
            ],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("Jane Doe, 456 Elm St");
      expect(text).toContain("spoke regarding zoning variance");
    });

    it("public_input speakers use name (no address), anonymous becomes 'a member of the public'", () => {
      const content = makeContent({
        sections: [
          {
            title: "Public Comment",
            sort_order: 0,
            section_type: "public_input",
            minutes_behavior: "summarize",
            is_fixed: true,
            marked_none: false,
            executive_session: null,
            items: [
              {
                title: "Public Comment",
                section_ref: null,
                section_type: "public_input",
                minutes_behavior: "summarize",
                is_fixed: true,
                discussion_summary: null,
                motions: [],
                recusals: [],
                speakers: [
                  { name: "Mary Public", address: "789 Oak Ave", topic: "road conditions" },
                  { name: "", address: undefined, topic: "budget concerns" },
                ],
                operator_notes: null,
                staff_resource: null,
                background: null,
                recommendation: null,
                timestamp_start: null,
                timestamp_end: null,
                status: "completed",
              },
            ],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("Mary Public");
      // public_input does NOT include address
      expect(text).not.toContain("789 Oak Ave");
      // Anonymous speaker
      expect(text).toContain("a member of the public");
    });
  });

  describe("recusal formatting", () => {
    it("includes recusal notice in section output", () => {
      const content = makeContent({
        sections: [
          {
            title: "Contract Award",
            sort_order: 0,
            section_type: "agenda_item",
            minutes_behavior: "summarize",
            is_fixed: false,
            marked_none: false,
            executive_session: null,
            items: [
              {
                title: "Contract Award",
                section_ref: null,
                section_type: "agenda_item",
                minutes_behavior: "summarize",
                is_fixed: false,
                discussion_summary: "Contract discussed.",
                motions: [
                  {
                    text: "Award contract.",
                    motion_type: "main",
                    moved_by: "Alice Johnson",
                    seconded_by: "Carol Davis",
                    status: "passed",
                    amendments: [],
                    vote: { type: "roll_call", result: "passed", yeas: 3, nays: 0, abstentions: 0, absent: 0, individual_votes: [] },
                  },
                ],
                recusals: [{ member: "Bob Smith", reason: "conflict of interest" }],
                speakers: [],
                operator_notes: null,
                staff_resource: null,
                background: null,
                recommendation: null,
                timestamp_start: null,
                timestamp_end: null,
                status: "completed",
              },
            ],
          },
        ],
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);
      const text = formatted.sections[0].formatted_text;

      expect(text).toContain("Smith recused");
      expect(text).toContain("conflict of interest");
    });
  });

  describe("adjournment text", () => {
    it("without_objection: officer adjourned the meeting", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.adjournment_text).toMatch(/There being no objection/);
      expect(formatted.adjournment_text).toMatch(/Johnson adjourned the meeting/);
    });

    it("returns null when adjournment is null", () => {
      const content = makeContent({ adjournment: null });
      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.adjournment_text).toBeNull();
    });

    it("motion adjournment includes inline motion text", () => {
      const content = makeContent({
        adjournment: {
          method: "motion",
          adjourned_by: "Alice Johnson",
          timestamp: "2026-03-13T20:45:00.000Z",
          motion: {
            text: "Move to adjourn.",
            motion_type: "main",
            moved_by: "Bob Smith",
            seconded_by: "Carol Davis",
            status: "passed",
            amendments: [],
            vote: { type: "roll_call", result: "passed", yeas: 4, nays: 0, abstentions: 0, absent: 0, individual_votes: [] },
          },
        },
      });

      const formatted = formatMinutes(content, BASE_OPTIONS);

      expect(formatted.adjournment_text).toContain("Johnson declared the meeting adjourned");
      expect(formatted.adjournment_text).toContain("moved Move to adjourn");
    });
  });

  describe("pass-through fields", () => {
    it("meeting_header passes through unchanged", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.meeting_header).toEqual(content.meeting_header);
    });

    it("attendance passes through unchanged", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.attendance).toEqual(content.attendance);
    });

    it("certification passes through unchanged", () => {
      const content = makeContent();
      const formatted = formatMinutes(content, BASE_OPTIONS);
      expect(formatted.certification).toEqual(content.certification);
    });
  });
});
