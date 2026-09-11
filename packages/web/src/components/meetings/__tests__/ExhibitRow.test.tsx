/**
 * `ExhibitRow` — the cache key its delete owes.
 *
 * New in Phase E wave 4, Task 3. The DELETE itself does not change: it stays
 * at the D1e endpoint (`DELETE /api/files/exhibits/:id`), because a tRPC
 * resolver cannot remove the bytes after the transaction commits — see
 * `exhibit.ts`'s header for why there is no `exhibit.delete`. What changed is
 * that the agenda builder now reads its exhibits through
 * `trpc.exhibit.byMeeting`, so this writer of the abandoned
 * `queryKeys.exhibits.byItem` key owes `trpc.exhibit.pathFilter()` in the
 * same commit (conventions item 7), and item 8 says the call gets its pin in
 * that same commit rather than on a later wave.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

const { mockApiJson } = vi.hoisted(() => ({ mockApiJson: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiJson: mockApiJson }));

vi.mock("@/hooks/useExhibitUpload", () => ({
  exhibitDownloadUrl: (id: string) => `/api/files/exhibits/${id}`,
}));

import { ExhibitRow } from "../ExhibitRow";
import type { MeetingExhibit } from "../agenda-types";

const queryClient = setupAppQueryClient();

const exhibit: MeetingExhibit = {
  id: "ex-1",
  agenda_item_id: "item-1",
  title: "Draft ordinance",
  file_storage_path: "https://example.test/draft.pdf",
  file_type: "url",
  file_name: null,
  exhibit_type: "supporting_document",
  visibility: "public",
  sort_order: 0,
};

describe("ExhibitRow", () => {
  it("invalidates trpc.exhibit.pathFilter() after the exhibit is deleted", async () => {
    mockApiJson.mockResolvedValue({});
    const exhibitKey = trpc.exhibit.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(exhibitKey, [exhibit]);
    expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <ExhibitRow exhibit={exhibit} index={0} readOnly={false} />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: "Delete Draft ordinance" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true));
  });

  // Wave 4, Task 3's fix round 1. Rule 16 (A3 for this board, not rule 15's
  // wider "A3 or a board seat") makes this the strictest-guarded write on the
  // agenda builder screen, so a refusal here is the most likely of the
  // refusal surfaces this task shipped — and it had no test at all. The
  // dialog stays open on a refused delete (the close lives after a
  // successful `apiJson` call), so the error must render, and be findable,
  // inside it.
  it("shows the refusal inside the dialog when the delete is refused", async () => {
    mockApiJson.mockRejectedValue(new Error("You don't have permission to delete this exhibit."));
    const { user } = renderWithProviders(
      <ExhibitRow exhibit={exhibit} index={0} readOnly={false} />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: "Delete Draft ordinance" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to delete this exhibit.",
    );
  });
});
