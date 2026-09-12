/**
 * `LiveMeetingPage` — /meetings/:meetingId/live
 *
 * Phase E, wave 5, Task 4. Rewritten, not adapted (conventions item 13: "a
 * rewritten test is not a migrated test"). The version this replaces mocked
 * `@tanstack/react-query`'s `useQuery` wholesale and routed on
 * `queryKey[0]` — so the keys it exercised were invented by the test and
 * matched nothing the app produces, which is the exact hole item 8 exists to
 * close. `@/lib/trpc` is left alone here and `globalThis.fetch` is stubbed
 * instead, so the query keys are real and an invalidation assertion means
 * something.
 *
 * `@trpc/tanstack-react-query`'s `useSubscription` IS mocked, and that is the
 * one deliberate exception. jsdom has no `EventSource`, and the thing worth
 * pinning is not the transport (`packages/api`'s `sse-bounds.test.ts` drives a
 * real one over real HTTP) — it is that this screen opens the subscription for
 * THIS meeting and that a topic arriving on it invalidates the right cache.
 * The mock captures the options object, so a test can deliver an event by hand
 * and watch the real `useLiveMeetingEvents` mapping run.
 *
 * The child panels and dialogs are mocked to isolate page-level routing and
 * data wiring; each has its own test file.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, setupAppQueryClient, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

// ─── Module-level mocks ──────────────────────────────────────────

const mockNavigate = vi.fn();

/**
 * The last options object `useSubscription` was handed — the seam a test uses
 * to deliver a realtime event without a transport.
 */
const subscription: { options: { onData?: (e: unknown) => void } | null } = { options: null };

vi.mock("@trpc/tanstack-react-query", async () => {
  const actual = await vi.importActual<typeof import("@trpc/tanstack-react-query")>(
    "@trpc/tanstack-react-query",
  );
  return {
    ...actual,
    useSubscription: vi.fn((opts: { onData?: (e: unknown) => void }) => {
      subscription.options = opts;
      return { status: "pending", data: undefined, error: null, reset: () => {} };
    }),
  };
});

// No Supabase mock: as of wave 5, Task 5 this route imports nothing from
// `@/hooks/useSupabase`, and every write it performs goes through the stubbed
// `fetch` below.

// No `ConnectionStatusBar` mock since wave 5, Task 6: that module no longer
// opens a Supabase channel (the reason it was mocked), and `live.tsx` now
// renders `LiveStreamStatusBar` from it, driven by `useLiveMeetingEvents`'s
// return value. Letting the real one render is what makes the assertions below
// about the stream's banner mean anything.

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ meetingId: "meeting-1" }),
  };
});

vi.mock("./+types/meetings.$meetingId.live", () => ({}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: vi.fn(() => ({
    id: "user-1",
    personId: "person-1",
    email: "admin@test.com",
    townId: "town-1",
    role: "admin",
    govTitle: null,
    permissions: {},
  })),
}));

vi.mock("@/hooks/useQuorumCheck", () => ({
  useQuorumCheck: vi.fn(() => ({
    quorum: { required: 2, present: 2, total: 3, hasQuorum: true },
    isLoading: false,
  })),
}));

vi.mock("@town-meeting/shared", async () => {
  const actual = await vi.importActual("@town-meeting/shared");
  return { ...actual, hasPermission: vi.fn(() => true) };
});

// ─── Child components ────────────────────────────────────────────

vi.mock("@/components/meeting/AgendaNavigationPanel", () => ({
  AgendaNavigationPanel: (props: any) => (
    <div data-testid="agenda-nav-panel">
      <span data-testid="nav-section-count">{props.sections?.length ?? 0}</span>
      {/* Reaches `navigateToItem`, the route's OTHER `agenda_item` writer —
          pinned separately from the adjournment handler below. */}
      <button data-testid="nav-to-item" onClick={() => props.onNavigate?.("item-1")}>
        Go
      </button>
    </div>
  ),
}));

vi.mock("@/components/meeting/AgendaItemDetailPanel", () => ({
  AgendaItemDetailPanel: (props: any) => (
    <div data-testid="detail-panel">
      <span data-testid="detail-title">{props.item?.title ?? "none"}</span>
      <span data-testid="detail-board-id">{props.boardId}</span>
      <span data-testid="detail-exhibits">{props.item?.exhibits?.length ?? 0}</span>
    </div>
  ),
}));

vi.mock("@/components/meeting/AttendancePanel", () => ({
  AttendancePanel: (props: any) => (
    <div data-testid="attendance-panel">
      <span data-testid="member-count">{props.members?.length ?? 0}</span>
    </div>
  ),
}));

vi.mock("@/components/meeting/MeetingStartFlow", () => ({
  MeetingStartFlow: (props: any) => (
    <div data-testid="meeting-start-flow">
      <span data-testid="start-flow-meeting-id">{props.meetingId}</span>
    </div>
  ),
}));

vi.mock("@/components/meeting/ExecutiveSessionDialog", () => ({
  // Always renders its proceed control, not only when `open`: the real dialog
  // is opened from inside `AgendaItemDetailPanel` (mocked here), and the thing
  // under test is what `onProceed` sets in motion, not the open/closed
  // plumbing.
  ExecutiveSessionDialog: (props: any) => (
    <div data-testid="exec-session-dialog">
      <button
        data-testid="exec-proceed"
        onClick={() => props.onProceed?.("1 M.R.S.A. 405(6)(A)", "A", "to enter Executive Session")}
      >
        Proceed
      </button>
    </div>
  ),
  EXECUTIVE_SESSION_CITATIONS: [],
}));

vi.mock("@/components/meeting/ExitExecutiveSessionDialog", () => ({
  ExitExecutiveSessionDialog: (props: any) => (
    <div data-testid="exit-exec-dialog">
      <button data-testid="exec-return-with-actions" onClick={props.onReturnWithActions}>
        Return with actions
      </button>
    </div>
  ),
}));

vi.mock("@/components/meeting/AdjournmentControls", () => ({
  // `adjournError` is rendered here because that is the whole of this route's
  // responsibility for it: the real control forwards it into
  // `AdjournWithoutObjectionDialog`, which renders it INSIDE the dialog that a
  // refusal leaves open. That placement is pinned in `AdjournmentFlow.test.tsx`
  // against the real components; this asserts the message reaches them.
  AdjournmentControls: (props: any) => (
    <div data-testid="adjournment-controls">
      <button data-testid="adjourn-motion" onClick={props.onAdjournMotion}>
        Motion
      </button>
      <button data-testid="adjourn-wo" onClick={props.onAdjournWithoutObjection}>
        WO
      </button>
      {props.adjournError && <span data-testid="adjourn-error">{props.adjournError}</span>}
    </div>
  ),
}));

vi.mock("@/components/meeting/ExecSessionBanner", () => ({
  ExecSessionBanner: (props: any) => (
    <div data-testid="exec-banner">
      <span data-testid="exec-citation">{props.citation}</span>
    </div>
  ),
}));

vi.mock("@/components/meeting/MotionCaptureDialog", () => ({
  // Keyed by motion type, because this route renders TWO of these — the
  // executive-session entry motion and the adjournment motion — and the
  // exec-session flow is driven by CLOSING the first one
  // (`handleExecMotionDialogClose`), which is what files the pending record.
  MotionCaptureDialog: (props: any) => (
    <div data-testid={`motion-dialog-${props.mode?.motionType}`}>
      <button
        data-testid={`motion-dialog-close-${props.mode?.motionType}`}
        onClick={() => props.onOpenChange?.(false)}
      >
        Close
      </button>
    </div>
  ),
}));

vi.mock("@/components/meeting/MeetingTimer", () => ({
  MeetingTimer: (props: any) => <span data-testid="meeting-timer">{props.startedAt}</span>,
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

// ─── Harness ─────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

// `meeting` gained a JSONB column of its own in wave 6, Task 4
// (`adjournment`), so it needs the same intersection the comment below
// describes for the other three.
type Meeting = RouterOutputs["meeting"]["detail"] & { adjournment: unknown };
type AgendaItem = RouterOutputs["agendaItem"]["byMeeting"][number];
// `board`, `executive_session` and `motion` each carry a JSONB column, and
// `RouterOutputs` types those as `unknown` — which `TestHandlers` (built from
// `inferProcedureOutput`) treats as REQUIRED while `inferRouterOutputs` treats
// as optional, so an explicitly-annotated fixture is rejected where the same
// literal inferred is accepted. Inferred here on purpose; the handler map is
// still what checks the shape against the real procedure.
type Board = typeof baseBoard;
type ExecSession = ReturnType<typeof execSession>;
type Motion = ReturnType<typeof motion>;

/** One `executive_session` row, with the fields a test varies. */
function execSession(overrides: { entered_at?: string | null; exited_at?: string | null } = {}) {
  return {
    id: "es-1",
    agenda_item_id: "item-1",
    statutory_basis: "1 M.R.S.A. 405(6)(A)",
    entered_at: "2026-03-10T19:00:00Z",
    exited_at: null as string | null,
    entry_motion_id: "motion-es-1" as string | null,
    post_session_action_motion_ids: [] as unknown,
    created_at: "2026-03-10T18:55:00Z",
    ...overrides,
  };
}

/** One `motion` row. */
function motion(overrides: {
  id?: string;
  agenda_item_id?: string;
  motion_text?: string;
  motion_type?: string;
  status?: string;
  created_at?: string;
}) {
  return {
    id: "motion-1",
    agenda_item_id: "item-1",
    motion_text: "to approve the site plan",
    motion_type: "main",
    moved_by: null as string | null,
    seconded_by: null as string | null,
    status: "passed",
    parent_motion_id: null as string | null,
    vote_summary: null as unknown,
    created_at: "2026-03-10T19:00:00Z",
    ...overrides,
  };
}

const baseMeeting: Meeting = {
  id: "meeting-1",
  board_id: "board-1",
  title: "Regular Meeting",
  status: "open",
  meeting_type: "regular",
  agenda_status: "published",
  scheduled_date: "2026-03-10",
  scheduled_time: "18:00",
  location: "Town Hall",
  presiding_officer_id: "bm-1",
  recording_secretary_id: "bm-2",
  current_agenda_item_id: "item-1",
  started_at: "2026-03-10T18:00:00Z",
  ended_at: null,
  agenda_packet_url: null,
  agenda_packet_generated_at: null,
  meeting_notice_url: null,
  meeting_notice_generated_at: null,
  adjournment: null,
  // Wave 6, Task 5: `meeting.detail` joins `board` for
  // `MeetingSubnavHeader`.
  board_name: "Select Board",
};

const baseBoard = {
  id: "board-1",
  name: "Planning Board",
  board_type: "appointed",
  elected_or_appointed: "appointed",
  member_count: 5,
  election_method: null,
  officer_election_method: null,
  is_governing_board: false,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: false,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
};

function seat(
  id: string,
  name: string,
  overrides: Partial<RouterOutputs["boardMember"]["roster"][number]> = {},
): RouterOutputs["boardMember"]["roster"][number] {
  return {
    id,
    person_id: `p-${id}`,
    board_id: "board-1",
    seat_title: null,
    term_start: null,
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
    ...overrides,
  };
}

function agendaItem(overrides: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    section_type: "procedural",
    sort_order: 0,
    title: "Call to Order",
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

const defaultItems: AgendaItem[] = [
  agendaItem({ id: "section-1", title: "Call to Order", status: "completed" }),
  agendaItem({
    id: "item-1",
    title: "Site Plan Review",
    section_type: "new_business",
    parent_item_id: "section-1",
    status: "active",
    description: "Review the site plan",
    suggested_motion: "to approve the site plan",
    estimated_duration: 15,
  }),
];

/** Everything a test can vary between renders. */
const server: {
  meeting: Meeting;
  items: AgendaItem[];
  execSessions: ExecSession[];
  motions: Motion[];
  exhibits: RouterOutputs["exhibit"]["byMeeting"];
  meetingRefuses: false | "NOT_FOUND" | "INTERNAL_SERVER_ERROR";
  adjournRefuses: boolean;
  navigateRefuses: boolean;
  execInsertRefuses: boolean;
  appendRefuses: boolean;
} = {
  meeting: baseMeeting,
  items: defaultItems,
  execSessions: [],
  motions: [],
  exhibits: [],
  meetingRefuses: false,
  adjournRefuses: false,
  navigateRefuses: false,
  execInsertRefuses: false,
  appendRefuses: false,
};

const stub = installTRPCFetchStub({
  "meeting.detail": () => {
    if (server.meetingRefuses) trpcTestError(server.meetingRefuses);
    return server.meeting;
  },
  "board.detail": () => baseBoard,
  "boardMember.roster": () => [
    seat("bm-1", "Alice Smith", { seat_title: "Chair" }),
    seat("bm-2", "Bob Jones", { is_default_rec_sec: true }),
    seat("bm-3", "Carol White"),
    // An ARCHIVED seat: the query this screen replaces filtered
    // `.eq("status", "active")` server-side, and the filter moved client-side
    // with the move to `boardMember.roster`. Without this row the member-count
    // assertion below would pass either way.
    seat("bm-4", "Dave Gone", { status: "archived" }),
  ],
  "meetingAttendance.byMeeting": () => [
    {
      id: "att-1",
      board_member_id: "bm-1",
      person_id: "p-bm-1",
      status: "present",
      is_recording_secretary: false,
      arrived_at: null,
      departed_at: null,
    },
    {
      id: "att-2",
      board_member_id: "bm-2",
      person_id: "p-bm-2",
      status: "present",
      is_recording_secretary: true,
      arrived_at: null,
      departed_at: null,
    },
    {
      id: "att-3",
      board_member_id: "bm-3",
      person_id: "p-bm-3",
      status: "absent",
      is_recording_secretary: false,
      arrived_at: null,
      departed_at: null,
    },
  ],
  "agendaItem.byMeeting": () => server.items,
  "exhibit.byMeeting": () => server.exhibits,
  "motion.byMeeting": () => server.motions,
  "voteRecord.byMeeting": () => [],
  "guestSpeaker.byMeeting": () => [],
  "agendaItemTransition.byMeeting": () => [],
  "executiveSession.byMeeting": () => server.execSessions,

  // ─── The writes this screen performs (wave 5, Task 5) ────────────
  //
  // Four, and that is the whole list. There is no handler for a
  // `minutes_document` write, for `executiveSession.markEntered` or for
  // `discard` — those are consequences of a motion's outcome and live inside
  // `voteRecord.recordForMotion` now. The absence is load-bearing: if this
  // screen ever starts writing them again, the stub answers "no handler" and
  // the test that triggers it fails.
  "meeting.adjourn": ({ meetingId }) => {
    if (server.adjournRefuses) trpcTestError("FORBIDDEN");
    return { id: meetingId, alreadyAdjourned: false as const, deferred: 0, tabled: 0 };
  },
  "meeting.navigateToAgendaItem": ({ meetingId, itemId }) => {
    if (server.navigateRefuses) trpcTestError("FORBIDDEN");
    return { id: meetingId, currentAgendaItemId: itemId };
  },
  "executiveSession.insert": () => {
    if (server.execInsertRefuses) trpcTestError("FORBIDDEN");
    return { id: "es-new" };
  },
  "executiveSession.appendPostSessionActionMotions": ({ executiveSessionId, motionIds }) => {
    if (server.appendRefuses) trpcTestError("FORBIDDEN");
    return { id: executiveSessionId, motionIds };
  },
});

import LiveMeetingPage from "./meetings.$meetingId.live";

function renderLive() {
  return renderWithProviders(
    <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    { queryClient },
  );
}

/**
 * The input of the LAST request that carried `path`.
 *
 * Not `stub.calls[stub.calls.length - 1]`: a mutation's `onSuccess`
 * invalidates, the invalidation refetches, and the refetch is what ends up
 * last. This looks the call up by the procedure it names.
 */
function lastInputFor(path: Parameters<typeof stub.countFor>[0]): Record<string, unknown> {
  const call = [...stub.calls].reverse().find((c) => c.paths.includes(path));
  expect(call, `no request named ${path}`).toBeDefined();
  return Object.values(call!.inputs)[0] as Record<string, unknown>;
}

/** Deliver one realtime event through the route's real topic mapping. */
function deliverTopic(topic: string) {
  expect(subscription.options, "the route no longer opens a subscription").not.toBeNull();
  subscription.options!.onData!({ id: "1", data: { topic } });
}

// ─── Tests ───────────────────────────────────────────────────────

describe("LiveMeetingPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    subscription.options = null;
    server.meeting = baseMeeting;
    server.items = defaultItems;
    server.execSessions = [];
    server.motions = [];
    server.exhibits = [];
    server.meetingRefuses = false;
    server.adjournRefuses = false;
    server.navigateRefuses = false;
    server.execInsertRefuses = false;
    server.appendRefuses = false;
  });

  it("renders meeting start flow when the meeting is noticed", async () => {
    server.meeting = {
      ...baseMeeting,
      status: "noticed",
      started_at: null,
      current_agenda_item_id: null,
    };

    renderLive();

    expect(await screen.findByTestId("meeting-start-flow")).toBeInTheDocument();
    expect(screen.getByTestId("start-flow-meeting-id")).toHaveTextContent("meeting-1");
    expect(screen.queryByTestId("agenda-nav-panel")).not.toBeInTheDocument();
  });

  it("renders the three-panel layout for an open meeting", async () => {
    renderLive();

    expect(await screen.findByTestId("agenda-nav-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-start-flow")).not.toBeInTheDocument();
  });

  it("displays the meeting header with the board name, from the SEPARATE board read", async () => {
    renderLive();

    // `board.name` no longer arrives embedded in the meeting row; it is
    // `trpc.board.detail`, fetched by the meeting's `board_id`.
    expect(await screen.findByText("Planning Board")).toBeInTheDocument();
    expect(screen.getByText("Regular Meeting")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("counts only ACTIVE seats from the roster", async () => {
    renderLive();

    // Four seats come back; one is archived. The status filter moved from the
    // Supabase query to the component when this read became `roster`.
    await waitFor(() => expect(screen.getByTestId("member-count")).toHaveTextContent("3"));
  });

  it("renders agenda navigation with the section tree", async () => {
    renderLive();

    expect(await screen.findByTestId("nav-section-count")).toHaveTextContent("1");
  });

  it("renders the detail panel for the current agenda item, with its board id", async () => {
    renderLive();

    expect(await screen.findByTestId("detail-title")).toHaveTextContent("Site Plan Review");
    // `AgendaItemDetailPanel`'s two writes authorize on this prop.
    expect(screen.getByTestId("detail-board-id")).toHaveTextContent("board-1");
  });

  it("attaches exhibits from the SEPARATE exhibit read", async () => {
    server.exhibits = [
      {
        id: "ex-1",
        agenda_item_id: "item-1",
        title: "Site plan",
        file_storage_path: "exhibits/site.pdf",
        file_type: "application/pdf",
        file_name: "site.pdf",
        exhibit_type: "file",
        visibility: "public",
        sort_order: 0,
      },
    ];

    renderLive();

    // They used to arrive embedded in `select("*, exhibit(*)")`; this pins
    // that the split read still reaches the item it belongs to.
    await waitFor(() => expect(screen.getByTestId("detail-exhibits")).toHaveTextContent("1"));
  });

  it("redirects adjourned meetings to the review page", async () => {
    server.meeting = { ...baseMeeting, status: "adjourned", ended_at: "2026-03-10T20:00:00Z" };

    renderLive();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/meetings/meeting-1/review", { replace: true }),
    );
  });

  it("shows the executive session banner when in exec session", async () => {
    server.execSessions = [execSession()];

    renderLive();

    expect(await screen.findByTestId("exec-banner")).toBeInTheDocument();
    expect(screen.getByTestId("exec-citation")).toHaveTextContent("1 M.R.S.A. 405(6)(A)");
    expect(screen.queryByTestId("adjournment-controls")).not.toBeInTheDocument();
  });

  it("handles a meeting with no agenda items gracefully", async () => {
    server.meeting = { ...baseMeeting, current_agenda_item_id: null };
    server.items = [];

    renderLive();

    expect(await screen.findByTestId("agenda-nav-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("none");
  });
});

describe("LiveMeetingPage error state", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    subscription.options = null;
    server.meeting = baseMeeting;
    server.items = defaultItems;
    server.execSessions = [];
    server.motions = [];
    server.exhibits = [];
    server.meetingRefuses = false;
  });

  it("renders an alert, not an endless spinner, when the meeting read fails", async () => {
    // Conventions item 5. `RouteErrorBoundary` covers a loader rejection
    // before mount; this branch is the only thing that covers a failure after
    // it, and without it the screen sat on "Loading meeting data..." forever.
    server.meetingRefuses = "NOT_FOUND";

    renderLive();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This meeting could not be found.");
    expect(screen.queryByText("Loading meeting data...")).not.toBeInTheDocument();
  });
});

// ─── The SSE subscription ────────────────────────────────────────

describe("LiveMeetingPage realtime", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    subscription.options = null;
    server.meeting = baseMeeting;
    server.items = defaultItems;
    server.execSessions = [];
    server.motions = [];
    server.exhibits = [];
    server.meetingRefuses = false;
  });

  it("opens ONE subscription, for this meeting", async () => {
    renderLive();
    await screen.findByTestId("agenda-nav-panel");

    const { useSubscription } = await import("@trpc/tanstack-react-query");
    const calls = vi.mocked(useSubscription).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Eight Supabase channels became one stream — see
    // `packages/api/src/trpc/routers/realtime.ts` for why more than one would
    // break in development and work in production.
    const inputs = new Set(calls.map((c) => JSON.stringify((c[0] as any).queryKey)));
    expect(inputs.size).toBe(1);
    expect(JSON.stringify([...inputs][0])).toContain("meeting-1");
  });

  it("refetches the meeting read when the `meeting` topic arrives", async () => {
    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    const before = stub.countFor("meeting.detail");

    server.meeting = { ...baseMeeting, title: "Renamed Meeting" };
    deliverTopic("meeting");

    await waitFor(() => expect(stub.countFor("meeting.detail")).toBeGreaterThan(before));
    expect(await screen.findByText("Renamed Meeting")).toBeInTheDocument();
  });

  it("refetches the motion read when the `motion` topic arrives, and nothing else's", async () => {
    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    const motionsBefore = stub.countFor("motion.byMeeting");
    const votesBefore = stub.countFor("voteRecord.byMeeting");

    deliverTopic("motion");

    await waitFor(() => expect(stub.countFor("motion.byMeeting")).toBeGreaterThan(motionsBefore));
    expect(stub.countFor("voteRecord.byMeeting")).toBe(votesBefore);
  });

  it("refetches BOTH the agenda and the exhibit reads when the `agenda_item` topic arrives", async () => {
    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    const itemsBefore = stub.countFor("agendaItem.byMeeting");
    const exhibitsBefore = stub.countFor("exhibit.byMeeting");

    deliverTopic("agenda_item");

    await waitFor(() => {
      expect(stub.countFor("agendaItem.byMeeting")).toBeGreaterThan(itemsBefore);
      expect(stub.countFor("exhibit.byMeeting")).toBeGreaterThan(exhibitsBefore);
    });
  });

  it("invalidates trpc.meetingAttendance.pathFilter() when the `meeting_attendance` topic arrives", async () => {
    // The shell (`routes/meetings.$meetingId.tsx`) reads
    // `meetingAttendance.countByMeeting`; this screen does not, so only a
    // ROUTER-level filter reaches it.
    const countKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(countKey, 2);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderLive();
    await screen.findByTestId("agenda-nav-panel");

    deliverTopic("meeting_attendance");

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });
});

// ─── The four writes this screen performs, and the four it no longer does ──

/**
 * Phase E, wave 5, Task 5.
 *
 * The previous version of this block pinned SEVEN writes. Three of them were
 * `useEffect`s that fired when a motion row arrived over the subscription
 * carrying a new `status` — on every connected device at once, deduplicated
 * only by an in-memory `useRef<Set>`. They are consequences of the transaction
 * that decides the motion's outcome now (`voteRecord.recordForMotion`), so the
 * tests that drove them from this screen are gone and one test that asserts
 * they CANNOT happen from here has taken their place.
 */
describe("LiveMeetingPage cache invalidation", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    subscription.options = null;
    server.meeting = baseMeeting;
    server.items = defaultItems;
    server.execSessions = [];
    server.motions = [];
    server.exhibits = [];
    server.meetingRefuses = false;
    server.adjournRefuses = false;
    server.navigateRefuses = false;
    server.execInsertRefuses = false;
    server.appendRefuses = false;
  });

  it("invalidates trpc.meeting.pathFilter() after adjourning without objection", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    renderLive();
    fireEvent.click(await screen.findByTestId("adjourn-wo"));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("adjourns through meeting.adjourn, with no motion behind it", async () => {
    const before = stub.countFor("meeting.adjourn");
    renderLive();
    fireEvent.click(await screen.findByTestId("adjourn-wo"));

    await waitFor(() => expect(stub.countFor("meeting.adjourn")).toBe(before + 1));
    const input = lastInputFor("meeting.adjourn");
    // The "motion" method is reached only from inside
    // `voteRecord.recordForMotion` now; this screen can only declare.
    expect(input).toMatchObject({ method: "without_objection", adjournMotionId: null });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/meetings/meeting-1/review"));
  });

  it("invalidates trpc.futureItem.pathFilter() when adjourning — the review page's queue", async () => {
    // The adjournment COPIES the unreached and tabled items into
    // `future_item_queue`, and this handler navigates straight to the page
    // that reads them (`routes/meetings.$meetingId.review.tsx`, wave 6 Task
    // 4). `future_item_queue` is not one of the eight `LIVE_MEETING_TOPICS`,
    // so nothing else in this app would reach that key. This screen does not
    // observe it, so `isInvalidated` is safe here.
    const queueKey = trpc.futureItem.byMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(queueKey, []);
    expect(queryClient.getQueryState(queueKey)?.isInvalidated).toBeFalsy();

    renderLive();
    fireEvent.click(await screen.findByTestId("adjourn-wo"));

    await waitFor(() => expect(queryClient.getQueryState(queueKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when adjourning — the shell's item count", async () => {
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(countKey, 2);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderLive();
    fireEvent.click(await screen.findByTestId("adjourn-wo"));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItemTransition.pathFilter() when adjourning", async () => {
    // Asserted as a REFETCH rather than as `isInvalidated`, because this
    // screen observes `agendaItemTransition.byMeeting` itself: an invalidation
    // on a key with a live observer triggers an immediate refetch that clears
    // the flag again, so the flag is a race and the refetch is not. The
    // `isInvalidated` assertions elsewhere in this file are all on keys only
    // the SHELL reads, which have no observer here.
    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    await waitFor(() => expect(stub.countFor("agendaItemTransition.byMeeting")).toBe(1));
    const before = stub.countFor("agendaItemTransition.byMeeting");

    fireEvent.click(screen.getByTestId("adjourn-wo"));

    await waitFor(() =>
      expect(stub.countFor("agendaItemTransition.byMeeting")).toBeGreaterThan(before),
    );
  });

  it("hands a refused adjournment to the confirmation dialog, not to the page", async () => {
    // The refusal must reach `AdjournWithoutObjectionDialog`, which stays open
    // on a refusal and `aria-hidden`s the rest of the page. This asserts the
    // message is handed DOWN; `AdjournmentFlow.test.tsx` asserts the real
    // dialog renders it inside itself with `role="alert"`.
    server.adjournRefuses = true;
    renderLive();
    fireEvent.click(await screen.findByTestId("adjourn-wo"));

    const message = await screen.findByTestId("adjourn-error");
    expect(message).toHaveTextContent(/permission to adjourn this meeting/i);
    // And the page-level alert region did NOT take it — that region is
    // `aria-hidden` while the dialog is open.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("invalidates trpc.agendaItem.pathFilter() when navigating between items — the OTHER call site", async () => {
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(countKey, 2);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderLive();
    fireEvent.click(await screen.findByTestId("nav-to-item"));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItemTransition.pathFilter() when navigating between items", async () => {
    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    await waitFor(() => expect(stub.countFor("agendaItemTransition.byMeeting")).toBe(1));
    const before = stub.countFor("agendaItemTransition.byMeeting");

    fireEvent.click(screen.getByTestId("nav-to-item"));

    await waitFor(() =>
      expect(stub.countFor("agendaItemTransition.byMeeting")).toBeGreaterThan(before),
    );
  });

  it("invalidates trpc.meeting.pathFilter() when navigating between items", async () => {
    // `meeting.navigateToAgendaItem` writes `meeting.current_agenda_item_id`,
    // which THIS screen reads through `trpc.meeting.detail` and the kanban
    // through `trpc.meeting.byTown` — the legacy `queryKeys.meetings.detail`
    // line beside it reaches neither now.
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    renderLive();
    fireEvent.click(await screen.findByTestId("nav-to-item"));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("shows a refusal when navigating to another agenda item is FORBIDDEN", async () => {
    // Navigation has no confirmation dialog of its own — it fires from the
    // agenda panel, from the prev/next buttons and from the arrow keys — so
    // its refusal renders in the page's own alert region.
    server.navigateRefuses = true;
    renderLive();
    fireEvent.click(await screen.findByTestId("nav-to-item"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to move this meeting to another agenda item/i);
  });

  /**
   * A key under the same ROUTER that this screen does not observe.
   *
   * `trpc.executiveSession.pathFilter()` matches every key beneath that
   * router, and an invalidation on a key WITH a live observer triggers an
   * immediate refetch that clears `isInvalidated` again — a race. A key for a
   * different meeting has no observer here, so the flag stays set and the
   * assertion is not timing-dependent.
   */
  function seedUnobservedExecKey() {
    const key = trpc.executiveSession.byMeeting.queryOptions({
      meetingId: "some-other-meeting",
    }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
    return key;
  }

  /** Proceed through the citation dialog and close the entry-motion dialog. */
  async function fileThePendingSession() {
    fireEvent.click(screen.getByTestId("exec-proceed"));
    fireEvent.click(await screen.findByTestId("motion-dialog-close-main"));
  }

  it("invalidates trpc.executiveSession.pathFilter() when the pending record is filed", async () => {
    // `handleExecMotionFiled`: the citation dialog proceeds, the entry motion
    // is captured, and CLOSING that motion dialog is what writes the pending
    // `executive_session` row through `executiveSession.insert`.
    const key = seedUnobservedExecKey();
    server.motions = [motion({ id: "motion-es-1", motion_text: "to enter Executive Session" })];

    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    await fileThePendingSession();

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("shows a refusal when filing the pending executive session is FORBIDDEN", async () => {
    server.execInsertRefuses = true;
    server.motions = [motion({ id: "motion-es-1", motion_text: "to enter Executive Session" })];

    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    await fileThePendingSession();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to move this meeting into executive session/i);
  });

  /**
   * Arm `isPostExecSession`, then deliver a motion filed after `exited_at`.
   *
   * The ORDER here is what makes the invalidation test a pin rather than a
   * tautology. `deliverTopic("executive_session")` itself invalidates that
   * router, so seeding the probe key before it would go green with the line
   * under test deleted — which is how the deletion sweep caught the first
   * version of this test. The probe is seeded AFTER every exec-session
   * delivery, and the only thing that can invalidate it afterwards is the
   * effect's own line: the last delivery names `motion`.
   */
  async function armPostSessionActions() {
    server.execSessions = [execSession()];
    server.motions = [];

    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    fireEvent.click(screen.getByTestId("exec-return-with-actions"));

    server.execSessions = [execSession({ exited_at: "2026-03-10T19:30:00Z" })];
    server.motions = [motion({ id: "motion-post", created_at: "2026-03-10T19:45:00Z" })];
    deliverTopic("executive_session");
    await waitFor(() => expect(stub.countFor("executiveSession.byMeeting")).toBeGreaterThan(1));
  }

  it("invalidates trpc.executiveSession.pathFilter() when post-session action motions are linked", async () => {
    await armPostSessionActions();

    const key = seedUnobservedExecKey();
    deliverTopic("motion");

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("sends only the ids to ADD when linking post-session action motions", async () => {
    // The raw write read `post_session_action_motion_ids`, merged in the
    // browser, and wrote the whole array back — losing a concurrent append.
    // The procedure unions under `FOR UPDATE`, so the client must send the
    // delta and nothing else.
    const before = stub.countFor("executiveSession.appendPostSessionActionMotions");
    await armPostSessionActions();
    deliverTopic("motion");

    // `toBeGreaterThan`, not `toBe(before + 1)`: the effect's dependencies can
    // settle on either the `executive_session` refetch or the `motion` one
    // depending on which lands first, so the CALL COUNT is a race. What is not
    // a race — and is the claim this test exists for — is the SHAPE of what
    // the client sends, which is the delta and nothing else however many times
    // the effect fires. That is what makes the union on the server the thing
    // that has to be right.
    await waitFor(() =>
      expect(stub.countFor("executiveSession.appendPostSessionActionMotions")).toBeGreaterThan(
        before,
      ),
    );
    expect(lastInputFor("executiveSession.appendPostSessionActionMotions")).toMatchObject({
      executiveSessionId: "es-1",
      motionIds: ["motion-post"],
    });
  });

  it("shows a refusal when recording a post-executive-session action is FORBIDDEN", async () => {
    server.appendRefuses = true;
    await armPostSessionActions();
    deliverTopic("motion");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record a post-executive-session action/i);
  });

  /**
   * **The regression pin for this whole task.**
   *
   * Three `useEffect`s used to fire from exactly this state — a pending
   * executive session whose entry motion has PASSED, and a minutes-approval
   * item whose motion has PASSED, on a meeting that is still `open` with a
   * passed motion to adjourn on it. Every connected client ran all three.
   *
   * Nothing happens here now, and "nothing" is the assertion: no request of
   * any kind leaves this screen, and in particular none of the three
   * procedures those effects would have needed. Two of them
   * (`executiveSession.markEntered`, `executiveSession.discard`) have no
   * handler in the stub at all, so a re-introduced effect would fail the test
   * by name rather than by a count.
   */
  it("performs NO write when motions arrive already passed — the four reactive effects are gone", async () => {
    server.items = [
      agendaItem({ id: "section-1", title: "New Business", parent_item_id: null }),
      agendaItem({
        id: "item-minutes",
        title: "Approve the minutes of February 10",
        source_minutes_document_id: "md-1",
      }),
    ];
    server.execSessions = [execSession({ entered_at: null })];
    server.motions = [
      motion({ id: "motion-es-1", motion_text: "to enter Executive Session", status: "passed" }),
      motion({
        id: "motion-minutes",
        agenda_item_id: "item-minutes",
        motion_text: "to approve the minutes of February 10",
        status: "passed",
      }),
      motion({
        id: "motion-adjourn",
        motion_type: "adjourn",
        motion_text: "to adjourn the meeting",
        status: "passed",
      }),
    ];

    renderLive();
    await screen.findByTestId("agenda-nav-panel");
    // Let every effect in the tree settle.
    await waitFor(() => expect(stub.countFor("motion.byMeeting")).toBeGreaterThan(0));

    expect(stub.countFor("meeting.adjourn")).toBe(0);
    expect(stub.countFor("executiveSession.insert")).toBe(0);
    expect(stub.countFor("executiveSession.appendPostSessionActionMotions")).toBe(0);
    expect(mockNavigate).not.toHaveBeenCalled();
    // Nothing rendered a refusal either — the screen made no request to refuse.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
