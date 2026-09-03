/**
 * `routes/meetings.$meetingId.review.tsx` — its
 * `trpc.minutesDocument.pathFilter()` invalidation.
 *
 * Phase E wave 3, Tasks 3+4 fix round. Task 3 moved
 * `routes/meetings.$meetingId.tsx`'s minutes status pill onto
 * `trpc.minutesDocument.byMeeting`; generating (or regenerating) minutes from
 * this page creates or replaces the meeting's `minutes_document`, so without
 * a `pathFilter()` call the shell keeps saying "Not yet generated" for the
 * full 60s `staleTime`.
 *
 * Scoped to that pin rather than added to a general route test, because this
 * route has none — its ~15 Supabase-backed `useQuery` calls are mocked
 * wholesale here (the same shape `meetings.$meetingId.agenda.test.tsx` uses)
 * and the rest of the page's rendering is out of this round's scope. The
 * filename follows the `boards.$boardId.templates.$templateId.edit.pathfilter.test.tsx`
 * precedent for a narrow-slice pin on a large route.
 */

import React from "react";
import { vi, describe, it, expect } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { queryClient } from "@/lib/queryClient";
import { trpc } from "@/lib/trpc";

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

// A REAL `QueryClient`, not a stand-in: this route imports the singleton
// directly, and the pin needs a cache a deleted invalidation can fail to
// touch (conventions item 13).
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    resetQueryCache: vi.fn(),
  };
});

vi.mock("@/lib/api-client", () => ({
  apiJson: vi.fn().mockResolvedValue({ id: "md-1" }),
}));

vi.mock("./+types/meetings.$meetingId.review", () => ({}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...(actual as object), useNavigate: () => vi.fn() };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    id: "user-1",
    personId: "person-1",
    townId: "town-1",
    role: "admin",
    permissions: {},
  }),
}));

vi.mock("@/components/meeting/FutureItemsQueue", () => ({
  FutureItemsQueue: () => null,
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

import PostMeetingReviewPage from "./meetings.$meetingId.review";

const mockMeeting = {
  id: "meeting-1",
  board_id: "board-1",
  town_id: "town-1",
  title: "Regular Meeting",
  status: "adjourned",
  scheduled_date: "2026-03-10",
  scheduled_time: "18:00",
  location: "Town Hall",
  started_at: "2026-03-10T18:00:00Z",
  ended_at: "2026-03-10T19:30:00Z",
  presiding_officer_id: null,
  recording_secretary_id: null,
  adjournment: null,
};

function setupQueries() {
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
    const namespace = queryKey[0] as string;
    if (namespace === "meetings") return { data: mockMeeting, isLoading: false, error: undefined };
    if (namespace === "boards") {
      return {
        data: { id: "board-1", name: "Planning Board", minutes_style_override: null },
        isLoading: false,
        error: undefined,
      };
    }
    if (namespace === "towns") {
      return {
        data: { id: "town-1", minutes_style: "summary" },
        isLoading: false,
        error: undefined,
      };
    }
    // Every list-shaped query, `minutesDocuments` included — an EMPTY
    // minutes list is what makes "Generate Minutes Draft" render.
    return { data: [], isLoading: false, error: undefined };
  });
}

describe("PostMeetingReviewPage cache invalidation", () => {
  it("invalidates trpc.minutesDocument.pathFilter() after generating a minutes draft", async () => {
    setupQueries();

    const minutesKey = trpc.minutesDocument.byMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(minutesKey, null);
    expect(queryClient.getQueryState(minutesKey)?.isInvalidated).toBeFalsy();

    renderWithProviders(
      <PostMeetingReviewPage {...({ loaderData: { meetingId: "meeting-1" } } as any)} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate minutes draft/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^generate draft$/i }));

    await waitFor(() => {
      expect(queryClient.getQueryState(minutesKey)?.isInvalidated).toBe(true);
    });
  });
});
