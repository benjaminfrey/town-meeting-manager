/**
 * Board meetings tab (/boards/:boardId/meetings) — `board.detail`/
 * `meeting.byBoard` on tRPC.
 *
 * Phase E, wave 3, Task 2. Same shape as `boards.$boardId.test.tsx`:
 * `@/lib/trpc` is NOT mocked, only `globalThis.fetch` is replaced via
 * `installTRPCFetchStub`.
 *
 * `CreateMeetingDialog`/`CancelMeetingDialog` are mocked away — both are
 * always mounted by this route (the former unconditionally, the latter once
 * a row's Cancel button is clicked), and each has its own dedicated writer
 * test (`CreateMeetingDialog.test.tsx`, `CancelMeetingDialog.test.tsx`) that
 * pins its own `trpc.meeting.pathFilter()` call — matching how
 * `boards.tsx`'s own route test does not re-verify `EditBoardDialog`'s
 * writes either.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { type RouterOutputs } from "@/lib/trpc";
import MeetingListPage from "../boards.$boardId.meetings";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

vi.mock("@/components/meetings/CreateMeetingDialog", () => ({
  CreateMeetingDialog: () => null,
}));
vi.mock("@/components/meetings/CancelMeetingDialog", () => ({
  CancelMeetingDialog: () => null,
}));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

const boardDetail = {
  id: "b1",
  name: "Select Board",
  board_type: "other",
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
} satisfies RouterOutputs["board"]["detail"];

const meetingRow = {
  id: "m1",
  title: "Regular Meeting",
  status: "noticed",
  meeting_type: "regular",
  agenda_status: "draft",
  scheduled_date: "2026-09-10",
  scheduled_time: "18:00:00",
} satisfies RouterOutputs["meeting"]["byBoard"][number];

const server = {
  meetings: [meetingRow] as RouterOutputs["meeting"]["byBoard"],
  boardRejects: false,
  meetingsReject: false,
};

installTRPCFetchStub({
  "board.detail": () => {
    if (server.boardRejects) trpcTestError("NOT_FOUND");
    return boardDetail;
  },
  "meeting.byBoard": () => {
    if (server.meetingsReject) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.meetings;
  },
});

function renderRoute(boardId: string) {
  return renderWithProviders(
    <MeetingListPage {...({ loaderData: { boardId } } as Parameters<typeof MeetingListPage>[0])} />,
    { route: `/boards/${boardId}/meetings`, queryClient },
  );
}

describe("board meetings tab", () => {
  it("shows the board name and its meetings", async () => {
    server.boardRejects = false;
    server.meetingsReject = false;
    renderRoute("b1");

    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Regular Meeting")).toBeInTheDocument();
    expect(screen.getByText("Noticed")).toBeInTheDocument();
  });

  it("shows a not-found error when board.detail rejects", async () => {
    server.boardRejects = true;
    server.meetingsReject = false;
    renderRoute("b1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This board could not be found.")).toBeInTheDocument();
  });

  it("shows a generic error when meeting.byBoard rejects", async () => {
    server.boardRejects = false;
    server.meetingsReject = true;
    renderRoute("b1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Something went wrong loading its meetings."),
    ).toBeInTheDocument();
  });
});
