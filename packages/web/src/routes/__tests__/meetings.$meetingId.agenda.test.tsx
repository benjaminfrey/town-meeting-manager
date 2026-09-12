/**
 * The agenda builder (`/meetings/:meetingId/agenda`) — five reads and two
 * writes on tRPC.
 *
 * Phase E, wave 4, Task 3. This file REPLACES
 * `routes/meetings.$meetingId.agenda.test.tsx`, which mocked
 * `@tanstack/react-query`'s `useQuery` wholesale and drove a Supabase
 * chainable mock. That shape is the one conventions item 8 exists to end: the
 * query keys were invented by the test, so no assertion about a writer's
 * `pathFilter()` reaching this screen's own read was even expressible, and
 * nothing bound a payload to a procedure. Rewritten, not adapted (item 13) —
 * `@/lib/trpc` is untouched and only `globalThis.fetch` is replaced, so the
 * real proxy produces real keys.
 *
 * It also moves into `__tests__/`, matching every other route test in this
 * phase; the old file sat beside the route, which is why
 * `pathfilter-pin-coverage.test.ts` had to match by import graph rather than
 * by filename.
 *
 * The child components are mocked away exactly as the old file did — each has
 * its own dedicated writer test (`AgendaSection.test.tsx`,
 * `PublishAgendaDialog.test.tsx`, `InlineItemForm.test.tsx`,
 * `ExhibitUploader.test.tsx`, `ExhibitRow.test.tsx`) that pins its own
 * `pathFilter()` calls, matching how `boards.$boardId.meetings.test.tsx`
 * treats its dialogs. What this file owns is the SCREEN: its five reads, the
 * two writes it makes itself, and its three distinguishable states.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// This screen surfaces its refusals as toasts; `renderWithProviders` mounts
// no `<Toaster />`, so the assertion is on the call, the way
// `AddPersonDialog.test.tsx` (the house pattern this screen copies) does it.
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

vi.mock("@/lib/api-client", () => ({
  apiJson: vi.fn().mockResolvedValue({ url: "https://example.com/generated.pdf" }),
}));

vi.mock("@/components/meetings/AgendaSection", () => ({
  AgendaSection: (props: any) => (
    <div data-testid={`agenda-section-${props.section.id}`}>
      <span data-testid={`section-title-${props.section.id}`}>{props.section.title}</span>
      <span data-testid={`section-type-${props.section.id}`}>{props.section.section_type}</span>
      <span data-testid={`item-count-${props.section.id}`}>
        {props.children_items?.length ?? 0}
      </span>
      <span data-testid={`exhibit-count-${props.section.id}`}>{props.exhibits?.length ?? 0}</span>
      <span data-testid={`board-id-${props.section.id}`}>{props.boardId}</span>
      <span data-testid={`read-only-${props.section.id}`}>{props.readOnly ? "true" : "false"}</span>
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
    <div data-testid="publish-agenda-dialog" data-open={props.open} data-board={props.boardId} />
  ),
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

// `onDragEnd` is exposed as a button rather than dropped on the floor: a real
// pointer drag in jsdom would be testing `@dnd-kit`, not this route's reorder
// handler.
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div data-testid="dnd-context">
      <button
        data-testid="fire-section-drag-end"
        onClick={() => onDragEnd({ active: { id: "sec-2" }, over: { id: "sec-1" } })}
      >
        drag
      </button>
      {children}
    </div>
  ),
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

import AgendaBuilderPage from "../meetings.$meetingId.agenda";

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

type Item = RouterOutputs["agendaItem"]["byMeeting"][number];
type Exhibit = RouterOutputs["exhibit"]["byMeeting"][number];

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    section_type: "procedural",
    sort_order: 0,
    status: "pending",
    operator_notes: null,
    source_minutes_document_id: null,
    title: "Call to Order",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: null,
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: null,
    ...overrides,
  };
}

function exhibit(overrides: Partial<Exhibit> & { id: string }): Exhibit {
  return {
    agenda_item_id: "item-1",
    title: "Draft ordinance",
    file_storage_path: "https://example.test/draft.pdf",
    file_type: "url",
    file_name: null,
    exhibit_type: "supporting_document",
    visibility: "public",
    sort_order: 0,
    ...overrides,
  };
}

/**
 * `& { adjournment: unknown }` is not decoration. `RouterOutputs` runs the
 * procedure's row through tRPC's serialization inference, which turns an
 * `unknown` column into an OPTIONAL property (`unknown` includes
 * `undefined`), while `TestHandlers` infers from `inferProcedureOutput`
 * directly and still requires it. The intersection restores the requirement,
 * so a fixture that forgets the column is a compile error — the same shape
 * `meetings.$meetingId.minutes.test.tsx` already carries for three JSONB
 * columns of its own.
 */
type MeetingDetail = RouterOutputs["meeting"]["detail"] & { adjournment: unknown };

const meetingDetail = {
  id: "meeting-1",
  board_id: "board-1",
  title: "Regular Board Meeting",
  status: "draft",
  meeting_type: "regular",
  agenda_status: "draft",
  scheduled_date: "2026-03-15",
  scheduled_time: "19:00",
  location: "Town Hall",
  presiding_officer_id: null,
  recording_secretary_id: null,
  current_agenda_item_id: null,
  started_at: null,
  ended_at: null,
  agenda_packet_url: null,
  agenda_packet_generated_at: null,
  meeting_notice_url: null,
  meeting_notice_generated_at: null,
  adjournment: null,
} satisfies MeetingDetail;

const server = {
  meeting: meetingDetail as MeetingDetail,
  items: [] as Item[],
  exhibits: [] as Exhibit[],
  meetingRejects: false,
  exhibitsReject: false,
  insertRefuses: false,
  reorderRefuses: false,
};

const stub = installTRPCFetchStub({
  "meeting.detail": () => {
    if (server.meetingRejects) trpcTestError("NOT_FOUND");
    return server.meeting;
  },
  "board.detail": () => ({
    id: "board-1",
    name: "Planning Board",
    board_type: "other",
    elected_or_appointed: "elected",
    member_count: 5,
    election_method: "at_large",
    officer_election_method: "vote_of_board",
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
    r4_board_member_default: true,
    audio_retention_policy_override: null,
    auto_publish_on_approval_override: null,
  }),
  "town.detail": () => ({
    id: "town-1",
    name: "Testville",
    state: "ME",
    municipality_type: "town",
    population_range: "under_1000",
    contact_name: null,
    contact_role: null,
    meeting_formality: "informal",
    minutes_style: "summary",
    presiding_officer_default: null,
    minutes_recorder_default: null,
    staff_roles_present: null,
    subdomain: "testville",
    seal_url: null,
    retention_policy_acknowledged_at: null,
    minutes_workflow_configured_at: null,
    audio_retention_policy: "retain_30_days",
    auto_publish_on_approval: false,
    minutes_review_window_days: 7,
  }),
  "agendaItem.byMeeting": () => server.items,
  "exhibit.byMeeting": () => {
    if (server.exhibitsReject) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.exhibits;
  },
  "agendaItem.insert": () => {
    if (server.insertRefuses) trpcTestError("FORBIDDEN");
    return { id: "new-section" };
  },
  "agendaItem.reorder": ({ itemIds }) => {
    if (server.reorderRefuses) trpcTestError("FORBIDDEN");
    return { count: itemIds.length };
  },
});

/**
 * The input a given procedure was actually called with, unwrapping the batch
 * index. Not `stub.calls.at(-1)`: a mutation's own `onSuccess` invalidates,
 * which refetches, so the LAST call is a query, not the write under test.
 */
function inputFor(path: Parameters<typeof stub.countFor>[0]) {
  const call = [...stub.calls].reverse().find((c) => c.paths.includes(path));
  return call?.inputs[String(call.paths.indexOf(path))];
}

function renderRoute() {
  return renderWithProviders(
    <AgendaBuilderPage
      {...({ loaderData: { meetingId: "meeting-1" } } as Parameters<typeof AgendaBuilderPage>[0])}
    />,
    { route: "/meetings/meeting-1/agenda", queryClient },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("AgendaBuilderPage", () => {
  beforeEach(() => {
    server.meeting = meetingDetail;
    server.items = [];
    server.exhibits = [];
    server.meetingRejects = false;
    server.exhibitsReject = false;
    server.insertRefuses = false;
    server.reorderRefuses = false;
    toastError.mockClear();
  });

  it("renders the meeting title and its sections, grouped by parent", async () => {
    server.items = [
      item({ id: "sec-1", title: "Call to Order", sort_order: 0 }),
      item({ id: "sec-2", title: "Old Business", section_type: "discussion", sort_order: 1 }),
      item({ id: "item-1", title: "Budget", parent_item_id: "sec-2", sort_order: 0 }),
    ];
    renderRoute();

    expect(await screen.findByText("Regular Board Meeting")).toBeInTheDocument();
    expect(await screen.findByTestId("agenda-section-sec-1")).toBeInTheDocument();
    expect(screen.getByTestId("section-title-sec-2")).toHaveTextContent("Old Business");
    expect(screen.getByTestId("item-count-sec-2")).toHaveTextContent("1");
    expect(screen.getByTestId("item-count-sec-1")).toHaveTextContent("0");
  });

  it("passes the meeting's own board_id down to every child that writes", async () => {
    // The one property the downstream writes depend on: `boardId` is read off
    // `meeting.detail` here, once, and handed to the components whose
    // procedures authorize against it. A prop or a second read would be a
    // second source of truth for the value a guard checks.
    server.items = [item({ id: "sec-1" })];
    renderRoute();

    expect(await screen.findByTestId("board-id-sec-1")).toHaveTextContent("board-1");
    expect(screen.getByTestId("publish-agenda-dialog")).toHaveAttribute("data-board", "board-1");
  });

  it("counts the exhibits it actually received, so the badge agrees with the list", async () => {
    // `agendaItem.byMeeting` lost its own unfiltered `exhibit_count` in this
    // task: it counted rows rule 14 hides from this caller, so the badge and
    // the list disagreed. This is the replacement — the length of the
    // rule-filtered rows, which is what a restricted clerk also sees below.
    server.items = [
      item({ id: "sec-1", sort_order: 0, estimated_duration: 0 }),
      item({ id: "item-1", parent_item_id: "sec-1", estimated_duration: 15, sort_order: 0 }),
      item({ id: "item-2", parent_item_id: "sec-1", estimated_duration: 30, sort_order: 1 }),
    ];
    server.exhibits = [exhibit({ id: "ex-1", agenda_item_id: "item-1" })];
    renderRoute();

    expect(await screen.findByTestId("status-item-count")).toHaveTextContent("3");
    expect(screen.getByTestId("status-duration")).toHaveTextContent("45");
    expect(screen.getByTestId("status-exhibit-count")).toHaveTextContent("1");
    expect(screen.getByTestId("status-agenda-status")).toHaveTextContent("draft");
  });

  it("degrades to zero exhibits, not to a broken screen, when rule 14 hides them all", async () => {
    // What a clerk holding A2 but not A3, who is not a board member, now sees:
    // `exhibit.byMeeting` returns nothing, and the agenda still renders in
    // full with a zero count that matches the (empty) list.
    server.items = [
      item({ id: "sec-1", sort_order: 0 }),
      item({ id: "item-1", parent_item_id: "sec-1", sort_order: 0 }),
    ];
    server.exhibits = [];
    renderRoute();

    expect(await screen.findByTestId("agenda-section-sec-1")).toBeInTheDocument();
    expect(screen.getByTestId("status-exhibit-count")).toHaveTextContent("0");
    expect(screen.getByTestId("exhibit-count-sec-1")).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds a section through agendaItem.insert, at max sort_order + 1", async () => {
    server.items = [item({ id: "sec-1", sort_order: 4 })];
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /add section/i }));
    await user.type(screen.getByPlaceholderText("New section title"), "Public Comment");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(stub.countFor("agendaItem.insert")).toBe(1));
    expect(inputFor("agendaItem.insert")).toEqual({
      boardId: "board-1",
      meetingId: "meeting-1",
      parentItemId: null,
      sectionType: "other",
      sortOrder: 5,
      title: "Public Comment",
      description: null,
      presenter: null,
      estimatedDuration: null,
      staffResource: null,
      background: null,
      recommendation: null,
      suggestedMotion: null,
    });
  });

  it("reorders sections through agendaItem.reorder in ONE call", async () => {
    server.items = [
      item({ id: "sec-1", title: "Call to Order", sort_order: 0 }),
      item({ id: "sec-2", title: "Public Comment", sort_order: 1 }),
    ];
    const { user } = renderRoute();

    await user.click(await screen.findByTestId("fire-section-drag-end"));

    await waitFor(() => expect(stub.countFor("agendaItem.reorder")).toBe(1));
    expect(inputFor("agendaItem.reorder")).toEqual({
      boardId: "board-1",
      itemIds: ["sec-2", "sec-1"],
    });
  });

  it("invalidates trpc.agendaItem.pathFilter() after adding a section — the shell's item count", async () => {
    // `routes/meetings.$meetingId.tsx` reads its "N items" badge from
    // `trpc.agendaItem.countByMeeting`; without this handler's
    // `pathFilter()` line the shell keeps the pre-insert count for the full
    // 60s `staleTime`. Seeded under the shell's OWN key so a deleted
    // invalidation is what makes this assertion false (conventions item 13).
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(countKey, 3);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /add section/i }));
    await user.type(screen.getByPlaceholderText("New section title"), "Public Comment");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when sections are reordered — the OTHER call site", async () => {
    // Each handler carries its own `pathFilter()` line, and conventions item
    // 8's credit bleed is per test FILE: without this test the reorder line
    // could be deleted with the whole suite still green, which is exactly
    // what a reviewer's sweep found at the previous version of this screen.
    server.items = [
      item({ id: "sec-1", title: "Call to Order", sort_order: 0 }),
      item({ id: "sec-2", title: "Public Comment", sort_order: 1 }),
    ];
    const countKey = trpc.agendaItem.countByMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(countKey, 2);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();

    await user.click(await screen.findByTestId("fire-section-drag-end"));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.meeting.pathFilter() after generating a meeting notice", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate notice/i }));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.meeting.pathFilter() after generating an agenda packet — the OTHER call site", async () => {
    server.items = [item({ id: "sec-1" })];
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /generate packet/i }));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("surfaces a FORBIDDEN from agendaItem.insert instead of a button that does nothing", async () => {
    // Closing the hole made FORBIDDEN reachable on this button for the first
    // time — a raw `agenda_item` INSERT under tenancy-only RLS could not be
    // refused at all before.
    server.insertRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /add section/i }));
    await user.type(screen.getByPlaceholderText("New section title"), "Public Comment");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "You don't have permission to add a section to this agenda.",
      ),
    );
  });

  it("surfaces a FORBIDDEN from agendaItem.reorder", async () => {
    server.items = [item({ id: "sec-1", sort_order: 0 }), item({ id: "sec-2", sort_order: 1 })];
    server.reorderRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByTestId("fire-section-drag-end"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("You don't have permission to reorder this agenda."),
    );
  });

  it("shows a not-found error when meeting.detail rejects", async () => {
    server.meetingRejects = true;
    renderRoute();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This meeting could not be found.")).toBeInTheDocument();
  });

  it("says which half is missing when only exhibit.byMeeting fails", async () => {
    // The agenda still renders; only its attachments are gone. Blanking the
    // page for this would be worse than the raw query it replaces, which
    // simply returned nothing.
    server.items = [item({ id: "sec-1" })];
    server.exhibitsReject = true;
    renderRoute();

    expect(await screen.findByText("Attachments could not be loaded.")).toBeInTheDocument();
    expect(await screen.findByTestId("agenda-section-sec-1")).toBeInTheDocument();
  });

  it("passes readOnly=true when the meeting is cancelled, and hides Add Section", async () => {
    server.meeting = { ...meetingDetail, status: "cancelled" };
    server.items = [item({ id: "sec-1" })];
    renderRoute();

    expect(await screen.findByTestId("read-only-sec-1")).toHaveTextContent("true");
    expect(screen.queryByRole("button", { name: /add section/i })).not.toBeInTheDocument();
  });

  it("hides Publish Agenda when the agenda is already published", async () => {
    server.meeting = { ...meetingDetail, agenda_status: "published" };
    renderRoute();

    await screen.findByText("Regular Board Meeting");
    expect(screen.queryByRole("button", { name: /publish agenda/i })).not.toBeInTheDocument();
  });

  it("shows Run Meeting once the meeting is noticed", async () => {
    server.meeting = { ...meetingDetail, status: "noticed" };
    renderRoute();

    expect(await screen.findByRole("button", { name: /run meeting/i })).toBeInTheDocument();
  });

  it("switches the document buttons to Regenerate once a packet and notice exist", async () => {
    // The four columns this task added to `meeting.detail`. Without them the
    // labels would be stuck on "Generate" forever.
    server.meeting = {
      ...meetingDetail,
      agenda_packet_url: "https://example.test/packet.pdf",
      agenda_packet_generated_at: "2026-03-01 09:00:00-05",
      meeting_notice_url: "https://example.test/notice.pdf",
      meeting_notice_generated_at: "2026-03-01 09:00:00-05",
    };
    renderRoute();

    expect(await screen.findByRole("button", { name: /regenerate packet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate notice/i })).toBeInTheDocument();
    expect(screen.getByText(/Packet generated/)).toBeInTheDocument();
  });
});
