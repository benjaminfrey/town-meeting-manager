/**
 * MemberRoster — real options proxy, stubbed transport.
 *
 * Phase E, wave 2, Task 3. Was three `@tanstack/react-query` mocks keyed by
 * invented query-key strings (`"members"`, `"userAccounts"`) — exactly the
 * anti-pattern conventions item 8 exists to end: those keys matched nothing
 * the app actually produces, so a deleted `boardMember.roster` read (or a
 * missing invalidation call from any writer) could not have been caught.
 * Rewritten on `installTRPCFetchStub`, per that item.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import type { RouterOutputs } from "@/lib/trpc";

// `sendInviteMutation`/`resendInviteMutation` POST to the existing REST
// endpoints (`/api/invitations/:id/send`/`/resend`), not tRPC —
// `installTRPCFetchStub` only answers `/api/trpc/...`. Mocked directly so
// those two mutations' `onSuccess` actually fires.
const { apiJsonMock } = vi.hoisted(() => ({ apiJsonMock: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api-client", () => ({ apiJson: apiJsonMock }));

vi.mock("@/components/members/AddMemberDialog", () => ({
  AddMemberDialog: () => null,
}));
vi.mock("@/components/members/MemberArchiveDialog", () => ({
  MemberArchiveDialog: () => null,
}));
vi.mock("@/components/members/MemberTransitionDialog", () => ({
  MemberTransitionDialog: () => null,
}));
vi.mock("@/components/members/EditGovTitleDialog", () => ({
  EditGovTitleDialog: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { MemberRoster } from "../MemberRoster";

const queryClient = setupAppQueryClient();

type RosterRow = RouterOutputs["boardMember"]["roster"][number];

function rosterRow(overrides: Partial<RosterRow> & { id: string; person_id: string }): RosterRow {
  return {
    board_id: "board-1",
    seat_title: null,
    term_start: null,
    term_end: null,
    status: "active",
    is_default_rec_sec: false,
    name: "Test Person",
    email: "test@test.com",
    user_account_id: null,
    role: null,
    gov_title: null,
    user_account_archived_at: null,
    invitation_id: null,
    invitation_token: null,
    invitation_status: null,
    invitation_sent_at: null,
    invitation_expires_at: null,
    ...overrides,
  };
}

/** Mutable so a test can change what the server returns between renders. */
const server = { rows: [] as RosterRow[] };

const stub = installTRPCFetchStub({
  "boardMember.roster": () => server.rows,
});

const defaultProps = {
  boardId: "board-1",
  boardName: "Select Board",
  electionMethod: "at_large",
  townId: "town-1",
  isArchived: false,
};

function renderRoster(props = defaultProps) {
  return renderWithProviders(<MemberRoster {...props} />, { queryClient });
}

describe("MemberRoster", () => {
  beforeEach(() => {
    server.rows = [];
  });

  it("renders member names from the roster", async () => {
    server.rows = [
      rosterRow({ id: "bm1", person_id: "p1", name: "Alice Johnson" }),
      rosterRow({ id: "bm2", person_id: "p2", name: "Bob Smith" }),
    ];
    renderRoster();

    expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();
    expect(await screen.findByText("Bob Smith")).toBeInTheDocument();
  });

  it("shows Add Member button when board is not archived", () => {
    renderRoster({ ...defaultProps, isArchived: false });
    const addButtons = screen.getAllByText("Add Member");
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("hides Add Member button when board is archived", () => {
    renderRoster({ ...defaultProps, isArchived: true });
    expect(screen.queryByText("Add Member")).not.toBeInTheDocument();
  });

  it("shows gov_title in parentheses next to name", async () => {
    server.rows = [
      rosterRow({
        id: "bm1",
        person_id: "p1",
        name: "Jane Doe",
        role: "staff",
        gov_title: "Town Clerk",
      }),
    ];
    renderRoster();

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(await screen.findByText("(Town Clerk)")).toBeInTheDocument();
  });

  it("shows empty state message when no members", async () => {
    renderRoster({ ...defaultProps, boardName: "Planning Board" });
    expect(
      await screen.findByText(
        "No members added yet. Add your Planning Board members to get started.",
      ),
    ).toBeInTheDocument();
  });

  it("displays active count correctly", async () => {
    server.rows = [
      rosterRow({ id: "bm1", person_id: "p1", name: "Alice", status: "active" }),
      rosterRow({ id: "bm2", person_id: "p2", name: "Bob", status: "active" }),
    ];
    renderRoster();

    expect(await screen.findByText("2 active members")).toBeInTheDocument();
  });

  it("hides archived members by default", async () => {
    server.rows = [
      rosterRow({ id: "bm1", person_id: "p1", name: "Alice Active", status: "active" }),
      rosterRow({ id: "bm2", person_id: "p2", name: "Bob Archived", status: "archived" }),
    ];
    renderRoster();

    expect(await screen.findByText("Alice Active")).toBeInTheDocument();
    expect(screen.queryByText("Bob Archived")).not.toBeInTheDocument();
  });

  /**
   * `sendInviteMutation`/`resendInviteMutation` — this file's own header
   * used to claim `queryKeys.invitations.byTown` had "no reader left
   * anywhere in the app" as the reason their invalidation moved onto
   * `trpc.boardMember.pathFilter()`, but that move had never actually been
   * exercised: deleting BOTH lines left the whole 355-test web suite green.
   * Each gets its own pin below, verified by deletion in the fix report.
   *
   * Asserts a REFETCH (`stub.countFor` increasing), not `isInvalidated`:
   * `MemberRoster` is itself the active observer of `boardMember.roster` for
   * this exact `boardId`, so `invalidateQueries` triggers an immediate
   * refetch under `setupAppQueryClient()`'s `staleTime: 0` — by the time a
   * `waitFor` polls `isInvalidated`, the refetch may have already completed
   * and cleared it, which is a race the `isInvalidated` shape (correct for
   * `ArchiveBoardDialog`'s tests, where the target query has no live
   * observer in that test) cannot see through here.
   */
  it("invalidates trpc.boardMember.pathFilter() after sending an invitation", async () => {
    server.rows = [
      rosterRow({
        id: "bm1",
        person_id: "p1",
        name: "Jamie Clerk",
        invitation_id: "inv-1",
        invitation_status: "pending",
        invitation_sent_at: null,
      }),
    ];

    const { user } = renderRoster();
    await screen.findByText("Jamie Clerk");
    const before = stub.countFor("boardMember.roster");

    await user.click(screen.getByTitle("Send invitation email"));

    await waitFor(() =>
      expect(apiJsonMock).toHaveBeenCalledWith("/api/invitations/inv-1/send", { method: "POST" }),
    );
    await waitFor(() => expect(stub.countFor("boardMember.roster")).toBeGreaterThan(before));
  });

  it("invalidates trpc.boardMember.pathFilter() after resending an invitation", async () => {
    server.rows = [
      rosterRow({
        id: "bm1",
        person_id: "p1",
        name: "Jamie Clerk",
        invitation_id: "inv-1",
        invitation_status: "expired",
        invitation_sent_at: "2026-01-01T00:00:00Z",
      }),
    ];

    const { user } = renderRoster();
    await screen.findByText("Jamie Clerk");
    const before = stub.countFor("boardMember.roster");

    await user.click(screen.getByTitle("Resend invitation"));

    await waitFor(() =>
      expect(apiJsonMock).toHaveBeenCalledWith("/api/invitations/inv-1/resend", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(stub.countFor("boardMember.roster")).toBeGreaterThan(before));
  });
});
