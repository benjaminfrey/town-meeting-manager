/**
 * `AgendaSection` — its writes, its refusals, and its three `pathFilter()`
 * calls.
 *
 * Phase E wave 3, Tasks 3+4's fix round added the first two assertions here
 * against a Supabase-backed component. Wave 4, Task 3 rewrote the component
 * onto `agendaItem.reorder` / `agendaItem.delete`, so this file is rewritten
 * too — not adapted: the Supabase chainable mock is gone and the real tRPC
 * proxy runs against a stubbed transport (conventions item 8, "mock the
 * transport, not the proxy"), which is what lets these tests assert on the
 * REAL query keys and on what the component actually sent.
 *
 * Three `pathFilter()` calls, each pinned in its own right rather than riding
 * on the file's other pins — the per-test-FILE credit bleed conventions item
 * 8 documents, which has real occupants in this very file's history:
 *
 *   1. `trpc.agendaItem.pathFilter()` on the section delete;
 *   2. `trpc.agendaItem.pathFilter()` on the item reorder;
 *   3. `trpc.exhibit.pathFilter()` on the section delete — new in Task 3,
 *      because the delete cascades to the children's exhibits and the agenda
 *      builder now reads those through `exhibit.byMeeting`.
 *
 * `@dnd-kit/core` is mocked to expose the drag-end callback as a button,
 * because a real pointer drag in jsdom would be testing `@dnd-kit`, not this
 * component.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div>
      <button
        data-testid="fire-drag-end"
        onClick={() => onDragEnd({ active: { id: "item-2" }, over: { id: "item-1" } })}
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
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: "vertical",
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => null) } },
}));

vi.mock("../AgendaItemRow", () => ({
  AgendaItemRow: () => null,
}));

vi.mock("../InlineItemForm", () => ({
  InlineItemForm: () => null,
}));

import { AgendaSection } from "../AgendaSection";
import type { AgendaItem, SectionWithChildren } from "../agenda-types";

const queryClient = setupAppQueryClient();

/** Mutable so a test can make a write fail without a second stub install. */
const server = { deleteRefuses: false, reorderRefuses: false };

const stub = installTRPCFetchStub({
  "agendaItem.delete": ({ itemId }) => {
    if (server.deleteRefuses) trpcTestError("FORBIDDEN");
    return { id: itemId };
  },
  "agendaItem.reorder": ({ itemIds }) => {
    if (server.reorderRefuses) trpcTestError("FORBIDDEN");
    return { count: itemIds.length };
  },
});

function item(overrides: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    section_type: "new_business",
    sort_order: 0,
    status: "pending",
    operator_notes: null,
    title: "Item",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: "sec-1",
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: null,
    ...overrides,
  };
}

const section: SectionWithChildren = {
  ...item({ id: "sec-1", title: "New Business", parent_item_id: null }),
  children: [],
};

function seedShellCount() {
  const countKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(countKey, 5);
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();
  return countKey;
}

function seedExhibitList() {
  const exhibitKey = trpc.exhibit.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(exhibitKey, []);
  expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBeFalsy();
  return exhibitKey;
}

function renderSection(children_items: AgendaItem[]) {
  return renderWithProviders(
    <AgendaSection
      section={section}
      sectionIndex={0}
      children_items={children_items}
      meetingId="m1"
      boardId="board-1"
      exhibits={[]}
      readOnly={false}
    />,
    { queryClient },
  );
}

describe("AgendaSection", () => {
  beforeEach(() => {
    server.deleteRefuses = false;
    server.reorderRefuses = false;
  });

  it("deletes the section in ONE call, letting the database cascade its children", async () => {
    // The point of `agendaItem.delete`: three unwrapped round trips (exhibits,
    // then children, then the row) became one statement. A per-child loop
    // would show up here as more than one call.
    const { user } = renderSection([item({ id: "item-1" }), item({ id: "item-2" })]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(stub.countFor("agendaItem.delete")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toEqual({ 0: { boardId: "board-1", itemId: "sec-1" } });
  });

  it("reorders children in ONE call, sending every id in its new order", async () => {
    const { user } = renderSection([
      item({ id: "item-1", title: "First", sort_order: 0 }),
      item({ id: "item-2", title: "Second", sort_order: 1 }),
    ]);

    await user.click(screen.getByTestId("fire-drag-end"));

    await waitFor(() => expect(stub.countFor("agendaItem.reorder")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toEqual({
      0: { boardId: "board-1", itemIds: ["item-2", "item-1"] },
    });
  });

  it("invalidates trpc.agendaItem.pathFilter() when the section is removed", async () => {
    const countKey = seedShellCount();
    // Empty section: the Remove button deletes immediately, with no
    // confirmation dialog (see the component's own `itemCount > 0` branch).
    const { user } = renderSection([]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.exhibit.pathFilter() when the section is removed — the cascade", async () => {
    // `exhibit_agenda_item_id_fkey` is ON DELETE CASCADE, so removing a
    // section removes its children's exhibits too. Pinned separately from the
    // `agendaItem` call on the SAME handler: conventions item 8's credit bleed
    // is per test FILE, so a second call inside an already-pinned file rides
    // in free unless it has its own assertion.
    const exhibitKey = seedExhibitList();
    const { user } = renderSection([]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));

    await waitFor(() => expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when items are reordered — the OTHER call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderSection([
      item({ id: "item-1", title: "First", sort_order: 0 }),
      item({ id: "item-2", title: "Second", sort_order: 1 }),
    ]);

    await user.click(screen.getByTestId("fire-drag-end"));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("shows a refusal when the delete is FORBIDDEN, rather than a button that does nothing", async () => {
    // `agendaItem.delete` is A2 board-scoped; before Task 3 this was a raw
    // Supabase delete under a tenancy-only policy, so FORBIDDEN is newly
    // reachable here and a silent no-op would be indistinguishable from a
    // successful removal.
    server.deleteRefuses = true;
    const { user } = renderSection([]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to remove this section.",
    );
  });

  it("shows a refusal INSIDE the confirmation dialog when a non-empty section's delete is FORBIDDEN", async () => {
    // The sibling site to the test above. A section with children opens the
    // AlertDialog first (see the component's `itemCount > 0` branch) and the
    // refusal must render INSIDE it — Radix marks everything outside an open
    // `AlertDialog` `aria-hidden`, so an error rendered beside the dialog is
    // invisible for exactly the case it exists for (conventions item 2, "the
    // aria-hidden refusal"). The test above only exercises the OTHER branch
    // (an empty section, no dialog), so it cannot catch a regression here.
    server.deleteRefuses = true;
    const { user } = renderSection([item({ id: "item-1" })]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to remove this section.",
    );
  });

  it("shows a refusal when the reorder is FORBIDDEN", async () => {
    server.reorderRefuses = true;
    const { user } = renderSection([
      item({ id: "item-1", sort_order: 0 }),
      item({ id: "item-2", sort_order: 1 }),
    ]);

    await user.click(screen.getByTestId("fire-drag-end"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to reorder these items.",
    );
  });
});
