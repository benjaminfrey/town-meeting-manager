/**
 * `CommandPalette` — Phase E, wave 6, Task 5.
 *
 * This component had no test of any kind while it made two live raw Supabase
 * reads, which is the same blind spot item 11 names for its marker sweep: the
 * file looked done from every angle except the import grep.
 *
 * Real options proxy, real `QueryClient`, `globalThis.fetch` stubbed
 * (conventions item 8) — so the query keys the palette reads under are the
 * ones a writer's `trpc.meeting.pathFilter()` / `trpc.board.pathFilter()`
 * actually matches.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { renderWithProviders, screen, setupAppQueryClient, waitFor } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

// `cmdk` scrolls the selected item into view on mount; jsdom implements no
// `scrollIntoView`. File-scoped, matching `MemberTransitionDialog.test.tsx`'s
// note on the same class of gap for Radix `Select`.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1", role: "admin", email: "a@b.test" }),
}));

const older: RouterOutputs["meeting"]["byTown"][number] = {
  id: "m-old",
  title: "Older Meeting",
  status: "approved",
  meeting_type: "regular",
  scheduled_date: "2026-01-05",
  scheduled_time: "18:00:00",
  started_at: null,
  board_id: "b1",
  board_name: "Select Board",
};

const newer: RouterOutputs["meeting"]["byTown"][number] = {
  ...older,
  id: "m-new",
  title: "Newer Meeting",
  scheduled_date: "2026-09-10",
};

const boards: RouterOutputs["board"]["listActive"] = [
  {
    id: "b1",
    name: "Select Board",
    member_count: 5,
    is_governing_board: true,
    election_method: "at_large",
    officer_election_method: "vote_of_board",
  },
];

const server = {
  meetings: [older, newer],
  meetingsReject: false,
  boardsReject: false,
};

const stub = installTRPCFetchStub({
  "meeting.byTown": () => {
    if (server.meetingsReject) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.meetings;
  },
  "board.listActive": () => {
    if (server.boardsReject) trpcTestError("INTERNAL_SERVER_ERROR");
    return boards;
  },
});

import { CommandPalette } from "../CommandPalette";

const queryClient = setupAppQueryClient();

function renderPalette(open = true) {
  return renderWithProviders(<CommandPalette open={open} onOpenChange={() => {}} />, {
    queryClient,
  });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    server.meetings = [older, newer];
    server.meetingsReject = false;
    server.boardsReject = false;
  });

  it("lists the town's boards and meetings once opened", async () => {
    renderPalette();
    expect(await screen.findByText("Newer Meeting")).toBeInTheDocument();
    expect(screen.getByText("Older Meeting")).toBeInTheDocument();
    // The board group and the meeting group both render the board's name, so
    // this is an "at least one" assertion, not an exact-count one.
    expect(screen.getAllByText("Select Board").length).toBeGreaterThan(0);
  });

  it("orders meetings most-recent-first, which meeting.byTown does not do", async () => {
    // `meeting.byTown` returns ascending by date (the kanban's order); the
    // raw query this replaced was descending. The sort lives at this call
    // site — deleting it puts "Older Meeting" first and turns this red.
    renderPalette();
    await screen.findByText("Newer Meeting");
    const titles = screen
      .getAllByText(/Meeting$/)
      .map((el) => el.textContent)
      .filter((t) => t === "Newer Meeting" || t === "Older Meeting");
    expect(titles).toEqual(["Newer Meeting", "Older Meeting"]);
  });

  it("makes neither read until the palette is actually opened", () => {
    renderPalette(false);
    expect(stub.countFor("meeting.byTown")).toBe(0);
    expect(stub.countFor("board.listActive")).toBe(0);
  });

  it("says so when the search reads fail, instead of rendering 'No results found.'", async () => {
    server.meetingsReject = true;
    server.boardsReject = true;
    renderPalette();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load search results/i);
  });

  it("refetches when a writer invalidates trpc.meeting.pathFilter()", async () => {
    renderPalette();
    await screen.findByText("Newer Meeting");
    const before = stub.countFor("meeting.byTown");

    server.meetings = [{ ...newer, title: "Renamed Meeting" }];
    await queryClient.invalidateQueries(trpc.meeting.pathFilter());

    await waitFor(() => expect(stub.countFor("meeting.byTown")).toBeGreaterThan(before));
    expect(await screen.findByText("Renamed Meeting")).toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
    renderPalette();
    await screen.findByText("Newer Meeting");
    const before = stub.countFor("board.listActive");

    await queryClient.invalidateQueries(trpc.board.pathFilter());

    await waitFor(() => expect(stub.countFor("board.listActive")).toBeGreaterThan(before));
  });
});
