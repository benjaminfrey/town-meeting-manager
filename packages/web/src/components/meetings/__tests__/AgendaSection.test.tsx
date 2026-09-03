/**
 * `AgendaSection` — its two `trpc.agendaItem.pathFilter()` calls.
 *
 * Phase E wave 3, Tasks 3+4 fix round. `routes/meetings.$meetingId.tsx`'s
 * shell reads its "N items" badge from `trpc.agendaItem.countByMeeting`;
 * this component DELETEs a section and all of its children (a real count
 * change) and reorders items (an `agenda_item` write either way), and
 * invalidated only the abandoned `queryKeys.agendaItems.byMeeting` key
 * before this round.
 *
 * `handleDeleteSection` and `handleItemDragEnd` each carry their own
 * `pathFilter()` line, so each is asserted separately. `@dnd-kit/core` is
 * mocked to expose the drag-end callback as a button — the same technique
 * `routes/meetings.$meetingId.live.test.tsx` uses to reach `onNavigate` —
 * because a real pointer drag in jsdom would be testing `@dnd-kit`, not this
 * invalidation.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        update: () => chain,
        delete: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

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

const queryClient = setupAppQueryClient();

const section = {
  id: "sec-1",
  title: "New Business",
  section_type: "new_business",
  sort_order: 0,
  children: [],
};

function seedShellCount() {
  const countKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(countKey, 5);
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();
  return countKey;
}

function renderSection(children_items: Record<string, unknown>[]) {
  return renderWithProviders(
    <AgendaSection
      section={section}
      sectionIndex={0}
      children_items={children_items}
      meetingId="m1"
      townId="town-1"
      exhibits={[]}
      readOnly={false}
    />,
    { queryClient },
  );
}

describe("AgendaSection cache invalidation", () => {
  it("invalidates trpc.agendaItem.pathFilter() when the section is removed", async () => {
    const countKey = seedShellCount();
    // Empty section: the Remove button deletes immediately, with no
    // confirmation dialog (see the component's own `itemCount > 0` branch).
    const { user } = renderSection([]);

    await user.click(screen.getByRole("button", { name: /remove section/i }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when items are reordered — the OTHER call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderSection([
      { id: "item-1", title: "First", sort_order: 0 },
      { id: "item-2", title: "Second", sort_order: 1 },
    ]);

    await user.click(screen.getByTestId("fire-drag-end"));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });
});
