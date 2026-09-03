/**
 * Meetings kanban (/) — `meeting.byTown`/`meeting.updateStatus` on tRPC.
 *
 * Phase E, wave 3, Task 2. Same shape as `boards.$boardId.test.tsx`:
 * `@/lib/trpc` is NOT mocked, only `globalThis.fetch` is replaced via
 * `installTRPCFetchStub`, so the query keys under test are the real ones
 * `transitionMutation`'s `trpc.meeting.pathFilter()` invalidation actually
 * reaches.
 *
 * `@dnd-kit/core`/`sortable`/`utilities` are mocked — real pointer-drag
 * simulation is impractical in jsdom (dnd-kit's collision detection reads
 * `getBoundingClientRect`, which jsdom always reports as zero-sized — the
 * same reason `meetings.$meetingId.agenda.test.tsx` mocks the library away
 * rather than simulating a real drag). Unlike that file, `DndContext` here
 * captures its real `onDragEnd` prop instead of discarding it, so a test can
 * invoke the SAME `handleDragEnd` → confirm dialog → `transitionMutation`
 * code path a real drag would — this is what lets `transitionMutation`'s own
 * `trpc.meeting.pathFilter()` invalidation be pinned by mutation (item 13),
 * not merely asserted by directly calling `invalidateQueries` from the test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import MeetingsPage from "../meetings";

// ─── Mock identity / permissions ─────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

vi.mock("@/hooks/usePermission", () => ({
  usePermission: () => ({ allowed: true }),
}));

// The board picker's read — still raw Supabase, not this task's file (see
// meetings.tsx's own header). Resolves empty; the picker is never opened by
// these tests.
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain["throwOnError"] = () => Promise.resolve({ data: [], error: null });
  for (const m of ["select", "eq", "is", "order"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { supabase: { from: vi.fn().mockReturnValue(chain) } };
});

// ─── Mock @dnd-kit — capture the real onDragEnd instead of discarding it ──

const dnd = vi.hoisted(() => ({ onDragEnd: null as ((e: DragEndEvent) => void) | null }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: { children: ReactNode; onDragEnd: (e: DragEndEvent) => void }) => {
    dnd.onDragEnd = props.onDragEnd;
    return props.children;
  },
  DragOverlay: (props: { children: ReactNode }) => props.children,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn().mockReturnValue([]),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

const noticedMeeting = {
  id: "m1",
  title: "Regular Meeting",
  status: "noticed",
  meeting_type: "regular",
  scheduled_date: "2026-09-10",
  scheduled_time: "18:00:00",
  board_id: "b1",
  board_name: "Select Board",
} satisfies RouterOutputs["meeting"]["byTown"][number];

/** Mutable so a test can change what the server returns between refetches. */
const server = {
  meetings: [noticedMeeting] as RouterOutputs["meeting"]["byTown"],
  byTownRejects: false,
};

/** Set by the `meeting.updateStatus` handler, so a test can assert on the exact input sent. */
const received: { updateStatus?: unknown } = {};

const stub = installTRPCFetchStub({
  "meeting.byTown": () => {
    if (server.byTownRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.meetings;
  },
  "meeting.updateStatus": (input) => {
    received.updateStatus = input;
    return { id: input.meetingId, status: input.status };
  },
});

function renderRoute() {
  return renderWithProviders(<MeetingsPage />, { route: "/", queryClient });
}

describe("meetings kanban", () => {
  beforeEach(() => {
    server.meetings = [noticedMeeting];
    server.byTownRejects = false;
    received.updateStatus = undefined;
    dnd.onDragEnd = null;
  });

  it("shows a meeting's title and board name in its column", async () => {
    renderRoute();
    expect(await screen.findByText("Regular Meeting")).toBeInTheDocument();
    expect(screen.getByText("Select Board")).toBeInTheDocument();
  });

  it("shows an error state when meeting.byTown rejects, not an empty page", async () => {
    server.byTownRejects = true;
    renderRoute();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Something went wrong loading meetings.")).toBeInTheDocument();
  });

  it('sends the real DB status ("open"), not the kanban column id ("active"), for a noticed→active drag', async () => {
    // The bug this file's header names: the kanban's "Active" column id and
    // `open` (the real `meeting_status`) are different strings, and a
    // previous version of this file sent the column id as the write.
    const { user } = renderRoute();
    await screen.findByText("Regular Meeting");
    expect(dnd.onDragEnd).not.toBeNull();

    dnd.onDragEnd!({
      active: { id: "m1" },
      over: { id: "active" },
    } as unknown as DragEndEvent);

    expect(await screen.findByText("Open this meeting for attendance?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(received.updateStatus).toEqual({ meetingId: "m1", boardId: "b1", status: "open" }),
    );
  });

  it("refetches meeting.byTown when the status-change mutation succeeds", async () => {
    // Pins `transitionMutation`'s own `trpc.meeting.pathFilter()` call by
    // mutation (conventions item 13): deleting that line leaves this
    // assertion at `before`, since nothing else in this flow re-fetches
    // `meeting.byTown`.
    const { user } = renderRoute();
    await screen.findByText("Regular Meeting");
    const before = stub.countFor("meeting.byTown");

    dnd.onDragEnd!({
      active: { id: "m1" },
      over: { id: "active" },
    } as unknown as DragEndEvent);
    await screen.findByText("Open this meeting for attendance?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(stub.countFor("meeting.byTown")).toBeGreaterThan(before));
  });

  it("refetches when a writer invalidates trpc.meeting.pathFilter() directly", async () => {
    renderRoute();
    await screen.findByText("Regular Meeting");
    const before = stub.countFor("meeting.byTown");

    server.meetings = [{ ...noticedMeeting, title: "Renamed Meeting" }];
    await queryClient.invalidateQueries(trpc.meeting.pathFilter());

    await waitFor(() => expect(stub.countFor("meeting.byTown")).toBeGreaterThan(before));
    expect(await screen.findByText("Renamed Meeting")).toBeInTheDocument();
  });
});
