/**
 * `InlineItemForm` — its two `trpc.agendaItem.pathFilter()` calls.
 *
 * Phase E wave 3, Tasks 3+4 fix round. This is the writer behind the
 * user-visible regression that made the `agendaItems` MIGRATED entry
 * blocking: add an agenda item here, navigate back to
 * `routes/meetings.$meetingId.tsx`, and its "N items" badge — now served by
 * `trpc.agendaItem.countByMeeting` — kept the pre-insert number for the full
 * 60s `staleTime`, because this form only invalidated the abandoned
 * `queryKeys.agendaItems.byMeeting` key.
 *
 * `handleSave` (INSERT) and `handleDelete` (DELETE) each carry their own
 * `pathFilter()` line, so each is asserted separately.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        insert: () => Promise.resolve({ error: null }),
        update: () => chain,
        delete: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { InlineItemForm } from "../InlineItemForm";

const queryClient = setupAppQueryClient();

function seedShellCount() {
  const countKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(countKey, 3);
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();
  return countKey;
}

function renderForm(existingItem?: Record<string, unknown>) {
  return renderWithProviders(
    <InlineItemForm
      meetingId="m1"
      townId="town-1"
      parentItemId="sec-1"
      sectionType="new_business"
      sortOrder={0}
      existingItem={existingItem}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
    { queryClient },
  );
}

describe("InlineItemForm cache invalidation", () => {
  it("invalidates trpc.agendaItem.pathFilter() when a new item is added", async () => {
    const countKey = seedShellCount();
    const { user } = renderForm();

    await user.type(screen.getByPlaceholderText("Item title"), "Site Plan Review");
    // `useWizardForm` runs react-hook-form in `mode: "onBlur"` and `setValue`
    // passes `shouldValidate: false`, so `formState.isValid` — which gates
    // the Add button's `disabled` — stays false until a field blurs.
    await user.tab();

    const addButton = screen.getByRole("button", { name: "Add" });
    await waitFor(() => expect(addButton).not.toBeDisabled());
    await user.click(addButton);

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when an item is deleted — the OTHER call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderForm({ id: "item-1", title: "Site Plan Review" });

    await user.click(screen.getByRole("button", { name: /delete/i }));
    // The confirmation dialog's own destructive button, not the trigger.
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });
});
