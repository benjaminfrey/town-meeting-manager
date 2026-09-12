/**
 * The post-meeting review screen (`/meetings/:meetingId/review`) — fourteen
 * reads on tRPC, zero writes.
 *
 * Phase E, wave 6, Task 4. This file REPLACES
 * `routes/meetings.$meetingId.review.pathfilter.test.tsx`, which was a single
 * cache-key pin driving a wholesale `vi.mock("@tanstack/react-query")` that
 * routed on `queryKey[0]` — so every key it exercised was invented by the
 * test and matched nothing the app produces, the exact hole conventions item
 * 8 exists to close. Rewritten, not adapted (item 13): `@/lib/trpc` is left
 * alone and only `globalThis.fetch` is replaced, so the query keys are real,
 * the invalidation assertion means something, and every fixture below is
 * bound to its procedure's own output type.
 *
 * It also moves into `__tests__/`, matching every other route test in this
 * phase.
 *
 * What this file owns is the SCREEN: its fourteen reads, its three
 * distinguishable states, every section it renders, the export, and the one
 * write-shaped action it has (the Fastify minutes generate/regenerate call,
 * which is NOT tRPC and stays that way — see the route's own header).
 * `FutureItemsQueue` renders for real rather than being stubbed: the screen
 * now hands it the procedure's rows unchanged, and that seam is the whole of
 * what it owns about the component.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const { currentUser } = vi.hoisted(() => ({
  currentUser: {
    value: {
      id: "user-1",
      personId: "person-1",
      townId: "town-1",
      role: "admin" as string | null,
      permissions: null as unknown,
    },
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUser.value,
}));

const { apiJson } = vi.hoisted(() => ({
  apiJson: vi.fn().mockResolvedValue({ id: "md-1" }),
}));
vi.mock("@/lib/api-client", () => ({ apiJson, apiFetch: vi.fn() }));

/**
 * Only the DOWNLOAD half is stubbed. `buildStructuredMeetingRecord` itself
 * runs for real, because the export is the one place this screen's row
 * mapping is observable end to end — and it is where the
 * `is_recording_secretary` boolean lands.
 */
const { downloadMeetingRecord } = vi.hoisted(() => ({
  downloadMeetingRecord: vi.fn(),
}));
vi.mock("@/lib/meeting/buildStructuredMeetingRecord", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meeting/buildStructuredMeetingRecord")>(
    "@/lib/meeting/buildStructuredMeetingRecord",
  );
  return { ...actual, downloadMeetingRecord };
});

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...(actual as object), useNavigate: () => mockNavigate };
});

import PostMeetingReviewPage from "../meetings.$meetingId.review";

// ─── Harness ────────────────────────────────────────────────────────────

// Radix `Select` (the minutes-style picker in both generation dialogs) calls
// `hasPointerCapture`/`releasePointerCapture`/`scrollIntoView` on open and on
// selecting an option — none implemented in jsdom. File-scoped, matching
// `MemberTransitionDialog.test.tsx`'s own stubs for the same component.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const queryClient = setupAppQueryClient();

/**
 * `& { adjournment: unknown }`: `RouterOutputs` runs the row through tRPC's
 * serialization inference, which turns an `unknown` column into an OPTIONAL
 * property, while `TestHandlers` infers from `inferProcedureOutput` and still
 * requires it. The intersection restores the requirement, so a fixture that
 * forgets the column is a compile error. Same shape as the sibling minutes
 * and agenda tests.
 */
type MeetingDetail = RouterOutputs["meeting"]["detail"] & { adjournment: unknown };
type Motion = RouterOutputs["motion"]["byMeeting"][number] & { vote_summary: unknown };
type ExecSession = RouterOutputs["executiveSession"]["byMeeting"][number] & {
  post_session_action_motion_ids: unknown;
};

const meetingDetail: MeetingDetail = {
  id: "meeting-1",
  board_id: "board-1",
  title: "Regular Board Meeting",
  status: "adjourned",
  meeting_type: "regular",
  agenda_status: "published",
  scheduled_date: "2026-03-10",
  scheduled_time: "18:00",
  location: "Town Hall",
  presiding_officer_id: "bm-1",
  recording_secretary_id: "bm-2",
  current_agenda_item_id: null,
  started_at: "2026-03-10T18:00:00.000Z",
  ended_at: "2026-03-10T19:30:00.000Z",
  agenda_packet_url: null,
  agenda_packet_generated_at: null,
  meeting_notice_url: null,
  meeting_notice_generated_at: null,
  adjournment: { method: "motion", motion_id: "motion-2" },
};

const boardDetail = {
  id: "board-1",
  name: "Select Board",
  board_type: "other",
  elected_or_appointed: "elected",
  member_count: 3,
  election_method: "at_large",
  officer_election_method: "vote_of_board",
  is_governing_board: false,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "formal",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: true,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
} satisfies RouterOutputs["board"]["detail"] & { notice_template_blocks: unknown };

const townDetail = {
  id: "town-1",
  name: "Newcastle",
  state: "ME",
  municipality_type: "town",
  population_range: null,
  contact_name: null,
  contact_role: null,
  meeting_formality: "semi_formal",
  minutes_style: "action",
  presiding_officer_default: null,
  minutes_recorder_default: null,
  staff_roles_present: null,
  subdomain: null,
  seal_url: null,
  retention_policy_acknowledged_at: null,
  minutes_workflow_configured_at: null,
  audio_retention_policy: "retain_30_days",
  auto_publish_on_approval: false,
  minutes_review_window_days: 7,
} satisfies RouterOutputs["town"]["detail"];

/** One roster seat, with `person.name` already joined by the procedure. */
function seat(
  id: string,
  name: string,
  seatTitle: string | null,
): RouterOutputs["boardMember"]["roster"][number] {
  return {
    id,
    person_id: `person-${id}`,
    board_id: "board-1",
    seat_title: seatTitle,
    term_start: "2026-01-01",
    term_end: null,
    status: "active",
    is_default_rec_sec: false,
    name,
    email: null,
    user_account_id: null,
    role: null,
    gov_title: null,
    user_account_archived_at: null,
    invitation_id: null,
    invitation_token: null,
    invitation_status: null,
    invitation_sent_at: null,
    invitation_expires_at: null,
  };
}

const roster = [
  seat("bm-1", "Alice Chair", "Chair"),
  seat("bm-2", "Bob Clerk", "Clerk"),
  seat("bm-3", "Carol Member", null),
];

const attendance: RouterOutputs["meetingAttendance"]["byMeeting"] = [
  {
    id: "att-1",
    board_member_id: "bm-1",
    person_id: "person-bm-1",
    status: "present",
    is_recording_secretary: false,
    arrived_at: "2026-03-10T18:00:00.000Z",
    departed_at: null,
  },
  {
    id: "att-2",
    board_member_id: "bm-2",
    person_id: "person-bm-2",
    status: "present",
    is_recording_secretary: true,
    arrived_at: "2026-03-10T18:00:00.000Z",
    departed_at: null,
  },
  {
    id: "att-3",
    board_member_id: "bm-3",
    person_id: "person-bm-3",
    status: "absent",
    is_recording_secretary: false,
    arrived_at: null,
    departed_at: null,
  },
];

function item(
  id: string,
  title: string,
  overrides: Partial<RouterOutputs["agendaItem"]["byMeeting"][number]> = {},
): RouterOutputs["agendaItem"]["byMeeting"][number] {
  return {
    id,
    section_type: "business",
    sort_order: 0,
    title,
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: null,
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: null,
    status: "pending",
    operator_notes: null,
    source_minutes_document_id: null,
    ...overrides,
  };
}

const agendaItems = [
  item("sec-1", "New Business", { sort_order: 0 }),
  item("item-1", "Road Paving Contract", {
    sort_order: 1,
    parent_item_id: "sec-1",
    status: "completed",
  }),
  item("item-2", "Sidewalk Repair", {
    sort_order: 2,
    parent_item_id: "sec-1",
    status: "tabled",
  }),
  item("sec-2", "Adjournment", { sort_order: 3, section_type: "procedural" }),
];

const motions: Motion[] = [
  {
    id: "motion-1",
    agenda_item_id: "item-1",
    motion_text: "Move to award the paving contract",
    motion_type: "main",
    moved_by: "bm-1",
    seconded_by: "bm-3",
    status: "passed",
    parent_motion_id: null,
    vote_summary: { yeas: 2, nays: 1, abstentions: 0, result: "passed", passed: true },
    created_at: "2026-03-10T18:30:00.000Z",
  },
];

const voteRecords: RouterOutputs["voteRecord"]["byMeeting"] = [
  {
    id: "vr-1",
    motion_id: "motion-1",
    board_member_id: "bm-1",
    vote: "yea",
    recusal_reason: null,
    created_at: "2026-03-10T18:31:00.000Z",
  },
  {
    id: "vr-2",
    motion_id: "motion-1",
    board_member_id: "bm-3",
    vote: "recusal",
    recusal_reason: "Owns adjacent parcel",
    created_at: "2026-03-10T18:31:00.000Z",
  },
];

const execSessions: ExecSession[] = [
  {
    id: "es-1",
    agenda_item_id: "item-2",
    statutory_basis: "1 M.R.S.A. 405(6)(A)",
    entered_at: "2026-03-10T19:00:00.000Z",
    exited_at: "2026-03-10T19:20:00.000Z",
    entry_motion_id: null,
    post_session_action_motion_ids: [],
    created_at: "2026-03-10T19:00:00.000Z",
  },
];

const transitions: RouterOutputs["agendaItemTransition"]["byMeeting"] = [
  {
    id: "tr-1",
    agenda_item_id: "item-1",
    started_at: "2026-03-10T18:10:00.000Z",
    ended_at: "2026-03-10T18:25:00.000Z",
  },
];

const speakers: RouterOutputs["guestSpeaker"]["byMeeting"] = [
  {
    id: "gs-1",
    agenda_item_id: "item-1",
    name: "Dana Resident",
    address: null,
    topic: "Traffic",
    created_at: "2026-03-10T18:15:00.000Z",
  },
];

const exhibits: RouterOutputs["exhibit"]["byMeeting"] = [
  {
    id: "ex-1",
    agenda_item_id: "item-1",
    title: "Bid Tabulation",
    file_storage_path: "exhibits/ex-1.pdf",
    file_type: "application/pdf",
    file_name: "bids.pdf",
    exhibit_type: null,
    visibility: "public",
    sort_order: 0,
  },
];

const futureItems: RouterOutputs["futureItem"]["byMeeting"] = [
  {
    id: "fi-1",
    title: "Sidewalk Repair",
    description: "Carried over from March",
    source: "tabled",
    status: "pending",
  },
  {
    id: "fi-2",
    title: "Already placed",
    description: null,
    source: "deferred",
    status: "placed",
  },
];

const server = {
  meeting: meetingDetail as MeetingDetail,
  meetingRejects: null as "NOT_FOUND" | "INTERNAL_SERVER_ERROR" | null,
  roster,
  attendance,
  agendaItems,
  motions,
  voteRecords,
  execSessions,
  transitions,
  speakers,
  exhibits,
  futureItems,
  minutesDoc: null as RouterOutputs["minutesDocument"]["byMeeting"],
  generateFails: false,
};

const stub = installTRPCFetchStub({
  "meeting.detail": () => {
    if (server.meetingRejects) trpcTestError(server.meetingRejects);
    return server.meeting;
  },
  "board.detail": () => boardDetail,
  "town.detail": () => townDetail,
  "boardMember.roster": () => server.roster,
  "meetingAttendance.byMeeting": () => server.attendance,
  "agendaItem.byMeeting": () => server.agendaItems,
  "motion.byMeeting": () => server.motions,
  "voteRecord.byMeeting": () => server.voteRecords,
  "executiveSession.byMeeting": () => server.execSessions,
  "agendaItemTransition.byMeeting": () => server.transitions,
  "guestSpeaker.byMeeting": () => server.speakers,
  "exhibit.byMeeting": () => server.exhibits,
  "futureItem.byMeeting": () => server.futureItems,
  "minutesDocument.byMeeting": () => server.minutesDoc,
});

function renderRoute() {
  return renderWithProviders(
    <PostMeetingReviewPage
      {...({
        loaderData: { meetingId: "meeting-1" },
      } as Parameters<typeof PostMeetingReviewPage>[0])}
    />,
    { route: "/meetings/meeting-1/review", queryClient },
  );
}

/**
 * The `<table>` under the `<h2>` named `heading`.
 *
 * Scoped rather than global because the same member name legitimately
 * appears in more than one place — "Carol Member" is both an attendance row
 * and a recusal row, and a bare `getByRole("cell")` finds both.
 */
async function sectionTable(heading: string): Promise<HTMLElement> {
  const h = await screen.findByRole("heading", { name: heading });
  const table = h.parentElement?.querySelector("table");
  if (!table) throw new Error(`no table under ${heading}`);
  return table as HTMLElement;
}

/**
 * The row of the attendance table whose Member cell reads `name`.
 *
 * `findByRole`, not `getByRole`: the roster is gated on `enabled: !!boardId`
 * and therefore arrives on a second round trip, after the meeting.
 */
async function attendanceRow(name: string): Promise<HTMLElement> {
  const cell = await within(await sectionTable("Attendance")).findByRole("cell", { name });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  currentUser.value = {
    id: "user-1",
    personId: "person-1",
    townId: "town-1",
    role: "admin",
    permissions: null,
  };
  server.meeting = meetingDetail;
  server.meetingRejects = null;
  server.roster = roster;
  server.attendance = attendance;
  server.agendaItems = agendaItems;
  server.motions = motions;
  server.voteRecords = voteRecords;
  server.execSessions = execSessions;
  server.transitions = transitions;
  server.speakers = speakers;
  server.exhibits = exhibits;
  server.futureItems = futureItems;
  server.minutesDoc = null;
  server.generateFails = false;
  apiJson.mockReset();
  apiJson.mockResolvedValue({ id: "md-1" });
  downloadMeetingRecord.mockReset();
  mockNavigate.mockReset();
});

// ─── Reads, and the three states ────────────────────────────────────────

describe("PostMeetingReviewPage — the three states", () => {
  it("renders the meeting header from meeting.detail, board.detail and the roster", async () => {
    renderRoute();

    expect(await screen.findByText("Regular Board Meeting")).toBeInTheDocument();
    // `board.detail` and `boardMember.roster` are gated on `enabled:
    // !!boardId`, so they are a SECOND round trip — the board name and every
    // member name arrive after the meeting does.
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(screen.getByText("Town Hall")).toBeInTheDocument();
    // 18:00 → 19:30 is 90 minutes.
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    // Both officers are `board_member.id`s resolved through the roster. Read
    // off the header line specifically: the same two names are also
    // attendance rows.
    expect(screen.getByText("Presiding:").parentElement).toHaveTextContent("Alice Chair");
    expect(screen.getByText("Secretary:").parentElement).toHaveTextContent("Bob Clerk");
  });

  it("renders the adjournment badge from the adjournment JSONB's method", async () => {
    renderRoute();
    expect(await screen.findByText("Adjourned by motion")).toBeInTheDocument();
  });

  it("says 'without objection' for any other adjournment method", async () => {
    server.meeting = { ...meetingDetail, adjournment: { method: "unanimous_consent" } };
    renderRoute();
    expect(await screen.findByText("Adjourned without objection")).toBeInTheDocument();
  });

  it("renders no adjournment badge when the column is null", async () => {
    server.meeting = { ...meetingDetail, adjournment: null };
    renderRoute();
    await screen.findByText("Regular Board Meeting");
    expect(screen.queryByText(/^Adjourned/)).not.toBeInTheDocument();
  });

  it("shows a loading state until the meeting has answered", () => {
    renderRoute();
    expect(screen.getByText("Loading meeting data...")).toBeInTheDocument();
  });

  it("renders a role=alert when meeting.detail answers NOT_FOUND", async () => {
    server.meetingRejects = "NOT_FOUND";
    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This meeting could not be found.");
    expect(alert).toHaveTextContent("it belongs to another town");
  });

  it("renders a role=alert with generic copy for any other read failure", async () => {
    server.meetingRejects = "INTERNAL_SERVER_ERROR";
    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong loading this meeting.");
  });
});

describe("PostMeetingReviewPage — attendance", () => {
  it("lists every roster seat with its status, seat title and role", async () => {
    renderRoute();

    const alice = within(await attendanceRow("Alice Chair"));
    expect(alice.getByText("Chair")).toBeInTheDocument();
    expect(alice.getByText("Present")).toBeInTheDocument();
    expect(alice.getByText("Presiding Officer")).toBeInTheDocument();

    const carol = within(await attendanceRow("Carol Member"));
    expect(carol.getByText("Absent")).toBeInTheDocument();
    // No seat title and no officer role → TWO em dashes, not two empty cells.
    expect(carol.getAllByText("—")).toHaveLength(2);
  });

  it("reads is_recording_secretary as a boolean, not as 0/1", async () => {
    renderRoute();

    expect(
      within(await attendanceRow("Bob Clerk")).getByText("Recording Secretary"),
    ).toBeInTheDocument();
    expect(
      within(await attendanceRow("Alice Chair")).queryByText("Recording Secretary"),
    ).not.toBeInTheDocument();
  });
});

describe("PostMeetingReviewPage — agenda coverage", () => {
  it("groups child items under their section and numbers both", async () => {
    renderRoute();

    expect(await screen.findByText("1. New Business")).toBeInTheDocument();
    expect(screen.getByText("A. Road Paving Contract")).toBeInTheDocument();
    expect(screen.getByText("B. Sidewalk Repair")).toBeInTheDocument();
    expect(screen.getByText("2. Adjournment")).toBeInTheDocument();
    // A section with no children says so rather than rendering an empty list.
    expect(screen.getByText("No items in this section.")).toBeInTheDocument();
  });

  it("computes time spent from agendaItemTransition.byMeeting", async () => {
    renderRoute();
    // 18:10 → 18:25.
    expect(await screen.findByText("15m")).toBeInTheDocument();
  });
});

describe("PostMeetingReviewPage — motions and votes", () => {
  it("resolves moved_by and seconded_by through the roster, not through a *_name column", async () => {
    renderRoute();

    expect(await screen.findByText("Moved: Alice Chair")).toBeInTheDocument();
    expect(screen.getByText("Seconded: Carol Member")).toBeInTheDocument();
  });

  it("renders the tally from vote_summary and the motion's own status", async () => {
    renderRoute();

    expect(await screen.findByText("Yeas: 2, Nays: 1, Abstentions: 0")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
  });

  it("hides the result line when vote_summary carries no numeric tally", async () => {
    server.motions = [{ ...motions[0]!, vote_summary: { result: "passed" } }];
    renderRoute();

    await screen.findByText("Move to award the paving contract");
    expect(screen.queryByText(/Yeas:/)).not.toBeInTheDocument();
  });

  it("names each individual voter through the roster", async () => {
    renderRoute();

    expect(await screen.findByText("Alice Chair: yea")).toBeInTheDocument();
    expect(screen.getByText("Carol Member: recusal")).toBeInTheDocument();
  });

  it("says so when no motions were recorded", async () => {
    server.motions = [];
    renderRoute();

    expect(
      await screen.findByText("No motions were recorded during this meeting."),
    ).toBeInTheDocument();
  });
});

describe("PostMeetingReviewPage — executive sessions, recusals and the queue", () => {
  it("renders each executive session's citation and duration", async () => {
    renderRoute();

    expect(await screen.findByText("1 M.R.S.A. 405(6)(A)")).toBeInTheDocument();
    expect(screen.getByText("Duration: 20m")).toBeInTheDocument();
  });

  it("builds the recusal table from vote_record, its motion and that motion's item", async () => {
    renderRoute();

    // The member name comes from the roster's second round trip.
    const row = (
      await within(await sectionTable("Recusals")).findByRole("cell", { name: "Carol Member" })
    ).closest("tr")!;
    expect(within(row).getByText("Road Paving Contract")).toBeInTheDocument();
    expect(within(row).getByText("Owns adjacent parcel")).toBeInTheDocument();
  });

  it("hands futureItem.byMeeting's rows straight to FutureItemsQueue, which shows only pending ones", async () => {
    renderRoute();

    await screen.findByText("Future Items Queue");
    expect(screen.getByText("Carried over from March")).toBeInTheDocument();
    expect(screen.getByText("Tabled")).toBeInTheDocument();
    expect(screen.queryByText("Already placed")).not.toBeInTheDocument();
  });

  it("renders the queue's empty state when the meeting deferred nothing", async () => {
    server.futureItems = [];
    renderRoute();

    expect(await screen.findByText("No items queued for the next meeting.")).toBeInTheDocument();
  });
});

// ─── The minutes actions ────────────────────────────────────────────────

describe("PostMeetingReviewPage — minutes generation", () => {
  it("offers Generate when the meeting has no minutes document", async () => {
    renderRoute();

    expect(
      await screen.findByRole("button", { name: /generate minutes draft/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view minutes draft/i })).not.toBeInTheDocument();
  });

  it("offers View and Regenerate once a draft exists", async () => {
    server.minutesDoc = { id: "md-1", status: "draft" };
    renderRoute();

    expect(await screen.findByRole("button", { name: /view minutes draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /generate minutes draft/i }),
    ).not.toBeInTheDocument();
  });

  it("withholds Regenerate once the minutes are approved", async () => {
    server.minutesDoc = { id: "md-1", status: "approved" };
    renderRoute();

    await screen.findByRole("button", { name: /view minutes draft/i });
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  it("posts to the Fastify generate route, not to a tRPC procedure", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate minutes draft/i }));
    await user.click(await screen.findByRole("button", { name: /^generate draft$/i }));

    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    expect(apiJson).toHaveBeenCalledWith("/api/meetings/meeting-1/minutes/generate", {
      method: "POST",
      json: {},
    });
  });

  it("sends minutes_style_override only when the clerk picks a style other than the effective one", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate minutes draft/i }));
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /narrative minutes/i }));
    await user.click(screen.getByRole("button", { name: /^generate draft$/i }));

    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    expect(apiJson.mock.calls[0]?.[1]).toEqual({
      method: "POST",
      json: { minutes_style_override: "narrative" },
    });
  });

  it("invalidates trpc.minutesDocument.pathFilter() after generating a draft", async () => {
    // A key under the same router that this screen does NOT observe (the same
    // procedure for a different meeting), so `isInvalidated` survives the
    // refetch an observed key would trigger — conventions item 8.
    const otherKey = trpc.minutesDocument.byMeeting.queryOptions({
      meetingId: "other-meeting",
    }).queryKey;
    queryClient.setQueryData(otherKey, null);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();
    await user.click(await screen.findByRole("button", { name: /generate minutes draft/i }));
    await user.click(await screen.findByRole("button", { name: /^generate draft$/i }));

    await waitFor(() => expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(true));
  });

  it("renders a refusal inside the dialog that triggered it", async () => {
    apiJson.mockRejectedValueOnce(new Error("Minutes generation failed"));
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate minutes draft/i }));
    await user.click(await screen.findByRole("button", { name: /^generate draft$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Minutes generation failed");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(alert);
  });

  // Two refusal SITES for ONE write: `generateError` is one piece of state
  // rendered inside BOTH generation dialogs, and only one of them is open at
  // a time. A single test on the generate dialog leaves the regenerate
  // dialog's `role="alert"` unpinned — and branch coverage cannot tell you
  // so, because React evaluates a closed Radix dialog's children eagerly, so
  // the `generateError &&` branch reads as HIT without ever rendering.
  it("renders a regenerate refusal inside the regenerate dialog, and only there", async () => {
    server.minutesDoc = { id: "md-1", status: "draft" };
    apiJson.mockRejectedValueOnce(new Error("Regeneration failed"));
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /regenerate/i }));
    await user.click(await screen.findByRole("button", { name: /overwrite & regenerate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Regeneration failed");
    expect(screen.getByRole("dialog")).toContainElement(alert);
    // Counted off the DOM, not through the accessibility tree: a duplicate
    // rendered behind the open dialog would be `aria-hidden` and invisible to
    // `getAllByRole`.
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  // Fix round 2, REQUIRED: `generateError` is shared by both dialogs, and
  // until now it was cleared only by each dialog's own Cancel button — not
  // by Radix's own close paths (Escape, outside click), and not on open. A
  // clerk refused on Generate who dismisses that way, then opens Regenerate
  // once a minutes document exists (e.g. someone else's realtime write),
  // would see the GENERATE refusal rendered inside the REGENERATE dialog:
  // accurate for a different action, which reads as a refusal of the one
  // they are currently attempting. Same shape Task 3 fixed on
  // `minutes.tsx`'s `actionError`; fixed here the same way — each dialog's
  // own open transition clears `generateError` first.
  it("clears a stale Generate refusal when Regenerate is opened without Cancel", async () => {
    apiJson.mockRejectedValueOnce(new Error("Minutes generation failed"));
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate minutes draft/i }));
    await user.click(await screen.findByRole("button", { name: /^generate draft$/i }));
    await screen.findByRole("alert");

    // Dismissed via Escape, not Cancel — the one path that used to leave
    // `generateError` standing.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A minutes document now exists, so the action bar swaps Generate for
    // Regenerate — set directly on the cache, the same way the pathFilter
    // test above controls it, rather than round-tripping another `apiJson`
    // call.
    queryClient.setQueryData(
      trpc.minutesDocument.byMeeting.queryOptions({ meetingId: "meeting-1" }).queryKey,
      { id: "md-1", status: "draft" },
    );

    await user.click(await screen.findByRole("button", { name: /regenerate/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("posts to the regenerate route from the regenerate dialog", async () => {
    server.minutesDoc = { id: "md-1", status: "draft" };
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /regenerate/i }));
    await user.click(await screen.findByRole("button", { name: /overwrite & regenerate/i }));

    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    expect(apiJson.mock.calls[0]?.[0]).toBe("/api/meetings/meeting-1/minutes/regenerate");
  });
});

describe("PostMeetingReviewPage — who may generate minutes", () => {
  it("hides Generate from a clerk with no R2 on this board", async () => {
    currentUser.value = {
      id: "user-2",
      personId: "person-2",
      townId: "town-1",
      role: "staff",
      permissions: { global: {}, board_overrides: [] },
    };
    renderRoute();

    await screen.findByText("Regular Board Meeting");
    expect(
      screen.queryByRole("button", { name: /generate minutes draft/i }),
    ).not.toBeInTheDocument();
  });

  // The ADDED `boardId` argument: a grant that exists only as a board
  // override is invisible to the global question this screen used to ask.
  it("shows Generate to a clerk granted R2 on THIS board only", async () => {
    currentUser.value = {
      id: "user-2",
      personId: "person-2",
      townId: "town-1",
      role: "staff",
      permissions: {
        global: {},
        board_overrides: [{ board_id: "board-1", permissions: { generate_ai_minutes: true } }],
      },
    };
    renderRoute();

    expect(
      await screen.findByRole("button", { name: /generate minutes draft/i }),
    ).toBeInTheDocument();
  });
});

// ─── The export ─────────────────────────────────────────────────────────

describe("PostMeetingReviewPage — the structured record export", () => {
  it("builds the record from every read and names the file from the board and date", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /export meeting data/i }));

    expect(downloadMeetingRecord).toHaveBeenCalledTimes(1);
    const [record, boardName, date] = downloadMeetingRecord.mock.calls[0]!;
    expect(boardName).toBe("Select Board");
    expect(date).toBe("2026-03-10");

    const built = record as Record<string, any>;
    expect(built.meeting.title).toBe("Regular Board Meeting");
    expect(built.meeting.presiding_officer).toBe("Alice Chair");
    expect(built.meeting.minutes_preparer).toBe("Bob Clerk");
    // `is_recording_secretary` survives as a boolean end to end — the column's
    // real type, no longer normalised to 0/1 and compared `=== 1`.
    const clerk = built.attendance.members.find((m: any) => m.name === "Bob Clerk");
    expect(clerk.is_recording_secretary).toBe(true);
    const chair = built.attendance.members.find((m: any) => m.name === "Alice Chair");
    expect(chair.is_recording_secretary).toBe(false);
  });

  it("carries the motion, its exhibits and its speakers onto the exported item", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /export meeting data/i }));

    const built = downloadMeetingRecord.mock.calls[0]![0] as Record<string, any>;
    const paving = built.sections[0].items[0];
    expect(paving.title).toBe("Road Paving Contract");
    expect(paving.motion.moved_by).toBe("Alice Chair");
    expect(paving.motion.vote.yeas).toBe(2);
    expect(paving.exhibits).toEqual([{ title: "Bid Tabulation", file_name: "bids.pdf" }]);
    expect(paving.speakers).toEqual([{ name: "Dana Resident", topic: "Traffic" }]);
  });

  it("serialises the adjournment JSONB rather than handing the object through", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /export meeting data/i }));

    const built = downloadMeetingRecord.mock.calls[0]![0] as Record<string, any>;
    // `sec-2` is `procedural` and titled "Adjournment", which is what the
    // builder keys the adjournment block off.
    expect(built.sections[1].adjournment).toEqual({ method: "motion", motion_id: "motion-2" });
  });
});

// ─── Every read is load-bearing ─────────────────────────────────────────

describe("PostMeetingReviewPage — the read surface", () => {
  it("calls all fourteen procedures and no supabase endpoint", async () => {
    renderRoute();
    await screen.findByText("Regular Board Meeting");

    await waitFor(() => expect(stub.countFor("futureItem.byMeeting")).toBeGreaterThan(0));

    for (const path of [
      "meeting.detail",
      "board.detail",
      "town.detail",
      "boardMember.roster",
      "meetingAttendance.byMeeting",
      "agendaItem.byMeeting",
      "motion.byMeeting",
      "voteRecord.byMeeting",
      "executiveSession.byMeeting",
      "agendaItemTransition.byMeeting",
      "guestSpeaker.byMeeting",
      "exhibit.byMeeting",
      "futureItem.byMeeting",
      "minutesDocument.byMeeting",
    ] as const) {
      expect(stub.countFor(path)).toBeGreaterThan(0);
    }
  });
});
