/**
 * `ExhibitUploader` — the unauthorized link-insert, closed.
 *
 * New in Phase E wave 4, Task 3. `handleAddUrl` was a second creation path
 * for the `exhibit` table: a raw INSERT through the dead Supabase client,
 * with no rule, no existence check on `agenda_item_id` (FK enforcement
 * bypasses RLS), a client-supplied `town_id` and `uploaded_by` left NULL,
 * under a tenancy-only RLS policy. It now calls `exhibit.link`, which applies
 * rule 15 against the board derived from the agenda item.
 *
 * Three things are pinned here, and only the first is about caching:
 *
 *   1. Both PATHS to this file's single `trpc.exhibit.pathFilter()` call —
 *      the link write and the D1e FILE upload — each by its own test. The one
 *      call sits in an `invalidateExhibits` helper both handlers reach, so
 *      commenting it turns BOTH tests red; the second test is what keeps the
 *      upload path covered if the two ever stop sharing the helper.
 *   2. What the link write SENDS: no `townId`, no client-minted `id`, no
 *      `sortOrder` computed from a client-side array length. Asserting the
 *      exact input is what would catch one of them creeping back.
 *   3. That a FORBIDDEN refusal is shown. Rule 15 is A3-for-this-board OR a
 *      board seat, so a staff member with neither is refused here for the
 *      first time.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

const { mockUpload } = vi.hoisted(() => ({ mockUpload: vi.fn() }));

vi.mock("@/hooks/useExhibitUpload", () => ({
  useExhibitUpload: () => ({ upload: mockUpload, isUploading: false, error: null }),
  exhibitDownloadUrl: (id: string) => `/api/files/exhibits/${id}`,
}));

import { ExhibitUploader } from "../ExhibitUploader";

const queryClient = setupAppQueryClient();

const server = { linkRefuses: false };

const stub = installTRPCFetchStub({
  "exhibit.link": () => {
    if (server.linkRefuses) trpcTestError("FORBIDDEN");
    return { id: "ex-new" };
  },
});

function seedExhibitList() {
  const exhibitKey = trpc.exhibit.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(exhibitKey, []);
  expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBeFalsy();
  return exhibitKey;
}

function renderUploader() {
  return renderWithProviders(
    <ExhibitUploader
      agendaItemId="item-1"
      meetingId="m1"
      boardId="board-1"
      exhibits={[]}
      readOnly={false}
    />,
    { queryClient },
  );
}

async function openLinkForm(user: ReturnType<typeof renderUploader>["user"]) {
  await user.click(screen.getByRole("button", { name: /add exhibit/i }));
  await user.click(screen.getByRole("button", { name: /link url instead/i }));
  await user.type(screen.getByPlaceholderText("Exhibit title"), "Draft ordinance");
  await user.type(screen.getByPlaceholderText("https://..."), "https://example.test/draft.pdf");
}

describe("ExhibitUploader", () => {
  beforeEach(() => {
    server.linkRefuses = false;
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ id: "ex-uploaded" });
  });

  it("adds a link through exhibit.link, sending no town, id or sort order", async () => {
    const { user } = renderUploader();
    await openLinkForm(user);

    await user.click(screen.getByRole("button", { name: /add link/i }));

    await waitFor(() => expect(stub.countFor("exhibit.link")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toEqual({
      0: {
        boardId: "board-1",
        agendaItemId: "item-1",
        title: "Draft ordinance",
        url: "https://example.test/draft.pdf",
        exhibitType: "supporting_document",
      },
    });
  });

  it("invalidates trpc.exhibit.pathFilter() after adding a link", async () => {
    const exhibitKey = seedExhibitList();
    const { user } = renderUploader();
    await openLinkForm(user);

    await user.click(screen.getByRole("button", { name: /add link/i }));

    await waitFor(() => expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.exhibit.pathFilter() after a FILE upload — the OTHER call site", async () => {
    // The D1e upload endpoint stays where it is (multipart, byte sniffing, the
    // row written in the same transaction as the bytes), but it creates the
    // same kind of row `exhibit.byMeeting` now serves, so it owes the same
    // invalidation. A different transport is not a different table.
    const exhibitKey = seedExhibitList();
    const { user } = renderUploader();

    await user.click(screen.getByRole("button", { name: /add exhibit/i }));
    const file = new File(["%PDF-1.4"], "draft.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("File"), file);

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true));
  });

  it("shows the refusal when exhibit.link is FORBIDDEN, rather than a button that does nothing", async () => {
    server.linkRefuses = true;
    const { user } = renderUploader();
    await openLinkForm(user);

    await user.click(screen.getByRole("button", { name: /add link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to attach a link to this item.",
    );
  });
});
