/**
 * `routes/meetings.$meetingId.minutes.tsx` — its `trpc.minutesDocument.pathFilter()` call.
 *
 * Whole-branch fix round, wave 3. This screen writes `minutes_document.status`
 * at six sites (submit for review, approve, publish, return for amendments,
 * unpublish, regenerate) and invalidated ONLY `queryKeys.minutes.byMeeting`.
 * `routes/meetings.$meetingId.tsx`'s shell renders the minutes status pill
 * from `trpc.minutesDocument.byMeeting` (wave 3, Task 3), so publishing
 * minutes and returning to the meeting detail showed a stale pill for up to
 * the 60s `staleTime` — the identical regression the previous fix round closed
 * for eight other files.
 *
 * It survived one commit longer for a mechanical reason worth recording: this
 * writer uses the `minutes` namespace, and `lib/__tests__/cache-key-parity.test.ts`'s
 * `MIGRATED` map only carried `minutesDocuments`. Two namespaces, one table.
 * Both are in the map now.
 *
 * All six sites funnel through ONE `invalidateMinutes()` helper, so one pin
 * covers the call — but the pin must still be one a DELETION turns red
 * (conventions item 13), which is why it seeds the SHELL's own key rather
 * than the legacy one this screen also invalidates.
 *
 * Supabase is mocked at `@/lib/supabase` (this route imports the client
 * directly) rather than mocking `useQuery`: the real query layer then runs,
 * so the key the component reads is the key the test seeds.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/lib/supabase", () => {
  // Declared INSIDE the factory: `vi.mock` is hoisted above every top-level
  // binding in this file, so a module-scope fixture would be read before it
  // is initialised.
  const rowsFor: Record<string, unknown[]> = {
    minutes_document: [
      {
        id: "minutes-1",
        meeting_id: "meeting-1",
        town_id: "town-1",
        status: "review",
        html_rendered: "<p>Minutes body</p>",
        content_json: null,
        original_content_json: null,
        amendments_history: [],
        pdf_url: null,
        generated_at: "2026-01-02T00:00:00Z",
        submitted_for_review_at: "2026-01-03T00:00:00Z",
        approved_at: null,
        published_at: null,
      },
    ],
    meeting: [
      {
        id: "meeting-1",
        board_id: "board-1",
        town_id: "town-1",
        scheduled_date: "2026-01-01",
        meeting_type: "regular",
      },
    ],
    board: [{ id: "board-1", name: "Select Board" }],
    town: [{ id: "town-1", name: "Testville" }],
  };
  return {
    supabase: {
      from: (table: string) => {
        const result = { data: rowsFor[table] ?? [], error: null };
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        };
        for (const m of ["select", "insert", "update", "delete", "eq", "limit", "throwOnError"]) {
          chain[m] = () => chain;
        }
        return chain;
      },
    },
  };
});

// `approveMutation` posts to the minutes approve endpoint; the invalidation
// under test happens in its `onSuccess`.
vi.mock("@/lib/api-client", () => ({
  apiJson: vi.fn().mockResolvedValue({}),
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    id: "user-1",
    townId: "town-1",
    role: "admin",
    permissions: {},
  }),
}));

vi.mock("@/components/minutes/MinutesEditor", () => ({
  MinutesEditor: () => <div data-testid="minutes-editor" />,
}));

vi.mock("@/components/minutes/TrackedChanges", () => ({
  TrackedChanges: () => <div data-testid="tracked-changes" />,
}));

vi.mock("./+types/meetings.$meetingId.minutes", () => ({}));

import MinutesReviewPage from "./meetings.$meetingId.minutes";

const queryClient = setupAppQueryClient();

describe("MinutesReviewPage cache invalidation", () => {
  it("invalidates trpc.minutesDocument.pathFilter() when minutes are approved — the shell's status pill", async () => {
    const pillKey = trpc.minutesDocument.byMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(pillKey, { id: "minutes-1", status: "review" });
    expect(queryClient.getQueryState(pillKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <MinutesReviewPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
      { queryClient },
    );

    const approve = await screen.findByRole("button", { name: /approve minutes/i });
    await user.click(approve);

    await waitFor(() => {
      expect(queryClient.getQueryState(pillKey)?.isInvalidated).toBe(true);
    });
  });
});
