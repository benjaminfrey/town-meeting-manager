import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";

// ─── Mock TanStack Query ───────────────────────────────────────────────

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

// ─── Mock Supabase ─────────────────────────────────────────────────────

const { mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain["then"] = (resolve: any, reject?: any) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  chain["catch"] = (reject: any) =>
    Promise.resolve({ data: [], error: null }).catch(reject as any);
  const methods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "in", "gte", "lte", "order", "limit",
    "single", "maybeSingle", "throwOnError", "or", "filter",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  const mockFrom = vi.fn().mockReturnValue(chain);
  return { mockChain: chain as Record<string, ReturnType<typeof vi.fn>>, mockFrom };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

// ─── Mock queryClient singleton ────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn(), ensureQueryData: vi.fn().mockResolvedValue(undefined) },
  resetQueryCache: vi.fn(),
}));

// ─── Mock route types ─────────────────────────────────────────────────

vi.mock("./+types/meetings.$meetingId.agenda", () => ({}));

// ─── Mock AuthProvider ────────────────────────────────────────────────

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: { access_token: "mock-jwt-token" },
    user: { id: "user-1", email: "admin@test.com" },
    isAuthenticated: true,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
  }),
}));

// ─── Mock child components with complex dependencies ──────────────────

vi.mock("@/components/meetings/AgendaSection", () => ({
  AgendaSection: (props: any) => (
    <div data-testid={`agenda-section-${props.section.id}`}>
      <span data-testid={`section-title-${props.section.id}`}>
        {props.section.title}
      </span>
      <span data-testid={`section-type-${props.section.id}`}>
        {props.section.section_type}
      </span>
      <span data-testid={`item-count-${props.section.id}`}>
        {props.children_items?.length ?? 0}
      </span>
      <span data-testid={`read-only-${props.section.id}`}>
        {props.readOnly ? "true" : "false"}
      </span>
    </div>
  ),
}));

vi.mock("@/components/meetings/AgendaStatusBar", () => ({
  AgendaStatusBar: (props: any) => (
    <div data-testid="agenda-status-bar">
      <span data-testid="status-item-count">{props.itemCount}</span>
      <span data-testid="status-duration">{props.totalDuration}</span>
      <span data-testid="status-exhibit-count">{props.exhibitCount}</span>
      <span data-testid="status-agenda-status">{props.agendaStatus}</span>
    </div>
  ),
}));

vi.mock("@/components/meetings/AgendaPreviewDialog", () => ({
  AgendaPreviewDialog: (props: any) => (
    <div data-testid="agenda-preview-dialog" data-open={props.open} />
  ),
}));

vi.mock("@/components/meetings/PublishAgendaDialog", () => ({
  PublishAgendaDialog: (props: any) => (
    <div data-testid="publish-agenda-dialog" data-open={props.open} />
  ),
}));

vi.mock("@/components/meetings/InlineItemForm", () => ({
  InlineItemForm: (props: any) => (
    <div data-testid="inline-item-form">
      <button data-testid="inline-save" onClick={props.onSaved}>
        Save
      </button>
      <button data-testid="inline-cancel" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

// Mock @dnd-kit modules to avoid WASM/DOM issues in jsdom
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <div data-testid="dnd-context">{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn().mockReturnValue([]),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: "vertical",
  useSortable: vi.fn().mockReturnValue({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn().mockReturnValue(null) } },
}));

// ─── Import component after mocks ─────────────────────────────────────

import AgendaBuilderPage from "./meetings.$meetingId.agenda";

// ─── Helpers ──────────────────────────────────────────────────────────

function mockQueryResult<T>(data: T[]) {
  return { data, isLoading: false, isFetching: false, error: undefined };
}

// ─── Mock data factories ──────────────────────────────────────────────

function createMockMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    board_id: "board-1",
    town_id: "town-1",
    title: "Regular Board Meeting",
    status: "draft",
    agenda_status: "draft",
    scheduled_date: "2026-03-15",
    scheduled_time: "7:00 PM",
    location: "Town Hall",
    agenda_packet_url: null,
    agenda_packet_generated_at: null,
    meeting_notice_url: null,
    meeting_notice_generated_at: null,
    ...overrides,
  };
}

function createMockBoard(overrides: Record<string, unknown> = {}) {
  return {
    id: "board-1",
    name: "Planning Board",
    ...overrides,
  };
}

function createMockTown(overrides: Record<string, unknown> = {}) {
  return {
    id: "town-1",
    name: "Testville",
    ...overrides,
  };
}

function createMockSection(overrides: Record<string, unknown> = {}) {
  return {
    id: "section-1",
    meeting_id: "meeting-1",
    town_id: "town-1",
    section_type: "procedural",
    sort_order: 0,
    title: "Call to Order",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    meeting_id: "meeting-1",
    town_id: "town-1",
    section_type: "discussion",
    sort_order: 0,
    title: "Approve previous minutes",
    description: null,
    presenter: "Town Clerk",
    estimated_duration: 5,
    parent_item_id: "section-1",
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function setupQueryMocks(opts: {
  meeting?: Record<string, unknown> | null;
  board?: Record<string, unknown> | null;
  town?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
  exhibits?: Record<string, unknown>[];
} = {}) {
  const {
    meeting = createMockMeeting(),
    board = createMockBoard(),
    town = createMockTown(),
    items = [],
    exhibits = [],
  } = opts;

  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0] as string;
    if (key === "meetings") return { data: meeting ?? undefined, isLoading: false, isFetching: false, error: undefined };
    if (key === "boards") return { data: board ?? undefined, isLoading: false, isFetching: false, error: undefined };
    if (key === "towns") return { data: town ?? undefined, isLoading: false, isFetching: false, error: undefined };
    if (key === "agendaItems") return mockQueryResult(items);
    if (key === "exhibits") return mockQueryResult(exhibits);
    return mockQueryResult([]);
  });
}

const defaultLoaderData = { meetingId: "meeting-1" };

// ─── Tests ────────────────────────────────────────────────────────────

describe("AgendaBuilderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    for (const m of ["select", "insert", "update", "delete", "eq", "neq", "order", "limit", "single", "throwOnError", "or", "filter", "upsert", "in", "maybeSingle"]) {
      if (typeof mockChain[m]?.mockReturnValue === "function") {
        mockChain[m].mockReturnValue(mockChain);
      }
    }
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: undefined });
  });

  it("renders loading state when meeting not loaded", () => {
    setupQueryMocks({ meeting: null });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(screen.getByText("Loading meeting...")).toBeInTheDocument();
  });

  it("renders meeting title and agenda sections", () => {
    const section1 = createMockSection({
      id: "sec-1",
      title: "Call to Order",
      section_type: "procedural",
      sort_order: 0,
    });
    const section2 = createMockSection({
      id: "sec-2",
      title: "Old Business",
      section_type: "discussion",
      sort_order: 1,
    });

    setupQueryMocks({
      meeting: createMockMeeting({ title: "March Planning Meeting" }),
      items: [section1, section2],
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // Meeting title in header
    expect(screen.getByText("March Planning Meeting")).toBeInTheDocument();

    // Section components rendered via mocked AgendaSection
    expect(screen.getByTestId("agenda-section-sec-1")).toBeInTheDocument();
    expect(screen.getByTestId("agenda-section-sec-2")).toBeInTheDocument();
    expect(screen.getByTestId("section-title-sec-1")).toHaveTextContent(
      "Call to Order",
    );
    expect(screen.getByTestId("section-title-sec-2")).toHaveTextContent(
      "Old Business",
    );
  });

  it("groups agenda items by parent section", () => {
    const section = createMockSection({
      id: "sec-1",
      title: "New Business",
      section_type: "action",
      sort_order: 0,
    });
    const child1 = createMockItem({
      id: "item-1",
      parent_item_id: "sec-1",
      title: "Budget Review",
      sort_order: 0,
    });
    const child2 = createMockItem({
      id: "item-2",
      parent_item_id: "sec-1",
      title: "Permit Application",
      sort_order: 1,
    });

    setupQueryMocks({ items: [section, child1, child2] });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // The mock AgendaSection receives children_items prop; its mock renders item-count
    expect(screen.getByTestId("item-count-sec-1")).toHaveTextContent("2");
  });

  it("displays empty state when no agenda items exist", () => {
    setupQueryMocks({ items: [] });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // No section elements rendered
    expect(screen.queryByTestId(/^agenda-section-/)).not.toBeInTheDocument();

    // Status bar shows 0 items
    expect(screen.getByTestId("status-item-count")).toHaveTextContent("0");
    expect(screen.getByTestId("status-duration")).toHaveTextContent("0");
  });

  it("adds a new section via the Add Section form", async () => {
    setupQueryMocks({ items: [] });

    const { user } = renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // Click "Add Section" button to open the form
    const addSectionBtn = screen.getByRole("button", {
      name: /add section/i,
    });
    await user.click(addSectionBtn);

    // Fill in the section title
    const titleInput = screen.getByPlaceholderText("New section title");
    await user.type(titleInput, "Public Comment");

    // Click the "Add" submit button
    const addBtn = screen.getByRole("button", { name: "Add" });
    await user.click(addBtn);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("agenda_item");
      expect(mockChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          meeting_id: "meeting-1",
          section_type: "other",
          title: "Public Comment",
        }),
      );
    });
  });

  it("passes readOnly=true when meeting is cancelled", () => {
    const section = createMockSection({
      id: "sec-1",
      title: "Call to Order",
      sort_order: 0,
    });

    setupQueryMocks({
      meeting: createMockMeeting({ status: "cancelled" }),
      items: [section],
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // The mocked AgendaSection renders the readOnly prop
    expect(screen.getByTestId("read-only-sec-1")).toHaveTextContent("true");

    // Add Section button should not be present for cancelled meetings
    expect(
      screen.queryByRole("button", { name: /add section/i }),
    ).not.toBeInTheDocument();
  });

  it("renders breadcrumb with board name and navigation links", () => {
    setupQueryMocks({
      board: createMockBoard({ id: "board-1", name: "Select Board" }),
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Select Board")).toBeInTheDocument();
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();

    // Verify links point to correct routes
    const boardLink = screen.getByText("Select Board").closest("a");
    expect(boardLink).toHaveAttribute("href", "/boards/board-1");

    const meetingsLink = screen.getByText("Meetings").closest("a");
    expect(meetingsLink).toHaveAttribute("href", "/boards/board-1/meetings");
  });

  it("shows section_type from template in the mocked section", () => {
    const proceduralSection = createMockSection({
      id: "sec-proc",
      title: "Call to Order",
      section_type: "procedural",
      sort_order: 0,
    });
    const discussionSection = createMockSection({
      id: "sec-disc",
      title: "New Business",
      section_type: "discussion",
      sort_order: 1,
    });
    const actionSection = createMockSection({
      id: "sec-act",
      title: "Motions",
      section_type: "action",
      sort_order: 2,
    });

    setupQueryMocks({
      items: [proceduralSection, discussionSection, actionSection],
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(screen.getByTestId("section-type-sec-proc")).toHaveTextContent(
      "procedural",
    );
    expect(screen.getByTestId("section-type-sec-disc")).toHaveTextContent(
      "discussion",
    );
    expect(screen.getByTestId("section-type-sec-act")).toHaveTextContent(
      "action",
    );
  });

  it("hides Publish Agenda button when agenda is already published", () => {
    setupQueryMocks({
      meeting: createMockMeeting({ agenda_status: "published" }),
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(
      screen.queryByRole("button", { name: /publish agenda/i }),
    ).not.toBeInTheDocument();
  });

  it("computes status bar totals from agenda items", () => {
    const section = createMockSection({
      id: "sec-1",
      title: "Discussion",
      sort_order: 0,
      estimated_duration: 0,
    });
    const item1 = createMockItem({
      id: "item-1",
      parent_item_id: "sec-1",
      estimated_duration: 15,
      sort_order: 0,
    });
    const item2 = createMockItem({
      id: "item-2",
      parent_item_id: "sec-1",
      estimated_duration: 30,
      sort_order: 1,
    });

    const exhibit1 = {
      id: "exhibit-1",
      agenda_item_id: "item-1",
      town_id: "town-1",
      sort_order: 0,
    };

    setupQueryMocks({
      items: [section, item1, item2],
      exhibits: [exhibit1],
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // 3 total items (1 section + 2 children)
    expect(screen.getByTestId("status-item-count")).toHaveTextContent("3");
    // 0 + 15 + 30 = 45 minutes
    expect(screen.getByTestId("status-duration")).toHaveTextContent("45");
    // 1 exhibit (filtered to match meeting items)
    expect(screen.getByTestId("status-exhibit-count")).toHaveTextContent("1");
    expect(screen.getByTestId("status-agenda-status")).toHaveTextContent(
      "draft",
    );
  });

  it("shows Run Meeting button when meeting status is noticed or open", () => {
    setupQueryMocks({
      meeting: createMockMeeting({ status: "noticed" }),
    });

    renderWithProviders(
      <AgendaBuilderPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(
      screen.getByRole("button", { name: /run meeting/i }),
    ).toBeInTheDocument();
  });
});
