/**
 * `MeetingSubnavHeader` — Phase E, wave 6, Task 5.
 *
 * Untested while it made a live raw `meeting` read with a PostgREST to-one
 * embed, the same silent shape as `CommandPalette`. Real options proxy, real
 * `QueryClient`, transport stubbed (conventions item 8).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen, setupAppQueryClient, waitFor } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1", role: "admin", email: "a@b.test" }),
}));

const meetingDetail = {
  id: "m1",
  board_id: "b1",
  title: "Regular Meeting",
  status: "noticed",
  meeting_type: "regular",
  agenda_status: "published",
  scheduled_date: "2026-09-10",
  scheduled_time: "18:00:00",
  location: "Town Hall",
  presiding_officer_id: null,
  recording_secretary_id: null,
  current_agenda_item_id: null,
  started_at: null,
  ended_at: null,
  agenda_packet_url: null,
  agenda_packet_generated_at: null,
  meeting_notice_url: null,
  meeting_notice_generated_at: null,
  adjournment: null,
  board_name: "Select Board",
  // `satisfies ... & { adjournment: unknown }`, not a plain annotation: an
  // `unknown`-typed property is inferred as OPTIONAL through
  // `inferRouterOutputs`, so annotating this constant with the procedure's
  // output type drops `adjournment` from the handler's required shape. Same
  // quirk `meetings.$meetingId.minutes.test.tsx` documents on its own copy.
} satisfies RouterOutputs["meeting"]["detail"] & { adjournment: unknown };

const server = { rejects: false as boolean | "NOT_FOUND" };

const stub = installTRPCFetchStub({
  "meeting.detail": () => {
    if (server.rejects === "NOT_FOUND") trpcTestError("NOT_FOUND");
    if (server.rejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return meetingDetail;
  },
});

import { MeetingSubnavHeader } from "../MeetingSubnavHeader";

const queryClient = setupAppQueryClient();

describe("MeetingSubnavHeader", () => {
  beforeEach(() => {
    server.rejects = false;
  });

  it("renders the board name, the meeting title and its status", async () => {
    renderWithProviders(<MeetingSubnavHeader meetingId="m1" />, {
      queryClient,
      route: "/meetings/m1/agenda",
    });
    // `board_name` is the column wave 6 Task 5 joined into `meeting.detail`
    // specifically for this strip.
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(screen.getByText("Regular Meeting")).toBeInTheDocument();
    expect(screen.getByText("Noticed")).toBeInTheDocument();
  });

  it("marks the tab matching the current URL", async () => {
    renderWithProviders(<MeetingSubnavHeader meetingId="m1" />, {
      queryClient,
      route: "/meetings/m1/review",
    });
    await screen.findByText("Select Board");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
  });

  it("says so when the meeting cannot be loaded, instead of silently showing 'Meeting'", async () => {
    // The raw query answered `null` for a missing row, a foreign row and a
    // transport failure alike, and this strip rendered its placeholder for
    // all three. Deleting the `isError` branch turns this red.
    server.rejects = "NOT_FOUND";
    renderWithProviders(<MeetingSubnavHeader meetingId="m1" />, {
      queryClient,
      route: "/meetings/m1/agenda",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load this meeting's details/i,
    );
  });

  it("refetches when a writer invalidates trpc.meeting.pathFilter()", async () => {
    renderWithProviders(<MeetingSubnavHeader meetingId="m1" />, {
      queryClient,
      route: "/meetings/m1/agenda",
    });
    await screen.findByText("Select Board");
    const before = stub.countFor("meeting.detail");

    await queryClient.invalidateQueries(trpc.meeting.pathFilter());

    await waitFor(() => expect(stub.countFor("meeting.detail")).toBeGreaterThan(before));
  });
});
