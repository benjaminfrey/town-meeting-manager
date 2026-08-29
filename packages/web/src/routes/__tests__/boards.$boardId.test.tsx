/**
 * Board detail screen — Overview data on tRPC.
 *
 * This screen had no test before Phase E unit 0, task 4, so there is nothing
 * to adapt: `@/lib/trpc` is mocked directly (its `queryOptions()` shape),
 * never Supabase's chainable client. See the 14 files elsewhere in this repo
 * that DO mock Supabase for what NOT to imitate — this project has shipped
 * four suites that could never fail, and each began as an adapted mock.
 *
 * Only `board.detail` / `board.stats` / `board.recentMeetings` — the three
 * procedures this task migrates — are exercised here. `town` and the agenda
 * template count still read through `@/lib/supabase` in the component (see
 * its comment), so that module is mocked too, just enough that those two
 * queries resolve instead of hitting a real network client in jsdom.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { TRPCClientError } from "@trpc/client";
import { queryClient, resetQueryCache } from "@/lib/queryClient";

// ─── Mock tRPC ──────────────────────────────────────────────────────────

const { trpcState } = vi.hoisted(() => ({
  trpcState: { detailRejects: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    board: {
      detail: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.detail", input],
          queryFn: async () => {
            if (trpcState.detailRejects) {
              // A real TRPCClientError instance, not a plain object, so the
              // component's `isTRPCClientError(boardError)` narrowing (the
              // same check production code uses to distinguish NOT_FOUND
              // from any other failure) is exercised for real.
              throw TRPCClientError.from({
                error: { code: -32004, message: "Not found", data: { code: "NOT_FOUND" } },
              });
            }
            return {
              id: "b1",
              name: "Select Board",
              elected_or_appointed: "elected",
              member_count: 5,
              election_method: "at_large",
              officer_election_method: "vote_of_board",
              is_governing_board: true,
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
            };
          },
        }),
      },
      stats: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.stats", input],
          queryFn: async () => ({ active_members: 3, meetings: 7 }),
        }),
      },
      recentMeetings: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.recentMeetings", input],
          queryFn: async () => [],
        }),
      },
    },
  },
}));

// ─── Mock Supabase (only town + template-count reads still use it) ─────────

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain["throwOnError"] = () => Promise.resolve({ data: [], count: 0, error: null });
  for (const m of ["select", "eq", "limit", "order", "neq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { supabase: { from: vi.fn().mockReturnValue(chain) } };
});

// ─── Mock identity ──────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

import BoardDetailPage from "../boards.$boardId";

// ─── Render helper ──────────────────────────────────────────────────────

function renderRoute(path: string, opts: { detailRejects?: boolean } = {}) {
  trpcState.detailRejects = opts.detailRejects ?? false;
  const boardId = path.split("/").pop()!;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        {/* Only `loaderData` is real here — `params`/`matches` are React
            Router's data-router plumbing, unused by this component, and not
            worth wiring a full data router for in a unit test. */}
        <BoardDetailPage {...({ loaderData: { boardId } } as any)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("board detail", () => {
  beforeEach(() => {
    resetQueryCache();
    trpcState.detailRejects = false;
    // This is the app's real QueryClient singleton (per @/lib/trpc's own
    // comment, trpc's options proxy is bound to it — a test must reuse it,
    // not construct its own). Its production defaults retry failed queries
    // twice with backoff, which would make the error-state test wait several
    // seconds for `isError` to ever become true; pin retry off for
    // determinism the way `createTestQueryClient()` does elsewhere.
    queryClient.setDefaultOptions({
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    });
  });

  it("shows the board's name and its member and meeting counts", async () => {
    renderRoute("/boards/b1");
    // The name renders twice (breadcrumb + header), so assert with findAllByText.
    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    expect(await screen.findByText("3 members")).toBeInTheDocument();
    expect(await screen.findByText("7 meetings")).toBeInTheDocument();
  });

  it("shows an error state when a query rejects, not an empty page", async () => {
    // The failure mode this whole phase exists to end is a screen that
    // renders nothing and says nothing. An error must be visible.
    renderRoute("/boards/b1", { detailRejects: true });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
