/**
 * Meeting detail shell — all nine reads on tRPC (wave 3, Task 3).
 *
 * Same harness discipline as `boards.$boardId.test.tsx`, the file this phase
 * copies from: `@/lib/trpc` is left unmocked so the real options proxy
 * produces real query keys, and only `globalThis.fetch` is replaced via
 * `installTRPCFetchStub` — see `src/test/trpc.ts` for why that distinction
 * is the whole point (it is what lets the last test below prove a writer's
 * `invalidateQueries(trpc.meeting.pathFilter())` actually reaches this
 * screen's read, and it is what makes every stubbed payload here type-checked
 * against the real router rather than invented by the test).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import MeetingDetail from "../meetings.$meetingId";

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns between refetches. */
const server = {
  meetingTitle: "Annual Town Meeting",
  status: "noticed" as string,
  detailRejects: false,
  presidingName: "Jordan Presiding",
  secretaryName: "Sam Secretary",
  agendaItemCount: 3,
  minutesStatus: null as string | null,
  attendanceCount: 0,
};

const BOARD_ID = "b1";
const PRESIDING_ID = "11111111-1111-1111-1111-111111111111";
const SECRETARY_ID = "22222222-2222-2222-2222-222222222222";

// Collection scope, once per file — see `installTRPCFetchStub`'s doc comment.
// Per-test variation goes through `server` above, which the handlers close
// over, not through a second install.
const stub = installTRPCFetchStub({
  "meeting.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return {
      id: "m1",
      board_id: BOARD_ID,
      title: server.meetingTitle,
      status: server.status,
      meeting_type: "regular",
      agenda_status: "draft",
      scheduled_date: "2026-03-14",
      scheduled_time: "19:00",
      location: "Town Hall",
      presiding_officer_id: PRESIDING_ID,
      recording_secretary_id: SECRETARY_ID,
      started_at: null,
      ended_at: null,
    };
  },
  "board.detail": () => ({
    id: BOARD_ID,
    name: "Select Board",
    board_type: "select_board",
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
  }),
  "person.detail": (input) => {
    if (input.personId === SECRETARY_ID) return { id: SECRETARY_ID, name: server.secretaryName };
    return { id: PRESIDING_ID, name: server.presidingName };
  },
  "agendaItem.countByMeeting": () => server.agendaItemCount,
  "minutesDocument.byMeeting": () =>
    server.minutesStatus ? { id: "doc1", status: server.minutesStatus } : null,
  "meetingAttendance.countByMeeting": () => server.attendanceCount,
});

function renderRoute(meetingId: string) {
  return renderWithProviders(
    <MeetingDetail {...({ loaderData: { meetingId } } as Parameters<typeof MeetingDetail>[0])} />,
    { route: `/meetings/${meetingId}`, queryClient },
  );
}

describe("meeting detail", () => {
  beforeEach(() => {
    server.meetingTitle = "Annual Town Meeting";
    server.status = "noticed";
    server.detailRejects = false;
    server.presidingName = "Jordan Presiding";
    server.secretaryName = "Sam Secretary";
    server.agendaItemCount = 3;
    server.minutesStatus = null;
    server.attendanceCount = 0;
  });

  it("shows the meeting's title, board, presiding officer, and agenda item count", async () => {
    renderRoute("m1");
    expect((await screen.findAllByText("Annual Town Meeting")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Jordan Presiding")).toBeInTheDocument();
    expect(await screen.findByText("Sam Secretary")).toBeInTheDocument();
    expect(await screen.findByText("3 items")).toBeInTheDocument();
  });

  it("links the board breadcrumb through the meeting's own board_id", async () => {
    // The one property this shell exists to guarantee downstream: every
    // board-scoped link on this page is built from `meeting.detail`'s own
    // `board_id`, not a prop or a second read.
    renderRoute("m1");
    const boardLink = await screen.findByRole("link", { name: "Select Board" });
    expect(boardLink).toHaveAttribute("href", `/boards/${BOARD_ID}`);
  });

  it("shows attendance only once some has been recorded", async () => {
    renderRoute("m1");
    await screen.findAllByText("Annual Town Meeting");
    expect(screen.queryByText(/member.*recorded/)).not.toBeInTheDocument();

    server.attendanceCount = 4;
    await queryClient.invalidateQueries(trpc.meetingAttendance.pathFilter());
    expect(await screen.findByText("4 members recorded")).toBeInTheDocument();
  });

  it("shows a Run Meeting action only when the status allows it", async () => {
    server.status = "draft";
    renderRoute("m1");
    await screen.findAllByText("Annual Town Meeting");
    expect(screen.queryByRole("link", { name: /Run Meeting/ })).not.toBeInTheDocument();
  });

  it("shows an error state when meeting.detail rejects, not an empty page", async () => {
    server.detailRejects = true;
    renderRoute("m1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This meeting could not be found.")).toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.meeting.pathFilter()", async () => {
    // This is the assertion invented query keys could never make. With the
    // real proxy in play, the key `CancelMeetingDialog`/`MeetingStartFlow`
    // already invalidate via `trpc.meeting.pathFilter()` is the exact key
    // this screen reads under.
    renderRoute("m1");
    expect((await screen.findAllByText("Annual Town Meeting")).length).toBeGreaterThan(0);
    const before = stub.countFor("meeting.detail");

    server.meetingTitle = "Renamed Meeting";
    await queryClient.invalidateQueries(trpc.meeting.pathFilter());

    await waitFor(() => {
      expect(stub.countFor("meeting.detail")).toBeGreaterThan(before);
    });
    expect((await screen.findAllByText("Renamed Meeting")).length).toBeGreaterThan(0);
  });
});
