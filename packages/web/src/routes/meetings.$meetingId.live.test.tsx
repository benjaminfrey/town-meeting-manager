/**
 * Tests for LiveMeetingPage — /meetings/:meetingId/live
 *
 * Mocks all child panels/dialogs to isolate page-level routing,
 * status transitions, and data wiring.
 *
 * Uses TanStack Query + Supabase mocks (migrated in M.09–M.10).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { trpc } from "@/lib/trpc";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import type { QueryClient } from "@tanstack/react-query";

/** Build a mock useQuery return value with data and no loading/error state. */
function mockQueryResult<T>(data: T[]) {
  return { data, isLoading: false, isFetching: false, error: undefined };
}

// ─── Module-level mocks ──────────────────────────────────────────

const { mockUseQuery, queryClientRef } = vi.hoisted(() => {
  return {
    mockUseQuery: vi.fn(),
    // Populated by the `@tanstack/react-query` mock factory below, once,
    // before any test runs — a fake extra module export would not
    // typecheck (the real module has no such member), so the factory's own
    // closure hands it out through this hoisted container instead.
    queryClientRef: { current: null as QueryClient | null },
  };
});

const mockNavigate = vi.fn();

// Mock TanStack Query hooks. `useQueryClient` returns a REAL `QueryClient`
// instance (built from the same `actual` module, not a `vi.fn()` stand-in) —
// this route calls `useQueryClient()` once and reuses the reference across
// every handler, and the pin test below needs a real cache to seed a
// `trpc.meeting.byBoard` entry into and genuinely observe
// `trpc.meeting.pathFilter()` invalidate it (conventions item 13: "verify
// by mutation" needs something a deleted invalidation call can actually
// make false).
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  const testQueryClient = new actual.QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClientRef.current = testQueryClient;
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
    useMutation: vi.fn(() => ({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    })),
    useQueryClient: vi.fn(() => testQueryClient),
  };
});

// Mock Supabase hook (no real DB calls in tests)
vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  })),
}));

// Mock Realtime subscription (no-op in tests)
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(() => ({ status: "connected" })),
}));

// Mock ConnectionStatusBar (silent in tests)
vi.mock("@/components/ConnectionStatusBar", () => ({
  ConnectionStatusBar: () => null,
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ meetingId: "meeting-1" }),
  };
});

vi.mock("./+types/meetings.$meetingId.live", () => ({}));

// Mock useCurrentUser to return an admin user with M1 permission
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

// Mock useQuorumCheck
vi.mock("@/hooks/useQuorumCheck", () => ({
  useQuorumCheck: vi.fn(() => ({
    quorum: { required: 2, present: 2, total: 3, hasQuorum: true },
    isLoading: false,
  })),
}));

// Mock hasPermission to return true (user can run meetings)
vi.mock("@town-meeting/shared", async () => {
  const actual = await vi.importActual("@town-meeting/shared");
  return { ...actual, hasPermission: vi.fn(() => true) };
});

// Mock child components to isolate page logic
vi.mock("@/components/meeting/AgendaNavigationPanel", () => ({
  AgendaNavigationPanel: (props: any) => (
    <div data-testid="agenda-nav-panel">
      <span data-testid="nav-section-count">{props.sections?.length ?? 0}</span>
      {/* Reaches `navigateToItem`, the route's OTHER `agenda_item` writer
          (it sets the departed item `completed` and the arrived one
          `active`) — pinned separately from the adjournment handler below. */}
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
      <button data-testid="start-meeting" onClick={() => props.onComplete?.()}>
        Start
      </button>
    </div>
  ),
}));

vi.mock("@/components/meeting/ExecutiveSessionDialog", () => ({
  ExecutiveSessionDialog: (props: any) =>
    props.open ? <div data-testid="exec-session-dialog" /> : null,
  EXECUTIVE_SESSION_CITATIONS: [],
}));

vi.mock("@/components/meeting/ExitExecutiveSessionDialog", () => ({
  ExitExecutiveSessionDialog: (props: any) =>
    props.open ? <div data-testid="exit-exec-dialog" /> : null,
}));

vi.mock("@/components/meeting/AdjournmentControls", () => ({
  AdjournmentControls: (props: any) => (
    <div data-testid="adjournment-controls">
      <button data-testid="adjourn-motion" onClick={props.onAdjournMotion}>
        Motion
      </button>
      <button data-testid="adjourn-wo" onClick={props.onAdjournWithoutObjection}>
        WO
      </button>
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
  MotionCaptureDialog: (props: any) => (props.open ? <div data-testid="motion-dialog" /> : null),
}));

vi.mock("@/components/meeting/MeetingTimer", () => ({
  MeetingTimer: (props: any) => <span data-testid="meeting-timer">{props.startedAt}</span>,
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

// ─── Mock data ───────────────────────────────────────────────────

const mockBoard = {
  id: "board-1",
  name: "Planning Board",
  board_type: "appointed",
  quorum_type: "simple_majority",
  quorum_value: null,
  member_count: 5,
  motion_display_format: "inline_narrative",
};

const mockMeeting = {
  id: "meeting-1",
  board_id: "board-1",
  town_id: "town-1",
  title: "Regular Meeting",
  status: "open",
  scheduled_date: "2026-03-10",
  scheduled_time: "18:00",
  location: "Town Hall",
  meeting_type: "regular",
  started_at: "2026-03-10T18:00:00Z",
  ended_at: null,
  current_agenda_item_id: "item-1",
  presiding_officer_id: "bm-1",
  recording_secretary_id: "bm-2",
  adjournment: null,
  board: mockBoard,
};

const mockMembers = [
  {
    id: "bm-1",
    person_id: "p-1",
    board_id: "board-1",
    seat_title: "Chair",
    status: "active",
    is_default_rec_sec: false,
    person: { id: "p-1", name: "Alice Smith" },
  },
  {
    id: "bm-2",
    person_id: "p-2",
    board_id: "board-1",
    seat_title: null,
    status: "active",
    is_default_rec_sec: true,
    person: { id: "p-2", name: "Bob Jones" },
  },
  {
    id: "bm-3",
    person_id: "p-3",
    board_id: "board-1",
    seat_title: null,
    status: "active",
    is_default_rec_sec: false,
    person: { id: "p-3", name: "Carol White" },
  },
];

const mockAttendance = [
  {
    id: "att-1",
    meeting_id: "meeting-1",
    board_member_id: "bm-1",
    status: "present",
    is_recording_secretary: false,
    arrived_at: null,
    departed_at: null,
  },
  {
    id: "att-2",
    meeting_id: "meeting-1",
    board_member_id: "bm-2",
    status: "present",
    is_recording_secretary: true,
    arrived_at: null,
    departed_at: null,
  },
  {
    id: "att-3",
    meeting_id: "meeting-1",
    board_member_id: "bm-3",
    status: "absent",
    is_recording_secretary: false,
    arrived_at: null,
    departed_at: null,
  },
];

const mockAgendaItems = [
  {
    id: "section-1",
    meeting_id: "meeting-1",
    title: "Call to Order",
    section_type: "procedural",
    sort_order: 0,
    parent_item_id: null,
    status: "completed",
    exhibit: [],
  },
  {
    id: "item-1",
    meeting_id: "meeting-1",
    title: "Site Plan Review",
    section_type: null,
    sort_order: 0,
    parent_item_id: "section-1",
    status: "in_progress",
    description: "Review the site plan",
    suggested_motion: "to approve the site plan",
    estimated_duration: 15,
    exhibit: [],
  },
];

// ─── Query router ────────────────────────────────────────────────

function setupLiveMeetingQueries(overrides: Record<string, any> = {}) {
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0] as string;

    if (key === "meetings") {
      // meetings.detail — returns meeting with embedded board
      const meetingOverride = overrides.meeting ?? overrides.meetings?.[0];
      const data = meetingOverride ?? { ...mockMeeting, board: overrides.board ?? mockBoard };
      return { data, isLoading: false, error: undefined };
    }
    if (key === "members") {
      return mockQueryResult(overrides.members ?? mockMembers);
    }
    if (key === "attendance") {
      return mockQueryResult(overrides.attendance ?? mockAttendance);
    }
    if (key === "agendaItems") {
      return mockQueryResult(overrides.agendaItems ?? mockAgendaItems);
    }
    if (key === "motions") {
      return mockQueryResult(overrides.motions ?? []);
    }
    if (key === "voteRecords") {
      return mockQueryResult(overrides.voteRecords ?? []);
    }
    if (key === "executiveSessions") {
      return mockQueryResult(overrides.execSessions ?? []);
    }
    if (key === "agendaItemTransitions") {
      return mockQueryResult(overrides.transitions ?? []);
    }
    if (key === "guestSpeakers") {
      return mockQueryResult(overrides.speakers ?? []);
    }
    return mockQueryResult([]);
  });
}

// ─── Import SUT ──────────────────────────────────────────────────

import LiveMeetingPage from "./meetings.$meetingId.live";

// ─── Tests ───────────────────────────────────────────────────────

describe("LiveMeetingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it("renders meeting start flow when meeting not started", () => {
    const noticedMeeting = {
      ...mockMeeting,
      status: "noticed",
      started_at: null,
      current_agenda_item_id: null,
    };
    setupLiveMeetingQueries({ meeting: noticedMeeting });

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByTestId("meeting-start-flow")).toBeInTheDocument();
    expect(screen.getByTestId("start-flow-meeting-id")).toHaveTextContent("meeting-1");
    expect(screen.queryByTestId("agenda-nav-panel")).not.toBeInTheDocument();
  });

  it("renders three-panel layout for in-progress meeting", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByTestId("agenda-nav-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-start-flow")).not.toBeInTheDocument();
  });

  it("displays meeting header with board name and status", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByText("Regular Meeting")).toBeInTheDocument();
    expect(screen.getByText("Planning Board")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("shows attendance panel with member count", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    const memberCount = screen.getByTestId("member-count");
    expect(memberCount).toHaveTextContent("3");
  });

  it("renders agenda navigation with correct sections", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    // mockAgendaItems has 1 section (section-1) with 1 child item
    const sectionCount = screen.getByTestId("nav-section-count");
    expect(sectionCount).toHaveTextContent("1");
  });

  it("renders detail panel for current agenda item", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    const detailTitle = screen.getByTestId("detail-title");
    expect(detailTitle).toHaveTextContent("Site Plan Review");
  });

  it("redirects adjourned meetings to review page", () => {
    const adjournedMeeting = {
      ...mockMeeting,
      status: "adjourned",
      ended_at: "2026-03-10T20:00:00Z",
    };
    setupLiveMeetingQueries({ meeting: adjournedMeeting });

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/meetings/meeting-1/review", {
      replace: true,
    });
  });

  it("shows executive session banner when in exec session", () => {
    const activeExecSession = {
      id: "es-1",
      meeting_id: "meeting-1",
      agenda_item_id: "item-1",
      town_id: "town-1",
      statutory_basis: "1 M.R.S.A. 405(6)(A)",
      entered_at: "2026-03-10T19:00:00Z",
      exited_at: null,
      entry_motion_id: "motion-es-1",
      post_session_action_motion_ids: [],
      created_at: "2026-03-10T18:55:00Z",
    };
    setupLiveMeetingQueries({ execSessions: [activeExecSession] });

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByTestId("exec-banner")).toBeInTheDocument();
    expect(screen.getByTestId("exec-citation")).toHaveTextContent("1 M.R.S.A. 405(6)(A)");
    expect(screen.queryByTestId("adjournment-controls")).not.toBeInTheDocument();
  });

  it("renders adjournment controls", () => {
    setupLiveMeetingQueries();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByTestId("adjournment-controls")).toBeInTheDocument();
    expect(screen.getByTestId("adjourn-motion")).toBeInTheDocument();
    expect(screen.getByTestId("adjourn-wo")).toBeInTheDocument();
  });

  it("handles meeting with no agenda items gracefully", () => {
    const meetingNoCurrentItem = {
      ...mockMeeting,
      current_agenda_item_id: null,
    };
    setupLiveMeetingQueries({
      meeting: meetingNoCurrentItem,
      agendaItems: [],
    });

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    expect(screen.getByTestId("agenda-nav-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-title")).toHaveTextContent("none");
  });

  it("invalidates trpc.meeting.pathFilter() after adjourning without objection", async () => {
    // Phase E wave 3 Task 2's fix round: this handler moves the meeting
    // open → adjourned — a status both the kanban (routes/meetings.tsx) and
    // the board Meetings tab (routes/boards.$boardId.meetings.tsx) render
    // via trpc.meeting.byTown/byBoard. Before this fix, neither refreshed
    // for up to 60s after a meeting was adjourned.
    setupLiveMeetingQueries();

    const mockQueryClient = queryClientRef.current!;
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey;
    mockQueryClient.setQueryData(byBoardKey, []);
    expect(mockQueryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    fireEvent.click(screen.getByTestId("adjourn-wo"));

    await waitFor(() => {
      expect(mockQueryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true);
    });
  });

  // ─── Wave 3, Tasks 3+4 fix round: the three new routers ───────────
  //
  // `routes/meetings.$meetingId.tsx`'s shell reads
  // `agendaItem.countByMeeting`, `meetingAttendance.countByMeeting` and
  // `minutesDocument.byMeeting`. This route writes all three tables, so
  // conventions item 7 owes each of those writes the matching
  // `pathFilter()` call — and item 8 owes each call a pin that a deletion
  // turns red. Each test below seeds the SHELL's own key, not a nearby one.

  it("invalidates trpc.agendaItem.pathFilter() when adjourning — the shell's item count", async () => {
    setupLiveMeetingQueries();

    const mockQueryClient = queryClientRef.current!;
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    mockQueryClient.setQueryData(countKey, 2);
    expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    fireEvent.click(screen.getByTestId("adjourn-wo"));

    await waitFor(() => {
      expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBe(true);
    });
  });

  it("invalidates trpc.agendaItem.pathFilter() when navigating between items — the OTHER call site", async () => {
    // `navigateToItem` carries its own `trpc.agendaItem.pathFilter()` line,
    // separate from the adjournment handler's, so deleting either one is
    // caught rather than only whichever the previous test happens to reach.
    setupLiveMeetingQueries();

    const mockQueryClient = queryClientRef.current!;
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    mockQueryClient.setQueryData(countKey, 2);
    expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    fireEvent.click(screen.getByTestId("nav-to-item"));

    await waitFor(() => {
      expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBe(true);
    });
  });

  it("invalidates trpc.meetingAttendance.pathFilter() from the meeting_attendance Realtime handler", async () => {
    // The Realtime hook is mocked out (see the module mocks above), so the
    // handler is reached by invoking the callback this route registered for
    // the `meeting_attendance` table — the same thing the real subscription
    // does when another device records attendance.
    setupLiveMeetingQueries();

    const mockQueryClient = queryClientRef.current!;
    const countKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    mockQueryClient.setQueryData(countKey, 2);
    expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    const attendanceCall = vi
      .mocked(useRealtimeSubscription)
      .mock.calls.find((call) => call[1] === "meeting_attendance");
    expect(attendanceCall, "the route no longer subscribes to meeting_attendance").toBeDefined();
    attendanceCall![3]({});

    await waitFor(() => {
      expect(mockQueryClient.getQueryState(countKey)?.isInvalidated).toBe(true);
    });
  });

  it("invalidates trpc.minutesDocument.pathFilter() when a minutes-approval motion passes", async () => {
    // The auto-approval effect: an agenda item carrying
    // `source_minutes_document_id` plus a PASSED motion on that item moves
    // the referenced `minutes_document` to `approved` — the exact status the
    // shell's pill renders.
    setupLiveMeetingQueries({
      agendaItems: [
        {
          ...mockAgendaItems[0],
          id: "item-minutes",
          parent_item_id: null,
          source_minutes_document_id: "md-1",
        },
      ],
      motions: [
        {
          id: "motion-1",
          agenda_item_id: "item-minutes",
          motion_type: "main",
          motion_text: "to approve the minutes of February 10",
          status: "passed",
        },
      ],
    });

    const mockQueryClient = queryClientRef.current!;
    const minutesKey = trpc.minutesDocument.byMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    mockQueryClient.setQueryData(minutesKey, { id: "md-1", status: "review" });
    expect(mockQueryClient.getQueryState(minutesKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <LiveMeetingPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    await waitFor(() => {
      expect(mockQueryClient.getQueryState(minutesKey)?.isInvalidated).toBe(true);
    });
  });
});
