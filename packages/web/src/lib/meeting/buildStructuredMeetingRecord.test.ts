/**
 * Integration tests for buildStructuredMeetingRecord.
 *
 * This pure function assembles the structured JSON meeting record
 * that feeds into the AI minutes generation pipeline. Tests verify
 * correct assembly of meeting metadata, attendance, agenda sections,
 * motions with vote tallies, executive sessions, and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  buildStructuredMeetingRecord,
  type StructuredMeetingRecordInput,
} from "./buildStructuredMeetingRecord";

// ─── Test Fixtures ──────────────────────────────────────────────────

function baseMeeting(): StructuredMeetingRecordInput["meeting"] {
  return {
    id: "meeting-1",
    title: "Regular Meeting",
    scheduled_date: "2026-03-10",
    scheduled_time: "18:30",
    location: "Town Hall, Room 201",
    meeting_type: "regular",
    started_at: "2026-03-10T18:32:00Z",
    ended_at: "2026-03-10T20:15:00Z",
    adjournment: JSON.stringify({
      type: "motion",
      time: "2026-03-10T20:15:00Z",
    }),
  };
}

function baseBoard(): StructuredMeetingRecordInput["board"] {
  return {
    id: "board-1",
    name: "Planning Board",
    board_type: "appointed",
    motion_display_format: "formal",
  };
}

function baseTown(): StructuredMeetingRecordInput["town"] {
  return {
    name: "Testville",
    meeting_formality: "moderate",
    minutes_style: "action",
  };
}

function baseMembers(): StructuredMeetingRecordInput["members"] {
  return [
    { boardMemberId: "bm-1", personId: "p-1", name: "Alice Johnson", seatTitle: "Chair" },
    { boardMemberId: "bm-2", personId: "p-2", name: "Bob Smith", seatTitle: "Vice Chair" },
    { boardMemberId: "bm-3", personId: "p-3", name: "Carol Davis", seatTitle: null },
    { boardMemberId: "bm-4", personId: "p-4", name: "Dan Lee", seatTitle: null },
    { boardMemberId: "bm-5", personId: "p-5", name: "Eve Martinez", seatTitle: null },
  ];
}

function baseAttendance(): StructuredMeetingRecordInput["attendance"] {
  return [
    { board_member_id: "bm-1", person_id: "p-1", status: "present", arrived_at: "2026-03-10T18:30:00Z", departed_at: null, is_recording_secretary: 0 },
    { board_member_id: "bm-2", person_id: "p-2", status: "present", arrived_at: "2026-03-10T18:30:00Z", departed_at: null, is_recording_secretary: 0 },
    { board_member_id: "bm-3", person_id: "p-3", status: "present", arrived_at: "2026-03-10T18:31:00Z", departed_at: null, is_recording_secretary: 1 },
    { board_member_id: "bm-4", person_id: "p-4", status: "absent", arrived_at: null, departed_at: null, is_recording_secretary: 0 },
    { board_member_id: "bm-5", person_id: "p-5", status: "remote", arrived_at: "2026-03-10T18:30:00Z", departed_at: null, is_recording_secretary: 0 },
  ];
}

function baseAgendaItems(): StructuredMeetingRecordInput["agendaItems"] {
  return [
    // Parent sections
    { id: "ai-1", meeting_id: "meeting-1", section_type: "procedural", sort_order: 1, title: "Call to Order", description: null, presenter: null, estimated_duration: 5, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },
    { id: "ai-2", meeting_id: "meeting-1", section_type: "public_hearing", sort_order: 2, title: "Public Hearings", description: null, presenter: null, estimated_duration: 30, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },
    { id: "ai-3", meeting_id: "meeting-1", section_type: "action", sort_order: 3, title: "Action Items", description: null, presenter: null, estimated_duration: 45, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },
    { id: "ai-4", meeting_id: "meeting-1", section_type: "procedural", sort_order: 4, title: "Adjournment", description: null, presenter: null, estimated_duration: 2, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },

    // Children under Public Hearings
    { id: "ai-2a", meeting_id: "meeting-1", section_type: null, sort_order: 1, title: "Zoning Amendment - Elm St", description: "Proposed rezoning from R-1 to R-2", presenter: "Town Planner", estimated_duration: 20, parent_item_id: "ai-2", status: "completed", staff_resource: "Jane Doe, Town Planner", background: "Application received Feb 2026", recommendation: "Staff recommends approval", suggested_motion: "Move to approve the zoning amendment for Elm St", operator_notes: null },

    // Children under Action Items
    { id: "ai-3a", meeting_id: "meeting-1", section_type: null, sort_order: 1, title: "Approve February Minutes", description: null, presenter: null, estimated_duration: 5, parent_item_id: "ai-3", status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },
    { id: "ai-3b", meeting_id: "meeting-1", section_type: null, sort_order: 2, title: "Budget Review FY2027", description: "Annual budget proposal review", presenter: "Finance Director", estimated_duration: 30, parent_item_id: "ai-3", status: "completed", staff_resource: "Finance Director", background: "Draft budget submitted March 1", recommendation: null, suggested_motion: null, operator_notes: null },
  ];
}

function baseInput(overrides?: Partial<StructuredMeetingRecordInput>): StructuredMeetingRecordInput {
  return {
    meeting: baseMeeting(),
    board: baseBoard(),
    town: baseTown(),
    presidingOfficerName: "Alice Johnson",
    recordingSecretaryName: "Carol Davis",
    members: baseMembers(),
    attendance: baseAttendance(),
    agendaItems: baseAgendaItems(),
    motions: [],
    voteRecords: [],
    executiveSessions: [],
    transitions: [],
    exhibits: [],
    speakers: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("buildStructuredMeetingRecord", () => {
  it("outputs correct meeting metadata including board, town, date, and officers", () => {
    const result = buildStructuredMeetingRecord(baseInput());

    const meeting = result.meeting as Record<string, unknown>;
    expect(meeting.id).toBe("meeting-1");
    expect(meeting.title).toBe("Regular Meeting");
    expect(meeting.board).toBe("Planning Board");
    expect(meeting.board_type).toBe("appointed");
    expect(meeting.date).toBe("2026-03-10");
    expect(meeting.time).toBe("18:30");
    expect(meeting.location).toBe("Town Hall, Room 201");
    expect(meeting.type).toBe("regular");
    expect(meeting.started_at).toBe("2026-03-10T18:32:00Z");
    expect(meeting.ended_at).toBe("2026-03-10T20:15:00Z");
    expect(meeting.presiding_officer).toBe("Alice Johnson");
    expect(meeting.minutes_preparer).toBe("Carol Davis");

    const townProfile = result.town_profile as Record<string, unknown>;
    expect(townProfile.town_name).toBe("Testville");
    expect(townProfile.minutes_style).toBe("action");
    expect(townProfile.formality).toBe("moderate");
    expect(townProfile.motion_display_format).toBe("formal");
  });

  it("correctly categorizes attendance by member status", () => {
    const result = buildStructuredMeetingRecord(baseInput());

    const attendance = result.attendance as Record<string, unknown>;
    const members = attendance.members as Array<Record<string, unknown>>;

    expect(members).toHaveLength(5);

    // Alice - present
    const alice = members.find((m) => m.name === "Alice Johnson")!;
    expect(alice.status).toBe("present");
    expect(alice.seat_title).toBe("Chair");
    expect(alice.is_recording_secretary).toBe(false);

    // Carol - present and recording secretary
    const carol = members.find((m) => m.name === "Carol Davis")!;
    expect(carol.status).toBe("present");
    expect(carol.is_recording_secretary).toBe(true);

    // Dan - absent
    const dan = members.find((m) => m.name === "Dan Lee")!;
    expect(dan.status).toBe("absent");
    expect(dan.arrived_at).toBeNull();

    // Eve - remote
    const eve = members.find((m) => m.name === "Eve Martinez")!;
    expect(eve.status).toBe("remote");

    // Quorum: 3 present-type (present, present, remote) + 1 absent + 1 present
    const quorum = attendance.quorum_status as Record<string, unknown>;
    expect(quorum.present).toBe(4); // present + present + present + remote
    expect(quorum.total).toBe(5);
  });

  it("builds sections from parent items with nested children in sort order", () => {
    const input = baseInput({
      transitions: [
        { agenda_item_id: "ai-2a", started_at: "2026-03-10T18:35:00Z", ended_at: "2026-03-10T18:55:00Z" },
        { agenda_item_id: "ai-3a", started_at: "2026-03-10T18:55:00Z", ended_at: "2026-03-10T19:00:00Z" },
        { agenda_item_id: "ai-3b", started_at: "2026-03-10T19:00:00Z", ended_at: "2026-03-10T19:45:00Z" },
      ],
    });

    const result = buildStructuredMeetingRecord(input);
    const sections = result.sections as Array<Record<string, unknown>>;

    // 4 parent sections
    expect(sections).toHaveLength(4);
    expect(sections[0]!.title).toBe("Call to Order");
    expect(sections[0]!.section_type).toBe("procedural");
    expect(sections[1]!.title).toBe("Public Hearings");
    expect(sections[1]!.section_type).toBe("public_hearing");
    expect(sections[2]!.title).toBe("Action Items");
    expect(sections[2]!.section_type).toBe("action");
    expect(sections[3]!.title).toBe("Adjournment");

    // Public Hearings has 1 child
    const phItems = sections[1]!.items as Array<Record<string, unknown>>;
    expect(phItems).toHaveLength(1);
    expect(phItems[0]!.title).toBe("Zoning Amendment - Elm St");
    expect(phItems[0]!.staff_resource).toBe("Jane Doe, Town Planner");
    expect(phItems[0]!.background).toBe("Application received Feb 2026");
    expect(phItems[0]!.recommendation).toBe("Staff recommends approval");
    expect(phItems[0]!.timestamp_start).toBe("2026-03-10T18:35:00Z");
    expect(phItems[0]!.timestamp_end).toBe("2026-03-10T18:55:00Z");

    // Action Items has 2 children in sort order
    const actionItems = sections[2]!.items as Array<Record<string, unknown>>;
    expect(actionItems).toHaveLength(2);
    expect(actionItems[0]!.title).toBe("Approve February Minutes");
    expect(actionItems[1]!.title).toBe("Budget Review FY2027");

    // Section timestamp_start comes from first child transition
    expect(sections[1]!.timestamp_start).toBe("2026-03-10T18:35:00Z");
    expect(sections[2]!.timestamp_start).toBe("2026-03-10T18:55:00Z");
  });

  it("includes motions with vote tallies and individual votes resolved to member names", () => {
    const input = baseInput({
      motions: [
        {
          id: "mot-1",
          agenda_item_id: "ai-2a",
          motion_text: "Move to approve the zoning amendment for Elm St as presented",
          motion_type: "main",
          moved_by: "bm-2",
          seconded_by: "bm-5",
          status: "passed",
          parent_motion_id: null,
          vote_summary: JSON.stringify({ result: "passed", yeas: 3, nays: 1, abstentions: 0 }),
        },
        // Amendment to the main motion
        {
          id: "mot-2",
          agenda_item_id: "ai-2a",
          motion_text: "Amend to add condition requiring traffic study",
          motion_type: "amendment",
          moved_by: "bm-3",
          seconded_by: "bm-1",
          status: "passed",
          parent_motion_id: "mot-1",
          vote_summary: null,
        },
      ],
      voteRecords: [
        { id: "vr-1", motion_id: "mot-1", board_member_id: "bm-1", vote: "yea", recusal_reason: null },
        { id: "vr-2", motion_id: "mot-1", board_member_id: "bm-2", vote: "yea", recusal_reason: null },
        { id: "vr-3", motion_id: "mot-1", board_member_id: "bm-3", vote: "yea", recusal_reason: null },
        { id: "vr-4", motion_id: "mot-1", board_member_id: "bm-5", vote: "nay", recusal_reason: null },
      ],
    });

    const result = buildStructuredMeetingRecord(input);
    const sections = result.sections as Array<Record<string, unknown>>;
    const phSection = sections[1]!;
    const items = phSection.items as Array<Record<string, unknown>>;
    const zoningItem = items[0]!;

    // Single main motion rendered as object (not array)
    const motion = zoningItem.motion as Record<string, unknown>;
    expect(motion.text).toBe("Move to approve the zoning amendment for Elm St as presented");
    expect(motion.motion_type).toBe("main");
    expect(motion.moved_by).toBe("Bob Smith");
    expect(motion.seconded_by).toBe("Eve Martinez");
    expect(motion.status).toBe("passed");

    // Vote tallies
    const vote = motion.vote as Record<string, unknown>;
    expect(vote.type).toBe("roll_call");
    expect(vote.result).toBe("passed");
    expect(vote.yeas).toBe(3);
    expect(vote.nays).toBe(1);
    expect(vote.abstentions).toBe(0);

    // Individual votes resolved to names
    const individualVotes = vote.individual_votes as Array<Record<string, unknown>>;
    expect(individualVotes).toHaveLength(4);
    expect(individualVotes.find((v) => v.member === "Alice Johnson")!.vote).toBe("yea");
    expect(individualVotes.find((v) => v.member === "Eve Martinez")!.vote).toBe("nay");

    // Amendment is nested
    const amendments = motion.amendments as Array<Record<string, unknown>>;
    expect(amendments).toHaveLength(1);
    expect(amendments[0]!.text).toBe("Amend to add condition requiring traffic study");
    expect(amendments[0]!.moved_by).toBe("Carol Davis");
    expect(amendments[0]!.seconded_by).toBe("Alice Johnson");
  });

  it("includes executive session data with statutory basis and post-session actions", () => {
    const input = baseInput({
      agendaItems: [
        ...baseAgendaItems(),
        { id: "ai-exec", meeting_id: "meeting-1", section_type: "executive_session", sort_order: 3.5, title: "Executive Session - Personnel", description: null, presenter: null, estimated_duration: 15, parent_item_id: null, status: "completed", staff_resource: null, background: null, recommendation: null, suggested_motion: null, operator_notes: null },
      ],
      executiveSessions: [
        {
          id: "es-1",
          agenda_item_id: "ai-exec",
          statutory_basis: "1 M.R.S.A. Section 405(6)(A) - Personnel matters",
          entered_at: "2026-03-10T19:45:00Z",
          exited_at: "2026-03-10T20:00:00Z",
          entry_motion_id: "mot-entry",
          post_session_action_motion_ids: JSON.stringify(["mot-post-1"]),
        },
      ],
      motions: [
        {
          id: "mot-post-1",
          agenda_item_id: "ai-exec",
          motion_text: "Move to authorize the Town Manager to proceed with the personnel action as discussed",
          motion_type: "main",
          moved_by: "bm-1",
          seconded_by: "bm-2",
          status: "passed",
          parent_motion_id: null,
          vote_summary: JSON.stringify({ result: "passed", yeas: 4, nays: 0 }),
        },
      ],
      voteRecords: [
        { id: "vr-p1", motion_id: "mot-post-1", board_member_id: "bm-1", vote: "yea", recusal_reason: null },
        { id: "vr-p2", motion_id: "mot-post-1", board_member_id: "bm-2", vote: "yea", recusal_reason: null },
        { id: "vr-p3", motion_id: "mot-post-1", board_member_id: "bm-3", vote: "yea", recusal_reason: null },
        { id: "vr-p4", motion_id: "mot-post-1", board_member_id: "bm-5", vote: "yea", recusal_reason: null },
      ],
    });

    const result = buildStructuredMeetingRecord(input);
    const sections = result.sections as Array<Record<string, unknown>>;

    // Find the executive session section (sort_order 3.5 puts it between action items and adjournment)
    const execSection = sections.find((s) => s.title === "Executive Session - Personnel")!;
    expect(execSection).toBeDefined();
    expect(execSection.section_type).toBe("executive_session");

    const execData = execSection.executive_session as Record<string, unknown>;
    expect(execData).toBeDefined();
    expect(execData.entered_at).toBe("2026-03-10T19:45:00Z");
    expect(execData.returned_at).toBe("2026-03-10T20:00:00Z");
    expect(execData.statutory_basis).toBe("1 M.R.S.A. Section 405(6)(A) - Personnel matters");

    // Post-session actions
    const postActions = execData.post_session_actions as Array<Record<string, unknown>>;
    expect(postActions).toHaveLength(1);
    expect(postActions[0]!.text).toBe(
      "Move to authorize the Town Manager to proceed with the personnel action as discussed",
    );
    expect(postActions[0]!.moved_by).toBe("Alice Johnson");

    const postVote = postActions[0]!.vote as Record<string, unknown>;
    expect(postVote.result).toBe("passed");
    expect(postVote.yeas).toBe(4);
    expect(postVote.nays).toBe(0);
  });

  it("handles empty agenda gracefully with valid but empty structure", () => {
    const input = baseInput({
      agendaItems: [],
      motions: [],
      voteRecords: [],
      attendance: [],
      members: [],
      executiveSessions: [],
      transitions: [],
      exhibits: [],
      speakers: [],
      presidingOfficerName: null,
      recordingSecretaryName: null,
    });

    const result = buildStructuredMeetingRecord(input);

    // Meeting metadata still present
    const meeting = result.meeting as Record<string, unknown>;
    expect(meeting.id).toBe("meeting-1");
    expect(meeting.presiding_officer).toBeNull();
    expect(meeting.minutes_preparer).toBeNull();

    // Sections array exists but is empty
    const sections = result.sections as Array<Record<string, unknown>>;
    expect(sections).toEqual([]);

    // Attendance exists but empty
    const attendance = result.attendance as Record<string, unknown>;
    const attendanceMembers = attendance.members as Array<unknown>;
    expect(attendanceMembers).toEqual([]);

    const quorum = attendance.quorum_status as Record<string, unknown>;
    expect(quorum.present).toBe(0);
    expect(quorum.total).toBe(0);

    // Town profile still present
    const townProfile = result.town_profile as Record<string, unknown>;
    expect(townProfile.town_name).toBe("Testville");
  });

  it("includes exhibits and speakers for agenda items", () => {
    const input = baseInput({
      exhibits: [
        { id: "ex-1", agenda_item_id: "ai-2a", title: "Site Plan - Elm St Parcel", file_name: "elm-st-site-plan.pdf" },
        { id: "ex-2", agenda_item_id: "ai-2a", title: "Traffic Impact Study", file_name: "traffic-study-2026.pdf" },
        { id: "ex-3", agenda_item_id: "ai-3b", title: "FY2027 Budget Draft", file_name: "fy2027-budget.xlsx" },
      ],
      speakers: [
        { id: "sp-1", agenda_item_id: "ai-2a", name: "John Resident", topic: "Concerns about traffic on Elm St" },
        { id: "sp-2", agenda_item_id: "ai-2a", name: "Mary Abutter", topic: null },
      ],
    });

    const result = buildStructuredMeetingRecord(input);
    const sections = result.sections as Array<Record<string, unknown>>;

    // Public Hearings section -> Zoning item
    const phItems = sections[1]!.items as Array<Record<string, unknown>>;
    const zoningItem = phItems[0]!;

    const exhibits = zoningItem.exhibits as Array<Record<string, unknown>>;
    expect(exhibits).toHaveLength(2);
    expect(exhibits[0]!.title).toBe("Site Plan - Elm St Parcel");
    expect(exhibits[0]!.file_name).toBe("elm-st-site-plan.pdf");
    expect(exhibits[1]!.title).toBe("Traffic Impact Study");

    const speakers = zoningItem.speakers as Array<Record<string, unknown>>;
    expect(speakers).toHaveLength(2);
    expect(speakers[0]!.name).toBe("John Resident");
    expect(speakers[0]!.topic).toBe("Concerns about traffic on Elm St");
    expect(speakers[1]!.name).toBe("Mary Abutter");
    expect(speakers[1]!.topic).toBeNull();

    // Action Items -> Budget item has 1 exhibit
    const actionItems = sections[2]!.items as Array<Record<string, unknown>>;
    const budgetItem = actionItems[1]!;
    const budgetExhibits = budgetItem.exhibits as Array<Record<string, unknown>>;
    expect(budgetExhibits).toHaveLength(1);
    expect(budgetExhibits[0]!.title).toBe("FY2027 Budget Draft");
  });

  it("handles recusals by including them in the item output", () => {
    const input = baseInput({
      motions: [
        {
          id: "mot-r1",
          agenda_item_id: "ai-2a",
          motion_text: "Move to approve the zoning amendment",
          motion_type: "main",
          moved_by: "bm-2",
          seconded_by: "bm-3",
          status: "passed",
          parent_motion_id: null,
          vote_summary: JSON.stringify({ result: "passed", yeas: 2, nays: 0, abstentions: 0 }),
        },
      ],
      voteRecords: [
        { id: "vr-r1", motion_id: "mot-r1", board_member_id: "bm-1", vote: "recusal", recusal_reason: "Property abutter" },
        { id: "vr-r2", motion_id: "mot-r1", board_member_id: "bm-2", vote: "yea", recusal_reason: null },
        { id: "vr-r3", motion_id: "mot-r1", board_member_id: "bm-3", vote: "yea", recusal_reason: null },
      ],
    });

    const result = buildStructuredMeetingRecord(input);
    const sections = result.sections as Array<Record<string, unknown>>;
    const phItems = sections[1]!.items as Array<Record<string, unknown>>;
    const zoningItem = phItems[0]!;

    const recusals = zoningItem.recusals as Array<Record<string, unknown>>;
    expect(recusals).toHaveLength(1);
    expect(recusals[0]!.member).toBe("Alice Johnson");
    expect(recusals[0]!.reason).toBe("Property abutter");
  });

  it("renders adjournment data for procedural adjournment sections", () => {
    const result = buildStructuredMeetingRecord(baseInput());
    const sections = result.sections as Array<Record<string, unknown>>;

    const adjSection = sections.find((s) => s.title === "Adjournment")!;
    expect(adjSection).toBeDefined();
    expect(adjSection.section_type).toBe("procedural");

    const adjData = adjSection.adjournment as Record<string, unknown>;
    expect(adjData).toBeDefined();
    expect(adjData.type).toBe("motion");
    expect(adjData.time).toBe("2026-03-10T20:15:00Z");
  });
});
